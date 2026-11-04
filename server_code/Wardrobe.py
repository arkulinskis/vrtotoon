"""The wardrobe: your own characters, made in the character editor (#wardrobe): a premade character to start from
({base}) plus everything you changed: species, colours, body (build), face, hair, hat, accessories, name, tagline, role
and voice note.

A character is data only: the browser builds it with VT.makeDef(base, overrides). When it joins a cast, the editor copies
its definition into the production (doc.custom), so films stay complete even if the character changes later.
"""
import re

import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables

from . import common as C

UID = re.compile(r"^c_[a-z0-9]{6,16}$")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
FIELDS = {"base", "name", "colors", "build", "face", "hair", "hat", "acc", "species", "tag", "role", "voice"}
COLOR_KEYS = {"skin", "fur2", "hair", "shirt", "pants", "shoes", "accent", "eyes", "hat", "gloves"}
# face sliders: name -> (lowest, highest); switches are 0/1
FACE_RANGES = {"eyes": (0.5, 1.6), "spread": (0.6, 1.5), "lift": (-1.0, 1.0), "tall": (0.6, 1.7), "brows": (0.0, 2.2),
               "nose": (0.0, 2.0), "mouth": (0.5, 1.6), "earSize": (0.5, 1.7)}
FACE_SWITCHES = {"freckles", "lashes", "cheeks"}
EARS = {"auto", "none", "human", "round", "point", "long", "flop", "horn", "antenna"}
ROLES = {"lead", "sidekick", "villain", "character", "creature"}
VOICES = {"bright", "warm", "deep", "smoky", "grand", "radio", "robot", "echo"}


def clean_face(face):
    out = {}
    if not isinstance(face, dict):
        return out
    for k, v in face.items():
        if k in FACE_RANGES and isinstance(v, (int, float)) and not isinstance(v, bool):
            lo, hi = FACE_RANGES[k]
            out[k] = round(max(lo, min(hi, float(v))), 3)
        elif k in FACE_SWITCHES:
            out[k] = 1 if v else 0
        elif k == "ears" and v in EARS:
            out[k] = v
    return out


def clean_def(d):
    if not isinstance(d, dict):
        return None
    out = {k: v for k, v in d.items() if k in FIELDS}
    out["name"] = C.text(out.get("name") or "My character", 40)
    out["tag"] = C.text(out.get("tag") or "", 80)
    colors = out.get("colors")
    out["colors"] = {k: v for k, v in colors.items() if k in COLOR_KEYS and isinstance(v, str) and HEX.match(v)} if isinstance(colors, dict) else {}
    if "face" in out:
        out["face"] = clean_face(out["face"])
    if out.get("role") not in ROLES:
        out.pop("role", None)
    if out.get("voice") not in VOICES:
        out.pop("voice", None)
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
