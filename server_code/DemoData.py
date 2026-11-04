"""Demo content, so the app never looks empty: three voiced demo pictures (demo_films.py), shared as premieres, by three
fictional demo makers. Loaded automatically on the first visit (ensure_loaded), removed or reloaded in Admin -> Demo data.

Demo users have is_demo=True and @example.com emails; they can't sign in (no password). Every demo row is flagged
is_demo=True, so remove() deletes exactly what load() added. Demo takes carry no recordings of their own: `asset` names a
voice file in theme/assets (made by tools/make_demo_voices.py) and the body acts procedurally.
"""
import datetime as dt

from anvil.tables import app_tables

from . import common as C
from . import demo_films

try:
    from .demo_voice_lengths import LENGTHS
except ImportError:  # before the voices are generated
    LENGTHS = {}

DEMO_USERS = [("Mira Okafor", "mira.demo@example.com"), ("Jonas Berg", "jonas.demo@example.com"), ("Lea Fontaine", "lea.demo@example.com")]
# Tables that hold demo rows (each has an is_demo column). Children before parents.
DEMO_TABLES = ["takes", "productions", "characters"]
DEMO_SET = 1  # bump when the demo films change, so live apps reload them


def state():
    return C.get_setting("demo", "never")  # "never" | "loaded" | "removed"


def ensure_loaded():
    """Call from the main public callables: loads the demo once (and refreshes it when DEMO_SET changes)."""
    s = state()
    if s == "never" or (s == "loaded" and C.get_setting("demo_set", 0) != DEMO_SET):
        load()


def load():
    remove(remember=False)
    users = []
    for name, email in DEMO_USERS:
        u = app_tables.users.get(email=email) or app_tables.users.add_row(email=email, enabled=False)
        u.update(display_name=name, is_demo=True, signed_up=C.now() - dt.timedelta(days=40))
        users.append(u)
    for i, (key, film, _) in enumerate(demo_films.FILMS):
        doc = dict(film)
        sel = {}
        when = C.now() - dt.timedelta(days=3 * (3 - i), hours=i)
        p = app_tables.productions.add_row(owner=users[i % len(users)], title=film["title"], logline=demo_films.LOGLINES.get(key, ""),
                                           data=doc, poster="", rev=1, share_key="demo-" + key, shared=True, featured=True,
                                           views=[184, 121, 97][i % 3], reports=0, created=when, updated=when, is_demo=True)
        for b in film["beats"]:
            if b["kind"] != "line" or not b["who"]:
                continue
            asset = demo_films.voice_file(key, b["id"])
            length = LENGTHS.get(asset)
            if not length:
                continue
            uid = "t_demo%s%s" % (key[:4], b["id"])
            app_tables.takes.add_row(production=p, owner=p["owner"], uid=uid, actor=b["who"], source="voice",
                                     clips=[{"beat": b["id"], "off": 0, "dur": length, "line": True}], dur=length, motion=None, audio=None,
                                     asset=asset, key=C.rand_key(24), stars=3, created=when, is_demo=True)
            sel["%s|%s" % (b["id"], b["who"])] = uid
        doc["sel"] = sel
        p["data"] = doc
    C.set_setting("demo", "loaded")
    C.set_setting("demo_set", DEMO_SET)
    return counts()


def remove(remember=True):
    for u in app_tables.users.search(is_demo=True):
        for p in app_tables.productions.search(owner=u):
            for t in app_tables.takes.search(production=p):
                t.delete()
            for link in app_tables.stage_links.search(production=p):
                link.delete()
    for name in DEMO_TABLES:
        for r in getattr(app_tables, name).search(is_demo=True):
            r.delete()
    for u in app_tables.users.search(is_demo=True):
        u.delete()
    if remember:
        C.set_setting("demo", "removed")
    return counts()


def counts():
    out = {"users": len(app_tables.users.search(is_demo=True))}
    for name in DEMO_TABLES:
        out[name] = len(getattr(app_tables, name).search(is_demo=True))
    return out
