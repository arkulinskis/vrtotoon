"""Server tests against the strict mock of Anvil (tools/testing/mock).

    python tools/testing/test_server.py          -> prints ALL OK, or the first failure

call(name, ...) runs a server function the way the browser does: by name, with require_user enforced,
and the reply must be JSON (a datetime or a row in a reply fails here, like it would break the page).
Add tests for every new server function: the happy path, bad input, and someone who isn't allowed.
"""
import datetime as dt
import importlib
import json
import os
import pathlib
import shutil
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
PROJECT = HERE.parents[1]
_tmp = pathlib.Path(tempfile.mkdtemp())
shutil.copytree(PROJECT / "server_code", _tmp / "app")
(_tmp / "app" / "__init__.py").write_text("")
os.environ["ANVIL_APP_YAML"] = str(PROJECT / "anvil.yaml")  # the mock's tables follow the app's own schema
sys.path[:0] = [str(HERE / "mock"), str(_tmp)]
import anvil  # noqa: E402
import anvil.server  # noqa: E402
import anvil.users  # noqa: E402
from anvil.tables import app_tables as T  # noqa: E402

M = {p.stem: importlib.import_module("app." + p.stem) for p in sorted((PROJECT / "server_code").glob("*.py"))}
now = dt.datetime.now(dt.timezone.utc)


def call(name, *args):
    r = anvil.server.call(name, *args)
    json.dumps(r)  # strict: must be JSON-able
    return r


def as_user(row):
    anvil.users.CURRENT[0] = row
    anvil.server.session.use(row.get_id() if row is not None else None)


def denied(name, *args):
    try:
        call(name, *args)
    except anvil.server.PermissionDenied:
        return True
    return False


def ok(r, msg=""):
    assert isinstance(r, dict) and r.get("ok"), (msg, r)
    return r


def bad(r, msg=""):
    assert isinstance(r, dict) and r.get("ok") is False and r.get("error"), (msg, r)
    return r


def person(email, name=None, **kw):
    return T.users.add_row(email=email, enabled=True, signed_up=now, display_name=name, **kw)


# ---------------------------------------------------------------------------------- accounts
admin = person("arkulinskis@gmail.com", "The Admin")
ana = person("ana@example.com", "Ana")
bob = person("bob@example.com")

as_user(None)
assert call("get_me") is None
assert denied("update_profile", "X")
as_user(admin)
assert call("get_me")["is_admin"] is True, "ADMIN_EMAILS become admins on first sign-in"
as_user(ana)
me = call("get_me")
assert me["name"] == "Ana" and me["is_admin"] is False
assert ana["last_seen"] is not None
as_user(bob)
assert call("get_me")["name"] == "Bob", "a name comes from the email when none is set"
bad(call("update_profile", " x "))
assert ok(call("update_profile", "  Bob   Stone "))["me"]["name"] == "Bob Stone"

# ---------------------------------------------------------------------------------- feedback
as_user(None)
bad(call("submit_feedback", "bug", "hi"))
ok(call("submit_feedback", "bug", "The button is broken", "guest@example.com", {"page": "#home", "evil": "x" * 9999}))
fb = T.feedback.search()[0]
assert fb["name"] == "Guest" and fb["email"] == "guest@example.com" and "evil" not in fb["context"] and fb["status"] == "new"
for i in range(4):
    ok(call("submit_feedback", "idea", "Idea number %d" % i))
bad(call("submit_feedback", "idea", "One too many this hour"), "rate limit")
as_user(ana)
ok(call("submit_feedback", "nonsense-kind", "Signed-in feedback"))
assert T.feedback.get(message="Signed-in feedback")["kind"] == "other"
assert denied("list_feedback")
as_user(admin)
lst = call("list_feedback")
assert lst["counts"]["new"] == 6 and len(lst["items"]) == 6
fid = lst["items"][0]["id"]
ok(call("set_feedback_status", fid, "done", "Fixed it"))
assert call("list_feedback", "done")["items"][0]["note"] == "Fixed it"
bad(call("set_feedback_status", fid, "weird"))
bad(call("set_feedback_status", "nope", "done"))
ok(call("delete_feedback", fid))
assert len(call("list_feedback")["items"]) == 5

