/* vt-ui.js: small browser-side pieces the Python forms use through client_code/vt.py:
     VT.controls(stage, el, {sound, subs, fullscreen})  a player bar (play, scrub, time, sound, subtitles, full screen)
     VT.wire(doc, stage, timeline, onChange)              keeps the stage + timeline in step with the document, in JS
                                                         (Python only hears about changes, ~4 times a second at most)
     VT.docFrom(json | object), VT.takesFrom(list, apiBase) build the engine objects from server replies
     VT.blobToB64 / VT.mediaUrl: helpers for uploads and the media endpoint */
(function () {
  'use strict';
  var VT = window.VT = window.VT || {};

  VT.docFrom = function (data) { return new VT.Doc(typeof data === 'string' ? JSON.parse(data || '{}') : data); };
  VT.API = '';
  // VT.API = anvil.server.get_api_origin(), which already ends in /_/api (on Anvil and the App Server): don't double it
  VT.mediaUrl = function (key) { return key ? String(VT.API || '').replace(/\/+$/, '').replace(/\/_\/api$/, '') + '/_/api/m/' + encodeURIComponent(key) : ''; };
  /* takes from the server: [{uid, actor, source, clips, dur, motion_key, audio_key, face_key, asset, stars, created}] */
  VT.takesFrom = function (list, takes) {
    takes = takes || new VT.Takes();
    (list || []).forEach(function (t) {
      takes.add({ uid: t.uid, actor: t.actor, source: t.source, clips: t.clips || [], dur: t.dur, stars: t.stars || 0, created: t.created,
        motionUrl: t.motion_key ? VT.mediaUrl(t.motion_key) : null, faceUrl: t.face_key ? VT.mediaUrl(t.face_key) : null,
        audioUrl: t.asset ? '_/theme/' + t.asset : (t.audio_key ? VT.mediaUrl(t.audio_key) : null) });
    });
    return takes;
  };
  VT.packPass = function (p) { return JSON.stringify(VT.packMotion(p.motion)); };

  VT.wire = function (doc, stage, timeline, onChange) {
    var pending = null, timer = null;
    doc.on(function (what) {
      if (stage) stage.refresh(what);
      if (timeline) timeline.draw();
      pending = pending ? pending + ',' + what : what;
      if (!timer) timer = setTimeout(function () { var w = pending; pending = null; timer = null; if (onChange) onChange(w); }, 250);
    });
    if (stage && timeline) {
      var prev = stage.o.onTime;
      stage.o.onTime = function (t) { timeline.setTime(t); if (prev) prev(t); };
      timeline.o.onSeek = function (t) { stage.seek(t); timeline.setTime(stage.time); };
    }
  };

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  var ICON = {
    play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor"/></svg>',
    sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 10v4h3l4 4V6L8 10z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
    mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 10v4h3l4 4V6L8 10z" fill="currentColor"/><path d="m16 9 5 6M21 9l-5 6"/></svg>',
    cc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M10 10.5a2 2 0 1 0 0 3M16 10.5a2 2 0 1 0 0 3"/></svg>',
    full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>'
  };
  VT.controls = function (stage, host, o) {
    o = o || {};
    var bar = el('div', 'vt-bar'), big = el('button', 'vt-big', ICON.play);
    big.type = 'button'; big.setAttribute('aria-label', 'Play');
    var play = el('button', 'vt-b', ICON.play); play.type = 'button'; play.setAttribute('aria-label', 'Play');
    var scrub = el('input', 'vt-scrub'); scrub.type = 'range'; scrub.min = 0; scrub.max = 1000; scrub.value = 0; scrub.setAttribute('aria-label', 'Position');
    var time = el('span', 'vt-time', '0:00');
    var snd = el('button', 'vt-b', stage.muted ? ICON.mute : ICON.sound); snd.type = 'button'; snd.setAttribute('aria-label', 'Sound');
    var cc = el('button', 'vt-b' + (stage.o.subs ? ' on' : ''), ICON.cc); cc.type = 'button'; cc.setAttribute('aria-label', 'Subtitles');
    var full = el('button', 'vt-b', ICON.full); full.type = 'button'; full.setAttribute('aria-label', 'Full screen');
    bar.appendChild(play); bar.appendChild(scrub); bar.appendChild(time);
    if (o.sound !== false) bar.appendChild(snd);
    if (o.subs !== false) bar.appendChild(cc);
    if (o.fullscreen !== false) bar.appendChild(full);
    host.appendChild(big); host.appendChild(bar);
    function fmt(t) { var m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + (s < 10 ? '0' : '') + s; }
    var dragging = false, raf = 0, alive = true;
    function tick() {
      if (!alive) return;
      var p = stage.playing;
      play.innerHTML = p ? ICON.pause : ICON.play; play.setAttribute('aria-label', p ? 'Pause' : 'Play');
      big.style.display = p ? 'none' : '';
      if (!dragging && stage.total) scrub.value = Math.round(stage.time / stage.total * 1000);
      time.textContent = fmt(stage.time) + ' / ' + fmt(stage.total || 0);
      raf = requestAnimationFrame(tick);
    }
    tick();
    function toggle() { if (stage.muted && o.unmuteOnPlay) { stage.muted = false; snd.innerHTML = ICON.sound; } stage.toggle(); }
    play.onclick = toggle; big.onclick = toggle;
    scrub.oninput = function () { dragging = true; stage.seek(scrub.value / 1000 * stage.total); };
    scrub.onchange = function () { dragging = false; };
    snd.onclick = function () { stage.muted = !stage.muted; snd.innerHTML = stage.muted ? ICON.mute : ICON.sound; if (stage.playing) stage._restartAudio(); };
    cc.onclick = function () { stage.o.subs = !stage.o.subs; cc.classList.toggle('on', !!stage.o.subs); stage._dirty = true; };
    full.onclick = function () { var t = host; if (document.fullscreenElement) document.exitFullscreen(); else if (t.requestFullscreen) t.requestFullscreen(); };
    return { destroy: function () { alive = false; cancelAnimationFrame(raf); bar.remove(); big.remove(); }, setMuted: function (m) { stage.muted = m; snd.innerHTML = m ? ICON.mute : ICON.sound; } };
  };
  VT.blobToB64 = function (blob) {
    return blob.arrayBuffer().then(function (ab) { var u = new Uint8Array(ab), s = ''; for (var i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); });
  };
})();
