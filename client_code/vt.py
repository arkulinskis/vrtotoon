"""The Python face of the VRtoToon engines (theme/assets/vt-*.js, window.VT).

The 3D characters, sets, the film model, the stage, the VR performance stage, the timeline and the exporters are
JavaScript: they run every frame, which the browser does fast and Skulpt (Anvil's client Python) does slowly. Forms never
touch window.VT directly; they call these functions or use the Components that wrap the engines.
Lists for RepeatingPanels come back as JSON from VT.ed and become plain Python dicts here (fast, one step).
"""
import json

import anvil.js
from anvil.js import window

VT = window.VT
NULL = anvil.js.call(window.Function("return null"))  # "nothing yet" for JS objects (typed Any, unlike None)


def py(x):
    """A JS value (array / object) as plain Python data."""
    if x is None:
        return None
    return json.loads(window.JSON.stringify(x))


def rows(text):
    return json.loads(text) if text else []


def set_api(origin):
    VT.API = origin or ""


# ---------------------------------------------------------------- catalogues (fixed data from the engines)
def cast_catalog():
    return py(VT.CAST)


def roles():
    return py(VT.ROLES)


def emotions():
    return py(VT.EMOTIONS)


def gestures():
    return py(VT.GESTURES)


_LISTS = {}


def _lists():
    if not _LISTS:
        _LISTS.update(json.loads(VT.ed.lists()))
    return _LISTS


def set_list():
    return _lists()["sets"]


def grades():
    return py(VT.GRADES)


_ASPECTS = []


def aspects():
    """The canvases (VT.ASPECTS): {id, name, label, use, r, sizes [[w, h]], safe?}. Ids are stored in productions."""
    if not _ASPECTS:
        _ASPECTS.extend(py(VT.ASPECTS))
    return _ASPECTS


def aspect(aspect_id):
    """One canvas by id (unknown ids: widescreen, like the engine)."""
    found = [a for a in aspects() if a["id"] == aspect_id]
    return found[0] if found else aspects()[0]


def doc_aspect(data):
    """The canvas id of a production document (JSON text or dict)."""
    try:
        d = json.loads(data) if isinstance(data, str) else (data or {})
    except ValueError:
        d = {}
    return aspect((d.get("look") or {}).get("aspect"))["id"]


def snap_size(aspect_id, longest=640):
    """(w, h) of a poster frame in this canvas, the longest side `longest` pixels."""
    r = aspect(aspect_id)["r"]
    return (longest, int(round(longest / r))) if r >= 1 else (int(round(longest * r)), longest)


def music():
    return [{"id": m["id"], "label": m["label"]} for m in py(VT.MUSIC)]


def sfx():
    return _lists()["sfx"]


def shots():
    return py(VT.SHOTS)


def moves():
    return py(VT.MOVES)


def styles():
    return py(VT.STYLES)


def templates():
    return [{"id": t["id"], "label": t["label"], "set": t["set"]} for t in py(VT.TEMPLATES)]


def voice_fx():
    return py(VT.VOICE_FX)


def hairs():
    return py(VT.HAIRS)


def hats():
    return py(VT.HATS)


def accs():
    return py(VT.ACCS)


def emoji(emo_id):
    e = VT.EMO[emo_id] if emo_id else None
    return e.emoji if e else ""


# ---------------------------------------------------------------- characters
def char_def(ref, custom=None):
    """The full definition of a premade id or a custom uid (custom = {uid: def})."""
    return py(VT.charDef(ref, custom or {}))


def make_def(base, overrides):
    return py(VT.normalize(VT.makeDef(base, overrides)))


def portrait(char, emo="happy", size=256, full=False):
    """A data URL picture of a character (char = premade id or a definition dict)."""
    if isinstance(char, str):
        char = VT.CAST_BY[char] if VT.CAST_BY[char] else VT.CAST[0]
    return VT.portrait(char, {"emo": emo, "size": size, "full": full}) or ""


def uid(prefix):
    return VT.uid(prefix)


# ---------------------------------------------------------------- productions
def new_doc_json(title, template_id, set_id=None, cast=None, aspect_id=None):
    """A new production document (JSON) from a template; cast = premade ids to use instead of the template's;
    aspect_id = the canvas (VT.ASPECTS id, default widescreen)."""
    opts = {"set": set_id} if set_id else {}
    if aspect_id:
        opts["aspect"] = aspect_id
    d = VT.newDoc(title, template_id, opts)
    if cast:
        for i, ref in enumerate(cast[:len(d.d.cast)]):
            if ref and ref != d.d.cast[i].char:
                d.d.cast[i].char = ref
                d.d.cast[i].name = ref.upper()
    return d.json()


def doc(data):
    """The engine's document object (data = the JSON text from the server)."""
    return VT.docFrom(data or "{}")


def takes(take_list, existing=None):
    return VT.takesFrom(take_list or [], existing)


def beats(d, tk):
    return rows(VT.ed.beats(d, tk))


def cast_rows(d):
    return rows(VT.ed.cast(d))


def take_rows(d, tk):
    return rows(VT.ed.takes(d, tk))


def shot_rows(d, tk):
    return rows(VT.ed.shots(d, tk))


def key_info(d, tk, key_id):
    t = VT.ed.key(d, tk, key_id)
    return json.loads(t) if t else None


def anchor(d, tk, t):
    return json.loads(VT.ed.anchor(d, tk, t))


def stats(d, tk):
    return json.loads(VT.ed.stats(d, tk))


def fmt(t):
    return VT.fmtTime(t or 0)


def parse_script(text):
    return py(VT.parseScript(text))


def script_text(d):
    return VT.scriptText(d)


def auto_direct(d, tk):
    return VT.autoDirect(d, tk)


def to_media(blob, name="voice.webm"):
    return anvil.js.to_media(blob)


def download(blob, name):
    VT.download(blob, name)


def slug(s):
    return VT.slug(s)
