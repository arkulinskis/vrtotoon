from anvil import *
import anvil.js

from ._anvil_designer import PerformViewTemplate
from ... import vt


class PerformView(PerformViewTemplate):
    """The performance stage (VT.Perform). .perform is the JS object: action(), cut(), keep(), retake(), enterVR(ar) ..."""

    def __init__(self, **properties):
        self.perform = vt.NULL
        super().__init__(**properties)

    def _state(self, st=None, *args):
        if st is not None:
            self.raise_event("state", info=vt.py(st))

    def _kept(self, p=None, *args):
        if p is not None:
            self.raise_event("kept", take=p)

    def load(self, doc, takes, actor=None, first=None, last=None):
        self.unload()
        opts = {"doc": doc, "takes": takes, "actor": actor, "from": first, "to": last,
                "onState": anvil.js.report_exceptions(self._state), "onPass": anvil.js.report_exceptions(self._kept)}
        self.perform = anvil.js.new(vt.VT.Perform, self.dom_nodes["mount"], opts)
        return self.perform

    def unload(self):
        if self.perform is not None:
            self.perform.destroy()
            self.perform = vt.NULL

    @handle("", "hide")
    def form_hide(self, **event_args):
        self.unload()
