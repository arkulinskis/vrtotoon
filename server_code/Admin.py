"""Admin page callables: overview, users (make admin, disable), demo data. Admins only.
Feedback admin calls live in Feedback.py."""
import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables

from . import common as C
from . import DemoData, Feedback


@anvil.server.callable(require_user=True)
def admin_overview():
    C.require_admin()
    return {"users": len([u for u in app_tables.users.search() if not u["is_demo"]]),
            "admins": len(app_tables.users.search(is_admin=True)),
            "feedback_new": Feedback.new_count(),
            "productions": len([p for p in app_tables.productions.search() if not p["is_demo"]]),
            "takes": len([t for t in app_tables.takes.search() if not t["is_demo"]]),
            "shared": len(app_tables.productions.search(shared=True)),
            "demo": {"state": DemoData.state(), "counts": DemoData.counts()}}


def _user(u):
    return {"id": u.get_id(), "email": u["email"], "name": C.name_of(u), "is_admin": C.is_admin(u),
            "enabled": u["enabled"] is not False, "joined": C.iso(u["signed_up"]), "last_seen": C.iso(u["last_seen"])}


@anvil.server.callable(require_user=True)
def list_users(query=None):
    C.require_admin()
    query = C.text(query, 80).lower()
    rows = [u for u in app_tables.users.search(tables.order_by("signed_up", ascending=False)) if not u["is_demo"]]
    if query:
        rows = [u for u in rows if query in (u["email"] or "").lower() or query in (u["display_name"] or "").lower()]
    return {"users": [_user(u) for u in rows[:200]], "total": len(rows)}


@anvil.server.callable(require_user=True)
def set_admin(user_id, flag):
    me = C.require_admin()
    u = C.row_by_id(app_tables.users, user_id)
    if u is None:
        return C.fail("That account no longer exists.")
    if u == me and not flag:
        return C.fail("You can't remove your own admin rights.")
    u["is_admin"] = bool(flag)
    return C.ok(user=_user(u))


@anvil.server.callable(require_user=True)
def set_enabled(user_id, flag):
    me = C.require_admin()
    u = C.row_by_id(app_tables.users, user_id)
    if u is None:
        return C.fail("That account no longer exists.")
    if u == me:
        return C.fail("You can't disable your own account.")
    u["enabled"] = bool(flag)
    return C.ok(user=_user(u))


@anvil.server.callable(require_user=True)
def demo_load():
    C.require_admin()
    DemoData.load()
    return C.ok(demo={"state": DemoData.state(), "counts": DemoData.counts()})


@anvil.server.callable(require_user=True)
def demo_remove():
    C.require_admin()
    DemoData.remove()
    return C.ok(demo={"state": DemoData.state(), "counts": DemoData.counts()})


def _film(p):
    d = p["data"] or {}
    return {"id": p.get_id(), "title": p["title"] or "Untitled", "owner": C.name_of(p["owner"]), "shared": bool(p["shared"]),
            "featured": bool(p["featured"]), "views": p["views"] or 0, "reports": p["reports"] or 0, "demo": bool(p["is_demo"]),
            "key": p["share_key"] or "", "lines": len(d.get("beats") or []), "takes": len(app_tables.takes.search(production=p)),
            "updated": C.iso(p["updated"])}


@anvil.server.callable(require_user=True)
def admin_films(query=None):
    """Every production, shared and reported ones first."""
    C.require_admin()
    q = C.text(query, 80).lower()
    rows = list(app_tables.productions.search(tables.order_by("updated", ascending=False)))
    if q:
        rows = [p for p in rows if q in (p["title"] or "").lower() or q in C.name_of(p["owner"]).lower()]
    rows.sort(key=lambda p: (-(p["reports"] or 0), not p["shared"]))
    return {"films": [_film(p) for p in rows[:200]], "total": len(rows)}


@anvil.server.callable(require_user=True)
def admin_feature(pid, flag):
    C.require_admin()
    p = C.row_by_id(app_tables.productions, pid)
    if p is None:
        return C.fail("That picture no longer exists.")
    p["featured"] = bool(flag)
    return C.ok(film=_film(p))


@anvil.server.callable(require_user=True)
def admin_unshare(pid):
    C.require_admin()
    p = C.row_by_id(app_tables.productions, pid)
    if p is None:
        return C.fail("That picture no longer exists.")
    p.update(shared=False, featured=False)
    return C.ok(film=_film(p))


@anvil.server.callable(require_user=True)
def admin_clear_reports(pid):
    C.require_admin()
    p = C.row_by_id(app_tables.productions, pid)
    if p is None:
        return C.fail("That picture no longer exists.")
    p["reports"] = 0
    return C.ok(film=_film(p))
