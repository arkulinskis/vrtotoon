import anvil.server
from anvil import *

from ._anvil_designer import WardrobeTemplate
from ... import vt

PALETTE = [("Marquee red", "#d7263d"), ("Velvet", "#b3182b"), ("Tangerine", "#ff7a1a"), ("Sunflower", "#ffc23d"), ("Gold", "#e8b54a"),
           ("Mint", "#7ee0c4"), ("Leaf", "#39b54a"), ("Teal", "#5fb8b2"), ("Sky", "#4d8fd6"), ("Navy", "#2b2d42"), ("Violet", "#6a3fd1"),
           ("Plum", "#4b2a6b"), ("Pink", "#ff8fab"), ("Rose", "#e58fae"), ("Cream", "#f7f4ee"), ("Silver", "#b9c2cc"), ("Grey", "#5b5560"),
           ("Brown", "#8a5a36"), ("Chocolate", "#4a2c17"), ("Black", "#151214")]
SKINS = [("Porcelain", "#eadfd6"), ("Peach", "#f6cfae"), ("Honey", "#e8b48c"), ("Caramel", "#c98c5e"), ("Bronze", "#9a6440"), ("Cocoa", "#6e4429"),
         ("Golden fur", "#d9a05b"), ("Ginger fur", "#e8762d"), ("Bear brown", "#8a5a36"), ("Snow", "#f4efe9"), ("Charcoal", "#2a2628"),
         ("Frog green", "#5fbf4a"), ("Alien mint", "#7ee0c4"), ("Ogre green", "#7cb342"), ("Robot teal", "#5fb8b2"), ("Ghost white", "#f4f6ff")]
HEIGHTS = [("Tiny", 0.72), ("Small", 0.85), ("Regular", 1.0), ("Tall", 1.1), ("Towering", 1.22)]
BUILDS = [("Slim", 0.85), ("Regular", 1.0), ("Sturdy", 1.15), ("Round", 1.3)]


def _choices(palette, current):
    items = [(n, c) for n, c in palette]
    if current and current not in [c for _, c in palette]:
        items = [("Original", current)] + items
    return items


class Wardrobe(WardrobeTemplate):
    """Make (or edit) a variant of a premade character: colours, hair, hat, accessories, height and build.
    base = the premade id; draft = the variant's saved overrides; uid = its id when editing. Closes with True when saved."""

    def __init__(self, base="max", draft=None, uid=None, **properties):
        super().__init__(**properties)
        self.base = base
        self.uid = uid or vt.uid("c")
        start = vt.char_def(base)
        d = vt.make_def(base, draft or {})
        self.start = d
        self.base_label.text = "A variant of " + start["name"]
        self.name_box.text = (draft or {}).get("name") or ("%s (my cut)" % start["name"])
        col = d["colors"]
        self.skin_dd.items = _choices(SKINS, col.get("skin"))
        self.skin_dd.selected_value = col.get("skin")
        for dd, key in ((self.shirt_dd, "shirt"), (self.pants_dd, "pants"), (self.shoes_dd, "shoes"), (self.accent_dd, "accent"), (self.haircol_dd, "hair")):
            dd.items = _choices(PALETTE, col.get(key))
            dd.selected_value = col.get(key)
        human = d.get("species") == "human"
        self.hair_dd.items = [(h.title(), h) for h in vt.hairs()]
        self.hair_dd.selected_value = d.get("hair") or "none"
        self.hair_dd.enabled = human
        self.haircol_dd.enabled = human
        self.hat_dd.items = [(h.title() if h != "space" else "Space helmet", h) for h in vt.hats()]
        self.hat_dd.selected_value = d.get("hat") or "none"
        b = d.get("build") or {}
        self.height_dd.items = HEIGHTS + ([("Original", b.get("h"))] if b.get("h") not in [v for _, v in HEIGHTS] else [])
        self.height_dd.selected_value = b.get("h", 1.0)
        self.build_dd.items = BUILDS + ([("Original", b.get("girth"))] if b.get("girth") not in [v for _, v in BUILDS] else [])
        self.build_dd.selected_value = b.get("girth", 1.0)
        self.acc = list(d.get("acc") or [])
        self.acc_panel.add_event_handler("x-chip", self._acc)
        self._draw_acc()
        self._preview()

    def _overrides(self):
        return {"base": self.base, "name": (self.name_box.text or "").strip() or self.start["name"],
                "colors": {"skin": self.skin_dd.selected_value, "shirt": self.shirt_dd.selected_value, "pants": self.pants_dd.selected_value,
                           "shoes": self.shoes_dd.selected_value, "accent": self.accent_dd.selected_value, "hair": self.haircol_dd.selected_value},
                "build": {"h": self.height_dd.selected_value, "girth": self.build_dd.selected_value},
                "hair": self.hair_dd.selected_value, "hat": self.hat_dd.selected_value, "acc": self.acc}

    def _preview(self):
        self.turntable.char = vt.make_def(self.base, self._overrides())

    def _draw_acc(self):
        self.acc_panel.items = [{"id": a, "label": a.title(), "on": a in self.acc} for a in vt.accs()]

    def _acc(self, chip_id=None, **event_args):
        if chip_id in self.acc:
            self.acc.remove(chip_id)
        elif len(self.acc) < 6:
            self.acc.append(chip_id)
        self._draw_acc()
        self._preview()

    @handle("skin_dd", "change")
    @handle("shirt_dd", "change")
    @handle("pants_dd", "change")
    @handle("shoes_dd", "change")
    @handle("accent_dd", "change")
    @handle("haircol_dd", "change")
    @handle("hair_dd", "change")
    @handle("hat_dd", "change")
    @handle("height_dd", "change")
    @handle("build_dd", "change")
    def any_change(self, **event_args):
        self._preview()

    @handle("cancel_button", "click")
    def cancel_button_click(self, **event_args):
        self.raise_event("x-close-alert", value=False)

    @handle("save_button", "click")
    def save_button_click(self, **event_args):
        self.save_button.enabled = False
        try:
            r = anvil.server.call("wardrobe_save", self.uid, self._overrides())
        finally:
            self.save_button.enabled = True
        if not r.get("ok"):
            self.message.text, self.message.visible = r.get("error") or "That didn't work.", True
            return
        self.raise_event("x-close-alert", value=True)
