import anvil.js
import anvil.server
from anvil import *

from ._anvil_designer import VoiceBoothTemplate
from ... import vt


class VoiceBooth(VoiceBoothTemplate):
    """Record one line with the computer's microphone (no headset): the voice moves the mouth, the body acts by itself.
    beat = a row from VT.ed.beats. Closes with {pass (JS), take (saved dict)} or None."""

    def __init__(self, pid=None, beat=None, **properties):
        super().__init__(**properties)
        self.pid, self.beat = pid, beat or {}
        self.who_label.text = "%s%s" % (self.beat.get("name") or "", ("  (" + self.beat["emo"] + ")") if self.beat.get("emo") else "")
        self.line_label.text = self.beat.get("text") or "(no words yet: write the line in the script first)"
        self.rec = vt.VT.ed.recorder()
        self.recording = False
        self.p = None
        self.light.visible = False

    @handle("rec_button", "click")
    def rec_button_click(self, **event_args):
        if not self.recording:
            ok = self.rec.start()
            if not ok:
                self.message.text, self.message.visible = "The microphone didn't start: %s. Allow it in the browser's address bar." % (self.rec.error or "no permission"), True
                return
            self.recording = True
            self.light.visible = True
            self.rec_button.text = "Stop"
            self.rec_button.role = ["btn", "btn-danger", "btn-solid", "btn-lg", "ic-rec"]
            self.keep_button.enabled = False
            self.status_label.text = "Recording... say the line, then press Stop."
            return
        self.recording = False
        self.light.visible = False
        self.rec_button.text = "Record again"
        self.rec_button.role = ["btn", "btn-lg", "ic-mic"]
        self.p = self.rec.stop(self.beat["id"], self.beat["who"])
        self.file_button.text = "Use an audio file instead"
        if self.p is None:
            return
        if not self.p.heard:
            self.status_label.text = "That was very quiet. Listen back, or record again a little closer to the microphone."
        else:
            self.status_label.text = "Got it: %.1f seconds. Listen back, then print it." % self.p.len
        self.play_button.visible = True
        self.keep_button.enabled = True

    @handle("file_button", "click")
    def file_button_click(self, **event_args):
        if self.recording:
            return
        self.message.visible = False
        self.file_button.enabled = self.rec_button.enabled = False
        self.status_label.text = "Pick an audio file..."
        try:
            p = self.rec.pickFile(self.dom_nodes["file_input"], self.beat["id"], self.beat["who"])
        finally:
            self.file_button.enabled = self.rec_button.enabled = True
        if p is None:
            err = self.rec.error
            if err:
                self.message.text, self.message.visible = err, True
            self.status_label.text = "Press Record, say the line, press Stop. Or use an audio file."
            return
        self.p = p
        if not p.heard:
            self.status_label.text = "That file is very quiet: listen back before you print it."
        else:
            self.status_label.text = "Got it: %.1f seconds from the file (silence trimmed). Listen back, then print it." % p.len
        self.rec_button.text = "Record instead"
        self.play_button.visible = True
        self.keep_button.enabled = True

    @handle("play_button", "click")
    def play_button_click(self, **event_args):
        self.rec.play()

    @handle("keep_button", "click")
    def keep_button_click(self, **event_args):
        if self.p is None:
            return
        self.keep_button.enabled = False
        audio = anvil.js.to_media(self.p.audio)
        try:
            r = anvil.server.call("take_save", self.pid, vt.rows("[" + vt.VT.ed.passMeta(self.p) + "]")[0], vt.VT.ed.passMotion(self.p), audio)
        finally:
            self.keep_button.enabled = True
        if not r.get("ok"):
            self.message.text, self.message.visible = r.get("error") or "That didn't save.", True
            return
        self.raise_event("x-close-alert", value={"pass": self.p, "take": r["take"]})

    @handle("cancel_button", "click")
    def cancel_button_click(self, **event_args):
        self.rec.cancel()
        self.raise_event("x-close-alert", value=None)
