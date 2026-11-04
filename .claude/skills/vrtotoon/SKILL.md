---
name: vrtotoon
description: Context, workflow and recipes for VRtoToon (folder vrtotoon), the user's Anvil app built as native Anvil Forms (Python + HTML templates, a layout, custom components, RepeatingPanels) with three.js engines. A Hollywood-themed cartoon/movie studio where one person performs every role with a VR headset (head, hands, voice) or a desk puppet, directs on the PC (walks, feelings, cameras) and exports video or a Blender kit. Load this before any feature request, bug fix, restyle, content change or deploy for this app.
---

# VRtoToon: working on the app

**What it is:** a browser cartoon studio (a better Flipside XR). Members cast 3D toon characters (25 premade + wardrobe
variants), write or paste a script, perform each role in VR / passthrough / as a desk puppet (head + hands + voice; the
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
passthrough; export as video and as a 3D format for Blender; looks great before Blender.
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
   Anvil App Server (container `vrtotoon-dev`); headless Chrome (SwiftShader WebGL, fake microphone) walks tools/ui/flow.js
   (visitor pages, sign-up, new picture, every editor panel, voice booth, a desk-puppet pass on the stage, headset link,
   .glb export, share, stage door), phone.js (390 px, every page) and admin.js. Server edits need `--restart`.
   `--shots DIR` = screenshots of every page (seed.js makes an account and a picture). Read them.
5. Commit as arkulinskis with the Co-Authored-By line; `git push origin master`. New tables/columns: Schema Mismatch step.

## Architecture

```
anvil.yaml        head_html loads three.min.js + vt-cast, vt-sets, vt-film, vt-stage, vt-timeline, vt-xr, vt-export, vt-ui, vt-ed
                  (+ app.css, vt.css); tables: productions, takes, characters, stage_links (+ template tables)
client_code/
  vt.py           THE door to window.VT: catalogues, portraits, new_doc_json, doc()/takes() engine objects, row lists (JSON)
                  for panels (VT.ed.*), NULL (a typed "nothing yet" for JS objects: the validator rejects attr-on-None)
  router.py       PAGES, NAV (Lot, Casting, Premieres, Headset), GUEST_NAV, CHROMELESS {stage, door}; calls page.leave()
  Layouts/Shell   marquee brand "VR<em>to</em>Toon"; classes no-chrome (stage, door) and wide-page (edit)
  Pages/          Landing (FilmPlayer hero), Home (the Lot), Casting, Premieres, Screen, Edit (the director's chair),
                  Stage (performance), Door (headset keypad), Auth, Profile, Admin (+ Films tab)
  Components/     Portrait (img from VT.portrait), FilmPlayer (VT.Stage film/hero + VT.controls), Turntable (VT.Stage
                  turntable), StageView (VT.Stage edit; events select/place), TimelineView (VT.Timeline; event select),
                  PerformView (VT.Perform; events state/kept)
  Items/          CastCard ProductionCard Chip BeatRow CastRow TakeRow ShotRow KeyButton FilmRow (+ template ones)
  Dialogs/        NewProduction CharacterSheet Wardrobe CastPicker ImportScript HeadsetLink Export Share VoiceBooth
server_code/      Productions (lot_home, new/get/save(merge)/copy/share/poster/logline/delete), Takes (save_take shared with
                  StageLink, list/star/delete), StageLink (link, join, get, poll, save_pass, status, call, note),
                  Wardrobe, Screenings (premieres_list, screen_get, screen_report, /_/api/m/<key>-m|-a media endpoint),
                  DemoData + demo_films.py + demo_voice_lengths.py, Admin (+ films), Feedback (+ record), Accounts, common
theme/assets/     vt-cast.js    characters: VT.CAST (25, ids never change), species builder, face rig, IK arms, legs,
                                VT.EMOTIONS (12), VT.GESTURES (15), VT.proceduralPose, VT.portrait, VT.makeDef (variants)
                  vt-sets.js    VT.SETS (10, ids never change), VT.buildSet, VT.GRADES (8), VT.ASPECTS, VT.SFX (14), VT.MUSIC (8)
                  vt-film.js    VT.Doc (undo/redo, ops), layout (ripple), VT.Film (place/walk, emotion, gesture, look, perform,
                                mouth, camera shots), VT.autoDirect, VT.parseScript / applyScript, VT.TEMPLATES, voiceChain
                  vt-stage.js   VT.Stage (render loop, grade post pass, letterbox, titles/subtitles, audio mix, editor input,
                                turntable), VT.scheduleAudio, VT.drawTitles
                  vt-xr.js      VT.Perform (passes, VR/AR sessions, calibration, HUD: teleprompter, monitor, laser menu, desk puppet)
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
- **Media:** takes' motion JSON and audio are served at `/_/api/m/<take key>-m|-a` (random per take); the client builds URLs
  with `VT.API` (set in startup from `get_api_origin()`). Demo takes have `asset` = a theme file instead.
- **Test hooks:** `window.VT_EDITOR = {doc, stage, takes, pid}` (Edit), `window.VT_PERFORM` (Stage), `window.VT_TEST =
  {lineSecs, speed}` (a pass treats each of your lines as N seconds of speech).
- **Validator patterns:** an `anvil:name` on a template's ROOT element is invisible to it (wrap the root in a div); JS objects
  that start empty use `vt.NULL`, not None; avoid `x = call() if a else {literal dict}` (union types): return early instead;
  `anvil.js.new(window.Blob, [...], {...})` instead of calling `window.Blob(...)`.

## Recipes

- **New premade character:** a row in `VT.CAST` (vt-cast.js): {id, name, role, tag, species, build, colors, hair, hat, acc,
  voice}. Ids are referenced by productions: never rename. New species: a branch in `Actor` (proportions), `_buildHead`.
- **New hat / hair / accessory:** `_buildHat` / `_buildHair` / `_buildFaceAcc` or `_buildBody`, plus `VT.HATS/HAIRS/ACCS`.
- **New emotion / gesture:** `VT.EMOTIONS` (face params) / `VT.GESTURES` + a `case` in `VT.proceduralPose`.
- **New set:** a row in `VT.SETS` (vt-sets.js) with light, marks (5) and build(api) (api.box/cyl/sph/cone/floor/backdrop/
  sign/bulbs/lightCone/particles, `api.anim.push(fn(t))`). Keep the acting area x -3..3, z -2..2 clear.
- **New shot type / move:** `VT.SHOTS` / `VT.MOVES` + a case in `Film.camera`; the auto-director is `VT.autoDirect`.
- **New film look:** `VT.GRADES` (sat, con, exp, tint, vig, grain, bw).
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

## Privacy & Terms (legal kit)

From `C:/Users/arkvi/Documents/CLAUDE/APP_MAKER/legal-kit`: change `apps/vrtotoon.json`, then there
`python -I build.py vrtotoon && python -I install.py vrtotoon`, then `python tools/assets.py` and deploy.
The facts cover takes (voice + head/hand movement, private unless a picture is shared), the headset link, the microphone and
WebXR permissions (passthrough camera never reaches the app). Feedback = Prepsto only ("Submit feedback").
- Client and server modules share ONE Python package: a server module can't share a name with a client package/module.
