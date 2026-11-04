from anvil import *

from ._anvil_designer import CastCardTemplate
from ... import router


class CastCard(CastCardTemplate):
    """A character tile. item = a VT.CAST entry, or a wardrobe variant {uid, name, def, custom: True}.
    Click: x-open on the RepeatingPanel (the casting page opens the character sheet); mini tiles go to #casting."""

    def __init__(self, **properties):
        super().__init__(**properties)
        it = self.item
        self.portrait.char = it.get("def") or it.get("id") or "max"
        self.portrait.emo = it.get("emo") or "happy"
        self.card.classes["mini"] = bool(it.get("mini"))
        self.card.classes["picked"] = bool(it.get("picked"))

    def card_click(self, event):
        if self.item.get("mini"):
            router.go("casting")
        else:
            self.parent.raise_event("x-open", item=self.item)
