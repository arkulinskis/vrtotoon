import anvil.js
import anvil.server
from anvil import *
from anvil.js import window

from ._anvil_designer import DoorTemplate
from ... import router, state

LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ"


class Door(DoorTemplate):
    """#door: the stage door keypad for headsets. Big letter keys (no I, L or O), typing works too. Four letters open the
    picture's stage in this browser for 12 hours (stage_join), then go to #stage/<id>."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.code = ""
        self.keys_panel.items = [{"key": c, "label": c} for c in LETTERS] + [{"key": "back", "label": "⌫"}]
        self.keys_panel.add_event_handler("x-key", self._press)
        self.lot_link.visible = bool(state.me())
        self._typed = anvil.js.report_exceptions(self._keydown)
        window.document.addEventListener("keydown", self._typed)
        self._draw()

    def leave(self):
        window.document.removeEventListener("keydown", self._typed)

    def _keydown(self, event):
        k = (getattr(event, "key", None) or "").upper()
        if k == "BACKSPACE":
            self._press("back")
        elif len(k) == 1 and k in LETTERS:
            self._press(k)

    def _draw(self):
        for i, slot in enumerate([self.s1, self.s2, self.s3, self.s4]):
            slot.text = self.code[i] if i < len(self.code) else ""
            slot.role = ["door-slot", "filled"] if i < len(self.code) else ["door-slot"]

    def _press(self, key=None, **event_args):
        self.message.visible = False
        if key == "back":
            self.code = self.code[:-1]
        elif key and len(self.code) < 4:
            self.code += key
        self._draw()
        if len(self.code) == 4:
            r = anvil.server.call("stage_join", self.code)
            if r.get("ok"):
                state.toast("Welcome to the set of %s" % r["title"], "ok")
                router.go("stage", r["pid"])
            else:
                self.message.text, self.message.visible = r.get("error") or "That code didn't work.", True
                self.code = ""
                self._draw()
