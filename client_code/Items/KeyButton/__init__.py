from anvil import *

from ._anvil_designer import KeyButtonTemplate


class KeyButton(KeyButtonTemplate):
    """A big key on the stage door keypad (easy to hit with a VR laser or a finger). item = {key, label}."""

    def __init__(self, **properties):
        super().__init__(**properties)
        if self.item["key"] in ("back", "go"):
            self.key.role = ["door-key", "door-key-" + self.item["key"]]

    @handle("key", "click")
    def key_click(self, **event_args):
        self.parent.raise_event("x-key", key=self.item["key"])
