"""Premieres: shared films anyone can watch (#premieres, #screen/<key>), reports, and the media endpoint.

/_/api/m/<take key>-m (motion JSON) and -a (voice) serve a take's recordings. The key is random per take and only ever
sent to people allowed to see that production (the owner, a paired headset, viewers of a shared or demo film).
"""
import anvil
import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables

from . import common as C
from . import DemoData, Productions


@anvil.server.callable
def premieres_list():
    DemoData.ensure_loaded()
    me = C.me()
    rows = [p for p in app_tables.productions.search(tables.order_by("updated", ascending=False), shared=True) if (p["reports"] or 0) < 3]
    rows.sort(key=lambda p: (not p["featured"], -(p["views"] or 0)))
    return {"films": [Productions.card(p, me) for p in rows[:60]], "total": len(rows)}


@anvil.server.callable
def screen_get(key):
    """A shared film for the screening room (counts a view)."""
    key = C.text(key, 40)
    p = app_tables.productions.get(share_key=key) if key else None
    if p is None or not p["shared"] or (p["reports"] or 0) >= 3:
        return C.fail("This film isn't showing any more. It may have been unshared by its maker.")
    if not C.rate_limited("view_" + key, 1, 1800):
        p["views"] = (p["views"] or 0) + 1
    me = C.me()
    return C.ok(production=Productions.full(p, me is not None and p["owner"] == me, me))


@anvil.server.callable
def screen_report(key, reason):
    key = C.text(key, 40)
    p = app_tables.productions.get(share_key=key) if key else None
    if p is None:
        return C.ok()
    if C.rate_limited("report", 3, 3600) or C.rate_limited("report_" + key, 1, 86400):
        return C.ok()
    p["reports"] = (p["reports"] or 0) + 1
    from . import Feedback
    Feedback.record("report", "Film reported: %s (%s)" % (p["title"], C.text(reason, 300)), {"film": p.get_id(), "key": key})
    return C.ok()


@anvil.server.http_endpoint("/m/:key")
def media(key, **kw):
    key = str(key or "")
    base, _, kind = key.rpartition("-")
    t = app_tables.takes.get(key=base) if base and kind in ("m", "a") else None
    if t is None:
        return anvil.server.HttpResponse(404, "Not found")
    m = t["motion"] if kind == "m" else t["audio"]
    if m is None:
        return anvil.server.HttpResponse(404, "Not found")
    return anvil.server.HttpResponse(200, m, headers={"Cache-Control": "private, max-age=604800, immutable",
                                                      "Content-Type": m.content_type or "application/octet-stream"})