# ---------------------------------------------------------------------------------- admin
as_user(ana)
for fn, args in [("admin_overview", ()), ("list_users", ()), ("set_admin", (bob.get_id(), True)), ("demo_load", ()), ("demo_remove", ())]:
    assert denied(fn, *args), fn
as_user(admin)
ov = call("admin_overview")
assert ov["users"] == 3 and ov["admins"] == 1 and ov["feedback_new"] == 5
assert len(call("list_users")["users"]) == 3 and len(call("list_users", "bob")["users"]) == 1
ok(call("set_admin", bob.get_id(), True))
assert bob["is_admin"] is True
bad(call("set_admin", admin.get_id(), False), "can't remove your own admin")
ok(call("set_enabled", bob.get_id(), False))
assert bob["enabled"] is False
bad(call("set_enabled", admin.get_id(), False))
ok(call("set_enabled", bob.get_id(), True))
ok(call("set_admin", bob.get_id(), False))
assert bob["is_admin"] is False

# ---------------------------------------------------------------------------------- demo data, the Lot, premieres
as_user(None)
prem = call("premieres_list")
assert M["DemoData"].state() == "loaded" and prem["total"] == 3, "the three demo films load on the first visit"
demo = prem["films"][0]
assert demo["demo"] and demo["shared"] and demo["share_key"]
scr = ok(call("screen_get", "demo-bigbreak"))["production"]
assert scr["takes"] and scr["takes"][0]["asset"].startswith("dv-bigbreak") and not scr["can_edit"]
assert json.loads(scr["data"])["sel"], "demo lines are selected takes"
bad(call("screen_get", "no-such-film"))
assert denied("lot_home")
as_user(ana)
lot = call("lot_home")
assert lot["total"] == 0 and len(lot["premieres"]) == 3

# ---------------------------------------------------------------------------------- productions
DOC = {"title": "x", "set": "diner", "cast": [{"id": "a_1", "char": "max", "name": "MAX"}, {"id": "a_2", "char": "rosie", "name": "ROSIE"}],
       "beats": [{"id": "b_1", "kind": "line", "who": "a_1", "text": "Hello"}, {"id": "b_2", "kind": "line", "who": "a_2", "text": "Hi"}],
       "keys": {"move": [], "emo": [], "act": [], "look": []}, "shots": [], "sfx": [], "sel": {}, "custom": {}}
bad(call("production_new", " ", json.dumps(DOC)))
bad(call("production_new", "Ok", "{not json"))
bad(call("production_new", "Ok", json.dumps([1, 2])))
pid = ok(call("production_new", "  Pie   Night ", json.dumps(DOC)))["id"]
got = ok(call("production_get", pid))["production"]
assert got["title"] == "Pie Night" and got["can_edit"] and json.loads(got["data"])["title"] == "Pie Night"
DOC2 = dict(DOC, title="Pie Night 2")
saved = ok(call("production_save", pid, json.dumps(DOC2), got["synced_at"]))
assert saved["rev"] == 2 and T.productions.get_by_id(pid)["title"] == "Pie Night 2"
bad(call("production_save", pid, "x" * 800000))
as_user(bob)
bad(call("production_get", pid), "a private production stays private")
bad(call("production_save", pid, json.dumps(DOC2)))
bad(call("production_share", pid, True))
as_user(ana)
sh = ok(call("production_share", pid, True))
assert sh["shared"] and sh["share_key"]
as_user(None)
assert ok(call("screen_get", sh["share_key"]))["production"]["title"] == "Pie Night 2"
ok(call("screen_report", sh["share_key"], "spam"))
assert T.productions.get_by_id(pid)["reports"] == 1
as_user(bob)
cp = ok(call("production_copy", pid))["id"]
assert T.productions.get_by_id(cp)["owner"] == bob and "(my cut)" in T.productions.get_by_id(cp)["title"]
demo_copy = ok(call("production_copy", demo["id"]))["id"]
assert len(T.takes.search(production=T.productions.get_by_id(demo_copy))) >= 5, "copying a demo copies its takes"
as_user(ana)
bad(call("production_poster", pid, "data:image/png;base64,xx"))
ok(call("production_poster", pid, "data:image/jpeg;base64,/9j/4AAQ"))
ok(call("production_logline", pid, "A pie, a meeting, a moment."))
assert ok(call("production_share", pid, False))["share_key"] == ""

