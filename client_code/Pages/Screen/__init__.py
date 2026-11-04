import anvil.server
from anvil import *
from anvil.js import window

from ._anvil_designer import ScreenTemplate
from ... import router, state, vt


class Screen(ScreenTemplate):
    """#screen/<share key>: the screening room. The film plays live in 3D with its full sound mix and subtitles."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.key = args[0] if args else ""
        self.p = {}
        self.info.visible = False
        if not self.key:
            self.missing_label.text = "No film was named in the link."
            return
        r = anvil.server.call("screen_get", self.key)
        self.info.visible = bool(r.get("ok"))
        self.missing.visible = not r.get("ok")
        if not r.get("ok"):
            self.missing_label.text = r.get("error") or ""
            return
        p = self.p = r["production"]
        self.player.production = p
        self.title_label.text = p["title"]
        window.document.title = p["title"] + " · VRtoToon"
        self.logline.text = p.get("logline") or ""
        self.logline.visible = bool(p.get("logline"))
        self.credits.text = "A VRtoToon picture by %s · %s" % (p.get("owner") or "a maker", state.plural(p.get("views") or 0, "view"))
        custom = p.get("custom") or {}
        cat = {c["id"]: c for c in vt.cast_catalog()}
        cast = []
        for ref in p.get("cast") or []:
            if ref in custom:
                cast.append({"id": ref, "name": custom[ref].get("name") or "", "def": vt.make_def(custom[ref].get("base") or "max", custom[ref]), "mini": True})
            elif ref in cat:
                cast.append(dict(cat[ref], mini=True))
        self.cast_panel.items = cast
        self.make_link.visible = not state.me()
        self.remix_button.visible = True

    def leave(self):
        self.player.pause()

    @handle("copy_button", "click")
    def copy_button_click(self, **event_args):
        url = window.location.href.split("#")[0] + router.href("screen", self.key)
        vt.VT.ed.copy(url)
        state.toast("Link copied: " + url, "ok")

    @handle("remix_button", "click")
    def remix_button_click(self, **event_args):
        router.go("edit", self.p["id"])

    @handle("report_link", "click")
    def report_link_click(self, **event_args):
        t = TextBox(placeholder="What's wrong with it?")
        if alert(t, title="Report this film", buttons=[("Cancel", False), ("Send report", True)], role="app-dialog"):
            anvil.server.call("screen_report", self.key, t.text or "")
            state.toast("Thanks. An admin will take a look.", "ok")
