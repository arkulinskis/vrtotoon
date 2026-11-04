"""Productions (a film being made): the Lot (home page), create, open, autosave, copy, share, poster, delete.

The document itself (cast, beats, blocking, shots, look...) is built and edited in the browser (theme/assets/vt-film.js);
the server stores it as one simpleObject, checks its size and shape, and keeps `title` / `rev` columns in step.
Anyone may OPEN a demo or shared production read-only (the editor then works as a sandbox); only the owner saves.
"""
import json

import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables

from . import common as C
from . import DemoData

MAX_JSON = 700_000
LIMITS = {"cast": 12, "beats": 400, "shots": 600, "sfx": 400, "custom": 16}


def clean_doc(d):
    """The stored document: a dict with the expected lists, capped. None if it isn't one."""
    if not isinstance(d, dict):
        return None
    out = dict(d)
    out["title"] = C.text(d.get("title") or "Untitled picture", 80)
    for k, n in LIMITS.items():
        v = out.get(k)
        if k == "custom":
            out[k] = dict(list(v.items())[:n]) if isinstance(v, dict) else {}
        else:
            out[k] = [x for x in v if isinstance(x, dict)][:n] if isinstance(v, list) else []
    for b in out["beats"]:
        b["text"] = C.text(b.get("text"), 400)
    for c in out["cast"]:
        c["name"] = C.text(c.get("name") or "ACTOR", 24)
    keys = out.get("keys")
    if not isinstance(keys, dict):
        keys = {}
    out["keys"] = {k: [x for x in (keys.get(k) or []) if isinstance(x, dict)][:1500] for k in ("move", "emo", "act", "look")}
    out["sel"] = {str(k)[:60]: str(v)[:40] for k, v in list((out.get("sel") or {}).items())[:3000]} if isinstance(out.get("sel"), dict) else {}
    return out


def owned(pid, me=None):
    """The production if `me` may change it (owner or admin), else None."""
    me = me or C.me()
    p = C.row_by_id(app_tables.productions, pid)
    if p is None or me is None:
        return None
    if p["owner"] != me and not C.is_admin(me):
        return None
    return p


def readable(pid, me=None):
    """(row, can_edit) for anyone allowed to look: owner, admin, demo or shared productions."""
    me = me if me is not None else C.me()
    p = C.row_by_id(app_tables.productions, pid)
    if p is None:
        return None, False
    mine = me is not None and (p["owner"] == me or C.is_admin(me))
    if mine:
        return p, True
    if p["is_demo"] or p["shared"]:
        return p, False
    return None, False


def card(p, me=None):
    """A production for lists (no document)."""
    d = p["data"] or {}
    return {"id": p.get_id(), "title": p["title"] or "Untitled picture", "logline": p["logline"] or "", "set": d.get("set") or "soundstage",
            "grade": (d.get("look") or {}).get("grade") or "technicolor",
            "cast": [c.get("char") for c in (d.get("cast") or [])][:6], "custom": d.get("custom") or {},
            "lines": len([b for b in (d.get("beats") or []) if b.get("kind") == "line"]),
            "takes": len(app_tables.takes.search(production=p)), "poster": p["poster"] or "",
            "shared": bool(p["shared"]), "share_key": p["share_key"] if p["shared"] else "", "featured": bool(p["featured"]),
            "views": p["views"] or 0, "updated": C.iso(p["updated"]), "created": C.iso(p["created"]), "demo": bool(p["is_demo"]),
            "mine": me is not None and p["owner"] == me, "owner": C.name_of(p["owner"])}


def take_dict(t):
    k = t["key"] or ""
    return {"uid": t["uid"], "actor": t["actor"], "source": t["source"] or "vr", "clips": t["clips"] or [], "dur": t["dur"] or 0,
            "motion_key": (k + "-m") if t["motion"] is not None else "", "audio_key": (k + "-a") if t["audio"] is not None else "",
            "asset": t["asset"] or "", "stars": t["stars"] or 0, "created": C.iso(t["created"])}


def full(p, can_edit, me=None):
    takes = app_tables.takes.search(tables.order_by("created", ascending=True), production=p)
    out = card(p, me)
    out.update({"data": json.dumps(p["data"] or {}), "rev": p["rev"] or 0, "can_edit": can_edit, "synced_at": C.iso(C.now()),
                "takes": [take_dict(t) for t in takes]})
    return out


@anvil.server.callable(require_user=True)
def lot_home():
    """Everything the Lot (home) needs: my productions, my wardrobe count, featured premieres."""
    DemoData.ensure_loaded()
    me = C.require_user()
    mine = app_tables.productions.search(tables.order_by("updated", ascending=False), owner=me)
    feats = [p for p in app_tables.productions.search(tables.order_by("views", ascending=False), shared=True) if not p["reports"] or p["reports"] < 3]
    feats.sort(key=lambda p: (not p["featured"], -(p["views"] or 0)))
    return {"productions": [card(p, me) for p in mine[:60]], "total": len(mine),
            "wardrobe": len(app_tables.characters.search(owner=me)),
            "premieres": [card(p, me) for p in feats[:6]],
            "demos": [card(p, me) for p in app_tables.productions.search(is_demo=True)][:6]}


