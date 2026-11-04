from anvil import *
import anvil.js

from ._anvil_designer import TimelineViewTemplate
from ... import vt


class TimelineView(TimelineViewTemplate):
    """The editor's timeline. load(doc, stage) builds it on the stage's film; .timeline is the JS VT.Timeline."""

    def __init__(self, **properties):
        self.timeline = vt.NULL
        super().__init__(**properties)

    def _picked(self, sel=None, *args):
        if sel is None:
            self.raise_event("select", kind=None, item_id=None)
        else:
            self.raise_event("select", kind=sel.kind, item_id=sel.id)

    def load(self, doc, stage):
        self.unload()
        film = anvil.js.window.Function("stage", "return function () { return stage.film; };")(stage)
        opts = {"doc": doc, "film": film, "onSelect": anvil.js.report_exceptions(self._picked)}
        self.timeline = anvil.js.new(vt.VT.Timeline, self.dom_nodes["mount"], opts)
        self.timeline.fit()
        return self.timeline

    def unload(self):
        if self.timeline is not None:
            self.timeline.destroy()
            self.timeline = vt.NULL
