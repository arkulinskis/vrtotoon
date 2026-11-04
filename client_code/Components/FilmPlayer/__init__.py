from anvil import *
import anvil.js

from ._anvil_designer import FilmPlayerTemplate
from ... import vt


class FilmPlayer(FilmPlayerTemplate):
    """A production playing in 3D. Builds its VT.Stage when shown and lets go of it (and its WebGL context) when hidden."""

    def __init__(self, **properties):
        self._production, self._mode, self._autoplay, self._muted, self._controls, self._subs = None, "film", False, False, True, True
        self._stage, self._ctl, self._ready = None, None, False
        super().__init__(**properties)
        self._ready = True

    def _mount(self):
        if not self._ready or not self._production or self._stage is not None:
            return
        p = self._production
        doc = vt.doc(p.get("data"))
        takes = vt.takes(p.get("takes") or [])
        opts = {"mode": self._mode, "doc": doc, "takes": takes, "autoplay": self._autoplay, "loop": self._mode == "hero",
                "muted": self._muted, "subs": self._subs and self._mode != "hero", "interactive": False,
                "titles": False if self._mode == "hero" else None, "shift": 0.2 if self._mode == "hero" else 0,
                "onEnd": anvil.js.report_exceptions(lambda *a: self.raise_event("ended"))}
        self._stage = anvil.js.new(vt.VT.Stage, self.dom_nodes["mount"], opts)
        if self._controls and self._mode != "hero":
            self._ctl = vt.VT.controls(self._stage, self.dom_nodes["mount"], {"unmuteOnPlay": True})

    def _unmount(self):
        if self._ctl is not None:
            self._ctl.destroy()
            self._ctl = None
        if self._stage is not None:
            self._stage.destroy()
            self._stage = None

    @property
    def stage(self):
        """The JS stage (for exports and snapshots), or None before it is shown."""
        return self._stage

    def play(self):
        if self._stage is not None:
            self._stage.play()

    def pause(self):
        if self._stage is not None:
            self._stage.pause()

    def set_muted(self, muted):
        self._muted = bool(muted)
        if self._ctl is not None:
            self._ctl.setMuted(self._muted)
        elif self._stage is not None:
            self._stage.muted = self._muted

    @handle("", "show")
    def form_show(self, **event_args):
        self._mount()

    @handle("", "hide")
    def form_hide(self, **event_args):
        self._unmount()

    @property
    def production(self):
        return self._production

    @production.setter
    def production(self, value):
        self._production = value
        self._unmount()
        if self.parent is not None:
            self._mount()

    @property
    def mode(self):
        return self._mode

    @mode.setter
    def mode(self, value):
        self._mode = value or "film"

    @property
    def autoplay(self):
        return self._autoplay

    @autoplay.setter
    def autoplay(self, value):
        self._autoplay = bool(value)

    @property
    def muted(self):
        return self._muted

    @muted.setter
    def muted(self, value):
        self._muted = bool(value)

    @property
    def controls(self):
        return self._controls

    @controls.setter
    def controls(self, value):
        self._controls = bool(value)

    @property
    def subs(self):
        return self._subs

    @subs.setter
    def subs(self, value):
        self._subs = bool(value)