@anvil.server.callable(require_user=True)
def production_new(title, data_json):
    me = C.require_user()
    title = C.text(title, 80)
    if len(title) < 1:
        return C.fail("Give your picture a title.")
    if C.rate_limited("production_new", 20, 3600):
        return C.fail("That's a lot of new pictures in one hour. Take a break and try again soon.")
    if not isinstance(data_json, str) or len(data_json) > MAX_JSON:
        return C.fail("That production is too big.")
    try:
        doc = clean_doc(json.loads(data_json))
    except ValueError:
        doc = None
    if doc is None:
        return C.fail("That production couldn't be read.")
    doc["title"] = title
    if len(app_tables.productions.search(owner=me)) >= 200:
        return C.fail("You have 200 productions. Delete an old one to start another.")
    p = app_tables.productions.add_row(owner=me, title=title, logline="", data=doc, poster="", rev=1, share_key="", shared=False,
                                       featured=False, views=0, reports=0, created=C.now(), updated=C.now(), is_demo=False)
    return C.ok(id=p.get_id())


@anvil.server.callable
def production_get(pid):
    """The whole production for the editor. Owners edit; anyone may open demo or shared ones as a sandbox."""
    me = C.me()
    p, can_edit = readable(pid, me)
    if p is None:
        return C.fail("This picture is private, or it no longer exists.")
    return C.ok(production=full(p, can_edit, me))


def merge_sel(p, doc, synced_at):
    """Keep selections made elsewhere (the headset) since this browser last synced, so an autosave never undoes a new take."""
    since = C.parse_iso(synced_at)
    old = (p["data"] or {}).get("sel") or {}
    if since is None or not old:
        return doc
    fresh = {t["uid"] for t in app_tables.takes.search(production=p) if t["created"] and t["created"] >= since}
    for k, v in old.items():
        if v in fresh and doc["sel"].get(k) != v:
            doc["sel"][k] = v
    return doc


@anvil.server.callable(require_user=True)
def production_save(pid, data_json, synced_at=None):
    me = C.require_user()
    p = owned(pid, me)
    if p is None:
        return C.fail("Only the owner can save this picture. Make your own copy to keep changes.")
    if not isinstance(data_json, str) or len(data_json) > MAX_JSON:
        return C.fail("This production is too big to save (over 700 KB). Remove some beats or keys.")
    try:
        doc = clean_doc(json.loads(data_json))
    except ValueError:
        doc = None
    if doc is None:
        return C.fail("That production couldn't be read.")
    doc = merge_sel(p, doc, synced_at)
    p.update(data=doc, title=doc["title"], rev=(p["rev"] or 0) + 1, updated=C.now())
    return C.ok(rev=p["rev"], saved=C.iso(p["updated"]), sel=doc["sel"])


@anvil.server.callable(require_user=True)
def production_logline(pid, text):
    p = owned(pid)
    if p is None:
        return C.fail("Only the owner can change this.")
    p["logline"] = C.text(text, 160)
    return C.ok()


@anvil.server.callable(require_user=True)
def production_poster(pid, data_url):
    p = owned(pid)
    if p is None:
        return C.fail("Only the owner can change the poster.")
    if not isinstance(data_url, str) or not data_url.startswith("data:image/jpeg;base64,") or len(data_url) > 220_000:
        return C.fail("That poster image is too big or not a JPEG.")
    p["poster"] = data_url
    return C.ok()


@anvil.server.callable(require_user=True)
def production_share(pid, on):
    p = owned(pid)
    if p is None:
        return C.fail("Only the owner can share this picture.")
    if on and not p["share_key"]:
        p["share_key"] = C.rand_key(12)
    p["shared"] = bool(on)
    if on:
        p["reports"] = 0
    return C.ok(shared=p["shared"], share_key=p["share_key"] if p["shared"] else "")


@anvil.server.callable(require_user=True)
def production_copy(pid):
    """Copy a demo, a shared picture or your own: the document and every take (the recordings are shared, not duplicated)."""
    me = C.require_user()
    p, _ = readable(pid, me)
    if p is None:
        return C.fail("This picture is private, or it no longer exists.")
    if C.rate_limited("production_new", 20, 3600):
        return C.fail("That's a lot of new pictures in one hour. Take a break and try again soon.")
    doc = dict(p["data"] or {})
    doc["title"] = C.text((p["title"] or "Untitled") + " (my cut)", 80)
    q = app_tables.productions.add_row(owner=me, title=doc["title"], logline=p["logline"] or "", data=doc, poster=p["poster"] or "", rev=1,
                                       share_key="", shared=False, featured=False, views=0, reports=0, created=C.now(), updated=C.now(),
                                       is_demo=False)
    for t in app_tables.takes.search(production=p):
        app_tables.takes.add_row(production=q, owner=me, uid=t["uid"], actor=t["actor"], source=t["source"], clips=t["clips"], dur=t["dur"],
                                 motion=t["motion"], audio=t["audio"], asset=t["asset"], key=C.rand_key(24), stars=t["stars"] or 0,
                                 created=t["created"] or C.now(), is_demo=False)
    return C.ok(id=q.get_id())


@anvil.server.callable(require_user=True)
def production_delete(pid):
    p = owned(pid)
    if p is None:
        return C.fail("Only the owner can delete this picture.")
    for t in app_tables.takes.search(production=p):
        t.delete()
    for link in app_tables.stage_links.search(production=p):
        link.delete()
    p.delete()
    return C.ok()
