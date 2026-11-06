from anvil import *

from ._anvil_designer import ProductionCardTemplate
from ... import router, state, vt


class ProductionCard(ProductionCardTemplate):
    """A picture as a one-sheet poster (the saved frame, or the cast). item = Productions.card(). For premieres
    (item['premiere']) the poster opens the screening room; for your own pictures it opens the editor."""

    def __init__(self, **properties):
        super().__init__(**properties)
        it = self.item
        premiere = bool(it.get("premiere"))
        edit_href = router.href("edit", it["id"])
        watch_href = router.href("screen", it["share_key"]) if it.get("share_key") else ""
        state.set_attr(self.poster_link, "href", watch_href if premiere and watch_href else edit_href)
        if it.get("poster"):
            state.set_attr(self.poster_img, "src", it["poster"])
            self.poster_cast.visible = False
        else:
            self.poster_img.visible = False
            custom = it.get("custom") or {}
            cast = [c for c in (it.get("cast") or []) if c][:3] or ["max"]
            for slot, ref in zip([self.p1, self.p2, self.p3], cast + [None, None]):
                slot.visible = ref is not None
                if ref is not None:
                    slot.char = custom.get(ref) or ref
                    slot.emo = ["happy", "smug", "laugh"][[self.p1, self.p2, self.p3].index(slot)]
        self.card.classes["grade-" + (it.get("grade") or "technicolor")] = True
        sets = {s["id"]: s["name"] for s in vt.set_list()}
        if premiere:
            self.meta.text = "%s · by %s · %s" % (sets.get(it.get("set"), "Stage 7"), it.get("owner") or "", state.plural(it.get("views") or 0, "view"))
        else:
            self.meta.text = "%s · %s · %s · %s" % (sets.get(it.get("set"), "Stage 7"), state.plural(it.get("lines") or 0, "line"),
                                                         state.plural(it.get("takes") or 0, "take"), state.ago(it.get("updated")))
        canvas = vt.aspect(it.get("aspect") or "16:9")
        if canvas["id"] != "16:9":
            self.meta.text += " · " + canvas["label"]
        self.badge.visible = bool(it.get("shared") or it.get("demo"))
        self.badge.text = "Featured" if it.get("featured") and premiere else "Premiered" if it.get("shared") else "Demo"
        state.set_attr(self.open_link, "href", edit_href)
        state.set_attr(self.perform_link, "href", router.href("stage", it["id"]))
        state.set_attr(self.watch_link, "href", watch_href or edit_href)
        self.watch_link.visible = bool(watch_href)
        self.perform_link.visible = bool(it.get("mine"))
        self.delete_button.visible = bool(it.get("mine")) and not premiere
        if premiere:
            self.open_link.text = "Studio"
            self.open_link.role = ["btn", "btn-sm", "ic-clapper"]
            self.watch_link.role = ["btn", "btn-sm", "btn-primary", "ic-play"]

    @handle("delete_button", "click")
    def delete_button_click(self, **event_args):
        if confirm("The picture and all its takes are deleted. This can't be undone.", title="Delete “%s”?" % self.item["title"],
                   buttons=[("Keep it", False), ("Delete", True)], role="app-dialog"):
            if state.call("production_delete", self.item["id"]) is not None:
                self.parent.raise_event("x-deleted")
