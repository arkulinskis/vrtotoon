from anvil import *
import anvil.js

from ._anvil_designer import StageViewTemplate
from ... import vt


class StageView(StageViewTemplate):
    """The editor's 3D stage. load(doc, takes) builds it; .stage is the JS VT.Stage (play, seek, view ...)."""

    def __init__(self, **properties):
        self.stage = vt.NULL
        super().__init__(**properties)

    def load(self, doc, takes):
        self.unload()
        opts = {"mode": "edit", "doc": doc, "takes": takes, "view": "film",
                "onSelect": anvil.js.report_exceptions(lambda aid=None, *a: self.raise_event("select", actor=aid)),
                "onPlace": anvil.js.report_exceptions(lambda aid, x, z, *a: self.raise_event("place", actor=aid, x=x, z=z))}
        self.stage = anvil.js.new(vt.VT.Stage, self.dom_nodes["mount"], opts)
        return self.stage

    def unload(self):
        if self.stage is not None:
            self.stage.destroy()
            self.stage = vt.NULL

    @handle("", "hide")
    def form_hide(self, **event_args):
        if self.stage is not None:
            self.stage.pause()