# ---------------------------------------------------------------------------------- takes
MOTION = json.dumps({"fps": 30, "n": 2, "f": [0.0] * 46, "m": "0011"})
meta = {"uid": "t_abc123def", "actor": "a_1", "source": "desk", "dur": 3.2, "clips": [{"beat": "b_1", "off": 1.0, "dur": 1.4, "line": True},
        {"beat": "b_2", "off": 2.75, "dur": 1.0, "line": False}, {"beat": "nope", "off": 0, "dur": 1}]}
audio = anvil.BlobMedia("audio/webm", b"\x1a\x45\xdf\xa3" + b"0" * 100, name="v.webm")
bad(call("take_save", pid, dict(meta, uid="bad id"), MOTION, audio))
bad(call("take_save", pid, dict(meta, actor="a_9"), MOTION, audio))
bad(call("take_save", pid, meta, MOTION, anvil.BlobMedia("text/html", b"<b>", name="x.html")))
tk = call("take_save", pid, meta, MOTION, audio) if False else anvil.server.call("take_save", pid, meta, MOTION, audio)
assert tk["ok"] and len(tk["take"]["clips"]) == 2 and tk["take"]["motion_key"] and tk["take"]["audio_key"], tk
bad(anvil.server.call("take_save", pid, meta, MOTION, audio), "the same take twice")
sel = T.productions.get_by_id(pid)["data"]["sel"]
assert sel == {"b_1|a_1": "t_abc123def", "b_2|a_1": "t_abc123def"}, sel
# an autosave from a browser that synced before the take arrived keeps the take's selection
ok(call("production_save", pid, json.dumps(DOC2), got["synced_at"]))
assert T.productions.get_by_id(pid)["data"]["sel"].get("b_1|a_1") == "t_abc123def", "merge keeps newer takes"
r = anvil.server.ENDPOINTS["/m/:key"](key=tk["take"]["audio_key"])
assert r.status == 200
assert anvil.server.ENDPOINTS["/m/:key"](key="nothing-a").status == 404
assert len(ok(call("take_list", pid))["takes"]) == 1
ok(call("take_star", pid, "t_abc123def", 3))
bad(call("take_star", pid, "t_abc123def", "lots"))
as_user(bob)
bad(anvil.server.call("take_save", pid, dict(meta, uid="t_bobtake01"), MOTION, audio))
bad(call("take_list", pid))
bad(call("take_star", pid, "t_abc123def", 1))
as_user(ana)
assert ok(call("take_delete", pid, "t_abc123def"))["sel"] == {}

# ---------------------------------------------------------------------------------- the headset link
link = ok(call("stage_link", pid))
assert len(link["code"]) == 4 and not link["online"]
assert ok(call("stage_link", pid))["code"] == link["code"], "the same code until it expires"
as_user(bob)
bad(call("stage_link", pid))
as_user(None)
bad(call("stage_get", pid), "a stranger can't open the stage")
bad(call("stage_join", "QQQQ"))
j = ok(call("stage_join", link["code"].lower()))
assert j["pid"] == pid
assert ok(call("stage_get", pid))["production"]["can_edit"]
ok(call("stage_poll", pid, "Quest Browser"))
ok(anvil.server.call("stage_save_pass", pid, dict(meta, uid="t_headset01"), MOTION, audio))
assert T.takes.get(uid="t_headset01")["owner"] == ana, "a headset pass belongs to the production's owner"
assert denied("stage_status", pid) and denied("stage_call", pid, {}) and denied("production_save", pid, "{}")
as_user(ana)
stt = ok(call("stage_status", pid, got["synced_at"]))
assert stt["online"] and stt["device"] == "Quest Browser" and [t["uid"] for t in stt["takes"]] == ["t_headset01"], stt
assert stt["sel"].get("b_1|a_1") == "t_headset01"
bad(call("stage_call", pid, {"actor": "a_9"}))
c = ok(call("stage_call", pid, {"actor": "a_2", "from": "b_2", "to": "zzz"}))["call"]
assert c["actor"] == "a_2" and c["from"] == "b_2" and c["to"] is None
ok(call("stage_note", pid, "Bigger, louder, more pie"))
as_user(None)
anvil.server.session["stage"] = {"pid": pid, "link": T.stage_links.search()[0].get_id()}
pl = ok(call("stage_poll", pid))
assert pl["call"]["actor"] == "a_2" and pl["note"].startswith("Bigger")

