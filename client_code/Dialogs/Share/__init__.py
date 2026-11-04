from anvil import *
from anvil.js import window

from ._anvil_designer import ShareTemplate
from ... import router, state, vt


class Share(ShareTemplate):
    """Share or unshare a picture, copy its screening link, set its poster. Closes with {shared, share_key}."""

    def __init__(self, production=None, stage=None, **properties):
        super().__init__(**properties)
        self.p = production or {}
        self.stage = stage
        self.result = {"shared": bool(self.p.get("shared")), "share_key": self.p.get("share_key") or ""}
        self.share_check.checked = bool(self.p.get("shared"))
        self._draw()

    def _draw(self):
        on = self.result["shared"] and self.result["share_key"]
        self.link_box.visible = bool(on)
        if on:
            url = window.location.href.split("#")[0] + router.href("screen", self.result["share_key"])
            self.link_box_text.text = url
            state.set_attr(self.open_link, "href", router.href("screen", self.result["share_key"]))
        self.poster_note.text = "It has a poster." if self.p.get("poster") else "No poster yet: the cast stands in for one."

    @handle("share_check", "change")
    def share_check_change(self, **event_args):
        r = state.call("production_share", self.p["id"], bool(self.share_check.checked))
        if r is None:
            self.share_check.checked = bool(self.result["shared"])
            return
        self.result = {"shared": r["shared"], "share_key": r["share_key"]}
        self._draw()

    @handle("copy_button", "click")
    def copy_button_click(self, **event_args):
        vt.VT.ed.copy(self.link_box_text.text or "")
        state.toast("Link copied", "ok")

    @handle("poster_button", "click")
    def poster_button_click(self, **event_args):
        if self.stage is not None and state.call("production_poster", self.p["id"], self.stage.snapshot(640, 360)) is not None:
            self.p["poster"] = "set"
            state.toast("Poster saved", "ok")
            self._draw()

    @handle("close_button", "click")
    def close_button_click(self, **event_args):
        self.raise_event("x-close-alert", value=self.result)
