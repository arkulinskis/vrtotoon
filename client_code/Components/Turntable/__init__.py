from anvil import *
import anvil.js

from ._anvil_designer import TurntableTemplate
from ... import vt


class Turntable(TurntableTemplate):
    """A character on a podium (casting, the wardrobe): drag to turn; set_emotion, gesture and talk act it out."""

    def __init__(self, **properties):
        self._char, self._emo, self._stage, self._ready = "max", "happy", None, False
        super().__init__(**properties)
        self._ready = True

    def _def(self):
        c = self._char
        if isinstance(c, str):
            return vt.char_def(c)
        if c.get("base"):
            return vt.make_def(c["base"], c)
        return c

    def _mount(self):
        if not self._ready or self._stage is not None:
            return
        self._stage = anvil.js.new(vt.VT.Stage, self.dom_nodes["mount"], {"mode": "turntable", "char": self._def(), "emo": self._emo})

    def _unmount(self):
        if self._stage is not None:
            self._stage.destroy()
            self._stage = None

    def gesture(self, gesture_id):
        if self._stage is not None:
            self._stage.gesture(gesture_id)

    def talk(self, on):
        if self._stage is not None:
            self._stage.talk(bool(on))

    @handle("", "show")
    def form_show(self, **event_args):
        self._mount()

    @handle("", "hide")
    def form_hide(self, **event_args):
        self._unmount()

    @property
    def char(self):
        return self._char

    @char.setter
    def char(self, value):
        self._char = value or "max"
        if self._stage is not None:
            self._stage.setChar(self._def(), self._emo)

    @property
    def emo(self):
        return self._emo

    @emo.setter
    def emo(self, value):
        self._emo = value or "happy"
        if self._stage is not None:
            self._stage.setEmotion(self._emo)
