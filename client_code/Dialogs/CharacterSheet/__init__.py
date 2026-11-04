from anvil import *

from ._anvil_designer import CharacterSheetTemplate
from ... import router, state, vt


class CharacterSheet(CharacterSheetTemplate):
    """A character up close: a live turntable, emotions and gestures to try, a variant, a new picture starring them.
    item = a VT.CAST entry, or a wardrobe card {uid, name, def, raw, custom}. Closes with "changed" after a wardrobe change."""

    def __init__(self, item=None, **properties):
        super().__init__(**properties)
        self.item = item or {"id": "max", "name": "Max Marquee"}
        it = self.item
        self.custom = bool(it.get("custom"))
        self.turntable.char = it.get("def") or it.get("id")
        roles = {r["id"]: r["label"] for r in vt.roles()}
        self.role_label.text = "From your wardrobe" if self.custom else roles.get(it.get("role"), "On call")
        self.name_label.text = it.get("name") or ""
        self.tag_label.text = it.get("tag") or ""
        self.emo_panel.items = [{"id": e["id"], "label": e["label"], "emoji": e["emoji"], "kind": "emo", "on": e["id"] == "happy"} for e in vt.emotions()]
        self.gest_panel.items = [{"id": g["id"], "label": g["label"], "emoji": g["emoji"], "kind": "gest"} for g in vt.gestures()]
        self.emo_panel.add_event_handler("x-chip", self._chip)
        self.gest_panel.add_event_handler("x-chip", self._chip)
        signed_in = bool(state.me())
        self.variant_button.visible = signed_in
        self.delete_button.visible = signed_in and self.custom
        self.star_button.visible = signed_in and not self.custom
        self.variant_button.text = "Edit this variant" if self.custom else "Make a variant"
        self._result = None

    def _chip(self, chip_id=None, kind=None, **event_args):
        if kind == "emo":
            self.turntable.emo = chip_id
            self.emo_panel.items = [dict(e, on=e["id"] == chip_id) for e in self.emo_panel.items]
        else:
            self.turntable.gesture(chip_id)

    @handle("talk_button", "click")
    def talk_button_click(self, **event_args):
        self.turntable.talk(True)
        self.turntable.gesture("point")
        self.talk_timer.interval = 2.2

    @handle("talk_timer", "tick")
    def talk_timer_tick(self, **event_args):
        self.talk_timer.interval = 0
        self.turntable.talk(False)

    @handle("variant_button", "click")
    def variant_button_click(self, **event_args):
        from ..Wardrobe import Wardrobe
        if self.custom:
            dlg = Wardrobe(base=self.item["raw"].get("base") or "max", draft=self.item["raw"], uid=self.item["uid"])
        else:
            dlg = Wardrobe(base=self.item["id"])
        if alert(dlg, buttons=[], role="app-dialog", large=True):
            self.raise_event("x-close-alert", value="changed")

    @handle("delete_button", "click")
    def delete_button_click(self, **event_args):
        if confirm("Pictures that already cast this variant keep their copy.", title="Delete %s from your wardrobe?" % self.item.get("name"),
                   buttons=[("Keep", False), ("Delete", True)], role="app-dialog"):
            if state.call("wardrobe_delete", self.item["uid"]) is not None:
                self.raise_event("x-close-alert", value="changed")

    @handle("star_button", "click")
    def star_button_click(self, **event_args):
        from ..NewProduction import NewProduction
        self.raise_event("x-close-alert", value=None)
        pid = alert(NewProduction(star=self.item.get("id")), buttons=[], role="app-dialog", large=True)
        if pid:
            router.go("edit", pid)

    @handle("close_button", "click")
    def close_button_click(self, **event_args):
        self.raise_event("x-close-alert", value=None)
