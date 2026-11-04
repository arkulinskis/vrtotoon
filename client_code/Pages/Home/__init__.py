from anvil import *

from ._anvil_designer import HomeTemplate
from ... import router, state


class Home(HomeTemplate):
    """#home, the Lot: your pictures as posters, the headset how-to, casting, demos to take apart and what's playing."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.prod_panel.add_event_handler("x-deleted", self._load)
        me = state.me() or {}
        self.hello.text = "Welcome back, %s" % ((me.get("name") or "director").split(" ")[0])
        self._load()

    def _load(self, **event_args):
        d = state.call("lot_home")
        if d is None:
            return
        self.prod_panel.items = d["productions"]
        self.empty.visible = not d["productions"]
        self.count.text = "%s on the lot." % state.plural(d["total"], "picture") if d["total"] else "Nothing in production yet."
        self.wardrobe_line.text = ("%s in your wardrobe. 25 actors on call." % state.plural(d["wardrobe"], "variant")) if d["wardrobe"] else "25 actors on call. Dress your own variants in the wardrobe."
        self.demo_panel.items = [dict(p, premiere=False, mine=False) for p in d["demos"]]
        self.demo_box.visible = bool(d["demos"]) and len(d["productions"]) < 3
        self.prem_panel.items = [dict(p, premiere=True) for p in d["premieres"]]
        self.prem_box.visible = bool(d["premieres"])

    def _new(self):
        from ...Dialogs.NewProduction import NewProduction
        pid = alert(NewProduction(), buttons=[], role="app-dialog", large=True)
        if pid:
            router.go("edit", pid)

    @handle("new_button", "click")
    def new_button_click(self, **event_args):
        self._new()

    @handle("empty_button", "click")
    def empty_button_click(self, **event_args):
        self._new()
