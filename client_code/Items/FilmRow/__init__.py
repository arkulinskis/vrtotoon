from anvil import *

from ._anvil_designer import FilmRowTemplate
from ... import router, state


class FilmRow(FilmRowTemplate):
    """A picture in Admin -> Films: who made it, shared / featured / reported, and the moderation buttons."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self._draw()

    def _draw(self):
        it = self.item
        state.set_attr(self.title_link, "href", router.href("screen", it["key"]) if it["shared"] and it["key"] else router.href("edit", it["id"]))
        self.reports_badge.visible = it["reports"] > 0
        self.reports_badge.text = state.plural(it["reports"], "report")
        self.meta.text = "by %s · %s · %s · %s · updated %s" % (it["owner"], state.plural(it["lines"], "beat"), state.plural(it["takes"], "take"),
                                                                  state.plural(it["views"], "view"), state.ago(it["updated"]))
        self.feature_button.text = "Unfeature" if it["featured"] else "Feature"
        self.feature_button.visible = it["shared"]
        self.unshare_button.visible = it["shared"]
        self.clear_button.visible = it["reports"] > 0

    def _apply(self, r):
        if r is not None:
            self.item = r["film"]
            self._draw()

    @handle("feature_button", "click")
    def feature_button_click(self, **event_args):
        self._apply(state.call("admin_feature", self.item["id"], not self.item["featured"]))

    @handle("unshare_button", "click")
    def unshare_button_click(self, **event_args):
        if confirm("It leaves Premieres and its link stops working. The maker can share it again.", title="Unshare this film?",
                   buttons=[("Cancel", False), ("Unshare", True)], role="app-dialog"):
            self._apply(state.call("admin_unshare", self.item["id"]))

    @handle("clear_button", "click")
    def clear_button_click(self, **event_args):
        self._apply(state.call("admin_clear_reports", self.item["id"]))
