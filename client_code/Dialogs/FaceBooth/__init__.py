import json

import anvil.js
import anvil.server
from anvil import *
from anvil.js import window

from ._anvil_designer import FaceBoothTemplate
from ... import state, vt

STATES = {
    "loading": "Starting the camera and the face tracker...",
    "live": "The character copies your face. Press Record when you're ready: the take plays and you act along.",
    "count": "Get ready...",
    "rec": "Recording your face. Act along with the take (the line you're on is under the character).",
    "saving": "Finishing...",
    "play": "Watching it back.",
}


class FaceBooth(FaceBoothTemplate):
    """The face booth: replay a recorded take in front of the computer's camera and act its FACE (eyelids, brows,
    smile, jaw, mouth, smirk, eye direction). VT.FaceBooth (vt-face.js) does the camera, the 25 key points and the
    recording; this form is the buttons and the save.

    take = a row from VT.ed.takes (+ can_edit); doc / takes = the editor's engine objects (the take plays from them and
    gets the face at once). can_save False = a sandbox picture: the face stays in this browser.
    Closes with {"saved": True, "voice": bool} or None."""

    def __init__(self, pid, take, doc, takes, can_save, **properties):
        super().__init__(**properties)
        self.pid, self.take, self.doc, self.takes, self.can_save = pid, take, doc, takes, can_save
        self.booth = vt.NULL
        self.st = {}
        self.has_face = False
        self._first = True
        src = {"vr": "VR take", "ar": "Passthrough take", "desk": "Desk-puppet take", "voice": "Voice take"}.get(take.get("source"), "Take")
        self.who_label.text = "%s · %s · %.1f s" % (take.get("name") or "", src, take.get("dur") or 0)
        self.remove_button.visible = bool(take.get("face")) and can_save
        self.gain_slider.add_event_handler("change", self._gain)

    @handle("", "show")
    def form_show(self, **event_args):
        if self.booth is not None:
            return
        self.takes.load(self.take["uid"])  # the take's motion and voice (a promise: waits here)
        n = self.dom_nodes
        opts = {"stageEl": n["toon"], "video": n["video"], "overlay": n["overlay"], "promptEl": n["prompt"], "clockEl": n["clock"],
                "doc": self.doc, "takes": self.takes, "uid": self.take["uid"], "gain": self.gain_slider.value,
                "onState": anvil.js.report_exceptions(self._state)}
        self.booth = anvil.js.new(vt.VT.FaceBooth, opts)
        window.VT_FACE = self.booth  # for the UI tests
        self.booth.begin()

    @handle("", "hide")
    def form_hide(self, **event_args):
        self._close_booth()

    def _close_booth(self):
        if self.booth is not None:
            self.booth.close()
            self.booth = vt.NULL
            window.VT_FACE = None

    # ------------------------------------------------------------------ state from the booth
    def _state(self, s=None, *args):
        if s is None:
            return
        st = self.st = vt.py(s)
        name = st.get("state")
        if self._first and name == "live":
            self._first = False
            if not st.get("hasVoice"):  # a take without a voice: record one with the face
                self.voice_check.checked = True
        found = bool(st.get("found"))
        self.dom_nodes["found"].textContent = ("Face found · 478 points · 25 key points" if found else "No face in view") if name not in ("loading", "nocam") else "Camera"
        self.dom_nodes["dot"].className = "fb-dot" + (" on" if found else "")
        busy = name in ("count", "rec", "saving")
        if name == "review":
            self.has_face = True
        self.rec_button.enabled = name in ("live", "review", "count", "rec", "play")
        if busy:
            self.rec_button.text, self.rec_button.role = "Stop", ["btn", "btn-danger", "btn-solid", "btn-lg", "ic-x"]
        else:
            self.rec_button.text = "Record again" if self.has_face else "Record the face"
            self.rec_button.role = ["btn", "btn-lg", "ic-rec"] if self.has_face else ["btn", "btn-primary", "btn-lg", "ic-rec"]
        self.play_button.visible = self.has_face
        self.play_button.enabled = name in ("review", "play", "live")
        self.play_button.text = "Stop watching" if name == "play" else "Watch it back"
        self.neutral_button.enabled = name in ("live", "review")
        self.keep_button.enabled = self.has_face and not busy
        for c in (self.voice_check, self.mouth_check):
            c.enabled = not busy and name != "play"
        msg = st.get("msg") or ""
        if name == "nocam":
            self.message.text, self.message.visible = msg, True
            self.status_label.text = "No camera, no face pass. You can still set feelings in the Direct tab."
            return
        self.message.visible = False
        if name == "review":
            lost = st.get("lost") or 0
            self.status_label.text = (msg or "Got it.") + (" (Your face was out of view for %.1f s: those moments hold the last look.)" % lost if lost > 0.4 else "")
        else:
            self.status_label.text = msg or STATES.get(name, "")

    # ------------------------------------------------------------------ buttons
    @handle("rec_button", "click")
    def rec_button_click(self, **event_args):
        if self.st.get("state") in ("count", "rec"):
            self.booth.stop()
            return
        if self.st.get("state") == "play":
            self.booth.stop()
        self.booth.record({"voice": bool(self.voice_check.checked), "mouth": bool(self.mouth_check.checked), "gain": self.gain_slider.value})

    @handle("play_button", "click")
    def play_button_click(self, **event_args):
        if self.st.get("state") == "play":
            self.booth.stop()
        else:
            self.booth.play()

    @handle("neutral_button", "click")
    def neutral_button_click(self, **event_args):
        self.booth.neutral()

    @handle("mouth_check", "change")
    def mouth_check_change(self, **event_args):
        self.booth.setMouth(bool(self.mouth_check.checked))

    def _gain(self, value=None, final=False, **event_args):
        if value is not None and self.booth is not None:
            self.booth.setGain(float(value))

    @handle("keep_button", "click")
    def keep_button_click(self, **event_args):
        res = self.booth.result() if self.booth is not None else None
        if res is None:
            return
        if not self.can_save:
            self.booth.applyTo()
            state.toast("The face plays in this sandbox. Make your own copy to keep it.", "ok")
            self._done({"saved": False, "voice": bool(res.voice)})
            return
        audio = anvil.js.to_media(res.audio) if res.audio else None
        self.keep_button.enabled = False
        try:
            r = state.call("take_face", self.pid, self.take["uid"], res.face, audio)
        finally:
            self.keep_button.enabled = True
        if r is None:
            return
        self.booth.applyTo()
        vt.VT.ed.takeSaved(self.takes, json.dumps(r["take"]))
        self._done({"saved": True, "voice": bool(res.voice)})

    @handle("remove_button", "click")
    def remove_button_click(self, **event_args):
        if not confirm("The feelings you set in the Direct tab drive this character's face again in this take.", title="Remove the face pass?",
                       buttons=[("Keep it", False), ("Remove", True)], role="app-dialog"):
            return
        r = state.call("take_face_remove", self.pid, self.take["uid"])
        if r is None:
            return
        vt.VT.ed.takeSaved(self.takes, json.dumps(r["take"]))
        self._done({"saved": True, "voice": False, "removed": True})

    @handle("cancel_button", "click")
    def cancel_button_click(self, **event_args):
        self._done(None)

    def _done(self, value):
        self._close_booth()
        self.raise_event("x-close-alert", value=value)
