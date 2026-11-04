from anvil import *

from ._anvil_designer import ShotRowTemplate


class ShotRow(ShotRowTemplate):
    """A camera shot: when it cuts in, the kind of shot, who it's on, the camera move.
    item = a row from VT.ed.shots + 'types', 'cast', 'moves' choices. Changes go to the page as x-shot (op, shot_id, value)."""

    def __init__(self, **properties):
        super().__init__(**properties)
        it = self.item
        self.type_dd.items = it["types"]
        self.type_dd.selected_value = it["type"]
        self.a_dd.items = [("Whoever's talking", "")] + list(it["cast"])
        self.a_dd.selected_value = it["a"] or ""
        self.move_dd.items = it["moves"]
        self.move_dd.selected_value = it["move"]
        self.row.classes["picked"] = bool(it.get("picked"))

    def _send(self, op, value=None):
        self.parent.raise_event("x-shot", op=op, shot_id=self.item["id"], value=value)

    @handle("time_link", "click")
    def time_link_click(self, **event_args):
        self._send("seek", self.item["t"])

    @handle("type_dd", "change")
    def type_dd_change(self, **event_args):
        self._send("type", self.type_dd.selected_value)

    @handle("a_dd", "change")
    def a_dd_change(self, **event_args):
        self._send("a", self.a_dd.selected_value or None)

    @handle("move_dd", "change")
    def move_dd_change(self, **event_args):
        self._send("move", self.move_dd.selected_value)

    @handle("delete_button", "click")
    def delete_button_click(self, **event_args):
        self._send("delete")
