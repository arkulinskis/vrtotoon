"""The headset link: the PC and the headset work on the same production at the same time.

PC (signed in):   stage_link(pid) -> a 4-letter code;  stage_status(pid, since) -> is the headset there, new takes;
                  stage_call(pid, call) = "next: MAX, lines 3 to 5";  stage_note(pid, text) = a note on the teleprompter
Headset (no sign-in needed, typing on a headset is painful): #door, type the code -> stage_join(code) puts the
                  production in this browser session (12 hours) -> #stage/<pid>: stage_get, stage_poll, stage_save_pass.
A signed-in owner can use the stage_* calls directly too (one person, one browser, no code needed).
"""
import datetime as dt
import random
import typing

import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables

from . import common as C
from . import Productions, Takes

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ"  # no I, L, O: easy to read and to press on a headset
HOURS = 12


def _session():
    s = anvil.server.session.get("stage")
    return s if isinstance(s, dict) else None


def access(pid):
    """(production, owner) for the owner or a paired headset session, else (None, None)."""
    me = C.me()
    p = C.row_by_id(app_tables.productions, pid)
    if p is None:
        return None, None
    if me is not None and (p["owner"] == me or C.is_admin(me)):
        return p, p["owner"]
    s = _session()
    if s and s.get("pid") == pid:
        link = C.row_by_id(app_tables.stage_links, s.get("link"))
        if link is not None and link["production"] == p and link["expires"] and link["expires"] > C.now():
            return p, p["owner"]
    return None, None


def _link(p):
    return app_tables.stage_links.get(production=p)


def _online(link):
    return bool(link and link["last_seen"] and (C.now() - link["last_seen"]).total_seconds() < 15)


@anvil.server.callable(require_user=True)
def stage_link(pid):
    """Make (or refresh) this production's headset code."""
    me = C.require_user()
    p = Productions.owned(pid, me)
    if p is None:
        return C.fail("Only the owner can open the stage door for this picture.")
    link = _link(p)
    if link is None or not link["expires"] or link["expires"] < C.now():
        used = {row["code"] for row in app_tables.stage_links.search() if row["expires"] and row["expires"] > C.now()}
        code = "".join(random.choice(ALPHABET) for _ in range(4))
        while code in used:
            code = "".join(random.choice(ALPHABET) for _ in range(4))
        if link is None:
            link = app_tables.stage_links.add_row(owner=me, production=p, code=code, created=C.now(), passes=0, note="", call=None, device="")
        link.update(code=code, expires=C.now() + dt.timedelta(hours=HOURS), last_seen=None)
    return C.ok(code=link["code"], expires=C.iso(link["expires"]), online=_online(link), device=link["device"] or "")


@anvil.server.callable
def stage_join(code):
    """The headset types the code: this browser session may now perform in that production."""
    code = C.text(code, 8).upper().replace(" ", "")
    if C.rate_limited("stage_join", 12, 600):
        return C.fail("Too many tries. Wait a few minutes, then type the code again.")
    link = app_tables.stage_links.get(code=code) if len(code) == 4 else None
    if link is None or not link["expires"] or link["expires"] < C.now() or link["production"] is None:
        return C.fail("That code doesn't open any stage door. Check it on your computer (Headset button in the editor).")
    typing.cast(dict, anvil.server.session)["stage"] = {"pid": link["production"].get_id(), "link": link.get_id()}
    link["last_seen"] = C.now()
    return C.ok(pid=link["production"].get_id(), title=link["production"]["title"])


@anvil.server.callable
def stage_get(pid):
    """The production for the performance stage (owner or paired headset)."""
    p, owner = access(pid)
    if p is None:
        return C.fail("This stage door is closed. Pair the headset again with the code from your computer.")
    out = Productions.full(p, True, owner)
    link = _link(p)
    out["call"] = link["call"] if link else None
    out["note"] = link["note"] if link else ""
    return C.ok(production=out)


@anvil.server.callable
def stage_poll(pid, device=None):
    """Every few seconds from the headset: the director's call + note, and the production's revision."""
    p, owner = access(pid)
    if p is None:
        return C.fail("This stage door is closed.")
    link = _link(p)
    if link is not None:
        link.update(last_seen=C.now(), device=C.text(device, 60) or link["device"])
    return C.ok(rev=p["rev"] or 0, call=link["call"] if link else None, note=link["note"] if link else "")


@anvil.server.callable
def stage_save_pass(pid, meta, motion_json, audio=None):
    """A kept pass from the headset (or the owner's own browser)."""
    p, owner = access(pid)
    if p is None:
        return C.fail("This stage door is closed. Pair the headset again, then keep the take.")
    if C.rate_limited("take_save", 120, 3600):
        return C.fail("That's a lot of takes in one hour. Take a break and try again soon.")
    r = Takes.save_take(p, owner, meta, motion_json, audio)
    link = _link(p)
    if r.get("ok") and link is not None:
        link["passes"] = (link["passes"] or 0) + 1
    return r


@anvil.server.callable(require_user=True)
def stage_status(pid, since=None):
    """For the PC: is the headset connected, and which takes arrived since `since` (ISO)."""
    p = Productions.owned(pid)
    if p is None:
        return C.fail("Only the owner can watch this stage.")
    link = _link(p)
    t0 = C.parse_iso(since)
    rows = app_tables.takes.search(tables.order_by("created", ascending=True), production=p)
    new = [Productions.take_dict(t) for t in rows if t0 is None or (t["created"] and t["created"] >= t0)]
    sel = (p["data"] or {}).get("sel") or {}
    return C.ok(online=_online(link), device=(link["device"] if link else "") or "", code=link["code"] if link and link["expires"] and link["expires"] > C.now() else "",
                takes=new if t0 is not None else [], sel={k: v for k, v in sel.items() if v in {t["uid"] for t in new}},
                rev=p["rev"] or 0, now=C.iso(C.now()), passes=(link["passes"] if link else 0) or 0)


@anvil.server.callable(require_user=True)
def stage_call(pid, call):
    """The director asks the headset for the next take: {actor, from, to} (beat ids)."""
    p = Productions.owned(pid)
    if p is None:
        return C.fail("Only the owner can direct this stage.")
    link = _link(p)
    if link is None:
        return C.fail("Open the headset link first.")
    if not isinstance(call, dict):
        link["call"] = None
        return C.ok()
    beats = {b.get("id") for b in (p["data"] or {}).get("beats") or []}
    cast = {c.get("id") for c in (p["data"] or {}).get("cast") or []}
    if call.get("actor") not in cast:
        return C.fail("Pick a character from the cast.")
    clean = {"actor": call["actor"], "from": call.get("from") if call.get("from") in beats else None,
             "to": call.get("to") if call.get("to") in beats else None, "id": C.rand_key(8), "at": C.iso(C.now())}
    link["call"] = clean
    return C.ok(call=clean)


@anvil.server.callable(require_user=True)
def stage_note(pid, note):
    p = Productions.owned(pid)
    link = p and _link(p)
    if not link:
        return C.fail("Open the headset link first.")
    link["note"] = C.text(note, 120)
    return C.ok()
