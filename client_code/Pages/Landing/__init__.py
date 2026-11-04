import anvil.server
from anvil import *
from anvil.js import window

from ._anvil_designer import LandingTemplate
from ... import state, vt

# The app's video on the Addanapp YouTube channel (APP_MAKER/youtube/manifest.json), shown in the Watch section.
YT_VIDEO = "wXfPmsZW_tA"

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
        self.dom_nodes["yt_cover"].addEventListener("click", self._play)
        cat = {c["id"]: c for c in vt.cast_catalog()}
        self.cast_panel.items = [dict(cat[k], mini=True) for k in WALL if k in cat]
        r = anvil.server.call("screen_get", "demo-bigbreak")
        if r.get("ok"):
            self.hero_player.production = r["production"]

    def _play(self, event):
        """Swap the video's cover for YouTube's player (privacy-enhanced); nothing loads from YouTube before this click."""
        self.dom_nodes["yt_frame"].innerHTML = (
            '<iframe src="https://www.youtube-nocookie.com/embed/' + YT_VIDEO + '?autoplay=1&rel=0&playsinline=1" '
            'title="VRtoToon video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen '
            'referrerpolicy="strict-origin-when-cross-origin"></iframe>')
