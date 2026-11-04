/* The main user journey, run inside the real app (Anvil App Server) by tools/ui_test.py through tools/live/drive.mjs.
   Resolves to {ok, log}. Keep log lines ASCII (the Windows console).
   Visitor: landing (the 3D hero plays), premieres, the screening room, casting + a screen test. Member: sign up, a new
   picture, the editor (script, cast, direct, camera, takes, look, autosave), the voice booth, the performance stage
   (a desk-puppet pass, kept and saved), the headset link, exports, sharing, the stage door, profile, theme, sign out. */
(async function () {
  const log = [], t0 = Date.now();
  const say = (m) => log.push(((Date.now() - t0) / 1000).toFixed(1) + 's ' + m);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, what, ms) {
    const end = Date.now() + (ms || 20000);
    while (Date.now() < end) { try { const v = fn(); if (v) return v; } catch (e) {} await sleep(150); }
    throw new Error('timed out waiting for: ' + what);
  }
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const vis = (e) => !!(e && e.getClientRects().length);
  const btn = (scope, text) => $$(scope + ' button').find((b) => vis(b) && b.textContent.trim().replace(/\s+/g, ' ') === text);
  async function click(scope, text) {
    const el = await until(() => btn(scope, text), scope + ' "' + text + '"');
    el.scrollIntoView({ block: 'center' }); el.click(); return el;
  }
  function type(input, value) {
    input.focus(); input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function pick(select, label) {  // Anvil DropDowns: choose by the visible label (option values are internal)
    const i = Array.from(select.options).findIndex((o) => o.textContent.trim().startsWith(label));
    if (i < 0) throw new Error('no option ' + label);
    select.selectedIndex = i; select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  async function page(hash, ready, what) {
    if (location.hash !== hash) window.UI_READY = false;
    location.hash = hash;
    await until(() => window.UI_READY && location.hash === hash && ready(), what || hash, 40000);
    await sleep(300);
  }
  const ok = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); say('ok   ' + msg); };
  const toastText = () => $$('.anvil-notification, [data-notify="container"]').map((n) => n.textContent).join(' | ');

  try {
    // ---- visitors: the landing page, the hero film plays
    await page('#landing', () => $('.lp-hero .vt-stage canvas'), 'landing');
    ok($('.lp-hero a[href="#auth/signup"]'), 'landing: hero with a sign-up link');
    ok($$('.lp-castwall .cast-card').length === 12, 'landing: the cast wall (12 portraits)');
    ok($$('.lp-castwall img.vt-portrait').every((i) => /^data:image\/png/.test(i.src)), 'landing: portraits are rendered by the 3D engine');

    // ---- premieres + the screening room
    await page('#premieres', () => $$('.prod-card').length >= 3, 'premieres');
    ok($$('.prod-card').length >= 3, 'premieres: the three demo pictures');
    await page('#screen/demo-bigbreak', () => $('.screen-frame .vt-stage canvas') && $('.vt-big'), 'screening room');
    ok(/The Big Break/.test($('.page-screen').textContent), 'screen: title');
    $('.vt-big').click();
    await until(() => /^0:0[1-9]/.test(($('.vt-time') || {}).textContent || ''), 'film clock running', 15000);
    ok(true, 'screen: the film plays (the clock runs)');
    $('.vt-bar .vt-b').click();  // pause

    // ---- casting: every character, a screen test
    await page('#casting', () => $$('.page-casting .cast-card').length >= 25, 'casting');
    ok($$('.page-casting .cast-card').length === 25, 'casting: 25 characters');
    await page('#casting/villain', () => $$('.page-casting .cast-card').length === 4, 'villains');
    ok(true, 'casting: the role filter (4 villains)');
    $('.page-casting .cast-card').click();
    await until(() => $('.char-sheet .vt-stage canvas'), 'character sheet');
    await click('.char-sheet', '😠 Angry');
    await click('.char-sheet', '👋 Wave');
    ok(true, 'casting: the character sheet turntable acts out a feeling and a gesture');
    await click('.char-sheet', 'Close');
    await until(() => !$('.char-sheet'), 'sheet closed');

    // ---- members-only page sends visitors to sign in, then back
    await page('#profile', () => true);
    await until(() => window.UI_READY && $$('.au-card input').length >= 2, 'redirected to sign in');
    ok(true, 'a members-only page asks visitors to sign in');
    await click('.au-card .ui-seg', 'Create account');
    await until(() => $$('.au-card input').filter((i) => i.offsetParent).length >= 3, 'sign-up form');
    const inputs = $$('.au-card input[type=text], .au-card input[type=email], .au-card input[type=password]').filter((i) => i.offsetParent);
    type(inputs[0], 'Flow Tester'); type(inputs[1], 'flow' + Date.now() + '@example.com'); type(inputs[2], 'Hb-' + Math.random().toString(36).slice(2) + '-Kq7');
    const tick = $('.au-card input[type=checkbox]'); if (tick && !tick.checked) tick.click();
    await click('.anvil-role-btn-block', 'Create account');
    await until(() => location.hash === '#profile' && window.UI_READY && $('.pf-grid'), 'back on the page they wanted', 40000);
    ok(true, 'sign-up: signed in and sent on to the page they asked for');

    // ---- the character editor (#wardrobe): from a character sheet, a full edit, undo/redo, saved, opened again
    ok(VT.buildActor(VT.CAST[0]).arms.r.H.f.length === 3 && VT.HAND_SHAPES.length === 8, 'hands: a thumb and three fingers, eight hand shapes');
    await page('#casting', () => $$('.page-casting .cast-card').length >= 25, 'casting (member)');
    $('.page-casting .cast-card').click();
    await until(() => $('.char-sheet .vt-stage canvas'), 'character sheet (member)');
    await click('.char-sheet', 'Make my own version');
    await until(() => /^#wardrobe\/new\//.test(location.hash) && window.UI_READY && $('.page-wardrobe .vt-stage canvas'), 'character editor', 30000);
    ok(/my cut/.test($('.anvil-role-wdp-name').textContent), 'wardrobe: a new character starts from the actor ("my cut")');
    const onChips = () => $$('.page-wardrobe .anvil-role-chip.anvil-role-on button').map((b) => b.textContent);
    await click('.page-wardrobe', '\u{1F431} Cat');
    await until(() => onChips().some((t) => /Cat/.test(t)), 'species: cat');
    const rng = $$('.page-wardrobe .sl-input').filter(vis)[0];
    rng.value = '1.2'; rng.dispatchEvent(new Event('input', { bubbles: true })); rng.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => /120%/.test($$('.page-wardrobe .anvil-role-sl-value').filter(vis)[0].textContent), 'height 120%');
    ok(true, 'wardrobe: species chips and body sliders');
    await click('.wdp-tabs', 'Face');
    $$('.page-wardrobe .wdp-checks input[type=checkbox]').filter(vis)[0].click();
    await click('.page-wardrobe', 'Floppy');
    await until(() => onChips().some((t) => /Floppy/.test(t)), 'ears: floppy');
    await click('.wdp-tabs', 'Extras');
    await click('.page-wardrobe', 'Cartoon gloves');
    await until(() => onChips().some((t) => /Cartoon gloves/.test(t)), 'gloves on');
    $('.wdp-tools .anvil-role-ic-undo button').click();
    await until(() => !onChips().some((t) => /Cartoon gloves/.test(t)), 'undo takes the gloves off');
    $('.wdp-tools .anvil-role-ic-redo button').click();
    await until(() => onChips().some((t) => /Cartoon gloves/.test(t)), 'redo puts them back');
    ok(true, 'wardrobe: face switches, ears, accessories, undo and redo');
    await click('.wdp-tabs', 'Colours');
    $$('.page-wardrobe .anvil-role-swatch button').filter(vis)[4].click();
    await until(() => $$('.page-wardrobe .anvil-role-swatch.anvil-role-on').filter(vis).length >= 3, 'a swatch picked');
    await click('.wdp-tabs', 'Name & voice');
    const nb2 = $$('.page-wardrobe .wdp-part input').filter(vis)[0];
    type(nb2, 'Whiskers Marquee'); nb2.dispatchEvent(new Event('blur')); nb2.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await until(() => /Whiskers Marquee/.test($('.anvil-role-wdp-name').textContent), 'name');
    await click('.wdp-foot', 'Hang it in the wardrobe');
    await until(() => location.hash === '#casting/wardrobe' && window.UI_READY && $$('.page-casting .cast-card').length === 1, 'saved to the wardrobe', 30000);
    ok(/Whiskers Marquee/.test($('.page-casting .cast-card').textContent), 'wardrobe: the new character is in My wardrobe');
    $('.page-casting .cast-card').click();
    await until(() => $('.char-sheet .vt-stage canvas'), 'sheet of my character');
    await click('.char-sheet', 'Edit in the wardrobe');
    await until(() => /^#wardrobe\/c_/.test(location.hash) && window.UI_READY && $('.page-wardrobe .vt-stage canvas'), 'editor with my character', 30000);
    ok(btn('.wdp-foot', 'Delete') && /Whiskers/.test($('.anvil-role-wdp-name').textContent) && onChips().some((t) => /Cat/.test(t)), 'wardrobe: a saved character opens again as it was');

    // ---- the Lot + a new picture
    await page('#home', () => $('.lot-head .anvil-role-ic-clapper button'), 'the Lot');
    ok($('.lot-empty') && vis($('.lot-empty')), 'lot: the empty state for a new member');
    $('.lot-head .anvil-role-ic-clapper button').click();
    type(await until(() => $('.new-prod input'), 'new picture dialog'), 'The Pie Heist');
    pick($$('.new-prod select')[0], 'Showdown');
    await sleep(400);
    ok($$('.new-prod .cast-card').length === 2, 'new picture: the template shows its cast');
    await click('.new-prod', 'Roll camera');
    await until(() => /^#edit\//.test(location.hash) && window.UI_READY && window.VT_EDITOR && $('.ed-stage-wrap canvas'), 'editor', 60000);
    const E = window.VT_EDITOR, D = () => E.doc.d;
    const pid = location.hash.split('/')[1];
    ok(D().set === 'western' && D().cast.length === 2, 'editor: the showdown template (western set, two actors)');
    ok($$('.beat-row').length === D().beats.length, 'script: one row per beat');

    // script: add a line, write it
    const n0 = D().beats.length;
    await click('.ed-part', 'Add a line');
    await until(() => $$('.beat-row').length === n0 + 1, 'line added');
    const ta = $$('.beat-row textarea').pop();
    type(ta, 'Nobody steals pie in my town.'); ta.dispatchEvent(new Event('blur')); ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await until(() => D().beats[D().beats.length - 1].text === 'Nobody steals pie in my town.', 'line text saved to the doc');
    ok(true, 'script: add a line and write it');

    // cast tab
    await click('.ed-tabs', 'Cast');
    await until(() => $$('.cast-row').length === 2, 'cast rows');
    ok($$('.cast-row img')[0].src.startsWith('data:image'), 'cast: rows with portraits');

    // direct: a feeling and a gesture at the playhead, a walk by dragging (onPlace)
    E.stage.seek(3.2);
    await click('.ed-tabs', 'Direct');
    const emo0 = D().keys.emo.length, act0 = D().keys.act.length, mv0 = D().keys.move.length;
    await click('.ed-part', '😲 Surprised');
    await click('.ed-part', '👉 Point');
    ok(D().keys.emo.length === emo0 + 1 && D().keys.act.length === act0 + 1, 'direct: feeling + gesture keys at the playhead');
    E.stage.o.onPlace(D().cast[0].id, 0.4, 0.8);
    await until(() => D().keys.move.length === mv0 + 1, 'walk key');
    ok(/walks there/.test($('.anvil-role-ed-hint').textContent), 'direct: dragging on the stage makes a walk');

    // the timeline selects a key; the selection card edits it
    E.stage.seek(0.2);
    const key = D().keys.emo[D().keys.emo.length - 1];
    $('.vt-tl canvas'); // the timeline exists
    ok($('.vt-tl canvas') && $('.vt-tl canvas').height > 100, 'timeline: drawn');

    // camera: auto-direct
    await click('.ed-tabs', 'Camera');
    const firstShot = D().shots.length ? D().shots[0].id : '';
    await click('.ed-part', 'Auto-direct');
    await click('.anvil-modal-content', 'Auto-direct');
    await until(() => D().shots.length >= 3 && D().shots[0].id !== firstShot && $$('.shot-row').length === D().shots.length, 'new shots');
    ok(D().shots.length === $$('.shot-row').length, 'camera: the auto-director cuts the scene');

    // look: grade + aspect
    await click('.ed-tabs', 'Look');
    pick($$('.ed-part select').filter(vis)[1], 'Film noir');
    await until(() => D().look.grade === 'noir', 'grade');
    ok(true, 'look: film look changes');

    // autosave
    await until(() => /^Saved$/.test($('.anvil-role-ed-status').textContent.trim()), 'autosave', 20000);
    ok(true, 'editor: autosaves');

    // undo / redo
    const g = D().look.grade;
    $('.anvil-role-ic-undo button').click();
    await until(() => D().look.grade !== g, 'undo');
    await sleep(1200);
    $('.anvil-role-ic-redo button').click();
    await until(() => D().look.grade === g, 'redo');
    ok(true, 'editor: undo and redo');

    // the voice booth (the fake microphone)
    await click('.ed-tabs', 'Script');
    $$('.beat-row .anvil-role-ic-mic button')[0].click();
    await until(() => $('.voice-booth'), 'voice booth');
    await click('.voice-booth', 'Record');
    await sleep(1800);
    await click('.voice-booth', 'Stop');
    await until(() => { const b = btn('.voice-booth', 'Print it'); return b && !b.disabled; }, 'recorded', 15000);
    await click('.voice-booth', 'Print it');
    await until(() => !$('.voice-booth') && E.takes.list().length === 1, 'take saved', 20000);
    ok(Object.keys(D().sel).length === 1, 'voice booth: a recorded line goes into the cut');

    // takes tab
    await click('.ed-tabs', 'Takes');
    await until(() => $$('.take-row').length === 1, 'take row');
    ok(/In the cut/.test($('.take-row').textContent), 'takes: the take is listed as in the cut');
    await until(() => /^Saved$/.test($('.anvil-role-ed-status').textContent.trim()), 'saved before leaving', 20000);

    // ---- the performance stage: a desk-puppet pass
    window.VT_TEST = { lineSecs: 0.9, speed: 1 };
    await page('#stage/' + pid, () => $('.vt-perform canvas') && window.VT_PERFORM, 'stage');
    await until(() => /Ready/.test($('.anvil-role-st-state').textContent), 'stage ready label', 15000).catch(function () { say('state label: ' + $('.anvil-role-st-state').textContent + ' perform state ' + window.VT_PERFORM.state); });
    ok(/Ready/.test($('.anvil-role-st-state').textContent), 'stage: ready, desk-puppet mode');
    const P = window.VT_PERFORM;
    P.setRange(D().beats[0].id, D().beats[2].id);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit5', key: '5' }));  // the desk puppet's hand: peace sign
    await click('.st-bar', 'Action!');
    await until(() => P.state === 'review', 'the pass ends in playback', 60000);
    ok(P.pass && P.pass.clips.length === 3, 'stage: the pass is cut into one clip per beat');
    const mo = P.pass.motion, mid = Math.floor(mo.n / 2) * mo.k;
    ok(mo.k === 31 && mo.f.length === mo.n * 31, 'fingers: a take records 31 numbers per frame (4 finger curls per hand)');
    ok(Math.abs(mo.f[mid + 27] - 0.85) < 0.01 && mo.f[mid + 28] === 0 && mo.f[mid + 29] === 0 && mo.f[mid + 30] === 1, 'fingers: key 5 records a peace sign');
    const smp = VT.sampleMotion(mo, mo.n / 2 / mo.fps);
    ok(smp.r.c && smp.r.c[1] === 0 && smp.r.c[3] === 1, 'fingers: playback reads the curls back');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit5', key: '5' }));  // back to relaxed
    await click('.st-bar', 'Print it');
    await until(() => /Printed/.test(toastText()), 'saved toast', 30000);
    ok(true, 'stage: Print it saves the take');
    window.VT_TEST = {};

    // ---- back in the editor: the take is there; the headset link; exports; share
    await page('#edit/' + pid, () => window.VT_EDITOR && window.VT_EDITOR.pid && $('.ed-stage-wrap canvas'), 'editor again');
    await until(() => window.VT_EDITOR.takes.list().length === 2, 'two takes');
    ok(true, 'editor: the stage take arrived');

    // ---- the face booth: replay the desk-puppet take in front of the webcam (drive.mjs: FAKE_VIDEO = a real face photo)
    await click('.ed-tabs', 'Takes');
    await until(() => $$('.take-row').length === 2, 'two take rows');
    const deskRow = () => $$('.take-row').find((r) => /Desk puppet/.test(r.textContent));
    ok(deskRow() && !/Redo face/.test(deskRow().textContent), 'face: the desk-puppet take has a Face button');
    Array.from(deskRow().querySelectorAll('button')).find((b) => b.textContent.trim() === 'Face').click();
    await until(() => $('.face-booth') && window.VT_FACE, 'face booth');
    await until(() => window.VT_FACE.stats().found, 'the face tracker finds the face (MediaPipe from jsDelivr)', 120000);
    let fst = window.VT_FACE.stats();
    ok(fst.points === 478 && fst.keyPoints >= 10, 'face: the tracker finds 478 points; the booth reads ' + fst.keyPoints + ' key points');
    await until(() => window.VT_FACE.stats().neutral, 'neutral face taken', 20000);
    await until(() => /Face found/.test($('.face-booth .fb-tag').textContent), 'camera tag');
    fst = window.VT_FACE.stats();
    ok(Math.abs(fst.live.curve - 0.15) < 0.3 && fst.live.lidL < 0.5 && fst.live.lidR < 0.5 && fst.live.open < 0.3, 'face: a relaxed face reads as relaxed (' +
      ['lidL', 'lidR', 'curve', 'open'].map((k) => k + ' ' + fst.live[k].toFixed(2)).join(', ') + ')');
    // the 25 key points move the right controls: a smile and a wink made from the real face's points
    const lm = window.VT_FACE.pts.map((p) => ({ x: p.x, y: p.y, z: p.z })), FP = VT.FACE_POINTS, neu = window.VT_FACE.neutralM;
    const iod = Math.hypot((lm[FP.lOut].x - lm[FP.rOut].x) * 4 / 3, lm[FP.lOut].y - lm[FP.rOut].y);
    const sm = lm.map((p) => ({ ...p })); sm[FP.mR].y -= 0.05 * iod; sm[FP.mL].y -= 0.05 * iod; sm[FP.rUp].y = sm[FP.rLo].y;
    const fo = VT.faceFromMeasures(VT.faceMeasure(sm, 4 / 3), neu, null);
    ok(fo.curve > 0.7 && fo.lidR > 0.9 && fo.lidL < 0.4, 'face: corners up = smile, one eyelid down = a wink of that eye only');
    ok(VT_FACE.stats().lines >= 3, 'face: the teleprompter has the take\'s lines');
    window.VT_TEST = { faceLead: 0.4 };
    const vchk = $$('.face-booth input[type=checkbox]')[0];
    if (!vchk.checked) vchk.click();  // record my voice again
    await click('.face-booth', 'Record the face');
    await until(() => window.VT_FACE.state === 'rec', 'recording', 15000);
    await until(() => ($('.face-booth .fb-prompt').textContent || '').length > 3, 'teleprompter line', 10000);
    ok(true, 'face: recording, the teleprompter shows the line');
    await until(() => window.VT_FACE.state === 'review', 'the take plays to its end', 90000);
    fst = window.VT_FACE.stats();
    say('booth: ' + JSON.stringify({ face: fst.face, voice: fst.voice, state: fst.state, status: $('.face-booth .anvil-role-fb-status').textContent }));
    ok(fst.face && fst.face.n > 20 && fst.face.vm && fst.voice, 'face: ' + fst.face.n + ' frames of face kept, with the new voice and its lip sync');
    await click('.face-booth', 'Watch it back');
    await until(() => window.VT_FACE.state === 'play', 'watching back');
    await click('.face-booth', 'Stop watching');
    await until(() => window.VT_FACE.state === 'review', 'stopped watching');
    await click('.face-booth', 'Print it');
    await until(() => !$('.face-booth') && /Printed! The face plays/.test(toastText()), 'face saved', 40000);
    const dtk = window.VT_EDITOR.takes.list().find((x) => x.source === 'desk');
    ok(dtk.face && dtk.face.n === fst.face.n && /-f$/.test(dtk.faceUrl || ''), 'face: the take carries the face track and its new address');
    await until(() => deskRow() && /Redo face/.test(deskRow().textContent), 'row redrawn');
    ok(vis(deskRow().querySelector('.anvil-role-badge-brand')), 'face: the take row shows the Face badge');
    const film = window.VT_EDITOR.stage.film, fc = dtk.clips[0], fb = film.L.by[fc.beat], tt = fb.start + Math.min(0.3, fb.dur / 2);
    const cfx = film.camFace(dtk.actor, tt, film.L.beatAt(tt));
    const pose = film.actorAt(window.VT_EDITOR.stage.actors[dtk.actor], dtk.actor, tt, { actors: window.VT_EDITOR.stage.actors }).pose;
    ok(cfx && pose.face.lidL != null && pose.face.cam > 0.99 && pose.blink === 0, 'face: the film plays the camera face (eyes, brows, mouth) instead of the set feeling');
    say('urls: ' + dtk.faceUrl + ' | ' + dtk.motionUrl + ' | ' + dtk.audioUrl);
    const fres = await fetch(dtk.faceUrl), ftxt = await fres.text();
    say('face fetch: ' + fres.status + ' ' + ftxt.slice(0, 120));
    const stored = JSON.parse(ftxt);
    ok(stored.n === fst.face.n && stored.k === 11 && stored.s.length === stored.n * 11 && stored.vm, 'face: the server serves the same face track back');
    const au = await fetch(dtk.audioUrl);
    ok(au.ok && /wav/.test(au.headers.get('content-type') || ''), 'face: the new voice replaced the take\'s sound (WAV, trimmed to the take)');
    // a fresh editor loads the take's recordings back from the server (motion, voice and face)
    await page('#home', () => true, 'home');
    await page('#edit/' + pid, () => window.VT_EDITOR && window.VT_EDITOR.pid && $('.ed-stage-wrap canvas'), 'editor reloaded');
    await until(() => { const x = window.VT_EDITOR.takes.list().find((y) => y.source === 'desk'); return x && x.face && x.face.n === fst.face.n && x.motion && x.motion.n > 0 && x.buffer; }, 'recordings loaded from the server', 30000);
    ok(true, 'face: a fresh editor loads the motion, voice and face of the take from the server');
    window.VT_TEST = {};

    await click('.ed-actions', 'Headset');
    const code = await until(() => { const l = $('.anvil-role-door-code-big'); return l && l.textContent.replace(/\s/g, '').length === 4 && l.textContent; }, 'headset code');
    ok(/^[A-Z ]+$/.test(code.trim()), 'headset: a 4-letter stage door code');
    await click('.headset-link', 'Send to the headset');
    await until(() => /Called/.test(toastText()), 'call sent');

    // ---- the live view: a second window plays the headset (types the stage door code), the editor watches it over WebRTC.
    // (A popup, not an iframe: Anvil sends frame-ancestors 'none'. drive.mjs runs Chrome with --disable-popup-blocking.)
    await click('.headset-link', 'Watch the headset live');
    await until(() => vis($('.vt-live')) && window.VT_LIVE, 'live window rings');
    ok(/Ringing|Connecting/.test($('.vt-live').textContent), 'live view: the editor rings the headset');
    const hw = window.open(location.href.split('#')[0] + '#door', 'vtheadset', 'width=700,height=520');
    ok(hw, 'live view: a second window opens (the headset)');
    const fr = { remove: () => hw.close() };
    const fw = () => hw, fdoc = () => hw.document;
    await until(() => fw().UI_READY && fdoc().querySelectorAll('.anvil-role-door-key button').length >= 23, 'headset window: stage door', 90000);
    for (const ch of code.replace(/\s/g, '')) Array.from(fdoc().querySelectorAll('.door button')).find((b) => b.textContent.trim() === ch).click();
    await until(() => /^#stage\//.test(fw().location.hash) && fw().VT_PERFORM && fdoc().querySelector('.vt-perform canvas'), 'headset window: the stage opens', 90000);
    ok(true, 'live view: the headset window opened the stage with the code');
    await until(() => { const s = window.VT_LIVE.stats(); return s.state === 'live' && s.w > 0; }, 'the live picture arrives', 90000);
    const t1 = window.VT_LIVE.stats().t;
    await until(() => window.VT_LIVE.stats().t > t1 + 0.5, 'the picture keeps moving', 20000);
    ok(/Live from the headset/.test($('.vt-live').textContent) && fw().VT_PERFORM.previewFrames() > 5, 'live view: the headset picture plays in the editor (WebRTC)');
    await click('.vt-live', 'Film camera');
    await until(() => fw().VT_PERFORM._pv && fw().VT_PERFORM._pv.view === 'film', 'the headset switches to the film camera', 15000);
    ok(true, 'live view: switching to the film camera reaches the headset');
    await until(() => vis(fdoc().querySelector('.anvil-role-st-live')), 'the headset shows "Director watching"', 15000);
    ok(true, 'live view: the headset shows that the director is watching');
    $('.vt-live .anvil-role-ic-x button').click();
    await until(() => !vis($('.vt-live')), 'live window closed');
    fr.remove();
    ok(true, 'live view: closes');
    await click('.ed-actions', 'Export');
    await until(() => $('.export-dlg'), 'export dialog');
    await click('.export-dlg', 'Just the .glb');
    await until(() => /Done: .*\.glb/.test($('.export-dlg').textContent), 'glb export', 60000);
    ok(true, 'export: a .glb for Blender');
    await click('.export-dlg', 'Close');
    await click('.ed-actions', 'Share');
    const chk = await until(() => $('.share-dlg input[type=checkbox]'), 'share dialog');
    chk.click();
    await until(() => vis($('.share-link')) && /#screen\//.test($('.share-link input').value), 'share link', 20000);
    const shareUrl = $('.share-link input').value;
    await click('.share-dlg', 'Done');
    ok(true, 'share: a screening link');
    await page('#screen/' + shareUrl.split('#screen/')[1], () => $('.screen-frame canvas'), 'own screening');
    ok(/The Pie Heist/.test($('.page-screen').textContent), 'screen: the shared picture plays for anyone with the link');

    // ---- the stage door: a wrong code is refused
    await page('#door', () => $$('.anvil-role-door-key button').length >= 23, 'stage door');
    for (const k of ['Q', 'Q', 'Q', 'Q']) btn('.door', k).click();
    await until(() => vis($('.door .anvil-role-msg-error')), 'error');
    ok(true, 'door: a wrong code is refused');

    // ---- the Lot lists the picture; theme; sign out
    await page('#home', () => $$('.prod-card').length >= 1, 'lot again');
    ok(/The Pie Heist/.test($('.anvil-role-poster-grid').textContent), 'lot: the new picture as a poster');
    await click('.ui-header', 'FT');
    await click('.ui-menu .ui-seg', 'Dark');
    ok(document.documentElement.classList.contains('ui-dark'), 'menu: Dark switches the theme');
    await click('.ui-menu .ui-seg', 'Auto');
    await click('.ui-menu', 'Sign out');
    await until(() => location.hash === '#landing' && window.UI_READY && $('.ui-header .ui-btn.primary'), 'signed out');
    ok(true, 'sign out: back to the landing page as a visitor');

    say('PASSED');
    return { ok: true, log: log };
  } catch (e) {
    say(String(e && e.message || e));
    say('hash=' + location.hash + ' toasts=' + toastText().slice(0, 200));
    return { ok: false, log: log };
  }
})();
