import anvil.server
from anvil import *

from ._anvil_designer import LandingTemplate
from ... import state, vt

WALL = ["max", "rosie", "duke", "vera", "biscuit", "mittens", "bolt", "baron", "nightshade", "zorp", "boo", "tux"]


class Landing(LandingTemplate):
    """#landing: the hero is a demo picture playing live in 3D inside a marquee (muted, looping); then the one-actor relay,
    how a picture gets made, the headset + computer co-work, features, a cast wall and the FAQ."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        me = state.me()
        self.guest_cta.visible = not me
        self.member_cta.visible = bool(me)
        if me:
            state.set_attr(self.band_link, "href", "#home")
        cat = {c["id"]: c for c in vt.cast_catalog()}
        self.cast_panel.items = [dict(cat[k], mini=True) for k in WALL if k in cat]
        r = anvil.server.call("screen_get", "demo-bigbreak")
        if r.get("ok"):
            self.hero_player.production = r["production"]
