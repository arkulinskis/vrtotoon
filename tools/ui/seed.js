/* For screenshots of member pages: sign up a fresh account and make a picture (New picture dialog, the "meet" template).
   Resolves to window.SEED = {home, edit: '#edit/<id>', stage: '#stage/<id>'}. */
(async function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, what, ms) {
    const end = Date.now() + (ms || 30000);
    while (Date.now() < end) { try { const v = fn(); if (v) return v; } catch (e) {} await sleep(150); }
    throw new Error('timed out waiting for: ' + what);
  }
  const $ = (s) => document.querySelector(s), $$ = (s) => Array.from(document.querySelectorAll(s));
  function type(input, value) {
    input.focus(); input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  try {
    if (location.hash !== '#auth/signup') window.UI_READY = false;
    location.hash = '#auth/signup';
    await until(() => window.UI_READY && $$('.au-card input').length >= 3, 'sign-up');
    const inputs = $$('.au-card input[type=text], .au-card input[type=email], .au-card input[type=password]');
    type(inputs[0], 'Sam Rivera'); type(inputs[1], 'shots' + Date.now() + '@example.com'); type(inputs[2], 'Hb-' + Math.random().toString(36).slice(2) + '-Kq7');
    const tick = $('.au-card input[type=checkbox]'); if (tick && !tick.checked) tick.click();
    $$('.anvil-role-btn-block button').find((b) => /Create account/.test(b.textContent)).click();
    await until(() => location.hash === '#home' && window.UI_READY && $('.lot-head .anvil-role-ic-clapper button'), 'home', 60000);
    $('.lot-head .anvil-role-ic-clapper button').click();
    const box = await until(() => $('.new-prod input'), 'new picture dialog');
    type(box, 'Pie Night');
    $$('.new-prod button').find((b) => /Roll camera/.test(b.textContent)).click();
    await until(() => /^#edit\//.test(location.hash) && window.UI_READY && window.VT_EDITOR, 'editor', 60000);
    const edit = location.hash.split('/').slice(0, 2).join('/');
    // a little direction so the timeline and the panels have something to show
    const E = window.VT_EDITOR, d = E.doc.d;
    E.doc.addKey('emo', { actor: d.cast[1].id, beat: d.beats[1].id, at: 0.3, emo: 'love' });
    E.doc.addKey('act', { actor: d.cast[0].id, beat: d.beats[2].id, at: 0.2, act: 'cheer' });
    E.doc.addKey('move', { actor: d.cast[0].id, beat: d.beats[1].id, at: 0.4, x: 0.2, z: 0.9, style: 'walk', face: null });
    await sleep(2500);
    window.SEED = { home: '#home', edit: edit, stage: edit.replace('#edit', '#stage') };
    return window.SEED;
  } catch (e) {
    return { error: String(e && e.message || e) };
  }
})();
