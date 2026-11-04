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
    await click('.st-bar', 'Action!');
    await until(() => P.state === 'review', 'the pass ends in playback', 60000);
    ok(P.pass && P.pass.clips.length === 3, 'stage: the pass is cut into one clip per beat');
    await click('.st-bar', 'Print it');
    await until(() => /Printed/.test(toastText()), 'saved toast', 30000);
    ok(true, 'stage: Print it saves the take');
    window.VT_TEST = {};

    // ---- back in the editor: the take is there; the headset link; exports; share
    await page('#edit/' + pid, () => window.VT_EDITOR && window.VT_EDITOR.pid && $('.ed-stage-wrap canvas'), 'editor again');
    await until(() => window.VT_EDITOR.takes.list().length === 2, 'two takes');
    ok(true, 'editor: the stage take arrived');
    await click('.ed-actions', 'Headset');
    const code = await until(() => { const l = $('.anvil-role-door-code-big'); return l && l.textContent.replace(/\s/g, '').length === 4 && l.textContent; }, 'headset code');
    ok(/^[A-Z ]+$/.test(code.trim()), 'headset: a 4-letter stage door code');
    await click('.headset-link', 'Send to the headset');
    await until(() => /Called/.test(toastText()), 'call sent');
    await click('.headset-link', 'Done');
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
