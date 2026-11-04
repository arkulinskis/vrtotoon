import json

import anvil.js
import anvil.server
from anvil import *

from ._anvil_designer import StageTemplate
from ... import router, state, vt

DESK_HELP = ("Desk puppet: the mouse moves a hand (hold the button for a fist, F to point, keys 1-8 for hand shapes: open, fist, "
             "point, thumbs up, peace, OK, rock on, relaxed; Shift + 1-8 for the other hand), A / D turn your head, W / S nod, "
             "Q / E lean. Space = Action, then next line. Your microphone moves the mouth.")
VR_HELP = ("In the headset: A (or X) = Action and next line, B (or Y) = cut or go again, thumbstick = switch role. Your fingers "
           "follow the controller (trigger = index finger, grip = the others, lift your thumb for thumbs up), or put the "
           "controllers down and use your hands: every finger is recorded, pinch to press menu buttons. Look down for the "
           "teleprompter, right for the director's monitor.")


class Stage(StageTemplate):
    """#stage/<production id>[/<actor id>]: the performance stage (full screen). Records one role at a time: in VR,
    in passthrough, or as a desk puppet. The owner (signed in) or a headset paired at the stage door (#door) may use it.
    Kept passes are uploaded at once (stage_save_pass); every 2 s it asks the server for the director's call and note,
    and for a live-view request from the director's computer (answered with VT.liveAnswer, vt-live.js)."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.pid = args[0] if args else ""
        self.want_actor = args[1] if len(args) > 1 else None
        self.pending = vt.NULL
        self.rtc_id = None
        self.call_id = None
        self.call = {}
        self.loaded = False
        self.mode = "flat"
        self.p = {}
        self.rev = 0
        self.doc = vt.NULL
        self.takes = vt.NULL
        self.pf = vt.NULL
        self.stage_box.visible = False
        if not self.pid:
            self.closed_label.text = "No picture was named in the link."
            return
        r = anvil.server.call("stage_get", self.pid)
        self.stage_box.visible = bool(r.get("ok"))
        self.closed.visible = not r.get("ok")
        if not r.get("ok"):
            self.closed_label.text = r.get("error") or ""
            return
        self.p = r["production"]
        self.rev = int(self.p.get("rev") or 0)
        self.title_label.text = self.p["title"]
        state.set_attr(self.back_link, "href", router.href("edit", self.pid) if state.me() else "#door")
        self.doc = vt.doc(self.p["data"])
        self.takes = vt.takes(self.p["takes"])
        self._pickers()
        self.perform_view.add_event_handler("state", self._state)
        self.perform_view.add_event_handler("kept", self._kept)
        self.help_label.text = DESK_HELP
        self.vr_button.visible = self.ar_button.visible = False
        self.save_again_button.visible = False
        self.call_box.visible = False
        self.count_box.visible = False

    def _pickers(self):
        cast = vt.cast_rows(self.doc)
        self.role_dd.items = [(c["name"] + " · %d/%d lines" % (c["recorded"], c["lines"]), c["id"]) for c in cast]
        ids = [c["id"] for c in cast]
        self.role_dd.selected_value = self.want_actor if self.want_actor in ids else (ids[0] if ids else None)
        beats = vt.beats(self.doc, self.takes)
        items = [("%d. %s" % (b["n"], (b["name"] + ": " + b["text"])[:34]), b["id"]) for b in beats]
        self.from_dd.items = [("The start", "")] + items
        self.to_dd.items = [("The end", "")] + items

    @handle("", "show")
    def form_show(self, **event_args):
        if self.closed.visible or self.loaded:
            return
        self.loaded = True
        self.pf = self.perform_view.load(self.doc, self.takes, self.role_dd.selected_value)
        anvil.js.window.VT_PERFORM = self.pf  # for the UI tests
        self._supports(self.pf.supports())  # Anvil waits for the JS promise
        self.poll_timer.interval = 2
        self.poll_timer_tick()

    def leave(self):
        self.poll_timer.interval = 0
        vt.VT.liveHangUp()
        self.perform_view.unload()

    def _supports(self, s=None, *args):
        if s is None:
            return
        self.vr_button.visible = bool(s.vr)
        self.ar_button.visible = bool(s.ar)
        if s.vr:
            self.help_label.text = VR_HELP + "  No headset on? " + DESK_HELP

    # ---------------------------------------------------------------- the performance reports in
    def _state(self, **event_args):
        info = event_args["info"]
        st = info["state"]
        labels = {"ready": "Ready: %s" % info["roleName"], "countdown": "Quiet on set...", "rec": "Rolling: line %d of %d" % (max(1, info["beat"] + 1), info["beats"]),
                  "review": "Playback: keep it?"}
        self.state_label.text = labels.get(st, st)
        if info.get("micError") and st == "rec":
            self.state_label.text += " (no microphone: %s)" % info["micError"]
        self.count_box.visible = st == "countdown"
        self.count_label.text = str(info.get("count") or "")
        self.action_button.visible = st in ("ready", "rec")
        self.action_button.text = "Action!" if st == "ready" else "Next line"
        self.cut_button.visible = st in ("rec", "countdown")
        for b in (self.keep_button, self.retake_button, self.discard_button):
            b.visible = st == "review"
        for c in (self.role_dd, self.from_dd, self.to_dd, self.others_check):
            c.enabled = st == "ready"
        self.mode = info.get("mode") or "flat"

    def _kept(self, take=None, **event_args):
        self.pending = take
        self._upload()

    def _upload(self):
        p = self.pending
        if p is None:
            return
        self.state_label.text = "Saving the take..."
        audio = anvil.js.to_media(p.audio) if p.audio else None
        meta = json.loads(vt.VT.ed.passMeta(p))
        try:
            r = anvil.server.call("stage_save_pass", self.pid, meta, vt.VT.ed.passMotion(p), audio)
        except anvil.server.AppOfflineError:
            self.save_again_button.visible = True
            state.toast("The connection dropped: the take isn't saved yet. Press “Save the take again”.", "error")
            return
        if not r.get("ok"):
            self.save_again_button.visible = True
            state.toast("The take isn't saved yet: %s Press “Save the take again”." % (r.get("error") or ""), "error")
            return
        self.pending = None
        self.save_again_button.visible = False
        self.rev = r.get("rev") or self.rev
        vt.VT.ed.addPass(self.takes, p, json.dumps(r["take"]))
        lines = len([c for c in r["take"]["clips"] if c["line"]])
        state.toast("Printed! %s and %s in the cut. Act the face later with your webcam: editor, Takes, Face." % (state.plural(lines, "line"), state.plural(len(r["take"]["clips"]) - lines, "reaction")), "ok")
        self.state_label.text = "Saved. Ready for the next take."
        self._pickers()

    @handle("save_again_button", "click")
    def save_again_button_click(self, **event_args):
        self._upload()

    # ---------------------------------------------------------------- controls
    def _range(self):
        if not self.loaded:
            return
        self.pf.setRole(self.role_dd.selected_value)
        self.pf.setRange(self.from_dd.selected_value or None, self.to_dd.selected_value or None)

    @handle("role_dd", "change")
    def role_dd_change(self, **event_args):
        self._range()

    @handle("from_dd", "change")
    def from_dd_change(self, **event_args):
        self._range()

    @handle("to_dd", "change")
    def to_dd_change(self, **event_args):
        self._range()

    @handle("others_check", "change")
    def others_check_change(self, **event_args):
        self.pf.others = bool(self.others_check.checked)

    @handle("action_button", "click")
    def action_button_click(self, **event_args):
        self.pf.primary()

    @handle("cut_button", "click")
    def cut_button_click(self, **event_args):
        self.pf.cut()

    @handle("keep_button", "click")
    def keep_button_click(self, **event_args):
        self.pf.keep()

    @handle("retake_button", "click")
    def retake_button_click(self, **event_args):
        self.pf.retake()

    @handle("discard_button", "click")
    def discard_button_click(self, **event_args):
        self.pf.discard()

    def _enter(self, ar):
        try:
            self.pf.enterVR(ar)
        except Exception as e:
            state.toast("The headset didn't start: %s" % e, "error")

    @handle("vr_button", "click")
    def vr_button_click(self, **event_args):
        self._enter(False)

    @handle("ar_button", "click")
    def ar_button_click(self, **event_args):
        self._enter(True)

    # ---------------------------------------------------------------- the director's calls
    @handle("poll_timer", "tick")
    def poll_timer_tick(self, **event_args):
        r = anvil.server.call_s("stage_poll", self.pid, vt.VT.ed.device())
        if not r.get("ok"):
            return
        self.pf.setNote(r.get("note") or "")
        rtc = r.get("rtc")
        if rtc and rtc.get("id") != self.rtc_id:
            self.rtc_id = rtc["id"]
            self._answer(rtc)
        self.live_label.visible = bool(vt.VT.liveActive())
        call = r.get("call")
        if call and call.get("id") != self.call_id:
            self.call_id = call["id"]
            self.call = call
            names = {i: n for n, i in [(c["name"], c["id"]) for c in vt.cast_rows(self.doc)]}
            rows = {b["id"]: b["n"] for b in vt.beats(self.doc, self.takes)}
            span = ""
            if call.get("from") or call.get("to"):
                span = ", lines %s to %s" % (rows.get(call.get("from"), 1), rows.get(call.get("to"), "the end"))
            self.call_label.text = "Director's call: %s%s" % (names.get(call["actor"], "?"), span)
            self.call_box.visible = True
        if int(r.get("rev") or 0) > self.rev and self.pf.state == "ready":
            fresh = anvil.server.call_s("stage_get", self.pid)
            if fresh.get("ok"):
                self.rev = fresh["production"]["rev"]
                vt.takes(fresh["production"]["takes"], self.takes)
                if self.pf.replaceDoc(fresh["production"]["data"]):
                    self._pickers()
                    self._range()

    def _answer(self, rtc):
        """The director's computer wants to watch: answer its WebRTC offer (the picture goes straight to it)."""
        try:
            sdp = vt.VT.liveAnswer(self.pf, rtc["offer"], {})  # a JS promise: Anvil waits for the answer
        except Exception as e:
            print("live view: %s" % e)
            return
        anvil.server.call_s("stage_rtc_reply", self.pid, rtc["id"], sdp)

    @handle("take_call_button", "click")
    def take_call_button_click(self, **event_args):
        c = self.call or {}
        self.role_dd.selected_value = c.get("actor")
        self.from_dd.selected_value = c.get("from") or ""
        self.to_dd.selected_value = c.get("to") or ""
        self._range()
        self.call_box.visible = False
