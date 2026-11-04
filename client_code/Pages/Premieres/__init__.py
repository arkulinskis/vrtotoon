import anvil.server
from anvil import *

from ._anvil_designer import PremieresTemplate
from ... import state


class Premieres(PremieresTemplate):
    """#premieres: every shared picture (featured first), each opening the screening room."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        d = anvil.server.call("premieres_list")
        self.film_panel.items = [dict(f, premiere=True) for f in d["films"]]
        self.empty.visible = not d["films"]
        if not state.me():
            state.set_attr(self.cta_link, "href", "#auth/signup")
