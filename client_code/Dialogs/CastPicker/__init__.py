from anvil import *

from ._anvil_designer import CastPickerTemplate
from ... import state, vt


class CastPicker(CastPickerTemplate):
    """Pick a character: a premade one or a wardrobe variant. Closes with {ref, def} (def only for variants), or None."""

    def __init__(self, title="Pick a character", **properties):
        super().__init__(**properties)
        self.title_label.text = title
        self.role = "all"
        self._wardrobe = None
        self.filter_panel.add_event_handler("x-chip", self._filter)
        self.cast_panel.add_event_handler("x-open", self._pick)
        self._draw()

    def _draw(self):
        chips = [{"id": "all", "label": "Everyone"}] + [{"id": r["id"], "label": r["label"]} for r in vt.roles()]
        if state.me():
            chips.append({"id": "wardrobe", "label": "My wardrobe", "emoji": "\U0001F45A"})
        self.filter_panel.items = [dict(c, on=c["id"] == self.role) for c in chips]
        if self.role == "wardrobe":
            if self._wardrobe is None:
                r = state.call("wardrobe_list")
                self._wardrobe = r["items"] if r else []
            self.cast_panel.items = [{"uid": w["uid"], "name": w["name"], "tag": "From your wardrobe", "custom": True,
                                      "def": vt.make_def(w["def"].get("base") or "max", w["def"]), "raw": w["def"]} for w in self._wardrobe]
            return
        cast = vt.cast_catalog()
        self.cast_panel.items = [c for c in cast if self.role == "all" or c.get("role") == self.role]

    def _filter(self, chip_id=None, **event_args):
        self.role = chip_id or "all"
        self._draw()

    def _pick(self, item=None, **event_args):
        if not item:
            return
        if item.get("custom"):
            self.raise_event("x-close-alert", value={"ref": item["uid"], "def": dict(item["raw"], base=item["raw"].get("base") or "max")})
        else:
            self.raise_event("x-close-alert", value={"ref": item["id"], "def": None})

    @handle("cancel_button", "click")
    def cancel_button_click(self, **event_args):
        self.raise_event("x-close-alert", value=None)
