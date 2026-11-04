import json

import anvil.server
from anvil import *

from ._anvil_designer import WardrobeTemplate
from ... import router, state, vt

TABS = ("body", "face", "hair", "outfit", "extras", "card")
SPECIES = [("human", "Human", "\U0001F9D1"), ("dog", "Dog", "\U0001F436"), ("cat", "Cat", "\U0001F431"), ("bear", "Bear", "\U0001F43B"),
           ("rabbit", "Rabbit", "\U0001F430"), ("fox", "Fox", "\U0001F98A"), ("frog", "Frog", "\U0001F438"), ("robot", "Robot", "\U0001F916"),
           ("ghost", "Ghost", "\U0001F47B"), ("alien", "Alien", "\U0001F47D"), ("ogre", "Ogre", "\U0001F479"), ("penguin", "Penguin", "\U0001F427"),
           ("dino", "Dino", "\U0001F996")]
TORSOS = [("round", "Round"), ("pear", "Pear"), ("box", "Boxy"), ("egg", "Egg"), ("dress", "Dress"), ("coat", "Long coat")]
EARS = [("auto", "As the species"), ("none", "None"), ("human", "Human"), ("round", "Round"), ("point", "Pointy"), ("long", "Long"),
        ("flop", "Floppy"), ("horn", "Horns"), ("antenna", "Antennae")]
HAT_NAMES = {"none": "No hat", "top": "Top hat", "space": "Space helmet", "police": "Police cap", "knight": "Knight's helmet", "chef": "Chef's hat",
             "witch": "Witch's hat", "cowboy": "Cowboy hat"}
ACC_NAMES = {"bowtie": "Bow tie", "tie": "Tie", "shades": "Sunglasses", "mustache": "Moustache", "gloves": "Cartoon gloves"}
VOICES = [("Bright", "bright"), ("Warm", "warm"), ("Deep", "deep"), ("Smoky", "smoky"), ("Grand (echo hall)", "grand"), ("Radio", "radio"),
          ("Robot", "robot"), ("Echo", "echo")]
BODY = ("h", "girth", "head", "legs", "arms", "hand")
FACE = ("eyes", "spread", "lift", "tall", "brows", "nose", "mouth", "earSize")
COLORS = ("skin", "fur2", "eyes", "hair", "hat", "shirt", "pants", "shoes", "accent", "gloves")
TRY_EMO = ("happy", "laugh", "surprised", "angry", "sad", "love")
TRY_GEST = ("wave", "peace", "okay", "rock", "thumbs", "count", "beckon", "dance")


def _title(s):
    return s[:1].upper() + s[1:]


