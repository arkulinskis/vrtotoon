# VRtoToon

Make cartoons and short films with 3D toon characters, performing every role yourself. Put on a VR headset and your
head, hands and voice drive a character; then play the next role while the first one plays back around you. Direct the
scene on your computer (walks, feelings, gestures, cameras, film looks) and export a video or a Blender kit. Hollywood
themed, browser based, no install. Built on [Anvil](https://anvil.works) as native Anvil Forms; the 3D, VR, timeline and
export engines are JavaScript (three.js r158) in `theme/assets/vt-*.js`.

- **App repo:** github.com/arkulinskis/vrtotoon (branch `master`). Anvil pulls `master`.
- **Live:** https://vrtotoon.anvil.app

## What it does

**The idea: one actor, every role.** A production is a list of *beats* (script lines and action beats). Each beat starts
where the one before it ends, so retaking a line (longer or shorter) ripples everything after it. Walks, feelings,
gestures, looks, camera shots and sound effects hang on beats, so they move with their line. A *take* is one recorded
pass of one role, cut into clips per beat: the speaker's lines (which set the beat lengths) and that character's
reactions during everyone else's lines. You can record roles in any order and retake any single line.

**Who moves what:** where characters walk and stand (blocking) is set on the PC; head, hands, fingers and voice come from
the VR headset (or the desk puppet and the microphone); the **face** comes from the webcam afterwards, in the face booth.

**Landing:** a demo picture plays live in 3D inside a marquee of chasing bulbs; the one-actor relay; how a picture is made
(4 reels); the headset + computer co-work; features; a cast wall (portraits rendered by the engine); FAQ.

**Casting (#casting):** 25 premade toon characters in 5 roles (leads, sidekicks, villains, character actors, creatures)
across 13 species (human, dog, cat, bear, rabbit, fox, frog, robot, ghost, alien, ogre, penguin, dino). Character sheet:
a live turntable (drag to turn), 12 emotions, 21 gestures (6 of them finger work: peace, OK, rock on, count to three, come
here, shush), "Say a line", "Star in a new picture". Every character has toon hands with a thumb and three jointed fingers
(8 hand shapes, any finger pose).

**The wardrobe (#wardrobe): a full character editor.** Start from any actor ("Make my own version"), from scratch (New
character) or from **Surprise me**. A live turntable on one side, six tabs on the other: *Body* (13 species, 6 body shapes,
height, build, head, legs, arms, hands), *Face* (eye size, spacing, height and shape, brows, nose, mouth, ear size, 9 ear
styles, freckles, lashes, rosy cheeks, eye colour), *Hair & hat* (11 hair styles + colour, 14 hats + any hat colour),
*Colours* (skin or fur, second fur, top, trousers, shoes, accent, gloves: suggested swatches or any colour), *Extras* (up
to 6 of 15 accessories, incl. cartoon gloves), *Name & voice* (name, tagline, casting type, voice note, the actor it started
from). A screen test (feelings and gestures) on the turntable, undo/redo, save, save as a copy, delete. Saved characters
are listed under Casting > My wardrobe and can join any cast.

**The Lot (#home):** your pictures as one-sheet posters (saved frame, or the cast), the headset how-to, demos to take apart,
what's playing. **New picture:** title, a template (blank, meet cute, showdown, mystery, space opera, spooky night: a short
script, a set, a film look, a score), the set, the starring cast.

**The director's chair (#edit/<id>):** the 3D stage (film camera with grade + letterbox, or a free director's view with
marks, walk paths and the camera body), a timeline (script row with ripple timing and recorded/estimated beats, a row per
actor with walks, feelings, gestures, looks and recorded clips, camera row, sound row; drag keys to move them, drag a beat's
edge to change its pause or an action beat's length, Ctrl+wheel zoom) and panels:
- *Script:* one row per beat (speaker or ACTION, feeling, words, pause after: overlap to very long), add/move/delete,
  **Record line** (the PC voice booth: microphone, silence trimmed, lip sync from the recording), **Paste a script**
  (`NAME: (feeling) words`, `[ACTION 3s] what happens`; new names join the cast, matched to premade actors).
- *Cast:* screen names, recast, voice effect (radio, robot, echo, megaphone, telephone, cave), Perform, remove, add.
- *Direct:* pick an actor (or click one on the stage); feelings and gestures at the playhead; drag a character on the floor
  to walk / run / sneak / glide / jump-cut there (then face their partner, the camera, a side, or someone); before the first
  line, dragging moves the starting mark; looks (whoever's talking, the camera, someone); a selection card edits the key,
  shot or sound picked on the timeline.
- *Camera:* the **auto-director** (wide openers, close-ups and crash zooms on strong feelings, over-the-shoulder exchanges,
  two-shots, reaction shots, re-establishing wides), or shots by hand: 12 shot types (wide, full, medium, close-up, extreme
  close-up, two-shot, over the shoulder, low, high, dutch, orbit, overhead) x 7 moves (locked, push in, pull out, track,
  crane, handheld, crash zoom). Framing follows the actors and keeps the 180-degree rule. Sound effects at the playhead.
- *Takes:* every kept pass (VR, passthrough, desk puppet, voice), stars, Use (swap a whole take back in), Delete, and
  **Face** (the face booth, below). A take with a face pass shows a *Face* badge and *Redo face*.
- *Look:* the **canvas** (shape tiles drawn to scale: Widescreen 16:9, Reel 9:16 for Instagram Reels / Stories /
  TikTok / Shorts, Instagram square 1:1, Instagram portrait 4:5, CinemaScope 2.39:1, Academy 4:3), 10 sets, 8 film looks
  (Technicolor, clean, noir, golden hour, moonlight, neon, sepia, sitcom pastel), 8 synthesised scores + volume,
  subtitles, opening title / THE END, logline, "use this frame as the poster".
- **Canvases:** picked when you start a picture (the new-picture dialog remembers your last one) and changed any time
  from the Look tab or the badge on the stage. The stage box, the screening room and posters take the shape; the camera
  steps back on tall canvases so faces and two-shots still fit; titles scale to the frame; on reels the editor shades the
  strips Instagram's buttons and caption cover and subtitles stay above them (bigger, up to three rows).
- Top bar: title, autosave (1.5 s after the last change; never undoes a take that arrived from the headset meanwhile),
  undo/redo (also Ctrl+Z), Headset, Share, Export. Other people's demo or shared pictures open as a sandbox
  ("Make my own copy").

**The stage (#stage/<id>[/<actor>]):** full-screen performance. Pick the role and the run of beats; **Action!** gives a
"quiet on set" countdown and a clapper. Your lines advance by voice (the teleprompter moves on when you stop talking) or
with the button; the other characters play their takes (voice + body) or read their lines on the teleprompter for an
estimated time; your reactions are recorded during their lines. Then playback in place: **Print it** (uploads at once),
**Go again**, **Discard**. Modes:
- **VR** (immersive-vr, local-floor): calibrates on your first frame, puts you on your character's mark at your character's
  eye height (the world scales), hides your own head from you, a teleprompter ahead, the director's monitor (the film
  camera, live) to the side, a laser-pointer menu (role, Action, others on/off, Keep / Go again / Next role).
  Controllers: A/X action + next line, B/Y cut or go again, thumbstick switches role. **Fingers:** the controller's touch
  sensors drive them (trigger = index finger, grip = the other fingers, lift the thumb off the buttons = thumbs up).
  **Hand tracking:** put the controllers down and your own hands drive the toon's: wrist and every finger's bend from
  the WebXR hand joints (ring + little finger share the toon's third finger); pinch to press menu buttons.
- **Passthrough** (immersive-ar): your room, the characters in it, the set hidden. No boundary on Quest 3 (unbounded space), so you can walk the whole room while you act; Quest 2 keeps it.
- **Desk puppet** (no headset): the mouse moves a hand (button = fist, F = point, keys 1-8 = open, fist, point, thumbs up,
  peace, OK, rock on, relaxed; Shift + 1-8 for the other hand), A/D head turn, W/S nod, Q/E lean, Space.
- Every take records the finger curls of both hands (4 per hand, 30 times a second); takes from before keep working.
- **Co-work:** the editor's Headset button shows a 4-letter code; on the headset, the stage door (#door) keypad (big keys,
  no I/L/O) opens the picture for 12 hours, no sign-in. The PC sees "Connected: Meta Quest", calls the next take
  ("ROSIE, lines 3 to 5"), sends notes to the teleprompter, and new takes drop into the timeline while you work.
- **Live view:** in the editor, **Watch live** (top bar once the headset is connected, or in the Headset window) opens a
  floating monitor with the headset's picture, live over WebRTC (peer to peer; the Anvil server only passes the offer and
  the answer): *their eyes* (what the performer sees, teleprompter included) or *the film camera*, the headset's microphone
  (sound button), a caption with what's happening (ROLLING, the line), bigger/smaller, stop. The headset shows "Director
  watching". The headset draws the picture at 640 x 360, ~12 frames a second.

**The face booth (Takes > Face): facial expressions from the webcam.** After a take is recorded, open it in front of the
computer's camera: the take replays (the character's recorded body and voice, the other characters' lines during your
reactions, a teleprompter with the line you're on, a 3-2-1 count-in) while you act the face. Google's open-source MediaPipe
Face Landmarker (in the browser; the camera picture never leaves the device) finds 478 points on the face; the booth reads
**25 key points** (eye corners and lids, irises, brows, mouth corners and lips, nose, chin, forehead) in a frame that moves
with the head, compares them with your own neutral face (taken in the first second, or with *Neutral face*) and turns them
into **11 face controls**: each eyelid (winks work), each eyebrow, brow tilt (worried / cross), smile or frown, jaw, mouth
width, a lopsided smirk, and where the eyes look (left/right, up/down). The character copies your face live before you
record. Options: **Record my voice again** (the new voice replaces the take's sound, trimmed to the take, with new lip
sync; on by default when a take has no voice), **Mouth follows the camera** (instead of the voice), **Bigger expressions**
(60-200 %, changeable after recording). Watch it back, then **Print it**; *Remove the face* hands the face back to the
feelings set in the Direct tab. In the film, a face pass drives eyes, brows and mouth (real blinks replace the automatic
ones) while a directed feeling still tints it a little and adds its tears, blush, sweat and pupils. It plays everywhere
the take plays: editor, screenings, the headset, video and the Blender kit. Stored per take as a compact track (11
characters a frame, 30 frames a second) at /_/api/m/<key>-f.

**Exports (all in the browser):** **Export as** any canvas, whatever the picture's own (one picture becomes a reel, a
square post and a widescreen film; only the export is reframed); video (MP4 or WebM, sizes per canvas: 1280 x 720 or
1920 x 1080, 1080 x 1920 or 720 x 1280, 1080 x 1080, 1080 x 1350 ..., grade, titles, optional burned-in
subtitles, the full mix of voices with their effects, music and sound effects; real-time recording with progress),
**Blender kit** (.zip: film.glb with the set, every character as a jointed hierarchy with baked animation down to fingers,
eyelids, brows and mouth, the film camera with cuts as timeline markers and lens changes, the lights; dialogue.wav; subtitles.srt;
film.json; import_vrtotoon.py that imports it, sets fps/range/resolution, plays the dialogue in the sequencer, binds the
camera cuts, animates the lens, switches on Freestyle outlines and Eevee), .glb alone, .srt, a WAV mix, the script.

**Premieres (#premieres) and the screening room (#screen/<key>):** shared pictures (featured first) as posters; the film
plays live in 3D between velvet curtains with controls (play, scrub, sound, subtitles, full screen); cast, credits, copy
link, open in the studio, report.

**Admin:** overview (members, pictures, takes, shared films), **Films** (feature, unshare, clear reports), feedback inbox
(film reports), users, demo data.

**Demo content:** three voiced pictures (The Big Break, Showdown at Dusty Gulch, The Case of the Missing Popcorn) with
blocking, feelings, gestures, shots and effects; their 20 lines were voiced with Kokoro (open-source TTS) into
`theme/assets/dv-*.mp3` by `tools/make_demo_voices.py`.

## Setting it up in Anvil (once)

1. Anvil editor: **Create app → Clone from GitHub**, paste `https://github.com/arkulinskis/vrtotoon`.
2. Check the **Users** service (email + password, Continue with Google, sign-up on).
3. Accept the **Schema Mismatch** alert with **"The schema of the source code is correct"**.
4. Run it, sign up with the admin email first, then **Publish**.

<!-- libraries:start -->
## Libraries and outside services

What this project uses besides its own code. Generated by `APP_MAKER/tools/libraries.py`; to change it, edit `APP_MAKER/libraries/catalog.py` and re-run the script.

| Name | How it gets in | Used here for |
|---|---|---|
| [three.js](https://threejs.org) r158 | Copied into the app | the toon cast, the sets, the film player, the VR performance stage and the glTF export |
| [MediaPipe vision tasks](https://ai.google.dev/edge/mediapipe/solutions/guide) 0.10.14 | Loaded from a CDN | Face Landmarker: the face booth reads the webcam face (478 points, 25 key points) to drive the character's eyes, brows and mouth |
| [YouTube embeds](https://developers.google.com/youtube/player_parameters) | Outside web service | Plays a YouTube video inside the page (the privacy-friendlier youtube-nocookie address). |
| [Google Fonts](https://fonts.google.com) | Loaded from a CDN | Bebas Neue, DM Sans, Playfair Display |

**Built into the browser:** Canvas 2D, WebGL, WebXR, Web Audio API, Camera, microphone and screen, MediaRecorder, WebRTC, localStorage, Clipboard, File downloads (Blob), Fullscreen.

**Anvil platform:** Anvil, Anvil Data Tables, Anvil JS bridge (anvil.js), Anvil Users, Anvil Google service.

**Build and test tools (not shipped):** Kokoro text-to-speech, NumPy, Node.js, Headless Chrome (DevTools Protocol), PyYAML, imageio-ffmpeg (MP3s of the demo films' Kokoro voices (tools/make_demo_voices.py)), soundfile.

<!-- libraries:end -->

## Working on it

See `.claude/skills/vrtotoon/SKILL.md`. In short:

```
python tools/check.py                    # Anvil's validator, JS syntax, asset hashes, server tests, face maths -> ALL CHECKS PASSED
python -I tools/ui_test.py               # the real app in the Anvil App Server (Docker) driven by headless Chrome
python -I tools/ui_test.py --shots DIR   # + screenshots of every page (desktop/phone, light/dark, guest/member)
python tools/make_demo_voices.py         # after changing the demo films' lines (Kokoro)
git push origin master                   # deploy
```

## Project layout

```
client_code/    startup.py, router.py, state.py, auth.py, legal.py, vt.py (the door to the engines)
                Layouts/Shell; Pages/ Landing Auth Home Casting Wardrobe Premieres Screen Edit Stage Door Profile Admin
                Components/ Portrait FilmPlayer Turntable StageView TimelineView PerformView LiveMonitor Slider ColorPick CanvasPicker
                Items/ NavLink CastCard ProductionCard Chip BeatRow CastRow TakeRow ShotRow KeyButton FilmRow Swatch CanvasTile FeedbackRow UserRow
                Dialogs/ NewProduction CharacterSheet CastPicker ImportScript HeadsetLink Export Share VoiceBooth FaceBooth
server_code/    common.py, Accounts.py, Productions.py, Takes.py, StageLink.py, Wardrobe.py, Screenings.py (+ /_/api/m/<key>),
                Admin.py, Feedback.py, DemoData.py, demo_films.py, demo_voice_lengths.py, SchemaCheck.py, legal_server.py
theme/assets/   three.min.js; vt-cast.js (characters) vt-sets.js (sets, looks, sound) vt-film.js (the film model)
                vt-stage.js (player/editor stage) vt-xr.js (VR performance, hands, preview) vt-live.js (live view)
                vt-face.js (the face booth: webcam face tracking, key points -> face controls) vt-timeline.js vt-export.js vt-ui.js vt-ed.js;
                app.css + vt.css, icons.css (generated), app-kit.js, theme.css (spinner), icon.svg + PNGs, dv-*.mp3 (demo voices)
tools/          check.py, assets.py, make_demo_voices.py, ui_test.py + ui/ (flow, phone, admin, seed, face-cam.mjpeg = the fake
                webcam's face), live/drive.mjs (FAKE_VIDEO), testing/ (test_server.py, face_math.js + face_points.json)
```
