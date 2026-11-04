from anvil import *

from ._anvil_designer import CastingTemplate
from ... import router, state, vt


class Casting(CastingTemplate):
    """#casting[/<role>]: every premade character by role (leads, sidekicks, villains, character actors, creatures) and
    your wardrobe (#casting/wardrobe). A tile opens the character sheet."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.role = args[0] if args else "all"
        self.filter_panel.add_event_handler("x-chip", self._filter)
        self.cast_panel.add_event_handler("x-open", self._open)
        self._wardrobe = None
        self._draw()

    def _draw(self):
        roles = vt.roles()
        chips = [{"id": "all", "label": "Everyone"}] + [{"id": r["id"], "label": r["label"]} for r in roles]
        if state.me():
            chips.append({"id": "wardrobe", "label": "My wardrobe", "emoji": "\U0001F45A"})
        for c in chips:
            c["on"] = c["id"] == self.role
        self.filter_panel.items = chips
        self.empty.visible = False
        if self.role == "wardrobe":
            if self._wardrobe is None:
                r = state.call("wardrobe_list")
                self._wardrobe = r["items"] if r else []
            self.section_title.text = "My wardrobe"
            self.cast_panel.items = [{"uid": w["uid"], "name": w["name"], "tag": "Based on " + (vt.char_def(w["def"].get("base") or "max")["name"]),
                                      "def": vt.make_def(w["def"].get("base") or "max", w["def"]), "raw": w["def"], "custom": True} for w in self._wardrobe]
            self.empty.visible = not self._wardrobe
            return
        cast = vt.cast_catalog()
        if self.role != "all":
            cast = [c for c in cast if c.get("role") == self.role]
        labels = {r["id"]: r["label"] for r in vt.roles()}
        self.section_title.text = labels.get(self.role, "Everyone on call") if self.role != "all" else "Everyone on call"
        self.cast_panel.items = cast

    def _filter(self, chip_id=None, **event_args):
        self.role = chip_id or "all"
        router.replace("casting", self.role) if self.role != "all" else router.replace("casting")
        self._draw()

    def _open(self, item=None, **event_args):
        from ...Dialogs.CharacterSheet import CharacterSheet
        r = alert(CharacterSheet(item=item), buttons=[], role="app-dialog", large=True)
        if r == "changed":
            self._wardrobe = None
            self.role = "wardrobe"
            router.replace("casting", "wardrobe")
            self._draw()
