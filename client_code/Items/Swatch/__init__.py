from anvil import *

from ._anvil_designer import SwatchTemplate


class Swatch(SwatchTemplate):
    """One colour in a ColorPick row. item = {color ("" = the part's own colour), name, on}. Click: x-swatch."""

    def __init__(self, **properties):
        super().__init__(**properties)
        col = self.item.get("color") or ""
        role = ["swatch"] + (["on"] if self.item.get("on") else []) + ([] if col else ["swatch-auto"])
        self.sw.role = role
        if col:
            self.sw.background = col
        else:
            self.sw.text = "Auto"

    @handle("sw", "click")
    def sw_click(self, **event_args):
        self.parent.raise_event("x-swatch", color=self.item.get("color") or "")
