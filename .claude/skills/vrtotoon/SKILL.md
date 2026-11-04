---
name: vrtotoon
description: Context, workflow and recipes for VRtoToon (folder vrtotoon), the user's Anvil app built as native Anvil Forms (Python + HTML templates, a layout, custom components, RepeatingPanels) with three.js engines. A Hollywood-themed cartoon/movie studio where one person performs every role with a VR headset (head, hands, voice) or a desk puppet, directs on the PC (walks, feelings, cameras) and exports video or a Blender kit. Load this before any feature request, bug fix, restyle, content change or deploy for this app.
---

# VRtoToon: working on the app

**What it is:** a browser cartoon studio (a better Flipside XR). Members cast 3D toon characters (25 premade + their own
characters from the wardrobe's character editor), write or paste a script, perform each role in VR / passthrough / as a desk puppet (head + hands + voice; the
mouth follows the voice), direct on the PC (blocking by dragging, feelings, gestures, looks, shots, auto-director, film
looks, score, sound effects), share a screening link (Premieres) and export video, a Blender kit (.glb + dialogue WAV +
import script), .srt, WAV, script. The core problem it solves: ONE person playing MANY roles (see "The film model").
README.md lists every feature.

**Where it lives:**
- Folder `C:\Users\arkvi\Documents\CLAUDE\vrtotoon\` = the git clone of **github.com/arkulinskis/vrtotoon**, branch `master`.
  "git" layout: the folder *is* the Anvil app. Anvil pulls master; pushing is the deploy. Live: not yet (planned
  https://vrtotoon.anvil.app; when the user sends the address: apps.json, legal-kit, README, SEO).
- Made from `C:\Users\arkvi\Documents\CLAUDE\APP_MAKER\template-forms` (native Anvil Forms, Nov 2026). The 3D/VR engine
  ideas come from Snackpuncher (WebXR with three r158, `renderer.xr`) and ToonyLoony (studio, takes, lip sync).

**What the user wants:** "Hollywood cinema" theme; browser based; lots of characters (set characters now, built as data so
they can be modified later); easy editing; the multi-role problem solved; teleprompters in the headset; voice moves the
mouth; head + hands captured in VR, emotions / positions / walking done on the PC; better PC + VR co-work than Flipside;
passthrough; export as video and as a 3D format for Blender; looks great before Blender. The user's split (Nov 3 2026):
blocking/walks on the PC, head + hands + fingers + voice in VR, the FACE from the webcam afterwards (the face booth).
Design: velvet red #b3182b (dark #e0384b), marquee gold #e8b54a (text gold #b8862a light / #f0c060 dark), cinema black
#120a0c (hero, stage, screening room in both themes), cream programme paper #f7f1e6 (light bg), dark bg #110a0c.
Fonts: Bebas Neue (marquee headings; ONE weight: never bold), Playfair Display italic (the flourish, `<em>` in headings),
DM Sans (body). Buttons are ticket-booth rectangles (radius 10), primary velvet with a gold inner edge; chasing marquee
bulbs on the landing; one-sheet posters (3:4, gold inner frame). Loader preset: flip. Claude assumes details and builds;
Claude deploys. Every page must fit 390 px. Light and dark.

## Workflow for any change

1. `git pull --ff-only` (Anvil commits "Edited ..." when the user changes something in the IDE; read those commits).
2. Edit: a page's template and Python side by side; engines in `theme/assets/vt-*.js` (then `python tools/assets.py`).
3. `python tools/check.py` (no -I) -> **ALL CHECKS PASSED**: Anvil's validator (type-checks every template and Python file),
   JS syntax, asset hashes, server tests (`tools/testing/test_server.py`).
4. `python -I tools/ui_test.py` (Docker Desktop running) -> **ALL UI TESTS PASSED**: the folder runs in the open-source
   Anvil App Server (container `vrtotoon-dev`, a copy of the folder in a Docker volume, `--auto-migrate`); headless Chrome (SwiftShader WebGL, fake microphone) walks tools/ui/flow.js
   (visitor pages, sign-up, the character editor, new picture, every editor panel, voice booth, a desk-puppet pass with a
   finger shape on the stage, the face booth on that take (the fake webcam shows tools/ui/face-cam.mjpeg, a real face:
   478 points found, record with a new voice, print, the film plays it, a fresh editor loads it back), headset link, the
   live view (a second window pairs at #door and streams to the editor), .glb export, share, stage door), phone.js
   (390 px, every page) and admin.js. Server edits need `--restart`. check.py also runs tools/testing/face_math.js (the
   key points -> face controls maths on face_points.json, the real face's 478 points).
   `--shots DIR` = screenshots of every page (seed.js makes an account and a picture). Read them.
5. Commit as arkulinskis with the Co-Authored-By line; `git push origin master`. New tables/columns: Schema Mismatch step.

## Architecture

```
anvil.yaml        head_html loads three.min.js + vt-cast, vt-sets, vt-film, vt-stage, vt-timeline, vt-xr, vt-live, vt-face, vt-export,
                  vt-ui, vt-ed (+ app.css, vt.css); tables: productions, takes (+ face), characters, stage_links (+ rtc) (+ template tables)
