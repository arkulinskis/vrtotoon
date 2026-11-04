import anvil.js
from anvil import *
from anvil.js import window

from ._anvil_designer import ExportTemplate
from ... import vt

SIZES = [("720p widescreen (1280 x 720)", "1280x720"), ("1080p widescreen (1920 x 1080)", "1920x1080"),
         ("Vertical for Reels and Shorts (1080 x 1920)", "1080x1920"), ("Square (1080 x 1080)", "1080x1080")]


class Export(ExportTemplate):
    """Exports of the picture on `stage` (the editor's JS stage): video, Blender kit, .glb, subtitles, sound, script."""

    def __init__(self, stage, title="film", **properties):
        super().__init__(**properties)
        self.stage = stage
        self.name = vt.slug(title)
        self.size_dd.items = SIZES
        aspect = vt.py(stage.doc.d.look.aspect)
        self.size_dd.selected_value = "1080x1920" if aspect == "9:16" else "1080x1080" if aspect == "1:1" else "1280x720"
        self.subs_check.checked = bool(vt.py(stage.doc.d.look.subs))
        self.progress.visible = False
        if not vt.VT.videoMime():
            self.video_button.enabled = False
            self.video_button.text = "This browser can't record video"

    def _say(self, text):
        self.message.text, self.message.visible = text, bool(text)

    def _busy(self, on):
        for b in (self.video_button, self.blender_button, self.glb_button, self.srt_button, self.wav_button, self.txt_button, self.close_button):
            b.enabled = not on

    @handle("video_button", "click")
    def video_button_click(self, **event_args):
        w, h = [int(x) for x in self.size_dd.selected_value.split("x")]
        self._busy(True)
        self.progress.visible = True
        self.cancel_video_button.visible = True
        self._say("Rolling... the film plays through once while it records (%s)." % vt.fmt(self.stage.total))
        try:
            r = vt.VT.ed.exportVideo(self.stage, {"w": w, "h": h, "subs": bool(self.subs_check.checked), "fps": 30}, self.dom_nodes["bar"])
            vt.download(r.blob, "%s.%s" % (self.name, r.ext))
            self._say("Done: %s.%s (%.1f MB) is in your downloads." % (self.name, r.ext, r.blob.size / 1e6))
        except Exception as e:
            self._say("The recording stopped: %s" % (str(e) if "cancel" not in str(e) else "cancelled."))
        finally:
            self._busy(False)
            self.cancel_video_button.visible = False

    @handle("cancel_video_button", "click")
    def cancel_video_button_click(self, **event_args):
        vt.VT.ed.cancelExport()

    @handle("blender_button", "click")
    def blender_button_click(self, **event_args):
        self._busy(True)
        self._say("Baking every frame for Blender...")
        try:
            z = vt.VT.blenderKit(self.stage, {"fps": 24})
            vt.download(z, self.name + "-blender.zip")
            self._say("Done: %s-blender.zip. Unzip it, open import_vrtotoon.py in Blender's Scripting tab and press Run Script." % self.name)
        finally:
            self._busy(False)

    @handle("glb_button", "click")
    def glb_button_click(self, **event_args):
        self._busy(True)
        try:
            g = vt.VT.exportGLB(self.stage, {"fps": 24})
            vt.download(g.blob, self.name + ".glb")
            self._say("Done: %s.glb (%d frames, %d animated channels)." % (self.name, g.info.frames, g.info.channels))
        finally:
            self._busy(False)

    @handle("srt_button", "click")
    def srt_button_click(self, **event_args):
        blob = anvil.js.new(window.Blob, [vt.VT.srt(self.stage)], {"type": "text/plain"})
        vt.download(blob, self.name + ".srt")

    @handle("wav_button", "click")
    def wav_button_click(self, **event_args):
        self._busy(True)
        try:
            buf = vt.VT.mixdown(self.stage)
            vt.download(vt.VT.wav(buf), self.name + ".wav")
        finally:
            self._busy(False)

    @handle("txt_button", "click")
    def txt_button_click(self, **event_args):
        text = vt.py(self.stage.doc.d.title) + "\n\n" + vt.script_text(self.stage.doc) + "\n"
        vt.download(anvil.js.new(window.Blob, [text], {"type": "text/plain"}), self.name + "-script.txt")

    @handle("close_button", "click")
    def close_button_click(self, **event_args):
        self.raise_event("x-close-alert", value=None)
