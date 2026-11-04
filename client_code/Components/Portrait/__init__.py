from anvil import *

from ._anvil_designer import PortraitTemplate
from ... import state, vt


class Portrait(PortraitTemplate):
    """A character's picture: VT.portrait renders it with the 3D engine (cached per character + emotion)."""

    def __init__(self, **properties):
        self._char, self._emo, self._size, self._full = "max", "happy", 256, False
        self._ready = False
        super().__init__(**properties)
        self._ready = True
        self._draw()

    def _draw(self):
        if not self._ready or not self._char:
            return
        state.set_attr(self.img, "src", vt.portrait(self._char, self._emo or "happy", int(self._size or 256), bool(self._full)))
        name = self._char if isinstance(self._char, str) else (self._char.get("name") or "")
        state.set_attr(self.img, "alt", name)

    def box_click(self, event):
        self.raise_event("click")

    @property
    def char(self):
        return self._char

    @char.setter
    def char(self, value):
        self._char = value
        self._draw()

    @property
    def emo(self):
        return self._emo

    @emo.setter
    def emo(self, value):
        self._emo = value or "happy"
        self._draw()

    @property
    def size(self):
        return self._size

    @size.setter
    def size(self, value):
        self._size = value or 256
        self._draw()

    @property
    def full(self):
        return self._full

    @full.setter
    def full(self, value):
        self._full = bool(value)
        self._draw()
