from anvil import *

from ._anvil_designer import CastRowTemplate
from ... import router, state


class CastRow(CastRowTemplate):
    """A cast member: portrait, screen name, the character playing it, voice effect, lines recorded, Perform.
    item = a row from VT.ed.cast + 'fx_items' + 'pid' + 'can_edit'. Edits go to the page as x-cast (op, actor_id, value)."""

    def __init__(self, **properties):
        super().__init__(**properties)
        it = self.item
        state.set_attr(self.pic, "src", it["portrait"])
        self.pic_box.style["border-color"] = it["col"]
        self.change_button.text = it["charName"]
        self.fx_dd.items = it["fx_items"]
        self.fx_dd.selected_value = it["fx"]
        self.meta.text = "%d of %s recorded" % (it["recorded"], state.plural(it["lines"], "line"))
        state.set_attr(self.perform_link, "href", router.href("stage", it["pid"], it["id"]))
        for c in (self.name_box, self.change_button, self.fx_dd, self.remove_button):
            c.enabled = bool(it.get("can_edit", True))

    def _send(self, op, value=None):
        self.parent.raise_event("x-cast", op=op, actor_id=self.item["id"], value=value)

    @handle("name_box", "lost_focus")
    def name_box_lost_focus(self, **event_args):
        v = (self.name_box.text or "").strip().upper()[:18]
        if v and v != self.item["name"]:
            self._send("name", v)

    @handle("name_box", "pressed_enter")
    def name_box_pressed_enter(self, **event_args):
        self.name_box_lost_focus()

    @handle("change_button", "click")
    def change_button_click(self, **event_args):
        self._send("recast")

    @handle("fx_dd", "change")
    def fx_dd_change(self, **event_args):
        self._send("fx", self.fx_dd.selected_value)

    @handle("remove_button", "click")
    def remove_button_click(self, **event_args):
        self._send("remove")
