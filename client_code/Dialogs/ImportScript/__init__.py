from anvil import *

from ._anvil_designer import ImportScriptTemplate
from ... import vt

SAMPLE = """MAX: (excited) We did it, Rosie! Our own picture!
ROSIE: (smug) We haven't shot a single frame, Max.
[ACTION 2s] Max trips over a cable.
MAX: (shy) ...Now we have."""


class ImportScript(ImportScriptTemplate):
    """Paste or edit the whole script as text. Closes with {text, mode: replace | append, direct}, or None."""

    def __init__(self, current="", **properties):
        super().__init__(**properties)
        self.text_box.text = current or SAMPLE
        self._preview()

    def _preview(self):
        p = vt.parse_script(self.text_box.text or "")
        lines = len([b for b in p["beats"] if b["kind"] == "line"])
        self.preview.text = "%d lines, %d action beats, characters: %s" % (lines, len(p["beats"]) - lines, ", ".join(p["names"]) or "none yet")

    @handle("text_box", "change")
    def text_box_change(self, **event_args):
        self._preview()

    @handle("cancel_button", "click")
    def cancel_button_click(self, **event_args):
        self.raise_event("x-close-alert", value=None)

    @handle("ok_button", "click")
    def ok_button_click(self, **event_args):
        if not (self.text_box.text or "").strip():
            return
        self.raise_event("x-close-alert", value={"text": self.text_box.text, "mode": "append" if self.mode_append.selected else "replace",
                                                 "direct": bool(self.direct_check.checked)})
