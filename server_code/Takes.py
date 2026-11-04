"""Takes: recorded passes (VR head + hands + voice, a desk-puppet pass, or voice only from the Voice booth).

A take belongs to a production and an actor (cast id) and is cut into clips per beat ({beat, off, dur, line}).
Motion is stored as JSON media, the voice as audio media; both are served by Screenings.media (/_/api/m/<key>-m|-a),
under a random key per take. save_take() is shared with the headset link (StageLink), which saves for the owner.
A face pass (the face booth: the webcam reads the performer's face while the take replays) adds `face`, a small JSON
track of 11 face controls 30 times a second (vt-face.js), served at -f; it can also replace the take's voice.
"""
import json
import re

import anvil
import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables

from . import common as C
from . import Productions

UID = re.compile(r"^t_[a-z0-9]{6,16}$")
MAX_MOTION = 2_500_000
MAX_AUDIO = 12_000_000
MAX_FACE = 1_500_000
FACE_K = 11
FACE_CHARS = set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_")
AUDIO_TYPES = ("audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "video/webm")


def clean_clips(clips, beat_ids):
    out = []
    for c in (clips or [])[:400]:
        if not isinstance(c, dict) or c.get("beat") not in beat_ids:
            continue
        try:
            off, dur = float(c.get("off") or 0), float(c.get("dur") or 0)
        except (TypeError, ValueError):
            continue
        if off < 0 or dur <= 0 or off > 3600 or dur > 120:
            continue
        out.append({"beat": c["beat"], "off": round(off, 3), "dur": round(dur, 3), "line": bool(c.get("line"))})
    return out


def save_take(p, owner, meta, motion_json, audio):
    """Validate and store one pass; select its clips in the production. Returns C.ok(take=...) or C.fail."""
    meta = meta if isinstance(meta, dict) else {}
    uid = meta.get("uid")
    if not isinstance(uid, str) or not UID.match(uid):
        return C.fail("That take has a bad id.")
    if app_tables.takes.get(production=p, uid=uid) is not None:
        return C.fail("That take is already saved.")
    doc = p["data"] or {}
    actor = meta.get("actor")
    if actor not in [c.get("id") for c in doc.get("cast") or []]:
        return C.fail("That character isn't in this cast any more.")
    clips = clean_clips(meta.get("clips"), {b.get("id") for b in doc.get("beats") or []})
    if not clips:
        return C.fail("Nothing was recorded in that take.")
    if len(app_tables.takes.search(production=p)) >= 600:
        return C.fail("This picture has 600 takes. Delete some old ones first.")
    motion = None
    if motion_json:
        if not isinstance(motion_json, str) or len(motion_json) > MAX_MOTION:
            return C.fail("That take is too long to save (keep passes under about 10 minutes).")
        try:
            m = json.loads(motion_json)
            assert isinstance(m, dict) and isinstance(m.get("f"), list)
        except (ValueError, AssertionError):
            return C.fail("That take couldn't be read.")
        motion = anvil.BlobMedia("application/json", motion_json.encode("utf-8"), name=uid + ".json")
    if audio is not None:
        ctype = (getattr(audio, "content_type", "") or "").split(";")[0]
        if ctype not in AUDIO_TYPES:
            return C.fail("That recording isn't an audio file we can keep.")
        if (getattr(audio, "length", 0) or len(audio.get_bytes() or b"")) > MAX_AUDIO:
            return C.fail("That recording is too long to save.")
    source = meta.get("source") if meta.get("source") in ("vr", "desk", "voice", "ar") else "vr"
    try:
        dur = min(3600.0, max(0.0, float(meta.get("dur") or 0)))
    except (TypeError, ValueError):
        dur = 0.0
    t = app_tables.takes.add_row(production=p, owner=owner, uid=uid, actor=actor, source=source, clips=clips, dur=round(dur, 3),
                                 motion=motion, audio=audio, asset="", key=C.rand_key(24), stars=0, created=C.now(), is_demo=False)
    if meta.get("select", True):
        sel = dict(doc.get("sel") or {})
        for c in clips:
            sel["%s|%s" % (c["beat"], actor)] = uid
        doc = dict(doc)
        doc["sel"] = sel
        p.update(data=doc, rev=(p["rev"] or 0) + 1, updated=C.now())
    return C.ok(take=Productions.take_dict(t), rev=p["rev"])


@anvil.server.callable(require_user=True)
def take_save(pid, meta, motion_json, audio=None):
    me = C.require_user()
    p = Productions.owned(pid, me)
    if p is None:
        return C.fail("Only the owner can record into this picture. Make your own copy first.")
    if C.rate_limited("take_save", 120, 3600):
        return C.fail("That's a lot of takes in one hour. Take a break and try again soon.")
    return save_take(p, me, meta, motion_json, audio)


def clean_face(face_json, dur):
    """The face booth's track, checked: {v, fps 30, n, k 11, s (k chars per frame), gain, mouth, vm?}. Returns (dict, error)."""
    if not isinstance(face_json, str) or len(face_json) > MAX_FACE:
        return None, "That face recording is too long to save."
    try:
        f = json.loads(face_json)
    except ValueError:
        return None, "That face recording couldn't be read."
    if not isinstance(f, dict):
        return None, "That face recording couldn't be read."
    s, n, k = f.get("s"), f.get("n"), f.get("k")
    if not isinstance(s, str) or not isinstance(n, int) or k != FACE_K or n < 1 or len(s) != n * k or not set(s) <= FACE_CHARS:
        return None, "That face recording couldn't be read."
    if n > (dur + 2) * 30:
        return None, "That face recording is longer than its take."
    try:
        gain = max(0.3, min(2.5, float(f.get("gain") or 1)))
    except (TypeError, ValueError):
        gain = 1.0
    out = {"v": 1, "fps": 30, "n": n, "k": k, "s": s, "gain": round(gain, 2), "mouth": bool(f.get("mouth"))}
    vm = f.get("vm")
    if isinstance(vm, str) and vm:
        if len(vm) % 2 or len(vm) > (dur + 2) * 60 or any(not "0" <= ch <= "9" for ch in vm):
            return None, "That voice's lip sync couldn't be read."
        out["vm"] = vm
    return out, None


@anvil.server.callable(require_user=True)
def take_face(pid, uid, face_json, audio=None):
    """Keep a face pass for a take (and, if the voice was recorded again with it, the new voice). The take gets a new
    media key, so browsers fetch the new recordings instead of a cached copy."""
    me = C.require_user()
    p = Productions.owned(pid, me)
    t = p and app_tables.takes.get(production=p, uid=uid)
    if not t:
        return C.fail("That take no longer exists, or it isn't yours.")
    if C.rate_limited("take_face", 120, 3600):
        return C.fail("That's a lot of face passes in one hour. Take a break and try again soon.")
    face, err = clean_face(face_json, t["dur"] or 0)
    if err:
        return C.fail(err)
    if audio is not None:
        ctype = (getattr(audio, "content_type", "") or "").split(";")[0]
        if ctype not in AUDIO_TYPES:
            return C.fail("That recording isn't an audio file we can keep.")
        if (getattr(audio, "length", 0) or len(audio.get_bytes() or b"")) > MAX_AUDIO:
            return C.fail("That recording is too long to save.")
    elif face.get("vm"):
        face.pop("vm")  # lip sync of a new voice only travels with that voice
    data = json.dumps(face, separators=(",", ":")).encode("utf-8")
    media = anvil.BlobMedia("application/json", data, name=uid + "-face.json")
    if audio is not None:
        t.update(face=media, audio=audio, asset="", key=C.rand_key(24))
    else:
        t.update(face=media, key=C.rand_key(24))
    return C.ok(take=Productions.take_dict(t))


@anvil.server.callable(require_user=True)
def take_face_remove(pid, uid):
    """Drop a take's face pass (the feelings set in the editor drive the face again). A re-recorded voice stays."""
    p = Productions.owned(pid)
    t = p and app_tables.takes.get(production=p, uid=uid)
    if not t:
        return C.fail("That take no longer exists, or it isn't yours.")
    t.update(face=None, key=C.rand_key(24))
    return C.ok(take=Productions.take_dict(t))


@anvil.server.callable(require_user=True)
def take_list(pid):
    p = Productions.owned(pid)
    if p is None:
        return C.fail("Only the owner can see these takes.")
    return C.ok(takes=[Productions.take_dict(t) for t in app_tables.takes.search(tables.order_by("created", ascending=True), production=p)])


@anvil.server.callable(require_user=True)
def take_star(pid, uid, stars):
    p = Productions.owned(pid)
    t = p and app_tables.takes.get(production=p, uid=uid)
    if not t:
        return C.fail("That take no longer exists.")
    try:
        t["stars"] = max(0, min(3, int(stars)))
    except (TypeError, ValueError):
        return C.fail("Stars go from 0 to 3.")
    return C.ok()


@anvil.server.callable(require_user=True)
def take_delete(pid, uid):
    p = Productions.owned(pid)
    t = p and app_tables.takes.get(production=p, uid=uid)
    if not t:
        return C.ok()
    t.delete()
    doc = dict(p["data"] or {})
    doc["sel"] = {k: v for k, v in (doc.get("sel") or {}).items() if v != uid}
    p.update(data=doc, rev=(p["rev"] or 0) + 1, updated=C.now())
    return C.ok(sel=doc["sel"])