# the live view: the PC offers, the headset finds the offer in stage_poll and answers, the PC picks the answer up
SDP_O, SDP_A = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n", "v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\ns=-\r\n"
assert pl["rtc"] is None
bad(call("stage_rtc_reply", pid, "nope", SDP_A), "nothing to answer yet")
assert denied("stage_rtc_offer", pid, SDP_O) and denied("stage_rtc_answer", pid, "x"), "only signed-in owners ring the headset"
as_user(bob)
bad(call("stage_rtc_offer", pid, SDP_O), "only the owner can watch")
as_user(ana)
bad(call("stage_rtc_offer", pid, "hello"), "not a session description")
bad(call("stage_rtc_offer", pid, "v=0" + "x" * 30000), "too long")
o = ok(call("stage_rtc_offer", pid, SDP_O))
assert o["online"], "the headset polled a moment ago"
assert ok(call("stage_rtc_answer", pid, o["id"]))["answer"] is None
as_user(bob)
bad(call("stage_rtc_answer", pid, o["id"]), "bob can't read ana's live view")
as_user(None)  # the paired headset (its session came from stage_join)
pr = ok(call("stage_poll", pid))["rtc"]
assert pr == {"id": o["id"], "offer": SDP_O}, pr
bad(call("stage_rtc_reply", pid, "wrongid00", SDP_A))
bad(call("stage_rtc_reply", pid, o["id"], "garbage"))
ok(call("stage_rtc_reply", pid, o["id"], SDP_A))
assert ok(call("stage_poll", pid))["rtc"] is None, "an answered offer isn't offered again"
as_user(ana)
assert ok(call("stage_rtc_answer", pid, o["id"]))["answer"] == SDP_A
o2 = ok(call("stage_rtc_offer", pid, SDP_O))
bad(call("stage_rtc_answer", pid, o["id"]), "a new offer replaces the old one")
lk = T.stage_links.search()[0]
lk["rtc"] = dict(lk["rtc"], at=(now - dt.timedelta(seconds=120)).isoformat())
as_user(None)
assert ok(call("stage_poll", pid))["rtc"] is None, "a stale offer is ignored"
bad(call("stage_rtc_reply", pid, o2["id"], SDP_A), "too late to answer a stale offer")
as_user(ana)
assert ok(call("stage_rtc_answer", pid, o2["id"]))["waiting"] is False
ok(call("stage_rtc_offer", pid, None))
assert T.stage_links.search()[0]["rtc"] is None, "hanging up clears the offer"

# ---------------------------------------------------------------------------------- wardrobe
as_user(ana)
bad(call("wardrobe_save", "bad", {"base": "max"}))
bad(call("wardrobe_save", "c_abcdef12", {"name": "No base"}))
w = ok(call("wardrobe_save", "c_abcdef12", {"base": "max", "name": "Max Noir", "colors": {"shirt": "#111111", "skin": "red"}, "build": {"h": 9}, "hat": "fedora", "evil": 1}))
assert w["item"]["def"]["colors"] == {"shirt": "#111111"} and w["item"]["def"]["build"]["h"] == 1.6 and "evil" not in w["item"]["def"]
# the character editor's fields: species, face sliders (clamped), switches, ears, hat/glove colours, role, voice
full = {"base": "rosie", "name": "Captain Whiskers", "species": "cat", "role": "villain", "voice": "robot", "acc": ["gloves", "bowtie"],
        "colors": {"hat": "#d7263d", "gloves": "#f7f4ee", "nonsense": "#000000"}, "build": {"hand": 1.3, "torso": "egg"},
        "face": {"eyes": 9, "lift": -3, "nose": 0, "freckles": "yes", "lashes": 0, "ears": "long", "spooky": 1, "brows": True}}
