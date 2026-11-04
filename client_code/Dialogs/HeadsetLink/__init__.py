import anvil.server
from anvil import *
from anvil.js import window

from ._anvil_designer import HeadsetLinkTemplate
from ... import state, vt


class HeadsetLink(HeadsetLinkTemplate):
    """Pair a headset with this picture (a 4-letter code), see whether it is connected, call the next take and send a
    note to the performer's teleprompter. page = the editor (its doc and its headset status)."""

    def __init__(self, page, **properties):
        super().__init__(**properties)
        self.page = page
        r = state.call("stage_link", page.pid)
        if r is None:
            self.timer.interval = 0
            return
        self.code_label.text = " ".join(r["code"])
        self.url_label.text = window.location.href.split("#")[0] + "#door"
        self._status(r["online"], r.get("device") or "")
        self.actor_dd.items = page.cast_short
        self.actor_dd.selected_value = page.actor
        beats = vt.beats(page.doc, page.takes)
        items = [("%d. %s: %s" % (b["n"], b["name"], (b["text"] or "")[:28]), b["id"]) for b in beats]
        self.from_dd.items = [("The start", "")] + items
        self.to_dd.items = [("The end", "")] + items

    def _status(self, online, device):
        self.dot.classes["on"] = bool(online)
        self.status_label.text = ("Connected: %s" % (device or "a headset")) if online else "Waiting for the headset..."

    @handle("timer", "tick")
    def timer_tick(self, **event_args):
        r = anvil.server.call_s("stage_status", self.page.pid, None)
        if r.get("ok"):
            self._status(r["online"], r["device"])

    @handle("call_button", "click")
    def call_button_click(self, **event_args):
        call = {"actor": self.actor_dd.selected_value, "from": self.from_dd.selected_value or None, "to": self.to_dd.selected_value or None}
        if state.call("stage_call", self.page.pid, call) is not None:
            state.toast("Called. The headset shows it in a moment.", "ok")

    @handle("note_button", "click")
    def note_button_click(self, **event_args):
        if state.call("stage_note", self.page.pid, self.note_box.text or "") is not None:
            state.toast("Note sent to the teleprompter.", "ok")

    @handle("note_box", "pressed_enter")
    def note_box_pressed_enter(self, **event_args):
        self.note_button_click()

    @handle("close_button", "click")
    def close_button_click(self, **event_args):
        self.timer.interval = 0
        self.raise_event("x-close-alert", value=None)
