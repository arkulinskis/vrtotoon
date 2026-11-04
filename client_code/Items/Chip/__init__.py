from anvil import *

from ._anvil_designer import ChipTemplate


class Chip(ChipTemplate):
    """A small pill button (an emotion, a gesture, a role filter). item = {id, label, emoji, on, kind}.
    Click: x-chip on the RepeatingPanel with the item's id and kind."""

    def __init__(self, **properties):
        super().__init__(**properties)
        if self.item.get("on"):
            self.chip.role = ["chip", "on"]

    @handle("chip", "click")
    def chip_click(self, **event_args):
        self.parent.raise_event("x-chip", chip_id=self.item.get("id"), kind=self.item.get("kind"))
