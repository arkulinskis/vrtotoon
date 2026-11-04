"""The three demo pictures every visitor sees (DemoData loads them; tools/make_demo_voices.py voices their lines with Kokoro).

Each film is a production document (see theme/assets/vt-film.js for the format) plus VOICES: which Kokoro voice reads
each actor. Ids are fixed: the voice files are named after them (theme/assets/dv-<film>-<beat>.mp3) and the lengths the
generator measured live in demo_voice_lengths.py. Change a line -> rerun tools/make_demo_voices.py.
"""


def _beat(i, who, text, emo="", gap=0.35):
    return {"id": "b%d" % i, "kind": "line", "who": who, "text": text, "emo": emo, "gap": gap}


def _action(i, text, dur, gap=0.3):
    return {"id": "b%d" % i, "kind": "action", "who": None, "text": text, "dur": dur, "gap": gap, "emo": ""}


def _k(kind, n, actor, beat, at, **kw):
    d = {"id": "%s%d" % (kind[0], n), "actor": actor, "beat": "b%d" % beat, "at": at}
    d.update(kw)
    return d


def _shot(n, beat, at, type_, a=None, b=None, move="static"):
    return {"id": "s%d" % n, "beat": "b%d" % beat, "at": at, "type": type_, "a": a, "b": b, "move": move}


def _sfx(n, beat, at, sfx, vol=0.8):
    return {"id": "x%d" % n, "beat": "b%d" % beat, "at": at, "sfx": sfx, "vol": vol}


BIG_BREAK: dict = {
    "title": "The Big Break", "set": "soundstage", "lead": 1.4,
    "look": {"grade": "technicolor", "aspect": "16:9", "fps": 24, "subs": True},
    "music": {"id": "comedy", "vol": 0.18},
    "cast": [
        {"id": "dee", "char": "dee", "name": "DEE", "mark": [-2.2, 0.7, 40], "fx": "none", "vol": 1},
        {"id": "max", "char": "max", "name": "MAX", "mark": [-0.55, 0.1, 12], "fx": "none", "vol": 1},
        {"id": "rosie", "char": "rosie", "name": "ROSIE", "mark": [0.85, 0.1, -14], "fx": "none", "vol": 1},
        {"id": "biscuit", "char": "biscuit", "name": "BISCUIT", "mark": [4.2, -0.8, -90], "fx": "none", "vol": 1},
    ],
    "beats": [
        _beat(1, "dee", "Quiet on set! Max, Rosie, this is your big break.", "happy"),
        _beat(2, "max", "I was born ready! Which way is the camera?", "happy"),
        _beat(3, "rosie", "The big glass eye, Max. It's always the big glass eye.", "smug"),
        _action(4, "Biscuit the dog runs across the stage.", 2.8),
        _beat(5, "dee", "Who let a dog on my set?", "surprised"),
        _beat(6, "max", "He's not with me. Well... he's a little bit with me.", "shy"),
        _beat(7, "rosie", "Keep rolling! The dog is the best actor we've got.", "laugh"),
        _beat(8, "dee", "And that's a wrap! Print it!", "happy", gap=0.6),
    ],
    "keys": {
        "move": [_k("move", 1, "biscuit", 4, 0.1, x=-1.4, z=1.1, style="run", face=None),
                 _k("move", 2, "biscuit", 5, 0.6, x=0.15, z=0.9, style="walk", face="front"),
                 _k("move", 3, "dee", 8, 0.2, x=-1.6, z=1.0, style="walk", face=None)],
        "emo": [_k("emo", 1, "biscuit", 1, 0, emo="happy"), _k("emo", 2, "max", 5, 0.2, emo="scared"),
                _k("emo", 3, "rosie", 5, 0.1, emo="surprised"), _k("emo", 4, "max", 7, 0.5, emo="happy"),
                _k("emo", 5, "biscuit", 6, 0, emo="love")],
        "act": [_k("act", 1, "max", 2, 0.2, act="wave"), _k("act", 2, "rosie", 3, 0.3, act="cross"),
                _k("act", 3, "dee", 5, 0.05, act="armsup"), _k("act", 4, "max", 6, 0.8, act="shrug"),
                _k("act", 5, "rosie", 7, 0.4, act="clap"), _k("act", 6, "dee", 8, 1.1, act="cheer"),
                _k("act", 7, "max", 8, 1.3, act="thumbs"), _k("act", 8, "biscuit", 8, 1.2, act="jump"),
                _k("act", 9, "dee", 1, 0.2, act="point")],
        "look": [_k("look", 1, "max", 4, 0.3, target="biscuit"), _k("look", 2, "rosie", 4, 0.3, target="biscuit"),
                 _k("look", 3, "dee", 4, 0.3, target="biscuit"), _k("look", 4, "max", 6, 0, target="auto"),
                 _k("look", 5, "rosie", 6, 0, target="auto"), _k("look", 6, "dee", 6, 0, target="auto"),
                 _k("look", 7, "biscuit", 6, 0, target="cam")],
    },
    "shots": [_shot(1, 1, -1.4, "wide", move="drift"), _shot(2, 1, 0.6, "medium", "dee", "max", "push"),
              _shot(3, 2, 0, "medium", "max", "rosie", "push"), _shot(4, 3, 0, "ots", "rosie", "max"),
              _shot(5, 4, 0, "wide", "biscuit", None, "pan"), _shot(6, 5, 0, "close", "dee", None, "crash"),
              _shot(7, 6, 0, "two", "max", "rosie"), _shot(8, 7, 0, "close", "rosie", "max", "push"),
              _shot(9, 8, 0, "wide", None, None, "crane")],
    "sfx": [_sfx(1, 1, -1.0, "clapper"), _sfx(2, 4, 0.15, "whoosh"), _sfx(3, 5, 0.0, "gasp", 0.5),
            _sfx(4, 8, 1.0, "tada", 0.6), _sfx(5, 8, 1.4, "applause", 0.7)],
}

