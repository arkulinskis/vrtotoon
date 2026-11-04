"""The wardrobe: your own variants of the premade characters ({base, name, colors, build, hair, hat, acc}).

A variant is data only: the browser builds it with VT.makeDef(base, overrides). When a variant joins a cast, the
editor copies its definition into the production (doc.custom), so films stay complete even if the variant changes later.
"""
import re

import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables

from . import common as C

UID = re.compile(r"^c_[a-z0-9]{6,16}$")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
FIELDS = {"base", "name", "colors", "build", "hair", "hat", "acc", "species", "tag", "role"}


def clean_def(d):
    if not isinstance(d, dict):
        return None
    out = {k: v for k, v in d.items() if k in FIELDS}
    out["name"] = C.text(out.get("name") or "My character", 40)
    out["tag"] = C.text(out.get("tag") or "", 80)
    colors = out.get("colors")
    out["colors"] = {k: v for k, v in colors.items() if isinstance(v, str) and HEX.match(v)} if isinstance(colors, dict) else {}
    build = out.get("build")
    if not isinstance(build, dict):
        build = {}
    nb = {}
    for k, v in build.items():
        if k == "torso" and isinstance(v, str):
            nb[k] = v[:10]
        elif isinstance(v, (int, float)):
            nb[k] = max(0.5, min(1.6, float(v)))
    out["build"] = nb
    out["acc"] = [a for a in (out.get("acc") or []) if isinstance(a, str)][:6] if isinstance(out.get("acc"), list) else []
    for k in ("base", "hair", "hat", "species"):
        if k in out and not isinstance(out[k], str):
            del out[k]
    return out


def _row(c):
    return {"uid": c["uid"], "name": c["name"], "def": dict(c["data"] or {}), "updated": C.iso(c["updated"])}


@anvil.server.callable(require_user=True)
def wardrobe_list():
    me = C.require_user()
    return C.ok(items=[_row(c) for c in app_tables.characters.search(tables.order_by("updated", ascending=False), owner=me)])


@anvil.server.callable(require_user=True)
def wardrobe_save(uid, data):
    me = C.require_user()
    if not isinstance(uid, str) or not UID.match(uid):
        return C.fail("That character has a bad id.")
    d = clean_def(data)
    if d is None or not d.get("base"):
        return C.fail("A variant needs a premade character to start from.")
    row = app_tables.characters.get(owner=me, uid=uid)
    if row is None:
        if len(app_tables.characters.search(owner=me)) >= 60:
            return C.fail("Your wardrobe holds 60 characters. Delete one to make room.")
        row = app_tables.characters.add_row(owner=me, uid=uid, created=C.now(), is_demo=False)
    row.update(name=d["name"], data=d, updated=C.now())
    return C.ok(item=_row(row))


@anvil.server.callable(require_user=True)
def wardrobe_delete(uid):
    me = C.require_user()
    row = app_tables.characters.get(owner=me, uid=uid)
    if row is not None:
        row.delete()
    return C.ok()
