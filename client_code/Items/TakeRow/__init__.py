from anvil import *

from ._anvil_designer import TakeRowTemplate
from ... import state

SOURCES = {"vr": ("VR", "vr"), "ar": ("Passthrough", "vr"), "desk": ("Desk puppet", "keyboard"), "voice": ("Voice", "mic")}


class TakeRow(TakeRowTemplate):
    """A recorded take: who, how (VR / desk / voice), how many clips are in the cut, a face pass, stars, Face, Use, Delete.
    item = a row from VT.ed.takes + 'can_edit'. Actions go to the page as x-take (op, uid, value)."""

    def __init__(self, **properties):
        super().__init__(**properties)
        it = self.item
        label, icon = SOURCES.get(it["source"], ("VR", "vr"))
        if it.get("builtin"):
            label = "Demo voice"
        self.src_badge.text = label
        self.src_i.classes.add("ic-" + icon)
        self.used_badge.visible = it["used"] > 0
        bits = [state.plural(it["lines"], "line")] if it["lines"] else []
        if it["clips"] > it["lines"]:
            bits.append(state.plural(it["clips"] - it["lines"], "reaction"))
        bits.append("%.1fs" % it["dur"])
        if it.get("created"):
            bits.append(state.ago(it["created"]))
        self.meta.text = " · ".join(bits)
        self.star_button.text = "★" * it["stars"] + "☆" * (3 - it["stars"])
        self.row.classes["used"] = it["used"] > 0
        can = bool(it.get("can_edit"))
        self.star_button.enabled = can
        self.delete_button.visible = can and not it.get("builtin")
        self.use_button.visible = it["used"] < it["clips"]
        self.face_badge.visible = bool(it.get("face"))
        self.face_button.text = "Redo face" if it.get("face") else "Face"

    def _send(self, op, value=None):
        self.parent.raise_event("x-take", op=op, uid=self.item["uid"], value=value)

    @handle("star_button", "click")
    def star_button_click(self, **event_args):
        self._send("star", (self.item["stars"] + 1) % 4)

    @handle("face_button", "click")
    def face_button_click(self, **event_args):
        self._send("face")

    @handle("use_button", "click")
    def use_button_click(self, **event_args):
        self._send("use")

    @handle("delete_button", "click")
    def delete_button_click(self, **event_args):
        self._send("delete")
