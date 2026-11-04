import anvil.js
import anvil.server
from anvil import *

from ._anvil_designer import LiveMonitorTemplate
from ... import state, vt

STATUS = {"calling": "Ringing the headset...", "connecting": "Connecting...", "live": "Live from the headset",
          "ended": "The live view stopped", "failed": "Couldn't reach the headset", "idle": "Headset view"}


class LiveMonitor(LiveMonitorTemplate):
    """The director's live window on the editor: the paired headset's picture (the performer's eyes or the film camera)
    and its microphone, straight from the headset over WebRTC (vt-live.js). The server only carries the offer and the
    answer (stage_rtc_offer / stage_rtc_answer); the headset picks the offer up in its stage_poll."""

    def __init__(self, **properties):
        self.viewer = vt.NULL
        self.pid = ""
        self.rid = ""
        self.waited = 0.0
        self.muted = True
        self.big = False
        super().__init__(**properties)
        self.visible = False

    # ---------------------------------------------------------------- ringing the headset
    def start(self, pid):
        self.pid = pid
        self.visible = True
        self.waited = 0.0
        self.rid = ""
        self._wait("Ringing the headset...", False)
        if self.viewer is None:
            self.viewer = anvil.js.new(vt.VT.LiveViewer, self.dom_nodes["video"],
                                       {"onState": anvil.js.report_exceptions(self._state), "onInfo": anvil.js.report_exceptions(self._info)})
            anvil.js.window.VT_LIVE = self.viewer  # for the UI tests
        try:
            sdp = self.viewer.offer()  # a JS promise: Anvil waits for it (ICE candidates gathered)
        except Exception as e:
            self._wait("This browser can't show the live view (%s)." % e, True)
            return
        r = state.call("stage_rtc_offer", pid, sdp)
        if r is None:
            self._wait("Couldn't ring the headset. Open the headset link first.", True)
            return
        self.rid = r["id"]
        if not r.get("online"):
            self._wait("Ringing... open this picture's stage on the headset: it answers within a few seconds.", False)
        self.poll_timer.interval = 1

    def stop(self):
        self.poll_timer.interval = 0
        if self.viewer is not None:
            self.viewer.close()
        if self.pid and self.rid:
            anvil.server.call_s("stage_rtc_offer", self.pid, None)
        self.rid = ""
        self.visible = False

    @handle("poll_timer", "tick")
    def poll_timer_tick(self, **event_args):
        if not self.rid:
            self.poll_timer.interval = 0
            return
        self.waited += 1
        r = anvil.server.call_s("stage_rtc_answer", self.pid, self.rid)
        if not r.get("ok"):
            self.poll_timer.interval = 0
            self._wait(r.get("error") or "The live view stopped.", True)
            return
        if r.get("answer"):
            self.poll_timer.interval = 0
            self.viewer.accept(r["answer"])
            return
        if not r.get("waiting") or self.waited > 50:
            self.poll_timer.interval = 0
            self._wait("The headset didn't answer. Open this picture's stage on the headset (stage door code), then try again.", True)

    # ---------------------------------------------------------------- what the call reports
    def _wait(self, text, retry):
        self.wait_box.visible = True
        self.wait_label.text = text
        self.retry_button.visible = retry
        self.caption_label.visible = False
        self.dot.classes["on"] = False
        self.status_label.text = "Headset view"

    def _state(self, s=None, *args):
        if s is None:
            return
        self.status_label.text = STATUS.get(s, s)
        self.dot.classes["on"] = s == "live"
        if s == "live":
            self.wait_box.visible = False
        elif s in ("ended", "failed"):
            self._wait(STATUS[s] + ". The headset may have left the stage.", True)
            self.status_label.text = STATUS[s]
        elif s == "connecting":
            self.wait_label.text = "Connecting to the headset..."

    def _info(self, info=None, *args):
        if info is None:
            return
        d = vt.py(info) or {}
        head = d.get("head") or ""
        line = d.get("line") or ""
        if len(line) > 80:
            line = line[:79] + "…"
        self.caption_label.text = (head + (": " + line if line else "")) if head else line
        self.caption_label.visible = bool(head or line) and not self.wait_box.visible

    # ---------------------------------------------------------------- buttons
    def _view(self, which):
        if self.viewer is not None:
            self.viewer.view(which)
        self.eyes_button.role = ["tab", "on"] if which == "eyes" else ["tab"]
        self.film_button.role = ["tab", "on"] if which == "film" else ["tab"]

    @handle("eyes_button", "click")
    def eyes_button_click(self, **event_args):
        self._view("eyes")

    @handle("film_button", "click")
    def film_button_click(self, **event_args):
        self._view("film")

    @handle("sound_button", "click")
    def sound_button_click(self, **event_args):
        self.muted = not self.muted
        if self.viewer is not None:
            self.viewer.mute(self.muted)
        self.sound_button.role = ["btn", "btn-sm", "btn-ghost", "ic-volume", "lv-icon"] + ([] if self.muted else ["live"])
        state.toast("Sound off." if self.muted else "You hear the headset's microphone (once the performer presses Action).", "ok")

    @handle("big_button", "click")
    def big_button_click(self, **event_args):
        self.big = not self.big
        self.box.classes["big"] = self.big

    @handle("retry_button", "click")
    def retry_button_click(self, **event_args):
        self.start(self.pid)

    @handle("close_button", "click")
    def close_button_click(self, **event_args):
        self.stop()
        self.raise_event("closed")

    @handle("", "hide")
    def form_hide(self, **event_args):
        if self.rid or self.visible:
            self.stop()