class Wardrobe(WardrobeTemplate):
    """#wardrobe[/<uid> | /new/<premade id> | /surprise]: the character editor. A character = a premade actor to start from
    (base) + overrides: species, body (build), face, colours, hair, hat, accessories, name, tagline, casting type and voice.
    The turntable shows every change at once; Undo / Redo remember each finished change; saving puts it in the wardrobe
    (wardrobe_save), from where any cast can use it."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.base = "max"
        self.uid = vt.uid("c")
        self.existing = False
        self.over: dict = {}
        self.undo_stack: list = []
        self.redo_stack: list = []
        self._drag = ""
        self.tab = "body"
        self._load(list(args))
        for panel, fn in ((self.species_panel, self._species), (self.torso_panel, self._torso), (self.ears_panel, self._ears),
                          (self.hair_panel, self._hair), (self.hat_panel, self._hat), (self.acc_panel, self._acc),
                          (self.try_emo_panel, self._try_emo), (self.try_gest_panel, self._try_gest)):
            panel.add_event_handler("x-chip", fn)
        for key in BODY:
            getattr(self, "s_" + key).add_event_handler("change", self._slider(("build", key)))
        for key in FACE:
            getattr(self, "f_" + key).add_event_handler("change", self._slider(("face", key)))
        for key in COLORS:
            getattr(self, "c_" + key).add_event_handler("change", self._color(key))
        self.base_dd.items = [(c["name"], c["id"]) for c in vt.cast_catalog()]
        self.role_dd.items = [(r["label"], r["id"]) for r in vt.roles()]
        self.voice_dd.items = VOICES
        self.try_emo_panel.items = [{"id": e["id"], "label": e["label"], "emoji": e["emoji"], "kind": "emo", "on": e["id"] == "happy"}
                                    for e in vt.emotions() if e["id"] in TRY_EMO]
        self.try_gest_panel.items = [{"id": g["id"], "label": g["label"], "emoji": g["emoji"], "kind": "gest"} for g in vt.gestures() if g["id"] in TRY_GEST]
        self._show_tab("body")
        self._draw()

    # ---------------------------------------------------------------- opening
    def _load(self, args):
        start = vt.char_def("max")
        if args and args[0] == "new":
            self.base = args[1] if len(args) > 1 and vt.VT.CAST_BY[args[1]] else "max"
            start = vt.char_def(self.base)
            self.over = {"name": "%s (my cut)" % start["name"]}
        elif args and args[0] == "surprise":
            self.over = dict(vt.py(vt.VT.randomDef()), name="Newcomer")
        elif args:
            r = state.call("wardrobe_list")
            hit = [w for w in (r["items"] if r else []) if w["uid"] == args[0]]
            if hit:
                d = dict(hit[0]["def"])
                self.uid = hit[0]["uid"]
                self.existing = True
                self.base = d.pop("base", None) or "max"
                self.over = d
            else:
                state.toast("That character isn't in your wardrobe any more: here's a fresh one.", "error")
                self.over = {"name": "%s (my cut)" % start["name"]}
        else:
            self.over = {"name": "%s (my cut)" % start["name"]}
        self.delete_button.visible = self.existing
        self.copy_button.visible = self.existing

    # ---------------------------------------------------------------- the current character
    def _def(self):
        return vt.make_def(self.base, dict(self.over, base=self.base))

    def _snap(self):
        return json.dumps({"b": self.base, "o": self.over})

    def _remember(self, snap=None):
        self.undo_stack.append(snap or self._snap())
        self.undo_stack = self.undo_stack[-60:]
        self.redo_stack = []

    def _set(self, path, value, final=True):
        """Change one thing: path = "species" or ("build", "h"). final=False = a slider still moving (no undo step yet)."""
        if not final and not self._drag:
            self._drag = self._snap()
        if final:
            self._remember(self._drag or None)
            self._drag = ""
        if isinstance(path, tuple):
            part = dict(self.over.get(path[0]) or {})
            part[path[1]] = value
            self.over[path[0]] = part
        else:
            self.over[path] = value
        if final:
            self._draw()
        else:
            self._preview()

    def _preview(self):
        d = self._def()
        self.turntable.char = d
        self.title_label.text = d.get("name") or "My character"
        self.undo_button.enabled = bool(self.undo_stack)
        self.redo_button.enabled = bool(self.redo_stack)
        return d

    def _draw(self):
        d = self._preview()
        b, f, col = d["build"], d["face"], d["colors"]
        sp = d["species"]
        human = sp == "human"
        self.base_label.text = "Started from %s" % vt.char_def(self.base)["name"]
        self.species_panel.items = [{"id": k, "label": n, "emoji": e, "on": k == sp} for k, n, e in SPECIES]
        self.torso_panel.items = [{"id": k, "label": n, "on": k == b.get("torso")} for k, n in TORSOS]
        for key in BODY:
            getattr(self, "s_" + key).value = b.get(key, 1)
        for key in FACE:
            getattr(self, "f_" + key).value = f.get(key, 0 if key == "lift" else 1)
        self.ears_panel.items = [{"id": k, "label": n, "on": k == (f.get("ears") or "auto")} for k, n in EARS]
        self.freckles_check.checked = bool(f.get("freckles"))
        self.lashes_check.checked = bool(f.get("lashes"))
        self.cheeks_check.checked = bool(f.get("cheeks"))
        self.hair_note.visible = not human
        self.hair_panel.items = [{"id": h, "label": "Bald" if h == "none" else _title(h), "on": h == d.get("hair")} for h in vt.hairs()]
        self.hat_panel.items = [{"id": h, "label": HAT_NAMES.get(h, _title(h)), "on": h == d.get("hat")} for h in vt.hats()]
        acc = d.get("acc") or []
        self.acc_panel.items = [{"id": a, "label": ACC_NAMES.get(a, _title(a)), "on": a in acc} for a in vt.accs()]
        self.acc_count.text = "%d of 6" % len(acc)
        for key in COLORS:
            getattr(self, "c_" + key).value = col.get(key) or ("" if key == "hat" else "#f7f4ee" if key == "gloves" else "#888888")
        self.c_fur2.visible = not human
        self.c_hat.visible = d.get("hat") not in (None, "none")
        self.c_gloves.visible = "gloves" in acc
        self.name_box.text = d.get("name") or ""
        self.tag_box.text = d.get("tag") or ""
        self.role_dd.selected_value = d.get("role") if d.get("role") in [r["id"] for r in vt.roles()] else "lead"
        self.voice_dd.selected_value = d.get("voice") if d.get("voice") in [v for _, v in VOICES] else "bright"
        self.base_dd.selected_value = self.base

    # ---------------------------------------------------------------- controls
    def _slider(self, path):
        def changed(value=1.0, final=True, **event_args):
            self._set(path, round(float(value), 3), final)
        return changed

    def _color(self, key):
        def changed(value="", **event_args):
            cols = dict(self.over.get("colors") or {})
            self._remember()
            if value:
                cols[key] = value
            else:
                cols.pop(key, None)
            self.over["colors"] = cols
            self._preview()
        return changed

    def _species(self, chip_id=None, **event_args):
        self._set("species", chip_id)

    def _torso(self, chip_id=None, **event_args):
        self._set(("build", "torso"), chip_id)

    def _ears(self, chip_id=None, **event_args):
        self._set(("face", "ears"), chip_id)

    def _hair(self, chip_id=None, **event_args):
        self._set("hair", chip_id)

    def _hat(self, chip_id=None, **event_args):
        self._set("hat", chip_id)

    def _acc(self, chip_id=None, **event_args):
        acc = list(self._def().get("acc") or [])
        if chip_id in acc:
            acc.remove(chip_id)
        elif len(acc) >= 6:
            state.toast("Six accessories is the limit: take one off first.", "error")
            return
        else:
            acc.append(chip_id)
        self._set("acc", acc)

    def _face_switch(self, key, on):
        self._set(("face", key), 1 if on else 0)

    @handle("freckles_check", "change")
    def freckles_check_change(self, **event_args):
        self._face_switch("freckles", self.freckles_check.checked)

    @handle("lashes_check", "change")
    def lashes_check_change(self, **event_args):
        self._face_switch("lashes", self.lashes_check.checked)

    @handle("cheeks_check", "change")
    def cheeks_check_change(self, **event_args):
        self._face_switch("cheeks", self.cheeks_check.checked)

    @handle("name_box", "lost_focus")
    @handle("name_box", "pressed_enter")
    def name_box_change(self, **event_args):
        name = (self.name_box.text or "").strip()
        if name and name != self.over.get("name"):
            self._set("name", name[:40])

    @handle("tag_box", "lost_focus")
    @handle("tag_box", "pressed_enter")
    def tag_box_change(self, **event_args):
        tag = (self.tag_box.text or "").strip()
        if tag != (self.over.get("tag") or ""):
            self._set("tag", tag[:80])

    @handle("role_dd", "change")
    def role_dd_change(self, **event_args):
        self._set("role", self.role_dd.selected_value)

    @handle("voice_dd", "change")
    def voice_dd_change(self, **event_args):
        self._set("voice", self.voice_dd.selected_value)

    @handle("base_dd", "change")
    def base_dd_change(self, **event_args):
        new = self.base_dd.selected_value
        if not new or new == self.base:
            return
        self._remember()
        keep = {k: self.over[k] for k in ("name", "tag") if self.over.get(k)}
        self.base = new
        self.over = keep
        self._draw()
        state.toast("Starting again from %s. Undo brings your version back." % vt.char_def(new)["name"], "ok")

    # ---------------------------------------------------------------- the screen test
    def _try_emo(self, chip_id=None, **event_args):
        self.turntable.emo = chip_id
        self.try_emo_panel.items = [dict(e, on=e["id"] == chip_id) for e in self.try_emo_panel.items]

    def _try_gest(self, chip_id=None, **event_args):
        self.turntable.gesture(chip_id)

    # ---------------------------------------------------------------- tabs
    def _show_tab(self, tab):
        self.tab = tab
        parts = {"body": self.part_body, "face": self.part_face, "hair": self.part_hair, "outfit": self.part_outfit,
                 "extras": self.part_extras, "card": self.part_card}
        tabs = {"body": self.tab_body, "face": self.tab_face, "hair": self.tab_hair, "outfit": self.tab_outfit,
                "extras": self.tab_extras, "card": self.tab_card}
        for k in TABS:
            parts[k].visible = k == tab
            tabs[k].role = ["tab", "on"] if k == tab else ["tab"]

    @handle("tab_body", "click")
    def tab_body_click(self, **event_args):
        self._show_tab("body")

    @handle("tab_face", "click")
    def tab_face_click(self, **event_args):
        self._show_tab("face")

    @handle("tab_hair", "click")
    def tab_hair_click(self, **event_args):
        self._show_tab("hair")

    @handle("tab_outfit", "click")
    def tab_outfit_click(self, **event_args):
        self._show_tab("outfit")

    @handle("tab_extras", "click")
    def tab_extras_click(self, **event_args):
        self._show_tab("extras")

    @handle("tab_card", "click")
    def tab_card_click(self, **event_args):
        self._show_tab("card")

    # ---------------------------------------------------------------- undo, redo, surprise
    def _restore(self, snap):
        s = json.loads(snap)
        self.base = s["b"]
        self.over = s["o"]
        self._draw()

    @handle("undo_button", "click")
    def undo_button_click(self, **event_args):
        if self.undo_stack:
            self.redo_stack.append(self._snap())
            self._restore(self.undo_stack.pop())

    @handle("redo_button", "click")
    def redo_button_click(self, **event_args):
        if self.redo_stack:
            self.undo_stack.append(self._snap())
            self._restore(self.redo_stack.pop())

    @handle("surprise_button", "click")
    def surprise_button_click(self, **event_args):
        self._remember()
        keep = {k: self.over[k] for k in ("name", "tag", "role") if self.over.get(k)}
        self.over = dict(vt.py(vt.VT.randomDef()), **keep)
        self._draw()

    # ---------------------------------------------------------------- saving
    def _data(self, name=None):
        data = json.loads(json.dumps(self.over))
        data["base"] = self.base
        data["name"] = name or (self.name_box.text or "").strip() or self._def().get("name") or "My character"
        return data

    def _save(self, uid, data):
        self.message.visible = False
        self.save_button.enabled = self.copy_button.enabled = False
        try:
            r = anvil.server.call("wardrobe_save", uid, data)
        finally:
            self.save_button.enabled = self.copy_button.enabled = True
        if not r.get("ok"):
            self.message.text, self.message.visible = r.get("error") or "That didn't save.", True
            return False
        return True

    @handle("save_button", "click")
    def save_button_click(self, **event_args):
        data = self._data()
        if self._save(self.uid, data):
            state.toast("%s is in the wardrobe, ready for any cast." % data["name"], "ok")
            router.go("casting", "wardrobe")

    @handle("copy_button", "click")
    def copy_button_click(self, **event_args):
        name = self._data()["name"]
        data = self._data(name if name.endswith("(copy)") else (name[:33] + " (copy)"))
        if self._save(vt.uid("c"), data):
            state.toast("Saved a copy: %s." % data["name"], "ok")
            router.go("casting", "wardrobe")

    @handle("delete_button", "click")
    def delete_button_click(self, **event_args):
        if confirm("Pictures that already cast this character keep their copy.", title="Delete %s from your wardrobe?" % self._def().get("name"),
                   buttons=[("Keep", False), ("Delete", True)], role="app-dialog"):
            if state.call("wardrobe_delete", self.uid) is not None:
                state.toast("Deleted.", "ok")
                router.go("casting", "wardrobe")
