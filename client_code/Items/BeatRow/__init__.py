from anvil import *

from ._anvil_designer import BeatRowTemplate

GAPS = [("Overlap (cut in)", -0.4), ("No pause", 0.0), ("Short pause", 0.2), ("Normal pause", 0.35), ("A beat", 0.7), ("Long pause", 1.2), ("Very long", 2.0)]


class BeatRow(BeatRowTemplate):
    """One beat of the script: who speaks (or ACTION), the feeling, the words, the pause after it.
    item = a row from VT.ed.beats + 'cast' [(name, id)] + 'emos' [(label, id)]. Every edit goes to the page as x-beat
    (op, beat_id, value); the page changes the document."""

    def __init__(self, **properties):
        super().__init__(**properties)
        it = self.item
        self.who_dd.items = list(it["cast"]) + [("ACTION (no lines)", "__action")]
        self.who_dd.selected_value = "__action" if it["kind"] == "action" else (it["who"] or None)
        self.emo_dd.items = [("No feeling set", "")] + list(it["emos"])
        self.emo_dd.selected_value = it["emo"] or ""
        self.emo_dd.visible = it["kind"] == "line"
        gaps = list(GAPS)
        if it["gap"] not in [v for _, v in gaps]:
            gaps.append(("Pause %.2fs" % it["gap"], it["gap"]))
        self.gap_dd.items = gaps
        self.gap_dd.selected_value = it["gap"]
        self.text_box.placeholder = "What happens (an action beat)" if it["kind"] == "action" else "The line"
        self.meta.text = "%s · %.1fs%s" % (it["start"], it["dur"], " · recorded" if it["recorded"] else "")
        self.row.classes["recorded"] = bool(it["recorded"])
        self.row.classes["action"] = it["kind"] == "action"
        self.row.classes["picked"] = bool(it.get("picked"))
        self.num_box.style["background"] = it["col"]
        self.booth_button.visible = it["kind"] == "line" and bool(it.get("can_edit"))
        self.booth_button.text = "Re-record" if it["recorded"] else "Record line"

    def _send(self, op, value=None):
        self.parent.raise_event("x-beat", op=op, beat_id=self.item["id"], value=value)

    @handle("who_dd", "change")
    def who_dd_change(self, **event_args):
        self._send("who", self.who_dd.selected_value)

    @handle("emo_dd", "change")
    def emo_dd_change(self, **event_args):
        self._send("emo", self.emo_dd.selected_value)

    @handle("gap_dd", "change")
    def gap_dd_change(self, **event_args):
        self._send("gap", self.gap_dd.selected_value)

    @handle("text_box", "lost_focus")
    def text_box_lost_focus(self, **event_args):
        if (self.text_box.text or "") != self.item["text"]:
            self._send("text", self.text_box.text or "")

    @handle("text_box", "focus")
    def text_box_focus(self, **event_args):
        self._send("focus")

    @handle("booth_button", "click")
    def booth_button_click(self, **event_args):
        self._send("booth")

    @handle("up_button", "click")
    def up_button_click(self, **event_args):
        self._send("move", -1)

    @handle("down_button", "click")
    def down_button_click(self, **event_args):
        self._send("move", 1)

    @handle("delete_button", "click")
    def delete_button_click(self, **event_args):
        self._send("delete")
