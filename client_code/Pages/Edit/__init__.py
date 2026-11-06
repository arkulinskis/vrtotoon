import json

import anvil.js
import anvil.server
from anvil import *
from anvil.js import window

from ._anvil_designer import EditTemplate
from ... import router, state, vt

TABS = ["script", "cast", "direct", "camera", "takes", "look"]
VOLS = [("Off", 0.0), ("Quiet", 0.12), ("Soft", 0.2), ("Medium", 0.32), ("Loud", 0.5)]
FACES = [("Towards whoever they talk to", ""), ("The camera", "front"), ("Screen right", 90), ("Screen left", -90), ("Away (upstage)", 180)]


class Edit(EditTemplate):
    """#edit/<production id>: the director's chair.

    The production document and its takes live in the JS engines (vt.doc / vt.takes); the 3D stage (StageView) and the
    timeline (TimelineView) redraw themselves when it changes (VT.wire). This page builds the panels from it (Script, Cast,
    Direct, Camera, Takes, Look), turns panel actions into document changes, autosaves the owner's changes 1.5 s after the
    last one, and listens to a paired headset (new takes arrive while you work). Other people's demo or shared pictures open
    as a sandbox: everything works, nothing is saved, "Make my own copy" keeps it."""

    def __init__(self, args=(), **properties):
        super().__init__(**properties)
        self.pid = args[0] if args else ""
        self.tab = args[1] if len(args) > 1 and args[1] in TABS else "script"
        self.actor = None
        self.sel = None
        self.doc = vt.NULL
        self.stage = vt.NULL
        self.takes = vt.NULL
        self.p = {}
        self.can_edit = False
        self.synced = ""
        self._quiet = False
        self._booted = False
        self.editor.visible = False
        if not self.pid:
            self.missing_label.text = "No picture was named in the link."
            return
        r = anvil.server.call("production_get", self.pid)
        self.editor.visible = bool(r.get("ok"))
        self.missing.visible = not r.get("ok")
        if not r.get("ok"):
            self.missing_label.text = r.get("error") or ""
            return
        p = self.p = r["production"]
        self.can_edit = bool(p["can_edit"])
        self.synced = p["synced_at"]
        self.doc = vt.doc(p["data"])
        self.takes = vt.takes(p["takes"])
        self.title_box.text = p["title"]
        self.title_box.enabled = self.can_edit
        self.sandbox_banner.visible = not self.can_edit
        if not state.me():
            self.copy_button.text = "Sign up to make your own"
        for b in (self.headset_button, self.share_button):
            b.visible = self.can_edit
        self.status_label.text = "Saved" if self.can_edit else "Sandbox"
        self._choices()
        for name, panel in (("x-beat", self.beat_panel), ("x-cast", self.cast_panel), ("x-take", self.take_panel), ("x-shot", self.shot_panel)):
            panel.add_event_handler(name, getattr(self, "_" + name[2:]))
        self.emo_panel.add_event_handler("x-chip", self._emo_chip)
        self.gest_panel.add_event_handler("x-chip", self._gest_chip)
        self.stage_view.add_event_handler("select", self._stage_select)
        self.stage_view.add_event_handler("place", self._stage_place)
        self.timeline_view.add_event_handler("select", self._tl_select)
        self.live_monitor.add_event_handler("closed", self._live_closed)

    def _live_closed(self, **event_args):
        self.watch_button.visible = bool((getattr(self, "link_status", None) or {}).get("online"))

    # ------------------------------------------------------------------ start-up
    @handle("", "show")
    def form_show(self, **event_args):
        if self.doc is None or self._booted:
            return
        self._booted = True
        self.stage = self.stage_view.load(self.doc, self.takes)
        tl = self.timeline_view.load(self.doc, self.stage)
        vt.VT.wire(self.doc, self.stage, tl, anvil.js.report_exceptions(self._changed))
        self.stage.o.onState = anvil.js.report_exceptions(self._play_state)
        cast = vt.cast_rows(self.doc)
        self.actor = cast[0]["id"] if cast else None
        self._keys = anvil.js.report_exceptions(self._key)
        window.document.addEventListener("keydown", self._keys)
        window.VT_EDITOR = {"doc": self.doc, "stage": self.stage, "takes": self.takes, "pid": self.pid}  # for the UI tests
        self._sync_canvas()
        self._refresh_all()
        self._show_tab(self.tab, False)
        self.takes.loadAll()
        if self.can_edit and anvil.server.call_s("stage_status", self.pid, None).get("code"):
            self._start_link()

    def leave(self):
        if self.save_timer.interval:
            self._save()
        self.link_timer.interval = 0
        self.live_monitor.stop()
        if self.doc is not None and self._booted:
            window.document.removeEventListener("keydown", self._keys)
        self.timeline_view.unload()
        self.stage_view.unload()

    def _choices(self):
        self.emos = [(e["emoji"] + "  " + e["label"], e["id"]) for e in vt.emotions()]
        self.gests = [(g["emoji"] + "  " + g["label"], g["id"]) for g in vt.gestures()]
        self.style_items = [(s["label"], s["id"]) for s in vt.styles()]
        self.shot_types = [(s["label"], s["id"]) for s in vt.shots()]
        self.move_items = [(m["label"], m["id"]) for m in vt.moves()]
        self.sfx_items = [(s["label"], s["id"]) for s in vt.sfx()]
        self.fx_items = [(f["label"], f["id"]) for f in vt.voice_fx()]
        self.emo_panel.items = [{"id": e["id"], "label": e["label"], "emoji": e["emoji"], "kind": "emo"} for e in vt.emotions()]
        self.gest_panel.items = [{"id": g["id"], "label": g["label"], "emoji": g["emoji"], "kind": "act"} for g in vt.gestures()]
        self.style_dd.items = self.style_items
        self.style_dd.selected_value = "walk"
        self.sfx_dd.items = self.sfx_items
        self.set_dd.items = [(s["name"], s["id"]) for s in vt.set_list()]
        self.grade_dd.items = [(g["label"] + " · " + g["note"], g["id"]) for g in vt.grades()]
        self.music_dd.items = [(m["label"], m["id"]) for m in vt.music()]
        self.vol_dd.items = VOLS

    # ------------------------------------------------------------------ the document changed (anywhere: panels, stage, timeline)
    def _changed(self, what=None, *args):
        what = what or ""
        if self.can_edit:
            self.save_timer.interval = 1.5
            self.status_label.text = "Unsaved changes"
        self._stats()
        self._sync_canvas()
        self.undo_button.enabled = bool(self.doc.canUndo())
        self.redo_button.enabled = bool(self.doc.canRedo())
        if self._quiet:
            return
        if "cast" in what or "script" in what or "replace" in what or "undo" in what or "redo" in what:
            self._refresh_all()
        else:
            self._refresh_tab()
        if self.sel:
            self._show_sel()

    @handle("save_timer", "tick")
    def save_timer_tick(self, **event_args):
        self._save()

    def _save(self):
        self.save_timer.interval = 0
        if not self.can_edit or self.doc is None:
            return
        self.status_label.text = "Saving..."
        r = anvil.server.call_s("production_save", self.pid, self.doc.json(), self.synced)
        if r.get("ok"):
            self.status_label.text = "Saved"
            if vt.VT.ed.mergeSel(self.doc, r.get("sel") or {}):
                self._refresh_tab()
        else:
            self.status_label.text = "Not saved"
            state.toast(r.get("error") or "Saving failed.", "error")

    def _stats(self):
        s = vt.stats(self.doc, self.takes)
        self.script_stats.text = "%s · %d of %s recorded · runs %s" % (state.plural(s["beats"], "beat"), s["recorded"], state.plural(s["lines"], "line"), s["time"])

    def _refresh_all(self):
        cast = vt.cast_rows(self.doc)
        self.cast_items = [(c["name"] + " (" + c["charName"] + ")", c["id"]) for c in cast]
        self.cast_short = [(c["name"], c["id"]) for c in cast]
        ids = [c["id"] for c in cast]
        if self.actor not in ids:
            self.actor = ids[0] if ids else None
        self.actor_dd.items = self.cast_items
        self.actor_dd.selected_value = self.actor
        self.face_dd.items = FACES + [("Towards " + n, i) for n, i in self.cast_short]
        self.look_dd.items = [("Whoever is talking", "auto"), ("The camera", "cam")] + [(n, i) for n, i in self.cast_short]
        self._stats()
        self._refresh_tab()

    def _refresh_tab(self):
        if not hasattr(self, "cast_short"):
            return
        getattr(self, "_draw_" + self.tab)()

    def _show_tab(self, tab, remember=True):
        self.tab = tab
        parts = {"script": self.part_script, "cast": self.part_cast, "direct": self.part_direct, "camera": self.part_camera,
                 "takes": self.part_takes, "look": self.part_look}
        tabs = {"script": self.tab_script, "cast": self.tab_cast, "direct": self.tab_direct, "camera": self.tab_camera,
                "takes": self.tab_takes, "look": self.tab_look}
        for k in TABS:
            parts[k].visible = k == tab
            tabs[k].role = ["tab", "on"] if k == tab else ["tab"]
        if remember:
            router.replace("edit", self.pid, tab)
        if self._booted:
            self._refresh_tab()

    @handle("tab_script", "click")
    def tab_script_click(self, **event_args):
        self._show_tab("script")

    @handle("tab_cast", "click")
    def tab_cast_click(self, **event_args):
        self._show_tab("cast")

    @handle("tab_direct", "click")
    def tab_direct_click(self, **event_args):
        self._show_tab("direct")

    @handle("tab_camera", "click")
    def tab_camera_click(self, **event_args):
        self._show_tab("camera")

    @handle("tab_takes", "click")
    def tab_takes_click(self, **event_args):
        self._show_tab("takes")

    @handle("tab_look", "click")
    def tab_look_click(self, **event_args):
        self._show_tab("look")

    # ------------------------------------------------------------------ Script
    def _draw_script(self):
        picked = self.sel["id"] if self.sel and self.sel["kind"] == "beat" else None
        rows = vt.beats(self.doc, self.takes)
        for r in rows:
            r.update(cast=self.cast_short, emos=self.emos, can_edit=self.can_edit, picked=r["id"] == picked)
        self.beat_panel.items = rows

    def _beat(self, op=None, beat_id=None, value=None, **event_args):
        d = self.doc
        if op == "focus":
            return
        self._quiet = op == "text"
        try:
            if op == "who":
                if value == "__action":
                    d.updateBeat(beat_id, {"kind": "action", "who": None, "dur": 3})
                else:
                    d.updateBeat(beat_id, {"kind": "line", "who": value})
            elif op == "emo":
                d.updateBeat(beat_id, {"emo": value})
            elif op == "gap":
                d.updateBeat(beat_id, {"gap": value})
            elif op == "text":
                d.updateBeat(beat_id, {"text": value})
            elif op == "move":
                d.moveBeat(beat_id, value)
            elif op == "delete":
                if confirm("Its walks, feelings, gestures and shots go with it.", title="Delete this beat?",
                           buttons=[("Keep", False), ("Delete", True)], role="app-dialog"):
                    d.deleteBeat(beat_id)
            elif op == "booth":
                self._booth(beat_id)
        finally:
            self._quiet = False
        if op == "text":
            self._stats()

    @handle("add_line_button", "click")
    def add_line_button_click(self, **event_args):
        rows = vt.beats(self.doc, self.takes)
        last = rows[-1] if rows else None
        lines = [r for r in rows if r["kind"] == "line"]
        ids = [i for _, i in self.cast_short]
        who = ids[0] if ids else None
        if lines and len(ids) > 1:  # the next line goes to someone other than the last speaker
            who = [i for i in ids if i != lines[-1]["who"]][0]
        self.doc.addBeat({"kind": "line", "who": who, "text": "", "emo": ""}, last["id"] if last else None)

    @handle("add_action_button", "click")
    def add_action_button_click(self, **event_args):
        rows = vt.beats(self.doc, self.takes)
        self.doc.addBeat({"kind": "action", "who": None, "text": "Something happens.", "dur": 3}, rows[-1]["id"] if rows else None)

    @handle("import_button", "click")
    def import_button_click(self, **event_args):
        from ...Dialogs.ImportScript import ImportScript
        r = alert(ImportScript(current=vt.script_text(self.doc)), buttons=[], role="app-dialog", large=True)
        if r:
            n = self.doc.applyScript(r["text"], r["mode"])
            if r.get("direct"):
                vt.auto_direct(self.doc, self.takes)
            state.toast("%s in the script." % state.plural(n, "beat"), "ok")

    def _booth(self, beat_id):
        if not self.can_edit:
            state.toast("Make your own copy first: recordings are saved to your pictures.", "error")
            return
        rows = [r for r in vt.beats(self.doc, self.takes) if r["id"] == beat_id]
        if not rows or not rows[0]["who"]:
            return
        from ...Dialogs.VoiceBooth import VoiceBooth
        saved = alert(VoiceBooth(pid=self.pid, beat=rows[0]), buttons=[], role="app-dialog")
        if saved:
            vt.VT.ed.addPass(self.takes, saved["pass"], json.dumps(saved["take"]))
            self.doc.select(beat_id, rows[0]["who"], saved["take"]["uid"])
            state.toast("Line recorded. The film re-timed around it.", "ok")

    # ------------------------------------------------------------------ Cast
    def _draw_cast(self):
        rows = vt.cast_rows(self.doc)
        for r in rows:
            r.update(fx_items=self.fx_items, pid=self.pid, can_edit=True)
        self.cast_panel.items = rows

    def _cast(self, op=None, actor_id=None, value=None, **event_args):
        if op == "name":
            self.doc.updateCast(actor_id, {"name": value})
        elif op == "fx":
            self.doc.updateCast(actor_id, {"fx": value})
        elif op == "remove":
            if confirm("Their lines go to someone else in the cast; their walks, feelings and takes leave the cut.", title="Remove them from the cast?",
                       buttons=[("Keep", False), ("Remove", True)], role="app-dialog"):
                self.doc.removeCast(actor_id)
        elif op == "recast":
            from ...Dialogs.CastPicker import CastPicker
            pick = alert(CastPicker(title="Recast this part"), buttons=[], role="app-dialog", large=True)
            if pick:
                if pick.get("def"):
                    self.doc.d.custom[pick["ref"]] = pick["def"]
                self.doc.updateCast(actor_id, {"char": pick["ref"]})

    @handle("add_cast_button", "click")
    def add_cast_button_click(self, **event_args):
        from ...Dialogs.CastPicker import CastPicker
        pick = alert(CastPicker(title="Add to the cast"), buttons=[], role="app-dialog", large=True)
        if pick:
            if len(vt.cast_rows(self.doc)) >= 12:
                state.toast("A cast holds up to 12 characters.", "error")
                return
            self.actor = self.doc.addCast(pick["ref"], None, pick.get("def"))

    # ------------------------------------------------------------------ Direct (the selected actor, keys at the playhead)
    def _draw_direct(self):
        self.actor_dd.selected_value = self.actor
        if self.stage is not None:
            self.stage.select(self.actor)
            self.at_label.text = "Playhead at " + vt.fmt(self.stage.time)
        state.set_attr(self.perform_link, "href", router.href("stage", self.pid, self.actor or ""))
        self.perform_link.visible = self.can_edit
        self._show_sel()

    def _at(self):
        return vt.anchor(self.doc, self.takes, self.stage.time if self.stage is not None else 0)

    @handle("actor_dd", "change")
    def actor_dd_change(self, **event_args):
        self.actor = self.actor_dd.selected_value
        self._draw_direct()

    def _emo_chip(self, chip_id=None, **event_args):
        if not self.actor:
            return
        a = self._at()
        if a["beat"] is None:
            state.toast("Add a line first: feelings hang on the script.", "error")
            return
        self.doc.addKey("emo", {"actor": self.actor, "beat": a["beat"], "at": a["at"], "emo": chip_id})
        self.hint.text = "%s %s from %s." % (self._name(self.actor), vt.emoji(chip_id), vt.fmt(self.stage.time))

    def _gest_chip(self, chip_id=None, **event_args):
        if not self.actor:
            return
        a = self._at()
        if a["beat"] is None:
            state.toast("Add a line first: gestures hang on the script.", "error")
            return
        self.doc.addKey("act", {"actor": self.actor, "beat": a["beat"], "at": a["at"], "act": chip_id})

    @handle("look_button", "click")
    def look_button_click(self, **event_args):
        a = self._at()
        if self.actor and a["beat"]:
            self.doc.addKey("look", {"actor": self.actor, "beat": a["beat"], "at": a["at"], "target": self.look_dd.selected_value})

    def _name(self, aid):
        for n, i in self.cast_short:
            if i == aid:
                return n
        return ""

    def _stage_select(self, actor=None, **event_args):
        if actor:
            self.actor = actor
            self.sel = None
            if self.tab != "direct":
                self._show_tab("direct")
            else:
                self._draw_direct()
            self.hint.text = "%s: drag on the floor to walk there, or pick a feeling or gesture." % self._name(actor)

    def _stage_place(self, actor=None, x=0, z=0, **event_args):
        t = self.stage.time
        lead = vt.stats(self.doc, self.takes)["lead"]
        if t < lead - 0.05:
            cast = [c for c in vt.py(self.doc.d.cast) if c["id"] == actor]
            face = cast[0]["mark"][2] if cast and len(cast[0]["mark"]) > 2 else 0
            self.doc.updateCast(actor, {"mark": [x, z, face]})
            self.hint.text = "%s starts on the new mark." % self._name(actor)
            return
        a = self._at()
        face = self.face_dd.selected_value
        self.doc.addKey("move", {"actor": actor, "beat": a["beat"], "at": a["at"], "x": x, "z": z,
                                 "style": self.style_dd.selected_value or "walk", "face": face if face not in ("", None) else None})
        self.hint.text = "%s %s there from %s." % (self._name(actor), {"run": "runs", "sneak": "sneaks", "glide": "glides", "place": "jumps"}.get(self.style_dd.selected_value, "walks"), vt.fmt(t))

    # ------------------------------------------------------------------ the selection (a key, shot or sound from the timeline)
    def _tl_select(self, kind=None, item_id=None, **event_args):
        if kind is None:
            self.sel = None
        else:
            self.sel = {"kind": kind, "id": item_id}
        if kind == "beat":
            if self.tab == "script":
                self._draw_script()
            return
        if kind in ("move", "emo", "act", "look", "shot", "sfx"):
            info = vt.key_info(self.doc, self.takes, item_id)
            if info and info.get("actor"):
                self.actor = info["actor"]
            if self.tab != "direct":
                self._show_tab("direct")
            else:
                self._draw_direct()

    def _show_sel(self):
        info = vt.key_info(self.doc, self.takes, self.sel["id"]) if self.sel and self.sel["kind"] != "beat" else None
        self.sel_box.visible = bool(info)
        if not info:
            return
        k = info["kind"]
        names = {"move": "Walk", "emo": "Feeling", "act": "Gesture", "look": "Look", "shot": "Camera shot", "sfx": "Sound effect"}
        who = (" · " + info["actorName"]) if info.get("actorName") else ""
        self.sel_title.text = "%s%s at %s" % (names.get(k, k), who, info["time"])
        dds = {"emo": self.sel_emo_dd, "act": self.sel_act_dd, "style": self.sel_style_dd, "face": self.sel_face_dd, "look": self.sel_look_dd,
               "sfx": self.sel_sfx_dd, "shot": self.sel_shot_dd, "a": self.sel_a_dd, "move": self.sel_move_dd}
        show = {"move": ["style", "face"], "emo": ["emo"], "act": ["act"], "look": ["look"], "shot": ["shot", "a", "move"], "sfx": ["sfx"]}[k]
        for name, dd in dds.items():
            dd.visible = name in show
        self.sel_emo_dd.items = self.emos
        self.sel_act_dd.items = self.gests
        self.sel_style_dd.items = self.style_items
        self.sel_face_dd.items = self.face_dd.items
        self.sel_look_dd.items = self.look_dd.items
        self.sel_sfx_dd.items = self.sfx_items
        self.sel_shot_dd.items = self.shot_types
        self.sel_a_dd.items = [("Whoever's talking", "")] + self.cast_short
        self.sel_move_dd.items = self.move_items
        if k == "move":
            self.sel_style_dd.selected_value = info.get("style") or "walk"
            f = info.get("face")
            self.sel_face_dd.selected_value = "" if f is None else f
        elif k == "emo":
            self.sel_emo_dd.selected_value = info.get("emo")
        elif k == "act":
            self.sel_act_dd.selected_value = info.get("act")
        elif k == "look":
            self.sel_look_dd.selected_value = info.get("target") or "auto"
        elif k == "sfx":
            self.sel_sfx_dd.selected_value = info.get("sfx")
        elif k == "shot":
            self.sel_shot_dd.selected_value = info.get("type")
            self.sel_a_dd.selected_value = info.get("a") or ""
            self.sel_move_dd.selected_value = info.get("move") or "static"

    def _sel_update(self, fields):
        if self.sel:
            self.doc.updateKey(self.sel["id"], fields)

    @handle("sel_emo_dd", "change")
    def sel_emo_dd_change(self, **event_args):
        self._sel_update({"emo": self.sel_emo_dd.selected_value})

    @handle("sel_act_dd", "change")
    def sel_act_dd_change(self, **event_args):
        self._sel_update({"act": self.sel_act_dd.selected_value})

    @handle("sel_style_dd", "change")
    def sel_style_dd_change(self, **event_args):
        self._sel_update({"style": self.sel_style_dd.selected_value})

    @handle("sel_face_dd", "change")
    def sel_face_dd_change(self, **event_args):
        v = self.sel_face_dd.selected_value
        self._sel_update({"face": None if v in ("", None) else v})

    @handle("sel_look_dd", "change")
    def sel_look_dd_change(self, **event_args):
        self._sel_update({"target": self.sel_look_dd.selected_value})

    @handle("sel_sfx_dd", "change")
    def sel_sfx_dd_change(self, **event_args):
        self._sel_update({"sfx": self.sel_sfx_dd.selected_value})

    @handle("sel_shot_dd", "change")
    def sel_shot_dd_change(self, **event_args):
        self._sel_update({"type": self.sel_shot_dd.selected_value})

    @handle("sel_a_dd", "change")
    def sel_a_dd_change(self, **event_args):
        self._sel_update({"a": self.sel_a_dd.selected_value or None})

    @handle("sel_move_dd", "change")
    def sel_move_dd_change(self, **event_args):
        self._sel_update({"move": self.sel_move_dd.selected_value})

    @handle("sel_delete_button", "click")
    def sel_delete_button_click(self, **event_args):
        if self.sel:
            sid = self.sel["id"]
            self.sel = None
            self.timeline_view.timeline.select(None)
            self.doc.deleteKey(sid)

    # ------------------------------------------------------------------ Camera
    def _draw_camera(self):
        picked = self.sel["id"] if self.sel and self.sel["kind"] == "shot" else None
        rows = vt.shot_rows(self.doc, self.takes)
        for r in rows:
            r.update(types=self.shot_types, cast=self.cast_short, moves=self.move_items, picked=r["id"] == picked)
        self.shot_panel.items = rows

    def _shot(self, op=None, shot_id=None, value=None, **event_args):
        if op == "seek":
            self.stage.seek(value or 0)
        elif op == "delete":
            self.doc.deleteKey(shot_id)
        elif op in ("type", "a", "move"):
            self.doc.updateKey(shot_id, {op: value})

    @handle("auto_button", "click")
    def auto_button_click(self, **event_args):
        if vt.shot_rows(self.doc, self.takes) and not confirm("Your shots are replaced by the auto-director's cut. (Undo brings them back.)",
                                                              title="Let the auto-director cut it?", buttons=[("Cancel", False), ("Auto-direct", True)], role="app-dialog"):
            return
        n = vt.auto_direct(self.doc, self.takes)
        state.toast("%s, cut to the script." % state.plural(n, "shot"), "ok")

    @handle("add_shot_button", "click")
    def add_shot_button_click(self, **event_args):
        a = self._at()
        if a["beat"] is None:
            state.toast("Add a line first: shots hang on the script.", "error")
            return
        kid = self.doc.addKey("shot", {"beat": a["beat"], "at": a["at"], "type": "medium", "a": self.actor, "b": None, "move": "static"})
        self.sel = {"kind": "shot", "id": kid}
        self.timeline_view.timeline.select({"kind": "shot", "id": kid})
        self._draw_camera()

    @handle("sfx_button", "click")
    def sfx_button_click(self, **event_args):
        a = self._at()
        if a["beat"] is None:
            state.toast("Add a line first: sounds hang on the script.", "error")
            return
        self.doc.addKey("sfx", {"beat": a["beat"], "at": a["at"], "sfx": self.sfx_dd.selected_value, "vol": 0.8})

    # ------------------------------------------------------------------ Takes
    def _draw_takes(self):
        rows = vt.take_rows(self.doc, self.takes)
        for r in rows:
            r["can_edit"] = self.can_edit
        self.take_panel.items = rows
        self.no_takes.visible = not rows

    def _take(self, op=None, uid=None, value=None, **event_args):
        if op == "face":
            self._face_booth(uid)
        elif op == "use":
            vt.VT.ed.useTake(self.doc, self.takes, uid)
        elif op == "star":
            if state.call("take_star", self.pid, uid, value) is not None:
                self.takes.map[uid].stars = value
                self._draw_takes()
        elif op == "delete":
            if confirm("The recording is deleted for good; lines that used it go back to their estimate.", title="Delete this take?",
                       buttons=[("Keep", False), ("Delete", True)], role="app-dialog"):
                r = state.call("take_delete", self.pid, uid)
                if r is not None:
                    vt.VT.ed.dropTake(self.doc, self.takes, uid)

    def _face_booth(self, uid):
        """Act a take's face in front of the webcam (Dialogs/FaceBooth); the film plays it at once."""
        rows = [r for r in vt.take_rows(self.doc, self.takes) if r["uid"] == uid]
        if not rows:
            return
        if self.stage is not None and self.stage.playing:
            self.stage.pause()
        from ...Dialogs.FaceBooth import FaceBooth
        r = alert(FaceBooth(pid=self.pid, take=rows[0], doc=self.doc, takes=self.takes, can_save=self.can_edit),
                  buttons=[], role="app-dialog", large=True)
        if not r:
            return
        self._draw_takes()
        if self.stage is not None:
            self.stage.refresh("sel")
        if r.get("removed"):
            state.toast("Face pass removed: the feelings you set drive the face again.", "ok")
        elif r.get("saved"):
            state.toast("Printed! The face plays in the film%s." % (", with your new voice" if r.get("voice") else ""), "ok")

    # ------------------------------------------------------------------ Look
    def _draw_look(self):
        d = vt.py(self.doc.d)
        look, music = d.get("look") or {}, d.get("music") or {}
        self.set_dd.selected_value = d.get("set")
        self.grade_dd.selected_value = look.get("grade")
        self.canvas_pick.value = look.get("aspect") or "16:9"
        self.music_dd.selected_value = music.get("id") or "none"
        vol = music.get("vol", 0.2)
        if vol not in [v for _, v in VOLS]:
            self.vol_dd.items = VOLS + [("%d%%" % round(vol * 100), vol)]
        self.vol_dd.selected_value = vol
        self.subs_check.checked = bool(look.get("subs"))
        self.titles_check.checked = look.get("titles") is not False
        self.logline_box.text = self.p.get("logline") or ""
        self.logline_box.enabled = self.can_edit
        self.poster_button.visible = self.can_edit
        blurbs = {s["id"]: s["blurb"] for s in vt.set_list()}
        self.set_blurb.text = blurbs.get(d.get("set"), "")

    @handle("set_dd", "change")
    def set_dd_change(self, **event_args):
        self.doc.set("set", self.set_dd.selected_value)

    @handle("grade_dd", "change")
    def grade_dd_change(self, **event_args):
        self.doc.set("look.grade", self.grade_dd.selected_value)

    @handle("canvas_pick", "change")
    def canvas_pick_change(self, value=None, **event_args):
        self.doc.set("look.aspect", value or "16:9")
        a = vt.aspect(value)
        state.toast("Canvas: %s. Every shot is reframed for it." % a["label"], "ok")

    @handle("canvas_button", "click")
    def canvas_button_click(self, **event_args):
        self._show_tab("look")

    def _sync_canvas(self):
        """The stage box and its badge follow the picture's canvas (after any change, undo included)."""
        a = vt.aspect(str(self.doc.d.look.aspect or "16:9"))
        if a["id"] == getattr(self, "_canvas", None):
            return
        self._canvas = a["id"]
        self.dom_nodes["stage_wrap"].style.setProperty("--ar", str(a["r"]))
        self.dom_nodes["stage_wrap"].classList.toggle("tall", a["r"] < 1.3)
        self.canvas_button.text = a["label"]

    @handle("music_dd", "change")
    def music_dd_change(self, **event_args):
        self.doc.set("music.id", self.music_dd.selected_value)

    @handle("vol_dd", "change")
    def vol_dd_change(self, **event_args):
        self.doc.set("music.vol", self.vol_dd.selected_value)

    @handle("subs_check", "change")
    def subs_check_change(self, **event_args):
        self.doc.set("look.subs", bool(self.subs_check.checked))

    @handle("titles_check", "change")
    def titles_check_change(self, **event_args):
        self.doc.set("look.titles", bool(self.titles_check.checked))

    @handle("logline_box", "lost_focus")
    def logline_box_lost_focus(self, **event_args):
        if self.can_edit and (self.logline_box.text or "") != (self.p.get("logline") or ""):
            if state.call("production_logline", self.pid, self.logline_box.text or "") is not None:
                self.p["logline"] = self.logline_box.text or ""

    @handle("poster_button", "click")
    def poster_button_click(self, **event_args):
        w, h = vt.snap_size(self.stage.aspectId())
        url = self.stage.snapshot(w, h)
        if state.call("production_poster", self.pid, url) is not None:
            state.toast("Poster saved. It shows on the Lot and in Premieres.", "ok")

    # ------------------------------------------------------------------ top bar
    @handle("title_box", "lost_focus")
    def title_box_lost_focus(self, **event_args):
        t = (self.title_box.text or "").strip()
        if t and t != vt.py(self.doc.d.title):
            self.doc.set("title", t[:80])

    @handle("title_box", "pressed_enter")
    def title_box_pressed_enter(self, **event_args):
        self.title_box_lost_focus()

    @handle("undo_button", "click")
    def undo_button_click(self, **event_args):
        self.doc.undo()

    @handle("redo_button", "click")
    def redo_button_click(self, **event_args):
        self.doc.redo()

    def _key(self, event):
        tag = getattr(event.target, "tagName", "") or ""
        if tag in ("INPUT", "TEXTAREA", "SELECT"):
            return
        if (event.ctrlKey or event.metaKey) and event.key in ("z", "Z"):
            event.preventDefault()
            if event.shiftKey:
                self.doc.redo()
            else:
                self.doc.undo()
        elif event.key == " " and self.stage is not None:
            event.preventDefault()
            self.stage.toggle()

    @handle("play_button", "click")
    def play_button_click(self, **event_args):
        self.stage.toggle()

    def _play_state(self, s=None, *args):
        playing = s == "play"
        self.play_button.text = "Pause" if playing else "Play"
        self.play_button.role = ["btn", "btn-sm", "btn-solid-dark", "ic-pause" if playing else "ic-play"]
        if not playing and self.tab == "direct":
            self.at_label.text = "Playhead at " + vt.fmt(self.stage.time)

    @handle("view_button", "click")
    def view_button_click(self, **event_args):
        director = self.stage.view != "director"
        self.stage.view = "director" if director else "film"
        self.stage._dirty = True
        self.view_button.text = "Film camera" if director else "Director's view"
        self.hint.text = ("Director's view: drag to look around, Shift-drag to slide, scroll to zoom. Marks are gold crosses, walks are dashed."
                          if director else "Film camera: what the audience sees.")

    @handle("copy_button", "click")
    def copy_button_click(self, **event_args):
        if not state.me():
            router.remember_after(router.href("edit", self.pid))
            router.go("auth", "signup")
            return
        r = state.call("production_copy", self.pid)
        if r:
            state.toast("Your own copy is on the Lot. It's yours to change.", "ok")
            router.go("edit", r["id"])

    @handle("share_button", "click")
    def share_button_click(self, **event_args):
        self._save()
        from ...Dialogs.Share import Share
        r = alert(Share(production=self.p, stage=self.stage), buttons=[], role="app-dialog")
        if isinstance(r, dict):
            self.p.update(r)

    @handle("export_button", "click")
    def export_button_click(self, **event_args):
        self.stage.pause()
        from ...Dialogs.Export import Export
        alert(Export(stage=self.stage, title=vt.py(self.doc.d.title)), buttons=[], role="app-dialog", large=True)

    # ------------------------------------------------------------------ the headset link
    @handle("headset_button", "click")
    def headset_button_click(self, **event_args):
        self._save()
        from ...Dialogs.HeadsetLink import HeadsetLink
        r = alert(HeadsetLink(page=self), buttons=[], role="app-dialog", large=True)
        self._start_link()
        if r == "watch":
            self.live_monitor.start(self.pid)

    @handle("watch_button", "click")
    def watch_button_click(self, **event_args):
        self.live_monitor.start(self.pid)

    def _start_link(self):
        self.link_since = self.link_since if getattr(self, "link_since", None) else self.synced
        self.link_timer.interval = 3
        self.headset_button.role = ["btn", "btn-sm", "ic-vr", "live"]

    @handle("link_timer", "tick")
    def link_timer_tick(self, **event_args):
        r = anvil.server.call_s("stage_status", self.pid, self.link_since)
        if not r.get("ok"):
            self.link_timer.interval = 0
            return
        self.link_status = r
        self.headset_button.text = "Headset ●" if r["online"] else "Headset"
        self.watch_button.visible = bool(r["online"]) and not self.live_monitor.visible
        if r["takes"]:
            vt.takes(r["takes"], self.takes)
            self.takes.loadAll()
            vt.VT.ed.mergeSel(self.doc, r["sel"])
            names = sorted(set(self._name(t["actor"]) for t in r["takes"]))
            lines = sum(len([c for c in t["clips"] if c["line"]]) for t in r["takes"])
            state.toast("New from the headset: %s (%s). It's in the cut. Add the face with your webcam: Takes, Face." % (", ".join(names), state.plural(lines, "line")), "ok")
            self.stage.refresh()
            self._refresh_tab()
        self.link_since = r["now"]

    # ------------------------------------------------------------------ timeline zoom
    @handle("tl_fit_button", "click")
    def tl_fit_button_click(self, **event_args):
        self.timeline_view.timeline.fit()

    @handle("tl_in_button", "click")
    def tl_in_button_click(self, **event_args):
        self.timeline_view.timeline.zoom(1.35)

    @handle("tl_out_button", "click")
    def tl_out_button_click(self, **event_args):
        self.timeline_view.timeline.zoom(1 / 1.35)
