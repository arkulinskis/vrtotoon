from anvil import *

from ._anvil_designer import CanvasPickerTemplate
from ... import vt


class CanvasPicker(CanvasPickerTemplate):
    """The film's canvas (shape): a row of CanvasTiles and a line on what the chosen one is for. change(value)."""

    def __init__(self, **properties):
        self._value = "16:9"
        self._enabled = True
        self._describe = True
        self._ready = False
        super().__init__(**properties)
        self._ready = True
        self.tile_panel.add_event_handler("x-canvas", self._pick)
        self._sync()

    def _sync(self):
        if not self._ready:
            return
        self.tile_panel.items = [dict(a, on=a["id"] == self._value, off=not self._enabled) for a in vt.aspects()]
        a = vt.aspect(self._value)
        self.use_label.text = "%s · %s" % (a["label"], a["use"])
        self.use_label.visible = self._describe

    def _pick(self, aspect_id=None, **event_args):
        if not self._enabled or not aspect_id or aspect_id == self._value:
            return
        self._value = aspect_id
        self._sync()
        self.raise_event("change", value=aspect_id)

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, v):
        v = vt.aspect(v)["id"]
        if v != self._value:
            self._value = v
            self._sync()

    @property
    def enabled(self):
        return self._enabled

    @enabled.setter
    def enabled(self, v):
        self._enabled = bool(v)
        self._sync()

    @property
    def describe(self):
        return self._describe

    @describe.setter
    def describe(self, v):
        self._describe = bool(v)
        self._sync()