SHOWDOWN: dict = {
    "title": "Showdown at Dusty Gulch", "set": "western", "lead": 1.4,
    "look": {"grade": "golden", "aspect": "2.39:1", "fps": 24, "subs": True},
    "music": {"id": "western", "vol": 0.2},
    "cast": [
        {"id": "duke", "char": "duke", "name": "DUKE", "mark": [-2.6, 0.6, 80], "fx": "none", "vol": 1},
        {"id": "baron", "char": "baron", "name": "BARON", "mark": [2.6, 0.6, -80], "fx": "echo", "vol": 1},
        {"id": "pip", "char": "pip", "name": "PIP", "mark": [0.1, -1.7, 0], "fx": "none", "vol": 1},
    ],
    "beats": [
        _beat(1, "duke", "This town ain't big enough for the both of us, Baron.", "angry"),
        _beat(2, "baron", "Then I suggest you find a bigger town, cowboy.", "smug"),
        _action(3, "They step toward each other. A tumbleweed rolls by.", 2.6),
        _beat(4, "duke", "Tell you what. Rock, paper, scissors. Winner keeps the town.", "thinking"),
        _beat(5, "baron", "That is... surprisingly civilised.", "surprised"),
        _action(6, "Rock, paper, scissors!", 2.0),
        _beat(7, "pip", "Paper covers rock! Duke wins!", "laugh"),
        _beat(8, "baron", "Best two out of three?", "sad", gap=0.6),
    ],
    "keys": {
        "move": [_k("move", 1, "duke", 3, 0.1, x=-1.05, z=0.6, style="walk", face=90),
                 _k("move", 2, "baron", 3, 0.2, x=1.05, z=0.6, style="sneak", face=-90),
                 _k("move", 3, "pip", 7, 0.0, x=0.0, z=-0.3, style="run", face="front")],
        "emo": [_k("emo", 1, "pip", 1, 0, emo="scared"), _k("emo", 2, "duke", 5, 0.3, emo="smug"),
                _k("emo", 3, "pip", 6, 0, emo="surprised"), _k("emo", 4, "duke", 7, 0.4, emo="happy")],
        "act": [_k("act", 1, "duke", 1, 0.3, act="point"), _k("act", 2, "baron", 2, 0.5, act="shrug"),
                _k("act", 3, "duke", 6, 0.2, act="shake"), _k("act", 4, "baron", 6, 0.2, act="shake"),
                _k("act", 5, "pip", 7, 0.4, act="jump"), _k("act", 6, "duke", 7, 0.8, act="cheer"),
                _k("act", 7, "baron", 8, 0.0, act="facepalm")],
        "look": [_k("look", 1, "pip", 3, 0.2, target="duke"), _k("look", 2, "pip", 7, 0.3, target="cam")],
    },
    "shots": [_shot(1, 1, -1.4, "wide", move="drift"), _shot(2, 1, 0.3, "low", "duke", "baron", "push"),
              _shot(3, 2, 0, "close", "baron", "duke", "push"), _shot(4, 3, 0, "two", "duke", "baron", "pan"),
              _shot(5, 4, 0, "ots", "duke", "baron"), _shot(6, 5, 0, "close", "baron", "duke", "crash"),
              _shot(7, 6, 0, "ecu", "duke", "baron", "shake"), _shot(8, 6, 1.0, "ecu", "baron", "duke", "shake"),
              _shot(9, 7, 0, "full", "pip"), _shot(10, 8, 0, "close", "baron", None, "push")],
    "sfx": [_sfx(1, 3, 0.0, "whoosh", 0.4), _sfx(2, 6, 0.0, "drumroll", 0.7), _sfx(3, 8, 1.4, "rimshot", 0.6)],
}