client_code/
  vt.py           THE door to window.VT: catalogues, portraits, new_doc_json, doc()/takes() engine objects, row lists (JSON)
                  for panels (VT.ed.*), NULL (a typed "nothing yet" for JS objects: the validator rejects attr-on-None)
  router.py       PAGES, NAV (Lot, Casting, Premieres, Headset), GUEST_NAV, CHROMELESS {stage, door}; calls page.leave()
  Layouts/Shell   marquee brand "VR<em>to</em>Toon"; classes no-chrome (stage, door) and wide-page (edit)
  Pages/          Landing (FilmPlayer hero), Home (the Lot), Casting, Wardrobe (#wardrobe: the character editor), Premieres,
                  Screen, Edit (the director's chair + LiveMonitor), Stage (performance; answers live-view offers), Door
                  (headset keypad), Auth, Profile, Admin (+ Films tab)
  Components/     Portrait (img from VT.portrait), FilmPlayer (VT.Stage film/hero + VT.controls), Turntable (VT.Stage
                  turntable), StageView (VT.Stage edit; events select/place), TimelineView (VT.Timeline; event select),
                  PerformView (VT.Perform; events state/kept), LiveMonitor (VT.LiveViewer: the floating headset view; event
                  closed), Slider (range input; change(value, final)), ColorPick (swatches + native picker; change(value))
  Items/          CastCard ProductionCard Chip BeatRow CastRow TakeRow ShotRow KeyButton FilmRow Swatch (+ template ones)
  Dialogs/        NewProduction CharacterSheet CastPicker ImportScript HeadsetLink (Watch live) Export Share VoiceBooth
                  FaceBooth (webcam face pass for one take: VT.FaceBooth; take_face / take_face_remove)
server_code/      Productions (lot_home, new/get/save(merge)/copy/share/poster/logline/delete), Takes (save_take shared with
                  StageLink, list/star/delete, take_face (face track + optional new voice; re-keys the take) / take_face_remove), StageLink (link, join, get, poll (+ a pending live-view offer), save_pass,
                  status, call, note, rtc_offer / rtc_reply / rtc_answer), Wardrobe (clean_def: face ranges, colours,
                  role, voice), Screenings (premieres_list, screen_get, screen_report, /_/api/m/<key>-m|-a|-f media endpoint),
                  DemoData + demo_films.py + demo_voice_lengths.py, Admin (+ films), Feedback (+ record), Accounts, common
theme/assets/     vt-cast.js    characters: VT.CAST (25, ids never change), species builder, face rig (+ def.face sliders), IK
                                arms, toon hands (thumb + 3 fingers, curls), VT.HAND_SHAPES (8), VT.handQ, legs,
                                VT.EMOTIONS (12), VT.GESTURES (21), VT.proceduralPose, VT.portrait, VT.makeDef, VT.randomDef
                  vt-sets.js    VT.SETS (10, ids never change), VT.buildSet, VT.GRADES (8), VT.ASPECTS, VT.SFX (14), VT.MUSIC (8)
                  vt-film.js    VT.Doc (undo/redo, ops), layout (ripple), VT.Film (place/walk, emotion, gesture, look, perform,
                                mouth, camera shots), VT.autoDirect, VT.parseScript / applyScript, VT.TEMPLATES, voiceChain
                  vt-stage.js   VT.Stage (render loop, grade post pass, letterbox, titles/subtitles, audio mix, editor input,
                                turntable), VT.scheduleAudio, VT.drawTitles
                  vt-xr.js      VT.Perform (passes, VR/AR sessions, calibration, HUD: teleprompter, monitor, laser menu, desk puppet,
                                hand tracking: VT.fingerCurls / VT.handFrameXR, controller fingers: VT.touchCurls,
                                startPreview: the live picture)
                  vt-live.js    VT.LiveViewer (PC) + VT.liveAnswer / liveHangUp / liveActive (headset): WebRTC, no trickle
                  vt-face.js    the face booth: VT.FACE_CH (11 controls), VT.FACE_POINTS (25 key points of MediaPipe's 478),
                                faceMeasure / faceFromMeasures (calibrated to the performer's neutral face), pack/unpack/faceAt,
                                mixCamFace (camera face over a feeling), loadFaceModel (MediaPipe tasks-vision 0.10.14 from
                                jsDelivr + Google's model), VT.FaceBooth (camera, live mirror, record/stop/play, voice, result)
                  vt-timeline.js VT.Timeline;  vt-export.js video, GLB, Blender kit, WAV, SRT, zip;  vt-ui.js controls, wire;
                  vt-ed.js      VT.ed rows/jobs for Python panels (beats, cast, takes, shots, key, recorder, passMeta ...)
tools/            make_demo_voices.py (Kokoro TTS -> theme/assets/dv-<film>-<beat>.mp3 + demo_voice_lengths.py)
```

## The film model (read before touching timing)

- doc = {title, set, look {grade, aspect, fps, subs, titles}, lead (seconds before beat 1), music {id, vol},
  cast [{id, char (premade id | custom uid), name, mark [x, z, faceDeg], fx, vol}], beats [{id, kind line|action, who,
  text, emo, gap, dur (action)}], keys {move, emo, act, look}: each {id, actor, beat, at, ...}, shots [{id, beat, at, type,
  a, b, move}], sfx [{id, beat, at, sfx, vol}], sel {"<beat>|<actor>": take uid}, custom {uid: def}}.
- Everything is anchored to a beat ({beat, at seconds}). `doc.layout(takes)`: beat start = previous end + gap; a line's
  length = its selected take clip's dur, else an estimate (words x 0.36 + 0.7 s). So retakes ripple. `doc.anchor(t)` turns a
  time into {beat, at} for new keys. Deleting a beat deletes what hangs on it.
- take = {uid t_..., actor, source vr|ar|desk|voice, clips [{beat, off, dur, line}], dur, motion {fps 30, n, f (23 floats
  per frame: head p3 q4, left hand p3 q4, right hand p3 q4, left shape, right shape), m (mouth: 2 chars/frame open+wide)},
  audio}. Positions are metres in the character's own space (+Z forward, relative to its mark). Blocking (move keys) is
  added on top, so VR = upper body + voice, PC = where they walk.
- Since Nov 2026 motion has `k` = floats per frame: **31** = the 23 above + finger curls [thumb, index, middle, ring] of
  the left (23-26) and the right hand (27-30). Takes without `k` are the old 23-float format (curls come from the shape
  number). Always read with `m.k || VT.FRAME0`; VT.sampleMotion returns hands as {p, q, g, c}.
- **Face pass** (Nov 3 2026): take.face = {v 1, fps 30, n, k 11, s (11 chars a frame, 64 steps each over the control's
  range in VT.FACE_CH), gain, mouth, vm?}, same time base as the motion (take time; clip.off + (t - beat start)). Controls:
  lidL lidR browL browR browTilt curve open wide smirk gx gy, where L/R = the PERFORMER's left/right, which drives the
  character's own left (+X, eye side +1). Film.actorAt: `camFace` -> `VT.mixCamFace(feelingFace, cam, w)` (fades in over
  0.3 s after a clip without a face; procedural blinks off), `face.mouth` makes Film.mouth use the camera's jaw; `vm` (lip
  sync of a voice re-recorded in the booth) replaces motion.m when the take loads. Actor._face reads lidL/lidR, browL/browR,
  smirk (mouth rotation.z) and gx/gy (added to the look) when present; feelings without them behave as before.
- **The rig's arm keys are positions, not anatomy:** 'r' is the arm on +X, which is the character's LEFT (it faces +Z).
  The performer's left hand drives 'r' (vt-xr.js RIG_KEY). A hand's own frame: fingers -Y, palm -Z, thumb towards the
  body's middle; author hand rotations with VT.handQ(fingerDir, palmDir), never Euler angles.
- Film.actorAt(): root from move keys (walk/run/sneak/glide/place; faces partner "auto" = cheat to camera), upper body from
  the selected clip (cross-fade 0.3 s between sources) or VT.proceduralPose (idle, talking hands, gesture keys), face from
  emotion keys + the beat's emo, mouth from the take (or flapping to the words), blink, gaze at the look target.
- Camera: the latest shot; framing from actor positions each frame; camDir keeps the 180-degree rule (audience side +Z).

## How things are done here

(The template's patterns hold: pages = Forms with the Shell layout; lists = RepeatingPanel + Items with `x-...` events;
dialogs = `alert(Form(...), buttons=[], role="app-dialog")`; server calls via `state.call`; JS only in theme/assets.)
- **Engine objects live in JS.** The editor keeps `self.doc` (VT.Doc) and `self.takes` (VT.Takes); `VT.wire(doc, stage,
  timeline, onChange)` redraws the stage and timeline in JS and calls Python at most every 250 ms. Python panels read rows
  through `vt.beats()` / `vt.cast_rows()` / `vt.take_rows()` / `vt.shot_rows()` (JSON from VT.ed) and change the doc with
  its methods (`doc.addKey("emo", {...})`, `doc.updateBeat(id, {...})`). Never loop over JS arrays in Python per frame.
- **Saving:** the editor autosaves `doc.json()` 1.5 s after the last change with `synced_at`; the server keeps selections of
  takes created since then (`merge_sel`), so a PC autosave never undoes a headset take.
- **Media:** takes' motion JSON, audio and face track are served at `/_/api/m/<take key>-m|-a|-f` (random per take, cached
  as immutable: take_face gives the take a NEW key so browsers fetch the new face/voice); the client builds URLs with
  `VT.mediaUrl` from `VT.API` (startup: `get_api_origin()`, which already ends in `/_/api`: mediaUrl strips it before
  adding `/_/api/m/`; until Nov 3 2026 it doubled it and saved takes never loaded after a reload). Demo takes have
  `asset` = a theme file instead.
- **Test hooks:** `window.VT_EDITOR = {doc, stage, takes, pid}` (Edit), `window.VT_PERFORM` (Stage), `window.VT_FACE`
  (the open face booth: stats(), pts, neutralM), `window.VT_TEST = {lineSecs, speed, faceLead}` (a pass treats each of your
  lines as N seconds of speech; faceLead = the face booth's count-in seconds).
- **Validator patterns:** an `anvil:name` on a template's ROOT element is invisible to it (wrap the root in a div); JS objects
  that start empty use `vt.NULL`, not None; avoid `x = call() if a else {literal dict}` (union types): return early instead;
  `anvil.js.new(window.Blob, [...], {...})` instead of calling `window.Blob(...)`.

## Recipes

- **New premade character:** a row in `VT.CAST` (vt-cast.js): {id, name, role, tag, species, build, colors, hair, hat, acc,
  voice}. Ids are referenced by productions: never rename. New species: a branch in `Actor` (proportions), `_buildHead`.
- **New hat / hair / accessory:** `_buildHat` / `_buildHair` / `_buildFaceAcc` or `_buildBody`, plus `VT.HATS/HAIRS/ACCS`.
- **New emotion / gesture:** `VT.EMOTIONS` (face params) / `VT.GESTURES` + a `case` in `VT.proceduralPose` (set Rg / Lg to
  a hand shape number, or Rc / Lc to curls; fingers blend in and out with the gesture).
- **New hand shape:** a row at the END of `VT.HAND_SHAPES` (numbers are stored in takes; never reorder) + the desk puppet's
  keys (Digit1-8 in vt-xr.js) and DESK_HELP in Pages/Stage.
- **New character-editor control:** a face/build key in vt-cast.js (FACE0 / BUILD0 default + use it in the Actor), its
  range in Wardrobe.py FACE_RANGES (server clamps), a Slider/Chip in Pages/Wardrobe (template + BODY/FACE tuple).
- **New set:** a row in `VT.SETS` (vt-sets.js) with light, marks (5) and build(api) (api.box/cyl/sph/cone/floor/backdrop/
  sign/bulbs/lightCone/particles, `api.anim.push(fn(t))`). Keep the acting area x -3..3, z -2..2 clear.
- **New shot type / move:** `VT.SHOTS` / `VT.MOVES` + a case in `Film.camera`; the auto-director is `VT.autoDirect`.
- **New film look:** `VT.GRADES` (sat, con, exp, tint, vig, grain, bw).
- **New face control (face booth):** append to `VT.FACE_CH` (never reorder: stored tracks are positional; old tracks with a
  smaller k read REST for the new one), add its REST value, measure it in `faceMeasure` (key points in the head frame,
  units = outer eye corner distance), map it in `faceFromMeasures`, use it in `mixCamFace` + Actor._face, set
  `FACE_K` in server_code/Takes.py, extend tools/testing/face_math.js. Tune scales on face_points.json (synthetic moves).
- **New template:** `VT.TEMPLATES` (script uses the premade ids upper-cased as names) + `TEMPLATE_CAST` in Dialogs/NewProduction.
- **Demo films:** server_code/demo_films.py (fixed ids), then `python tools/make_demo_voices.py` (Kokoro; needs
  `pip install kokoro soundfile imageio-ffmpeg`), then bump `DemoData.DEMO_SET` so live apps reload them.
- **New table or column / server function / restyle / icon:** as in the template (anvil.yaml db_schema, tests, tokens at
  the top of app.css + vt.css, `python -I tools/make_icons.py --bg "#110a0c"`, `python tools/assets.py`).

## Gotchas

- Headless Chrome needs SwiftShader for WebGL: tools/live/drive.mjs runs with `--use-angle=swiftshader
  --enable-unsafe-swiftshader` plus fake media flags (microphone tests). Never put `--disable-gpu` back.
- WebXR can't be tested headless: the desk puppet runs the same pass code (`Perform._readPuppet` vs `_readXR`). Test VR on a
  real headset (Quest Browser) after changes to vt-xr.js: calibration (`_calibrate`: world scale k = performer eye / character
  eye, offset reference space), the HUD (`_placeHud`: hud children are in world metres because hud.scale = 1/k), lasers.
- In XR three.js renders every frame with the XR camera; the monitor renders to a target with `renderer.xr.enabled = false`
  around it (and back), then restores the XR render target.
- Recording time runs on the wall clock (`Perform._tick`), not the frame clock: slow frames must not desync voice and motion.
- Bebas Neue has one weight: any `font-weight: 700/800` on it fakes bold. vt.css resets headings to 400.
- Never write Anvil's theme-colour token pattern (percent, `color:`, name, percent) in theme.css.
- The local App Server (1.18) lags hosted Anvil (attrs, notifications, `<anvil-dropzone>` wrappers): see the template notes.
- Licensed music must never ship here (users export videos): all music and effects are synthesised (VT.MUSIC / VT.SFX).
- **Live view:** the headset renders the preview into its own 640x360 render target (sRGB, no MSAA) ~12 times a second,
  `readRenderTargetPixels` + a row flip into a 2D canvas, `captureStream(12)` -> WebRTC. readPixels stalls the GPU a little:
  keep it small. The canvas track is replaced with `sender.replaceTrack`, and the microphone joins the same way once the
  first Action opens it (no renegotiation). Offers expire after 60 s (StageLink.RTC_TTL).
- **Testing the live view headless:** the flow test opens a popup window at #door (Anvil forbids iframes: frame-ancestors
  'none'; drive.mjs runs Chrome with --disable-popup-blocking), types the code like a headset,
  and waits for `window.VT_LIVE.stats()` (state live, videoWidth > 0, currentTime moving). Two WebGL apps in one headless
  page are slow but work. Hand tracking and controller touch sensors can't run headless: VT.fingerCurls / handFrameXR /
  touchCurls are pure functions (test them with synthetic joints) and need a real Quest session to judge.

- **Face booth:** MediaPipe Face Landmarker 0.10.14 (`@mediapipe/tasks-vision`, the same version Subsudo and Reelstuber
  load) from jsDelivr, model from storage.googleapis.com; GPU delegate with a CPU fallback. Headless Chrome finds the face
  (SwiftShader, ~170 ms a frame) when drive.mjs gets `FAKE_VIDEO=tools/ui/face-cam.mjpeg` (`--use-file-for-fake-video-capture`;
  an MJPEG is just JPEG frames back to back). The fake microphone is a beep, enough to test "record my voice again".
  The booth's dialog awaits nothing long in Python: `booth.begin()` starts the camera + model without handing a promise back.
- Mirror vs anatomy: the camera preview is mirrored (like a mirror), but YOUR left eye drives the CHARACTER's left eye
  (which faces you, so it appears on the right of the character box), the same rule as the VR arms.
- Not checked with a real person on a real webcam yet: the scales in faceFromMeasures (e.g. brow 0.07, smile 0.05, jaw
  0.32 eye-corner units) come from one photo + synthetic moves; retune there if expressions feel too small or too big.

## Privacy & Terms (legal kit)

From `C:/Users/arkvi/Documents/CLAUDE/APP_MAKER/legal-kit`: change `apps/vrtotoon.json`, then there
`python -I build.py vrtotoon && python -I install.py vrtotoon`, then `python tools/assets.py` and deploy.
The facts cover takes (voice + head/hand movement, private unless a picture is shared), face passes (11 numbers a frame;
the camera picture and face points never leave the device; no face recognition; section "Your face"), the headset link,
the microphone, camera (face booth only) and WebXR permissions (passthrough camera never reaches the app), and the kit
provider `mediapipe_face` (jsDelivr + Google). Feedback = Prepsto only ("Submit feedback").
- Client and server modules share ONE Python package: a server module can't share a name with a client package/module.