fd = ok(call("wardrobe_save", "c_whisker01", full))["item"]["def"]
assert fd["species"] == "cat" and fd["role"] == "villain" and fd["voice"] == "robot", fd
assert fd["face"] == {"eyes": 1.6, "lift": -1.0, "nose": 0.0, "freckles": 1, "lashes": 0, "ears": "long"}, fd["face"]
assert fd["colors"] == {"hat": "#d7263d", "gloves": "#f7f4ee"} and fd["build"] == {"hand": 1.3, "torso": "egg"}
odd = ok(call("wardrobe_save", "c_whisker01", dict(full, role="boss", voice="opera", face="big")))["item"]["def"]
assert "role" not in odd and "voice" not in odd and odd["face"] == {}, odd
ok(call("wardrobe_delete", "c_whisker01"))
assert len(ok(call("wardrobe_list"))["items"]) == 1
as_user(bob)
assert ok(call("wardrobe_list"))["items"] == []
ok(call("wardrobe_delete", "c_abcdef12"))
as_user(ana)
assert len(ok(call("wardrobe_list"))["items"]) == 1, "bob can't delete ana's character"
ok(call("wardrobe_delete", "c_abcdef12"))

# ---------------------------------------------------------------------------------- admin films + demo data
as_user(ana)
assert denied("admin_films") and denied("admin_feature", pid, True)
as_user(admin)
fl = call("admin_films")
assert fl["total"] >= 6
ok(call("admin_feature", pid, True))
ok(call("admin_unshare", demo["id"]))
ok(call("admin_clear_reports", pid))
ov = call("admin_overview")
assert ov["productions"] == 3 and ov["takes"] >= 1, ov
ok(call("demo_remove"))
assert M["DemoData"].state() == "removed" and not T.users.search(is_demo=True) and not T.productions.search(is_demo=True)
assert T.productions.get_by_id(pid) is not None, "removing demo data keeps real data"
as_user(None)
call("premieres_list")
assert M["DemoData"].state() == "removed", "removed demo data doesn't come back by itself"
as_user(admin)
ok(call("demo_load"))
ok(call("demo_load"))
assert len(T.productions.search(is_demo=True)) == 3, "reloading replaces the demo instead of doubling it"
as_user(ana)
ok(call("production_delete", pid))
assert T.productions.get_by_id(pid) is None and not T.takes.search(uid="t_headset01")

# ---------------------------------------------------------------------------------- Privacy & Terms
if "legal_server" in M:
    as_user(ana)
    st = call("legal_state")
    assert st["signedIn"] and st["accepted_version"] is None
    ok(call("legal_accept", st["version"], "signup"))
    assert ana["legal_source"] == "signup" and call("legal_state")["accepted_version"] == st["version"]

# ---------------------------------------------------------------------------------- schema check (App Board): names only, never data
r = anvil.server.ENDPOINTS["/schema-check"](tables="users, productions,no_such_table")
json.dumps(r)
assert "email" in r["tables"]["users"] and "title" in r["tables"]["productions"] and r["tables"]["no_such_table"] is None, r

# ---------------------------------------------------------------------------------- every callable is covered by a permission check
# A callable that changes data without require_user / a C.require_* check is a security hole. List the public ones here.
PUBLIC = {"get_me", "submit_feedback", "legal_state", "legal_accept", "premieres_list", "screen_get", "screen_report",
          "production_get", "stage_join", "stage_get", "stage_poll", "stage_save_pass", "stage_rtc_reply"}
for name, (f, need) in sorted(anvil.server.CALLABLES.items()):
    if name in PUBLIC:
        continue
    assert need, "%s is callable by anyone: add require_user=True (or list it in PUBLIC in test_server.py)" % name

print("ALL OK (%d server functions)" % len(anvil.server.CALLABLES))
