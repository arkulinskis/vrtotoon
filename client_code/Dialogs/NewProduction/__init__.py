import anvil.server
from anvil import *

from ._anvil_designer import NewProductionTemplate
from ... import vt

TEMPLATE_CAST = {"blank": ["max", "rosie"], "meet": ["max", "rosie"], "showdown": ["duke", "baron"], "mystery": ["vera", "lou"],
                 "space": ["nova", "bolt"], "spooky": ["boo", "pip"]}


class NewProduction(NewProductionTemplate):
    """Title + a template (a short script, a set, a look and music) + the set. star = a premade id to cast first.
    Closes with the new production's id, or None."""

    def __init__(self, star=None, **properties):
        super().__init__(**properties)
        self._star = star
        self._templates = vt.templates()
        self._sets = vt.set_list()
        self.template_dd.items = [(t["label"], t["id"]) for t in self._templates]
        self.template_dd.selected_value = "meet" if not star else "blank"
        self.set_dd.items = [(s["name"], s["id"]) for s in self._sets]
        self._sync()

    def _cast(self):
        cast = list(TEMPLATE_CAST.get(self.template_dd.selected_value, ["max", "rosie"]))
        if self._star:
            cast = [self._star] + [c for c in cast if c != self._star][:1]
        return cast

    def _sync(self):
        t = [x for x in self._templates if x["id"] == self.template_dd.selected_value]
        if t:
            self.set_dd.selected_value = t[0]["set"]
        self._blurb()
        cat = {c["id"]: c for c in vt.cast_catalog()}
        self.cast_panel.items = [dict(cat[c], mini=False, picked=True) for c in self._cast() if c in cat]

    def _blurb(self):
        s = [x for x in self._sets if x["id"] == self.set_dd.selected_value]
        self.set_blurb.text = s[0]["blurb"] if s else ""

    @handle("template_dd", "change")
    def template_dd_change(self, **event_args):
        self._sync()

    @handle("set_dd", "change")
    def set_dd_change(self, **event_args):
        self._blurb()

    @handle("", "show")
    def form_show(self, **event_args):
        self.title_box.focus()

    @handle("title_box", "pressed_enter")
    def title_box_pressed_enter(self, **event_args):
        self.create_button_click()

    @handle("cancel_button", "click")
    def cancel_button_click(self, **event_args):
        self.raise_event("x-close-alert", value=None)

    @handle("create_button", "click")
    def create_button_click(self, **event_args):
        title = (self.title_box.text or "").strip()
        if not title:
            self.message.text, self.message.visible = "Every picture needs a title (you can change it later).", True
            return
        data = vt.new_doc_json(title, self.template_dd.selected_value, self.set_dd.selected_value, self._cast())
        self.create_button.enabled = False
        try:
            r = anvil.server.call("production_new", title, data)
        finally:
            self.create_button.enabled = True
        if not r.get("ok"):
            self.message.text, self.message.visible = r.get("error") or "That didn't work.", True
            return
        self.raise_event("x-close-alert", value=r["id"])
