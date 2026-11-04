import anvil.js
from anvil import *
from anvil.js import window

from ._anvil_designer import ColorPickTemplate

PALETTES = {
    "clothes": [("Marquee red", "#d7263d"), ("Velvet", "#b3182b"), ("Tangerine", "#ff7a1a"), ("Sunflower", "#ffc23d"), ("Gold", "#e8b54a"),
                ("Mint", "#7ee0c4"), ("Leaf", "#39b54a"), ("Teal", "#5fb8b2"), ("Sky", "#4d8fd6"), ("Navy", "#2b2d42"), ("Violet", "#6a3fd1"),
                ("Plum", "#4b2a6b"), ("Pink", "#ff8fab"), ("Cream", "#f7f4ee"), ("Silver", "#b9c2cc"), ("Grey", "#5b5560"), ("Brown", "#8a5a36"),
                ("Black", "#151214")],
    "skin": [("Porcelain", "#eadfd6"), ("Peach", "#f6cfae"), ("Honey", "#e8b48c"), ("Caramel", "#c98c5e"), ("Bronze", "#9a6440"), ("Cocoa", "#6e4429"),
             ("Golden fur", "#d9a05b"), ("Ginger fur", "#e8762d"), ("Bear brown", "#8a5a36"), ("Snow", "#f4efe9"), ("Charcoal", "#2a2628"),
             ("Frog green", "#5fbf4a"), ("Alien mint", "#7ee0c4"), ("Ogre green", "#7cb342"), ("Robot teal", "#5fb8b2"), ("Ghost white", "#f4f6ff")],
    "hair": [("Jet", "#151012"), ("Espresso", "#3b1f14"), ("Chestnut", "#6b3a1e"), ("Brown", "#8a5a36"), ("Honey blond", "#c9a14a"),
             ("Platinum", "#e8dcb0"), ("Silver", "#d9d9dc"), ("Ginger", "#e8762d"), ("Cherry", "#b3182b"), ("Bubblegum", "#ff8fab"),
             ("Violet", "#6a3fd1"), ("Electric blue", "#4d8fd6"), ("Lime", "#9be564")],
    "eyes": [("Dark brown", "#2a1a10"), ("Hazel", "#6b4a1e"), ("Forest", "#2b4a2b"), ("Ocean", "#2a3a5a"), ("Sky", "#4d8fd6"), ("Violet", "#6a1b9a"),
             ("Lime", "#9acd32"), ("Amber", "#ffca28"), ("Cyan glow", "#7ff9ff"), ("Ruby", "#b3182b"), ("Black", "#111111")],
}


class ColorPick(ColorPickTemplate):
    """A colour: suggested swatches (palette) plus the browser's own picker. change(value). With auto on, the first
    swatch is "the part's own colour" (value "")."""

    def __init__(self, **properties):
        self._label = ""
        self._value = "#d7263d"
        self._palette = "clothes"
        self._auto = False
        self._ready = False
        super().__init__(**properties)
        self._ready = True
        self.swatch_panel.add_event_handler("x-swatch", self._swatch)
        self.dom_nodes["input"].addEventListener("input", anvil.js.report_exceptions(self._native))
        self._sync()

    def _sync(self):
        if not self._ready:
            return
        self.label_label.text = self._label
        items = [{"color": "", "name": "Its own colour", "on": not self._value}] if self._auto else []
        items += [{"color": c, "name": n, "on": c.lower() == (self._value or "").lower()} for n, c in PALETTES.get(self._palette, PALETTES["clothes"])]
        if self._value and not any(i["on"] for i in items):
            items.insert(1 if self._auto else 0, {"color": self._value, "name": "Your colour", "on": True})
        self.swatch_panel.items = items
        window.Object.assign(self.dom_nodes["input"], {"value": self._value or "#ffffff"})

    def _swatch(self, color=None, **event_args):
        self._value = color or ""
        self._sync()
        self.raise_event("change", value=self._value)

    def _native(self, event=None):
        self._value = str(getattr(self.dom_nodes["input"], "value"))
        self._sync()
        self.raise_event("change", value=self._value)

    @property
    def label(self):
        return self._label

    @label.setter
    def label(self, v):
        self._label = v or ""
        self._sync()

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, v):
        self._value = v or ""
        self._sync()

    @property
    def palette(self):
        return self._palette

    @palette.setter
    def palette(self, v):
        self._palette = v or "clothes"
        self._sync()

    @property
    def auto(self):
        return self._auto

    @auto.setter
    def auto(self, v):
        self._auto = bool(v)
        self._sync()