POPCORN: dict = {
    "title": "The Case of the Missing Popcorn", "set": "noir", "lead": 1.6,
    "look": {"grade": "noir", "aspect": "16:9", "fps": 24, "subs": True},
    "music": {"id": "noir", "vol": 0.22},
    "cast": [
        {"id": "vera", "char": "vera", "name": "VERA", "mark": [-1.1, 0.4, 28], "fx": "none", "vol": 1},
        {"id": "lou", "char": "lou", "name": "LOU", "mark": [1.2, 0.6, -32], "fx": "none", "vol": 1},
        {"id": "mittens", "char": "mittens", "name": "MITTENS", "mark": [2.9, -1.9, -35], "fx": "none", "vol": 1},
    ],
    "beats": [
        _beat(1, "vera", "The rain fell like it had something to prove. And the popcorn... was gone.", "thinking"),
        _beat(2, "lou", "Detective, the whole bucket! Not one kernel left!", "scared"),
        _beat(3, "vera", "Relax, Lou. Every crime leaves a trail.", "smug"),
        _action(4, "Vera follows a trail of butter to the bins.", 2.8),
        _beat(5, "mittens", "Meow?", "shy"),
        _beat(6, "vera", "Butter on the whiskers. Mittens, how could you?", "surprised"),
        _beat(7, "mittens", "A cat's gotta eat, sweetheart.", "smug"),
        _beat(8, "lou", "Case closed!", "laugh", gap=0.6),
    ],
    "keys": {
        "move": [_k("move", 1, "vera", 4, 0.2, x=1.9, z=-0.9, style="sneak", face="mittens"),
                 _k("move", 2, "lou", 4, 1.2, x=0.6, z=0.2, style="walk", face="mittens")],
        "emo": [_k("emo", 1, "mittens", 1, 0, emo="smug"), _k("emo", 2, "lou", 3, 0.4, emo="neutral"),
                _k("emo", 3, "mittens", 6, 0.2, emo="shy"), _k("emo", 4, "vera", 7, 0.8, emo="laugh")],
        "act": [_k("act", 1, "vera", 1, 1.2, act="think"), _k("act", 2, "lou", 2, 0.3, act="armsup"),
                _k("act", 3, "vera", 3, 0.6, act="point"), _k("act", 4, "vera", 6, 0.6, act="facepalm"),
                _k("act", 5, "mittens", 7, 0.4, act="shrug"), _k("act", 6, "lou", 8, 0.2, act="clap")],
        "look": [_k("look", 1, "lou", 4, 0.5, target="mittens"), _k("look", 2, "vera", 5, 0, target="mittens")],
    },
    "shots": [_shot(1, 1, -1.6, "wide", move="drift"), _shot(2, 1, 0.8, "close", "vera", None, "push"),
              _shot(3, 2, 0, "medium", "lou", "vera", "shake"), _shot(4, 3, 0, "ots", "vera", "lou"),
              _shot(5, 4, 0, "wide", "vera", None, "pan"), _shot(6, 5, 0, "close", "mittens", "vera", "push"),
              _shot(7, 6, 0, "close", "vera", "mittens", "crash"), _shot(8, 7, 0, "ecu", "mittens", "vera", "push"),
              _shot(9, 8, 0, "two", "lou", "vera", "crane")],
    "sfx": [_sfx(1, 1, -1.2, "thunder", 0.6), _sfx(2, 5, 0.0, "boing", 0.3), _sfx(3, 8, 0.9, "rimshot", 0.6)],
}

FILMS: list = [("bigbreak", BIG_BREAK, "dee@demo"), ("showdown", SHOWDOWN, "duke@demo"), ("popcorn", POPCORN, "vera@demo")]
LOGLINES = {
    "bigbreak": "Two actors, one director and a dog who steals the show.",
    "showdown": "A cowboy and a villain settle the fate of a town the civilised way.",
    "popcorn": "A detective, a downpour and a very guilty cat.",
}
# Kokoro voice + speed per actor id
VOICES = {
    "dee": ("af_bella", 1.05), "max": ("am_puck", 1.08), "rosie": ("af_sarah", 1.0), "duke": ("am_onyx", 0.92),
    "baron": ("bm_george", 0.95), "pip": ("af_sky", 1.1), "vera": ("bf_emma", 0.95), "lou": ("am_eric", 1.0),
    "mittens": ("bf_lily", 0.98), "biscuit": ("am_puck", 1.1),
}


def voice_file(film_key, beat_id):
    return "dv-%s-%s.mp3" % (film_key, beat_id)
