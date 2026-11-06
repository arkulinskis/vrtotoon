/* vt-film.js: the film model of VRtoToon: the production document, the beat timeline, sampling every actor and the camera
   at any time, the auto-director, takes (recorded performances) and voice analysis (lip sync).

   THE BIG IDEA: a production is a list of BEATS (script lines and action beats). Every beat has a start time computed from
   the beats before it, so recording a line again (longer or shorter) ripples everything after it, like a film editor.
   Everything else (walks, emotions, gestures, looks, camera shots, sound effects) is anchored to a beat ({beat, at}), so it
   moves with its line. A take is one recorded pass (VR head + hands + voice, or voice only) and is cut into CLIPS per beat:
   the speaker's line clips set the beat lengths, the other characters' clips are their reactions. One person can play
   every role, in any order, and retake any single line.

   doc = {v, title, set, look: {grade, aspect, fps}, lead, music: {id, vol},
          cast: [{id, char, name, mark: [x, z, faceDeg], fx, vol}],
          beats: [{id, kind: 'line' | 'action', who, text, emo, gap, dur, note}],
          keys: {move: [{id, actor, beat, at, x, z, style, face}], emo: [{id, actor, beat, at, emo}],
                 act: [{id, actor, beat, at, act}], look: [{id, actor, beat, at, target}]},
          shots: [{id, beat, at, type, a, b, move}], sfx: [{id, beat, at, sfx, vol}],
          sel: {"<beat>|<actor>": "<take uid>"}, custom: {<char uid>: def}}
   take = {uid, actor, source: 'vr' | 'desk' | 'voice' | 'builtin', clips: [{beat, off, dur, line}], dur,
           motion: {fps, n, k, f: Float32Array (k floats per frame: 31 now, 23 in takes made before fingers), m: 'mouth string'},
           audioUrl, buffer, faceUrl, face (the webcam face track from the face booth, vt-face.js)} */
(function () {
  'use strict';
  var VT = window.VT = window.VT || {};
  var T = window.THREE;
  var D2R = Math.PI / 180;
  // one recorded frame: head p3 q4, left hand p3 q4, right hand p3 q4, left shape, right shape (23 floats, the first format),
  // then the finger curls [thumb, index, middle, ring] of the left and the right hand (31 floats, since Nov 2026)
  var FRAME = 31, FRAME0 = 23;
  VT.FRAME = FRAME; VT.FRAME0 = FRAME0;

  VT.uid = function (p) { var s = ''; for (var i = 0; i < 10; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 36)); return (p || 'x') + '_' + s; };
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function ease(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  function lerp(a, b, u) { return a + (b - a) * u; }
  function hash(n) { n = Math.sin(n * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); }
  VT.clamp = clamp; VT.ease = ease;

  /* ------------------------------------------------------------------ the document */
  VT.STYLES = [{ id: 'walk', label: 'Walk', speed: 1.15 }, { id: 'run', label: 'Run', speed: 2.8 }, { id: 'sneak', label: 'Sneak', speed: 0.55 },
    { id: 'glide', label: 'Glide', speed: 1.2 }, { id: 'place', label: 'Jump cut (no walk)', speed: 0 }];
  VT.STYLE_BY = {}; VT.STYLES.forEach(function (s) { VT.STYLE_BY[s.id] = s; });
  VT.SHOTS = [
    { id: 'wide', label: 'Wide', note: 'The whole scene' }, { id: 'full', label: 'Full shot', note: 'Head to toe' },
    { id: 'medium', label: 'Medium', note: 'Waist up' }, { id: 'close', label: 'Close-up', note: 'The face' },
    { id: 'ecu', label: 'Extreme close-up', note: 'Just the eyes' }, { id: 'two', label: 'Two-shot', note: 'Two characters' },
    { id: 'ots', label: 'Over the shoulder', note: 'Past one, onto the other' }, { id: 'low', label: 'Low angle', note: 'Heroic, powerful' },
    { id: 'high', label: 'High angle', note: 'Small, worried' }, { id: 'dutch', label: 'Dutch tilt', note: 'Something is wrong' },
    { id: 'orbit', label: 'Orbit', note: 'Circle around' }, { id: 'top', label: 'Overhead', note: 'Straight down' }
  ];
  VT.SHOT_BY = {}; VT.SHOTS.forEach(function (s) { VT.SHOT_BY[s.id] = s; });
  VT.MOVES = [{ id: 'static', label: 'Locked off' }, { id: 'drift', label: 'Slow drift' }, { id: 'push', label: 'Push in' }, { id: 'pull', label: 'Pull out' }, { id: 'pan', label: 'Track sideways' },
    { id: 'crane', label: 'Crane up' }, { id: 'shake', label: 'Handheld' }, { id: 'crash', label: 'Crash zoom' }];
  VT.MOVE_BY = {}; VT.MOVES.forEach(function (s) { VT.MOVE_BY[s.id] = s; });

  VT.normDoc = function (d) {
    d = d ? JSON.parse(JSON.stringify(d)) : {};
    d.v = 1;
    d.title = d.title || 'Untitled picture';
    d.set = VT.SET_BY && VT.SET_BY[d.set] ? d.set : 'soundstage';
    d.look = Object.assign({ grade: 'technicolor', aspect: '16:9', fps: 24, subs: false }, d.look || {});
    d.lead = d.lead == null ? 1.2 : d.lead;
    d.music = Object.assign({ id: 'none', vol: 0.35 }, d.music || {});
    d.cast = (d.cast || []).filter(function (c) { return c && c.id; });
    d.beats = (d.beats || []).filter(function (b) { return b && b.id; });
    d.keys = Object.assign({ move: [], emo: [], act: [], look: [] }, d.keys || {});
    ['move', 'emo', 'act', 'look'].forEach(function (k) { d.keys[k] = (d.keys[k] || []).filter(function (x) { return x && x.id; }); });
    d.shots = (d.shots || []).filter(function (s) { return s && s.id; });
    d.sfx = (d.sfx || []).filter(function (s) { return s && s.id; });
    d.sel = d.sel || {};
    d.custom = d.custom || {};
    d.cast.forEach(function (c, i) {
      c.name = c.name || 'ACTOR ' + (i + 1);
      c.mark = c.mark || ((VT.SET_BY && VT.SET_BY[d.set] ? VT.SET_BY[d.set].marks[i % 5] : null) || [i * 1.2 - 1, 0, 0]);
      c.fx = c.fx || 'none'; c.vol = c.vol == null ? 1 : c.vol;
    });
    return d;
  };

  function Doc(data, opts) {
    this.d = VT.normDoc(data);
    this.undoStack = []; this.redoStack = [];
    this.fns = [];
    this.opts = opts || {};
    this.version = 0;
  }
  VT.Doc = Doc;
  Doc.prototype.json = function () { return JSON.stringify(this.d); };
  Doc.prototype.on = function (fn) { this.fns.push(fn); };
  Doc.prototype.off = function (fn) { this.fns = this.fns.filter(function (f) { return f !== fn; }); };
  Doc.prototype.emit = function (what) { this.version++; var self = this; this.fns.slice().forEach(function (f) { try { f(what || 'change', self); } catch (e) { console.error(e); } }); };
  Doc.prototype.change = function (what, fn) {
    var before = JSON.stringify(this.d);
    var r = fn(this.d);
    if (JSON.stringify(this.d) === before) return r;  // nothing changed: no undo step, no redraw
    this.undoStack.push(before);
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
    this.emit(what);
    return r;
  };
  Doc.prototype.undo = function () { if (!this.undoStack.length) return false; this.redoStack.push(JSON.stringify(this.d)); this.d = JSON.parse(this.undoStack.pop()); this.emit('undo'); return true; };
  Doc.prototype.redo = function () { if (!this.redoStack.length) return false; this.undoStack.push(JSON.stringify(this.d)); this.d = JSON.parse(this.redoStack.pop()); this.emit('redo'); return true; };
  Doc.prototype.canUndo = function () { return this.undoStack.length > 0; };
  Doc.prototype.canRedo = function () { return this.redoStack.length > 0; };
  Doc.prototype.replace = function (data) { this.d = VT.normDoc(data); this.emit('replace'); };
  Doc.prototype.actor = function (id) { return this.d.cast.filter(function (c) { return c.id === id; })[0] || null; };
  Doc.prototype.beat = function (id) { return this.d.beats.filter(function (b) { return b.id === id; })[0] || null; };
  Doc.prototype.beatIndex = function (id) { for (var i = 0; i < this.d.beats.length; i++) if (this.d.beats[i].id === id) return i; return -1; };
  Doc.prototype.charDef = function (actorId) { var a = this.actor(actorId); return VT.charDef(a ? a.char : 'max', this.d.custom); };
  Doc.prototype.set = function (path, value) {  // doc.set('look.grade', 'noir'), doc.set('title', 'x')
    return this.change('set:' + path, function (d) { var parts = path.split('.'), o = d; for (var i = 0; i < parts.length - 1; i++) o = o[parts[i]]; o[parts[parts.length - 1]] = value; });
  };
  // ---- cast
  Doc.prototype.addCast = function (charRef, name, def) {
    var self = this;
    return this.change('cast', function (d) {
      var i = d.cast.length, set = VT.SET_BY[d.set] || VT.SETS[0];
      var id = VT.uid('a');
      if (def) d.custom[charRef] = def;
      var base = VT.charDef(charRef, d.custom);
      // short screen names: premade ids are already short (MAX, ROSIE, BARON); custom characters use their first name
      var nm = (name || (VT.CAST_BY[charRef] ? charRef : (base.name || 'Actor').split(' ')[0])).toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 18) || 'ACTOR';
      var used = d.cast.map(function (c) { return c.name; });
      while (used.indexOf(nm) >= 0) nm = nm + ' 2';
      d.cast.push({ id: id, char: charRef, name: nm, mark: (set.marks[i % set.marks.length] || [0, 0, 0]).slice(), fx: VT.VOICE_HINT[base.voice] || 'none', vol: 1 });
      return id;
    });
  };
  Doc.prototype.updateCast = function (id, fields) { return this.change('cast', function (d) { d.cast.forEach(function (c) { if (c.id === id) Object.assign(c, fields); }); }); };
  Doc.prototype.removeCast = function (id) {
    return this.change('cast', function (d) {
      d.cast = d.cast.filter(function (c) { return c.id !== id; });
      d.beats.forEach(function (b) { if (b.who === id) b.who = d.cast[0] ? d.cast[0].id : null; });
      ['move', 'emo', 'act', 'look'].forEach(function (k) { d.keys[k] = d.keys[k].filter(function (x) { return x.actor !== id && x.target !== id; }); });
      d.shots.forEach(function (s) { if (s.a === id) s.a = null; if (s.b === id) s.b = null; });
      Object.keys(d.sel).forEach(function (k) { if (k.split('|')[1] === id) delete d.sel[k]; });
    });
  };
  // ---- beats
  Doc.prototype.addBeat = function (fields, afterId) {
    return this.change('beats', function (d) {
      var b = Object.assign({ id: VT.uid('b'), kind: 'line', who: d.cast[0] ? d.cast[0].id : null, text: '', emo: '', gap: 0.35 }, fields || {});
      var i = afterId ? d.beats.map(function (x) { return x.id; }).indexOf(afterId) : -1;
      if (i >= 0) d.beats.splice(i + 1, 0, b); else d.beats.push(b);
      return b.id;
    });
  };
  Doc.prototype.updateBeat = function (id, fields) { return this.change('beat', function (d) { d.beats.forEach(function (b) { if (b.id === id) Object.assign(b, fields); }); }); };
  Doc.prototype.moveBeat = function (id, delta) {
    return this.change('beats', function (d) {
      var i = d.beats.map(function (x) { return x.id; }).indexOf(id), j = i + delta;
      if (i < 0 || j < 0 || j >= d.beats.length) return;
      var b = d.beats.splice(i, 1)[0]; d.beats.splice(j, 0, b);
    });
  };
  Doc.prototype.deleteBeat = function (id) {
    return this.change('beats', function (d) {
      d.beats = d.beats.filter(function (b) { return b.id !== id; });
      ['move', 'emo', 'act', 'look'].forEach(function (k) { d.keys[k] = d.keys[k].filter(function (x) { return x.beat !== id; }); });
      d.shots = d.shots.filter(function (s) { return s.beat !== id; });
      d.sfx = d.sfx.filter(function (s) { return s.beat !== id; });
      Object.keys(d.sel).forEach(function (k) { if (k.split('|')[0] === id) delete d.sel[k]; });
    });
  };
  // ---- keys (move / emo / act / look), shots, sfx: all anchored to a beat
  Doc.prototype.addKey = function (kind, fields) {
    return this.change('keys', function (d) {
      var k = Object.assign({ id: VT.uid('k') }, fields);
      var list = kind === 'shot' ? d.shots : kind === 'sfx' ? d.sfx : d.keys[kind];
      if (kind === 'move' || kind === 'emo' || kind === 'look') {  // one key of a kind per actor per moment: replace a twin
        for (var i = list.length - 1; i >= 0; i--) if (list[i].actor === k.actor && list[i].beat === k.beat && Math.abs(list[i].at - k.at) < 0.05) list.splice(i, 1);
      }
      list.push(k);
      return k.id;
    });
  };
  Doc.prototype.findKey = function (id) {
    var d = this.d, lists = { move: d.keys.move, emo: d.keys.emo, act: d.keys.act, look: d.keys.look, shot: d.shots, sfx: d.sfx };
    for (var kind in lists) { var hit = lists[kind].filter(function (k) { return k.id === id; })[0]; if (hit) return { kind: kind, key: hit }; }
    return null;
  };
  Doc.prototype.updateKey = function (id, fields) {
    var self = this;
    return this.change('keys', function () { var f = self.findKey(id); if (f) Object.assign(f.key, fields); });
  };
  Doc.prototype.deleteKey = function (id) {
    return this.change('keys', function (d) {
      ['move', 'emo', 'act', 'look'].forEach(function (k) { d.keys[k] = d.keys[k].filter(function (x) { return x.id !== id; }); });
      d.shots = d.shots.filter(function (s) { return s.id !== id; });
      d.sfx = d.sfx.filter(function (s) { return s.id !== id; });
    });
  };
  Doc.prototype.select = function (beatId, actorId, takeUid) {
    return this.change('sel', function (d) { var k = beatId + '|' + actorId; if (takeUid) d.sel[k] = takeUid; else delete d.sel[k]; });
  };
  // anchor an absolute time to the beat it falls in (for new keys from the timeline / the stage)
  Doc.prototype.anchor = function (t, layout) {
    var L = layout || this.layout();
    if (!L.beats.length) return { beat: null, at: t };
    var b = L.beats[0];
    for (var i = 0; i < L.beats.length; i++) if (L.beats[i].start <= t + 1e-6) b = L.beats[i];
    return { beat: b.id, at: Math.round((t - b.start) * 100) / 100 };
  };

  /* ------------------------------------------------------------------ timing */
  VT.wordCount = function (s) { return (String(s || '').match(/[\w'À-ɏ]+/g) || []).length; };
  VT.estimate = function (beat) {
    if (beat.kind === 'action') return clamp(+beat.dur || 3, 0.5, 30);
    return clamp(VT.wordCount(beat.text) * 0.36 + 0.7, 1.2, 14);
  };
  Doc.prototype.layout = function (takes) {
    takes = takes || this.takes || {};
    var d = this.d, t = d.lead, out = [], by = {};
    d.beats.forEach(function (b, i) {
      var dur = VT.estimate(b), src = 'estimate';
      if (b.kind === 'line' && b.who) {
        var uid = d.sel[b.id + '|' + b.who], tk = uid && takes[uid], c = tk && clipOf(tk, b.id);
        if (c && c.dur > 0.2) { dur = c.dur; src = 'take'; }
      }
      if (b.kind === 'action' && b.dur) { dur = clamp(+b.dur, 0.5, 30); src = 'set'; }
      var gap = b.gap == null ? 0.35 : clamp(+b.gap, -dur * 0.8, 10);
      var x = { id: b.id, i: i, start: t, dur: dur, end: t + dur, gap: gap, kind: b.kind, who: b.who, src: src, text: b.text, emo: b.emo };
      out.push(x); by[b.id] = x;
      t = t + dur + gap;
    });
    var total = Math.max(2, (out.length ? out[out.length - 1].end : d.lead) + 1.5);
    return { beats: out, by: by, total: total, lead: d.lead,
      abs: function (beatId, at) { var b = by[beatId]; return b ? b.start + (at || 0) : null; },
      beatAt: function (tt) { var hit = null; for (var i = 0; i < out.length; i++) if (out[i].start <= tt + 1e-6) hit = out[i]; return hit; } };
  };
  function clipOf(take, beatId) { var cs = take.clips || []; for (var i = 0; i < cs.length; i++) if (cs[i].beat === beatId) return cs[i]; return null; }
  VT.clipOf = clipOf;

  /* ------------------------------------------------------------------ takes: motion sampling + voice analysis */
  VT.unpackMotion = function (m) {
    if (!m) return null;
    if (m.f && !(m.f instanceof Float32Array)) m.f = Float32Array.from(m.f);
    return m;
  };
  VT.packMotion = function (m) {
    return { fps: m.fps, n: m.n, k: m.k || FRAME0, f: Array.prototype.map.call(m.f, function (v) { return Math.round(v * 1000) / 1000; }), m: m.m || '' };
  };
  var _qa = new T.Quaternion(), _qb = new T.Quaternion();
  VT.sampleMotion = function (m, t) {
    if (!m || !m.n) return null;
    var x = clamp(t * m.fps, 0, m.n - 1), i = Math.floor(x), j = Math.min(m.n - 1, i + 1), u = x - i, f = m.f;
    var K = m.k || FRAME0, A = i * K, B = j * K;
    function v3(o) { return [lerp(f[A + o], f[B + o], u), lerp(f[A + o + 1], f[B + o + 1], u), lerp(f[A + o + 2], f[B + o + 2], u)]; }
    function q4(o) { _qa.set(f[A + o], f[A + o + 1], f[A + o + 2], f[A + o + 3]); _qb.set(f[B + o], f[B + o + 1], f[B + o + 2], f[B + o + 3]); _qa.slerp(_qb, u); return [_qa.x, _qa.y, _qa.z, _qa.w]; }
    function c4(o) { return K >= FRAME ? [lerp(f[A + o], f[B + o], u), lerp(f[A + o + 1], f[B + o + 1], u), lerp(f[A + o + 2], f[B + o + 2], u), lerp(f[A + o + 3], f[B + o + 3], u)] : null; }
    return { head: { p: v3(0), q: q4(3) }, l: { p: v3(7), q: q4(10), g: f[A + 21], c: c4(23) }, r: { p: v3(14), q: q4(17), g: f[A + 22], c: c4(27) } };
  };
  VT.mouthAt = function (mstr, fps, t) {
    if (!mstr) return null;
    var n = mstr.length / 2, i = clamp(Math.round(t * (fps || 30)), 0, n - 1);
    var o = mstr.charCodeAt(i * 2) - 48, w = mstr.charCodeAt(i * 2 + 1) - 48;
    return { open: clamp(o, 0, 9) / 9, wide: clamp(w, 0, 9) / 9 };
  };
  // lip sync from a voice recording: 2 characters per frame, open (0-9) + wide (0-9)
  VT.analyzeVoice = function (buf, fps) {
    fps = fps || 30;
    var data = buf.getChannelData(0), sr = buf.sampleRate, hop = Math.floor(sr / fps), n = Math.floor(data.length / hop), rms = [], zcr = [];
    for (var i = 0; i < n; i++) {
      var s = 0, z = 0, a = i * hop;
      for (var j = 0; j < hop; j++) { var v = data[a + j]; s += v * v; if (j && (v >= 0) !== (data[a + j - 1] >= 0)) z++; }
      rms.push(Math.sqrt(s / hop)); zcr.push(z / hop);
    }
    var sorted = rms.slice().sort(function (x, y) { return x - y; });
    var floor = sorted[Math.floor(n * 0.2)] || 0, peak = sorted[Math.floor(n * 0.97)] || 1e-3;
    floor = Math.max(floor, peak * 0.06);
    var out = '', prev = 0;
    for (var k = 0; k < n; k++) {
      var o = clamp((rms[k] - floor) / Math.max(1e-4, peak - floor), 0, 1);
      o = Math.pow(o, 0.65);
      o = Math.max(o, prev * 0.55);  // close a little slower than it opens
      prev = o;
      var w = clamp((zcr[k] - 0.03) / 0.12, 0, 1);
      out += String.fromCharCode(48 + Math.round(o * 9)) + String.fromCharCode(48 + Math.round(w * 9));
    }
    return out;
  };
  // where speech starts and ends in a recording (for trimming and VR line detection)
  VT.speechSpan = function (mstr, fps) {
    if (!mstr) return null;
    var n = mstr.length / 2, a = -1, b = -1;
    for (var i = 0; i < n; i++) if (mstr.charCodeAt(i * 2) - 48 >= 3) { if (a < 0) a = i; b = i; }
    return a < 0 ? null : { start: a / (fps || 30), end: (b + 1) / (fps || 30) };
  };
  var _audioCtx = null;
  VT.audioCtx = function () {
    if (!_audioCtx) { var C = window.AudioContext || window.webkitAudioContext; _audioCtx = new C(); }
    if (_audioCtx.state === 'suspended') { try { _audioCtx.resume(); } catch (e) {} }
    return _audioCtx;
  };
  var _bufCache = {};
  VT.loadAudio = function (url) {
    if (!url) return Promise.resolve(null);
    if (_bufCache[url]) return _bufCache[url];
    return (_bufCache[url] = fetch(url).then(function (r) { if (!r.ok) throw new Error('audio ' + r.status); return r.arrayBuffer(); })
      .then(function (ab) { return new Promise(function (res, rej) { VT.audioCtx().decodeAudioData(ab, res, rej); }); })
      .catch(function (e) { console.warn('audio load failed', url, e); delete _bufCache[url]; return null; }));
  };
  /* VT.Takes: the takes of a production. add({uid, ...meta, motionUrl | motion, audioUrl}) then ready() loads them. */
  function Takes() { this.map = {}; }
  VT.Takes = Takes;
  Takes.prototype.add = function (t) { this.map[t.uid] = Object.assign(this.map[t.uid] || {}, t); return this.map[t.uid]; };
  Takes.prototype.remove = function (uid) { delete this.map[uid]; };
  Takes.prototype.list = function () { var m = this.map; return Object.keys(m).map(function (k) { return m[k]; }); };
  Takes.prototype.load = function (uid) {
    var t = this.map[uid];
    if (!t) return Promise.resolve(null);
    if (t._loading) return t._loading;
    var jobs = [];
    if (!t.motion && t.motionUrl) jobs.push(fetch(t.motionUrl).then(function (r) { return r.json(); }).then(function (m) { t.motion = VT.unpackMotion(m); }).catch(function (e) { console.warn('motion load failed', e); }));
    else if (t.motion) VT.unpackMotion(t.motion);
    if (t.audioUrl && !t.buffer) jobs.push(VT.loadAudio(t.audioUrl).then(function (b) {
      t.buffer = b;
      if (b && (!t.motion || !t.motion.m) && !t.faceUrl) { t.motion = t.motion || { fps: 30, n: 0, f: new Float32Array(0) }; t.motion.m = VT.analyzeVoice(b, t.motion.fps || 30); }
    }));
    if (t.faceUrl && !t.face && VT.unpackFace) jobs.push(fetch(t.faceUrl).then(function (r) { return r.json(); }).then(function (f) { t.face = VT.unpackFace(f); }).catch(function (e) { console.warn('face load failed', e); }));
    return (t._loading = Promise.all(jobs).then(function () {
      // a face pass that re-recorded the voice carries the new lip sync
      if (t.face && t.face.vm) { t.motion = t.motion || { fps: 30, n: 0, f: new Float32Array(0) }; t.motion.m = t.face.vm; }
      else if (t.buffer && (!t.motion || !t.motion.m)) { t.motion = t.motion || { fps: 30, n: 0, f: new Float32Array(0) }; t.motion.m = VT.analyzeVoice(t.buffer, t.motion.fps || 30); }
      return t;
    }));
  };
  Takes.prototype.loadAll = function (uids) { var self = this; return Promise.all((uids || Object.keys(this.map)).map(function (u) { return self.load(u); })); };

  /* ------------------------------------------------------------------ the film: where everyone is at time t */
  function Film(doc, takes) { this.doc = doc; this.takes = takes || new Takes(); this.refresh(); }
  VT.Film = Film;
  Film.prototype.refresh = function () {
    var d = this.doc.d, self = this;
    this.L = this.doc.layout(this.takes.map);
    var L = this.L;
    // absolute times for every keyed thing
    function abs(k) { var t = L.abs(k.beat, k.at); return t == null ? null : t; }
    this.moves = {}; this.emos = {}; this.acts = {}; this.looks = {};
    d.cast.forEach(function (c) { self.moves[c.id] = []; self.emos[c.id] = []; self.acts[c.id] = []; self.looks[c.id] = []; });
    d.keys.move.forEach(function (k) { var t = abs(k); if (t != null && self.moves[k.actor]) self.moves[k.actor].push(Object.assign({ t: t }, k)); });
    d.keys.emo.forEach(function (k) { var t = abs(k); if (t != null && self.emos[k.actor]) self.emos[k.actor].push({ t: t, emo: k.emo }); });
    d.keys.act.forEach(function (k) { var t = abs(k); if (t != null && self.acts[k.actor]) self.acts[k.actor].push({ t: t, act: k.act, len: (VT.GEST[k.act] || { len: 1.5 }).len }); });
    d.keys.look.forEach(function (k) { var t = abs(k); if (t != null && self.looks[k.actor]) self.looks[k.actor].push({ t: t, target: k.target }); });
    L.beats.forEach(function (b) { if (b.kind === 'line' && b.emo && self.emos[b.who]) self.emos[b.who].push({ t: b.start - 0.15, emo: b.emo, line: true }); });
    var byT = function (a, b) { return a.t - b.t; };
    Object.keys(this.moves).forEach(function (k) { self.moves[k].sort(byT); self.emos[k].sort(byT); self.acts[k].sort(byT); self.looks[k].sort(byT); });
    this.paths = {};
    d.cast.forEach(function (c) { self.paths[c.id] = self._path(c); });
    this.shots = d.shots.map(function (s) { return Object.assign({ t: abs(s) }, s); }).filter(function (s) { return s.t != null; }).sort(byT);
    this.shots.forEach(function (s, i) { s.end = i + 1 < self.shots.length ? self.shots[i + 1].t : L.total; });
    this.sfx = d.sfx.map(function (s) { return Object.assign({ t: abs(s) }, s); }).filter(function (s) { return s.t != null; });
    this.total = L.total;
  };
  // walking paths: segments from move keys (walk from where you are at t to the key's spot)
  Film.prototype._path = function (c) {
    var keys = this.moves[c.id] || [], segs = [], x = c.mark[0], z = c.mark[1], face = (c.mark[2] || 0) * D2R;
    keys.forEach(function (k) {
      var st = VT.STYLE_BY[k.style || 'walk'] || VT.STYLE_BY.walk;
      var dx = k.x - x, dz = k.z - z, dist = Math.sqrt(dx * dx + dz * dz);
      var travel = dist > 0.02 ? Math.atan2(dx, dz) : face;
      var dur = st.speed ? dist / st.speed : 0;
      var endFace = k.face == null || k.face === '' ? null : k.face;
      segs.push({ t0: k.t, t1: k.t + dur, x0: x, z0: z, x1: k.x, z1: k.z, dist: dist, style: k.style || 'walk', travel: travel, prevFace: face, endFace: endFace, key: k.id });
      x = k.x; z = k.z;
      face = typeof endFace === 'number' ? endFace * D2R : travel;
    });
    return { segs: segs, x0: c.mark[0], z0: c.mark[1], f0: (c.mark[2] || 0) * D2R };
  };
  function angDiff(a, b) { var d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }
  VT.angDiff = angDiff;
  // root position, facing (radians, 0 = +Z) and walk at time t; "auto" facing turns towards whoever the actor talks to
  Film.prototype.place = function (aid, t, noAuto) {
    var P = this.paths[aid];
    if (!P) return { x: 0, z: 0, f: 0, walk: { phase: 0, amt: 0 }, moving: false };
    var x = P.x0, z = P.z0, f = P.f0, phase = 0, amt = 0, moving = false, dist = 0, settled = -1e9, endFace = 'mark';
    for (var i = 0; i < P.segs.length; i++) {
      var s = P.segs[i];
      if (t < s.t0) break;
      if (t < s.t1 && s.t1 > s.t0) {
        var u = (t - s.t0) / (s.t1 - s.t0);
        x = lerp(s.x0, s.x1, u); z = lerp(s.z0, s.z1, u);
        var turn = clamp((t - s.t0) / 0.3, 0, 1);
        f = s.prevFace + angDiff(s.prevFace, s.travel) * turn;
        dist += s.dist * u; moving = s.style !== 'glide';
        amt = moving ? Math.min(1, (t - s.t0) / 0.2, (s.t1 - t) / 0.2) * (s.style === 'run' ? 1.4 : s.style === 'sneak' ? 0.7 : 1) : 0;
        endFace = null;
        break;
      }
      x = s.x1; z = s.z1; dist += s.dist; settled = s.t1;
      f = s.dist > 0.02 ? s.travel : s.prevFace;
      endFace = s.endFace == null ? 'auto' : s.endFace;
    }
    phase = dist / Math.max(0.3, 0.55) * Math.PI;
    if (endFace !== null && !moving) {
      var target = null;
      if (endFace === 'mark') target = null;
      else if (typeof endFace === 'number') target = endFace * D2R;
      else if (endFace === 'front' || endFace === 'cam') target = 0;
      else if (endFace === 'auto' && !noAuto) target = this._autoFace(aid, t, x, z);
      else if (endFace !== 'auto' && this.paths[endFace]) { var o = this.place(endFace, t, true); target = Math.atan2(o.x - x, o.z - z); }
      if (target != null) { var k = clamp((t - settled) / 0.45, 0, 1); f = f + angDiff(f, target) * ease(k); }
    }
    return { x: x, z: z, f: f, walk: { phase: phase, amt: amt }, moving: amt > 0.05 };
  };
  // "cheat to camera": face between the audience and the person you're talking to
  Film.prototype._autoFace = function (aid, t, x, z) {
    var other = this.partner(aid, t);
    if (!other) return 0;
    var o = this.place(other, t, true);
    var toward = Math.atan2(o.x - x, o.z - z);
    return toward * 0.55;
  };
  // the actor this one is talking to / listening to at time t
  Film.prototype.partner = function (aid, t) {
    var L = this.L, b = L.beatAt(t), d = this.doc.d;
    if (!b) return null;
    if (b.kind === 'line' && b.who && b.who !== aid) return b.who;
    // the speaker talks to the previous different speaker, else the next, else anyone else
    for (var i = b.i - 1; i >= 0; i--) { var p = L.beats[i]; if (p.kind === 'line' && p.who && p.who !== aid) return p.who; }
    for (var j = b.i + 1; j < L.beats.length; j++) { var n = L.beats[j]; if (n.kind === 'line' && n.who && n.who !== aid) return n.who; }
    var others = d.cast.filter(function (c) { return c.id !== aid; });
    return others.length ? others[0].id : null;
  };
  Film.prototype.speakerAt = function (t) { var b = this.L.beatAt(t); return b && b.kind === 'line' && t < b.end ? b.who : null; };
  Film.prototype.emotion = function (aid, t) {
    var list = this.emos[aid] || [], cur = 'neutral', prev = 'neutral', since = -1e9;
    for (var i = 0; i < list.length; i++) { if (list[i].t > t) break; prev = cur; cur = list[i].emo; since = list[i].t; }
    var u = clamp((t - since) / 0.3, 0, 1);
    if (u >= 1 || prev === cur) { var o = {}; o[cur] = 1; return o; }
    var w = {}; w[prev] = 1 - u; w[cur] = (w[cur] || 0) + u; return w;
  };
  Film.prototype.gesture = function (aid, t) {
    var list = this.acts[aid] || [];
    for (var i = list.length - 1; i >= 0; i--) { var a = list[i]; if (a.t <= t && t < a.t + a.len) return { id: a.act, u: (t - a.t) / a.len }; }
    return null;
  };
  Film.prototype.lookTarget = function (aid, t) {
    var list = this.looks[aid] || [], tg = 'auto';
    for (var i = 0; i < list.length; i++) { if (list[i].t > t) break; tg = list[i].target || 'auto'; }
    if (tg === 'auto') { var sp = this.speakerAt(t); tg = sp && sp !== aid ? sp : this.partner(aid, t); }
    return tg;
  };
  // which recorded clip drives an actor at time t: {take, clip, local} or null
  Film.prototype.source = function (aid, b) {
    if (!b) return null;
    var uid = this.doc.d.sel[b.id + '|' + aid], tk = uid && this.takes.map[uid];
    if (!tk) return null;
    var c = clipOf(tk, b.id);
    return c ? { take: tk, clip: c, uid: uid } : null;
  };
  // the webcam face of the clip playing for this actor at t (face booth), or null
  Film.prototype.camFace = function (aid, t, b) {
    var s = b && this.source(aid, b);
    if (!s || !s.take.face || !VT.faceAt) return null;
    return VT.faceAt(s.take.face, s.clip.off + (t - b.start));
  };
  Film.prototype.mouth = function (aid, t, b) {
    if (!b || b.kind !== 'line' || b.who !== aid || t < b.start || t > b.end + 0.1) return { open: 0, wide: 0.5, talking: false };
    var s = this.source(aid, b);
    var cf = s && s.take.face && s.take.face.mouth ? this.camFace(aid, t, b) : null;
    if (cf) return { open: cf.open, wide: cf.wide, talking: true };  // "mouth follows the camera"
    if (s && s.take.motion && s.take.motion.m) {
      var m = VT.mouthAt(s.take.motion.m, s.take.motion.fps, s.clip.off + (t - b.start));
      if (m) return { open: m.open, wide: m.wide, talking: true };
    }
    // no recording yet: flap to the words (vowels) so the scene still reads
    var text = (b.text || '').toLowerCase(), u = (t - b.start) / Math.max(0.3, b.dur), idx = Math.floor(u * text.length);
    var ch = text.charAt(idx), vowel = 'aeiouy'.indexOf(ch) >= 0, sp = ch === ' ' || ch === ',' || ch === '.';
    var open = sp ? 0.05 : vowel ? 0.55 + 0.35 * hash(idx) : 0.2 + 0.2 * hash(idx + 3);
    open *= clamp(u * 12, 0, 1) * clamp((1 - u) * 12, 0, 1);
    return { open: open, wide: 'eiy'.indexOf(ch) >= 0 ? 0.85 : 'ou'.indexOf(ch) >= 0 ? 0.15 : 0.5, talking: true };
  };
  VT.blinkAt = function (t, seed) {
    var p = 3.3, k = Math.floor((t + seed) / p), start = k * p - seed + hash(k + seed) * (p - 0.4);
    var u = (t - start) / 0.16;
    return u >= 0 && u <= 1 ? Math.sin(u * Math.PI) : 0;
  };
  function blendPose(A, B, w) {
    if (!A) return B; if (!B) return A;
    function bp(a, b) { if (!a || !a.p) return b; if (!b || !b.p) return a; var q = null; if (a.q && b.q) { _qa.set(a.q[0], a.q[1], a.q[2], a.q[3]); _qb.set(b.q[0], b.q[1], b.q[2], b.q[3]); _qa.slerp(_qb, w); q = [_qa.x, _qa.y, _qa.z, _qa.w]; } else q = w < 0.5 ? a.q : b.q; var ca = a.c || VT.handCurls(a.g), cb = b.c || VT.handCurls(b.g); return { p: [lerp(a.p[0], b.p[0], w), lerp(a.p[1], b.p[1], w), lerp(a.p[2], b.p[2], w)], q: q, g: w < 0.5 ? a.g : b.g, c: [0, 1, 2, 3].map(function (i) { return lerp(ca[i], cb[i], w); }) }; }
    return { head: bp(A.head, B.head), l: bp(A.l, B.l), r: bp(A.r, B.r) };
  }
  VT.blendPose = blendPose;
  // the upper-body performance: a take clip, or procedural acting, with cross-fades between sources
  Film.prototype.perform = function (actor, aid, t, ctx) {
    var L = this.L, b = L.beatAt(t), self = this;
    function from(src, bb) {
      if (src && src.take.motion && src.take.motion.n) return VT.sampleMotion(src.take.motion, src.clip.off + (t - bb.start));
      return VT.proceduralPose(actor, ctx);
    }
    if (!b) return VT.proceduralPose(actor, ctx);
    var s = this.source(aid, b), cur = from(s, b);
    var since = t - b.start;
    if (since < 0.3 && b.i > 0) {
      var pb = L.beats[b.i - 1], ps = this.source(aid, pb);
      var same = ps && s && ps.uid === s.uid && Math.abs(ps.clip.off + (b.start - pb.start) - s.clip.off) < 0.08;
      if (!same && (ps || s)) cur = blendPose(from(ps, pb), cur, ease(since / 0.3));
    }
    return cur;
  };
  /* everything an actor needs to be drawn at t: root (x, z, rot) + the setPose() argument */
  Film.prototype.actorAt = function (actor, aid, t, opts) {
    opts = opts || {};
    var pl = this.place(aid, t), b = this.L.beatAt(t), m = this.mouth(aid, t, b);
    var face = VT.faceOf(this.emotion(aid, t));
    // a face pass from the webcam drives eyes, brows and mouth (fading in over 0.3 s when the clip before had none)
    var cf = b ? this.camFace(aid, t, b) : null, cw = 0;
    if (cf) {
      cw = 1;
      if (t - b.start < 0.3 && b.i > 0) { var pb = this.L.beats[b.i - 1]; if (!this.camFace(aid, b.start - 0.01, pb)) cw = ease((t - b.start) / 0.3); }
      face = VT.mixCamFace(face, cf, cw);
      cw = face.cam || 0;
    }
    var lt = this.lookTarget(aid, t), lookLocal = null;
    if (lt && this.paths[lt]) {
      var o = this.place(lt, t, true), oa = opts.actors && opts.actors[lt];
      var hy = oa ? oa.headRest.y : 1.2, dx = o.x - pl.x, dz = o.z - pl.z, c = Math.cos(-pl.f), s = Math.sin(-pl.f);
      lookLocal = [dx * c + dz * s, hy, -dx * s + dz * c];
    } else if (lt === 'cam' && opts.cam) {
      var cdx = opts.cam.x - pl.x, cdz = opts.cam.z - pl.z, cc = Math.cos(-pl.f), cs = Math.sin(-pl.f);
      lookLocal = [cdx * cc + cdz * cs, opts.cam.y, -cdx * cs + cdz * cc];
    }
    var seed = (aid.charCodeAt(2) || 7) % 13;
    var ctx = { t: t, seed: seed, talk: m.open, speaking: m.talking, gesture: this.gesture(aid, t), look: lookLocal };
    var p = this.perform(actor, aid, t, ctx);
    var g = ctx.gesture;
    if (g && this.source(aid, b)) {  // a gesture key on top of a recorded take: blend towards the procedural gesture
      var pg = VT.proceduralPose(actor, ctx), w = ease(Math.min(g.u / 0.15, (1 - g.u) / 0.2));
      p = blendPose(p, pg, w * 0.85);
    }
    p.face = face;
    p.mouth = { open: m.open, wide: m.wide };
    p.blink = VT.blinkAt(t, seed) * (1 - cw);  // the camera brings real blinks
    p.gaze = lookLocal;
    p.walk = pl.walk;
    p.time = t;
    return { x: pl.x, z: pl.z, rot: pl.f, pose: p, moving: pl.moving };
  };

  /* ------------------------------------------------------------------ the camera */
  // returns {pos: V3, look: V3, fov, roll} for time t (shots, or a gentle wide when there are none)
  Film.prototype.camera = function (t, actors, aspect) {
    var d = this.doc.d, shots = this.shots, shot = null;
    for (var i = 0; i < shots.length; i++) { if (shots[i].t <= t + 1e-6) shot = shots[i]; else break; }
    var self = this;
    function headOf(aid) {
      var pl = self.place(aid, t, true), a = actors && actors[aid];
      return { x: pl.x, z: pl.z, f: pl.f, y: a ? a.headRest.y : 1.2, h: a ? a.height : 1.4, hr: a ? a.headR : 0.23 };
    }
    var ids = d.cast.map(function (c) { return c.id; });
    var spk = this.speakerAt(t);
    var type = shot ? shot.type : 'wide', move = shot ? shot.move || 'static' : 'drift';
    var a = shot && shot.a && this.paths[shot.a] ? shot.a : (spk || ids[0]);
    var bId = shot && shot.b && this.paths[shot.b] ? shot.b : (a ? this.partner(a, t) : null);
    var u = shot ? clamp((t - shot.t) / Math.max(0.5, shot.end - shot.t), 0, 1) : (t / Math.max(1, this.total));
    var pos = new T.Vector3(), look = new T.Vector3(), fov = 38, roll = 0;
    var A = a ? headOf(a) : { x: 0, z: 0, f: 0, y: 1.2, h: 1.4, hr: 0.23 }, B = bId ? headOf(bId) : null;
    var dirA = new T.Vector3(Math.sin(A.f), 0, Math.cos(A.f));
    var camDir = dirA.clone().multiplyScalar(0.55).add(new T.Vector3(0, 0, 1)).normalize();  // the 180-degree rule: stay on the audience side
    if (B && Math.hypot(B.x - A.x, B.z - A.z) > 0.2) {  // in a conversation, shoot from the side the actor is talking to
      var toB = new T.Vector3(B.x - A.x, 0, B.z - A.z).normalize();
      camDir = toB.multiplyScalar(0.75).add(new T.Vector3(0, 0, 0.85)).normalize();
    }
    var framedAll = false;
    function frameAll() {
      framedAll = true;
      var xs = [], zs = [], ys = [];
      ids.forEach(function (id) { var h = headOf(id); xs.push(h.x); zs.push(h.z); ys.push(h.h); });
      if (!xs.length) { xs = [0]; zs = [0]; ys = [1.4]; }
      var cx = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2, cz = (Math.min.apply(null, zs) + Math.max.apply(null, zs)) / 2;
      var spread = Math.max(Math.max.apply(null, xs) - Math.min.apply(null, xs), (Math.max.apply(null, zs) - Math.min.apply(null, zs)) * 0.6, 1.2);
      var hmax = Math.max.apply(null, ys);
      var ar = aspect || 16 / 9, fit = spread / Math.min(1.6, ar) * 1.35 + 2.4;
      look.set(cx, hmax * 0.55, cz); pos.set(cx, hmax * 0.8 + 0.5, cz + Math.max(4.2, fit)); fov = 38;
    }
    var dist;
    switch (type) {
      case 'wide': frameAll(); break;
      case 'full': look.set(A.x, A.h * 0.5, A.z); dist = A.h * 1.9 + 0.9; pos.copy(look).addScaledVector(camDir, dist); pos.y = A.h * 0.62; fov = 34; break;
      case 'medium': look.set(A.x, A.y - A.hr * 1.1, A.z); dist = A.h * 0.75 + 0.55; pos.copy(look).addScaledVector(camDir, dist); pos.y = A.y - A.hr * 0.4; fov = 30; break;
      case 'close': look.set(A.x, A.y - A.hr * 0.25, A.z); dist = A.hr * 4.2 + 0.35; pos.copy(look).addScaledVector(camDir, dist); pos.y = A.y; fov = 28; break;
      case 'ecu': look.set(A.x, A.y + A.hr * 0.12, A.z); dist = A.hr * 2.0 + 0.12; pos.copy(look).addScaledVector(camDir, dist); pos.y = A.y + A.hr * 0.12; fov = 22; break;
      case 'two':
        if (B) {
          var mid = new T.Vector3((A.x + B.x) / 2, (A.y + B.y) / 2 - 0.15, (A.z + B.z) / 2), sep = Math.hypot(A.x - B.x, A.z - B.z);
          var line = new T.Vector3(B.x - A.x, 0, B.z - A.z).normalize(), perp = new T.Vector3(-line.z, 0, line.x);
          if (perp.z < 0) perp.negate();
          look.copy(mid); pos.copy(mid).addScaledVector(perp, sep * 1.05 + 1.5); pos.y = mid.y + 0.15; fov = 34;
        } else frameAll();
        break;
      case 'ots':
        if (B) {
          var toA = new T.Vector3(A.x - B.x, 0, A.z - B.z).normalize(), side = new T.Vector3(-toA.z, 0, toA.x);
          if (side.z < 0) side.negate();
          pos.set(B.x, B.y + 0.12, B.z).addScaledVector(toA, -1.3).addScaledVector(side, 0.62);
          look.set(A.x, A.y - A.hr * 0.4, A.z); fov = 30;
        } else { look.set(A.x, A.y - A.hr, A.z); pos.copy(look).addScaledVector(camDir, 1.6); fov = 30; }
        break;
      case 'low': look.set(A.x, A.y - A.hr * 0.5, A.z); pos.copy(look).addScaledVector(camDir, A.h * 1.2 + 0.8); pos.y = 0.3; fov = 34; break;
      case 'high': look.set(A.x, A.h * 0.45, A.z); pos.copy(look).addScaledVector(camDir, A.h * 1.1 + 1.2); pos.y = A.h + 2.2; fov = 34; break;
      case 'dutch': look.set(A.x, A.y - A.hr * 1.1, A.z); pos.copy(look).addScaledVector(camDir, A.h * 0.8 + 0.6); pos.y = A.y - A.hr * 0.3; fov = 30; roll = 14 * D2R; break;
      case 'orbit':
        var base = Math.atan2(camDir.x, camDir.z) - 0.6 + u * 1.2, r = A.h * 1.4 + 1.2;
        look.set(A.x, A.y - A.hr * 1.2, A.z); pos.set(A.x + Math.sin(base) * r, A.y + 0.2, A.z + Math.cos(base) * r); fov = 34; break;
      case 'top': look.set(A.x, 0, A.z); pos.set(A.x, 6.5, A.z + 0.05); fov = 40; break;
      default: frameAll();
    }
    // tall canvases (reels, square, portrait) are narrow: step back so faces and two-shots still fit side to side
    var arr = aspect || 16 / 9;
    if (arr < 1.3 && !framedAll && type !== 'top') {
      var back = pos.clone().sub(look), dNow = back.length(), dNeed = dNow * Math.pow(1.3 / arr, 0.75);
      if (type === 'two' && B) {  // fit both actors exactly: half the gap plus a body width either side
        var halfH = Math.atan(Math.tan(fov * D2R / 2) * arr);
        dNeed = Math.max(dNow, (Math.hypot(A.x - B.x, A.z - B.z) / 2 + 0.6) / Math.tan(halfH));
      }
      if (dNow > 1e-3) pos.copy(look).addScaledVector(back, dNeed / dNow);
    }
    // camera moves
    var e = ease(u), off = pos.clone().sub(look);
    if (move === 'push') off.multiplyScalar(lerp(1.18, 0.86, e));
    if (move === 'pull') off.multiplyScalar(lerp(0.85, 1.22, e));
    if (move === 'drift') off.multiplyScalar(lerp(1.04, 0.97, e));
    pos.copy(look).add(off);
    if (move === 'pan') { var sd = new T.Vector3(-off.z, 0, off.x).normalize(); pos.addScaledVector(sd, lerp(-0.6, 0.6, e)); }
    if (move === 'crane') { pos.y += lerp(-0.35, 1.2, e); }
    if (move === 'shake') { pos.x += VT.noise(t * 2.1, 1) * 0.025; pos.y += VT.noise(t * 2.4, 5) * 0.02; roll += VT.noise(t * 1.7, 9) * 0.015; }
    if (move === 'crash' && shot) fov *= lerp(2.1, 1, ease((t - shot.t) / 0.22));
    pos.y = Math.max(0.2, pos.y); pos.z = Math.min(pos.z, 11); pos.x = clamp(pos.x, -9, 9);
    return { pos: pos, look: look, fov: fov, roll: roll, shot: shot, type: type };
  };

  /* ------------------------------------------------------------------ the auto-director */
  var STRONG = { surprised: 'crash', angry: 'push', scared: 'shake', laugh: null, love: 'push', sad: 'push' };
  VT.autoDirect = function (doc, takes) {
    var d = doc.d, L = doc.layout(takes && takes.map);
    var shots = [], last = null, ids = d.cast.map(function (c) { return c.id; });
    function add(beat, at, type, a, b, move) {
      if (last && last.type === type && last.a === a && last.b === b) return;
      var s = { id: VT.uid('s'), beat: beat, at: Math.round(at * 100) / 100, type: type, a: a || null, b: b || null, move: move || 'static' };
      shots.push(s); last = s;
    }
    var pattern = ['medium', 'ots', 'close', 'medium', 'two'], k = 0, lastSpeaker = null;
    L.beats.forEach(function (b, i) {
      var bd = d.beats[i];
      if (i === 0) { add(b.id, -Math.min(d.lead, 1.2), 'wide', null, null, 'drift'); }
      if (b.kind === 'action') { add(b.id, 0, i % 2 ? 'wide' : 'orbit', bd.who || ids[0], null, i % 2 ? 'pan' : 'static'); lastSpeaker = null; return; }
      var s = b.who, other = null;
      for (var j = i - 1; j >= 0 && !other; j--) if (L.beats[j].who && L.beats[j].who !== s && L.beats[j].kind === 'line') other = L.beats[j].who;
      for (var j2 = i + 1; j2 < L.beats.length && !other; j2++) if (L.beats[j2].who && L.beats[j2].who !== s && L.beats[j2].kind === 'line') other = L.beats[j2].who;
      if (!other) other = ids.filter(function (x) { return x !== s; })[0] || null;
      var strong = bd.emo && Object.prototype.hasOwnProperty.call(STRONG, bd.emo);
      if (i > 0 && i % 6 === 0) { add(b.id, 0, ids.length > 2 ? 'wide' : 'two', s, other, 'drift'); }
      else if (strong) { add(b.id, 0, 'close', s, other, STRONG[bd.emo] || 'static'); }
      else if (s === lastSpeaker && b.dur < 2.5) { /* keep the shot */ }
      else {
        var type = other ? pattern[k % pattern.length] : ['medium', 'close', 'full'][k % 3]; k++;
        if (type === 'ots' && !other) type = 'medium';
        add(b.id, 0, type, s, other, type === 'medium' && k % 2 ? 'push' : 'static');
      }
      if (b.dur > 4.2 && other) add(b.id, Math.round(b.dur * 0.62 * 100) / 100, 'close', other, s, 'static');  // a reaction shot
      lastSpeaker = s;
    });
    doc.change('shots', function (dd) { dd.shots = shots; });
    return shots.length;
  };

  /* ------------------------------------------------------------------ scripts in, scripts out */
  var EMO_WORDS = { happy: 'happy', excited: 'happy', cheerful: 'happy', glad: 'happy', proud: 'happy', laughing: 'laugh', laughs: 'laugh', laugh: 'laugh', giggling: 'laugh',
    sad: 'sad', crying: 'sad', upset: 'sad', gloomy: 'sad', angry: 'angry', mad: 'angry', furious: 'angry', shouting: 'angry', annoyed: 'angry',
    surprised: 'surprised', shocked: 'surprised', amazed: 'surprised', astonished: 'surprised', scared: 'scared', afraid: 'scared', nervous: 'scared', terrified: 'scared', worried: 'scared',
    smug: 'smug', sly: 'smug', smirking: 'smug', sarcastic: 'smug', love: 'love', dreamy: 'love', swooning: 'love', loving: 'love',
    thinking: 'thinking', thoughtful: 'thinking', pondering: 'thinking', puzzled: 'thinking', confused: 'thinking', sleepy: 'sleepy', tired: 'sleepy', yawning: 'sleepy',
    shy: 'shy', embarrassed: 'shy', bashful: 'shy', deadpan: 'neutral', calm: 'neutral', flat: 'neutral', whispering: 'neutral' };
  VT.emoFromWord = function (w) { w = String(w || '').toLowerCase().trim(); if (VT.EMO[w]) return w; var hit = ''; w.split(/[^a-z]+/).forEach(function (x) { if (!hit && EMO_WORDS[x]) hit = EMO_WORDS[x]; }); return hit; };
  /* "NAME: (emotion) words", "NAME (emotion): words", "[ACTION 3s] what happens", "ACTION: what happens", "INT. DINER - NIGHT" */
  VT.parseScript = function (text) {
    var beats = [], names = [], scenes = [];
    String(text || '').replace(/\r/g, '').split('\n').forEach(function (raw) {
      var line = raw.trim();
      if (!line || /^(FADE IN|FADE OUT|CUT TO|THE END)/i.test(line)) return;
      if (/^(INT|EXT|INT\/EXT)[.\s]/i.test(line)) { scenes.push(line); return; }
      var m = /^\[\s*action\s*(\d+(?:\.\d+)?)?\s*s?\s*\]\s*(.*)$/i.exec(line) || /^action\s*(\d+(?:\.\d+)?)?\s*s?\s*:\s*(.*)$/i.exec(line);
      if (m) { beats.push({ kind: 'action', text: m[2] || '', dur: m[1] ? +m[1] : 3 }); return; }
      var d = /^([A-Za-z][A-Za-z0-9 .'\-]{0,24}?)\s*(\(([^)]*)\))?\s*:\s*(\(([^)]*)\))?\s*(.+)$/.exec(line);
      if (d) {
        var name = d[1].trim().toUpperCase(), emoWord = d[3] || d[5] || '';
        if (names.indexOf(name) < 0) names.push(name);
        var words = d[6].trim(), emo = VT.emoFromWord(emoWord);
        if (!emo) emo = /\?!|!\?/.test(words) ? 'surprised' : '';
        beats.push({ kind: 'line', name: name, text: words.slice(0, 400), emo: emo });
        return;
      }
      if (beats.length && beats[beats.length - 1].kind === 'line' && !/^[A-Z ]+$/.test(line)) beats[beats.length - 1].text += ' ' + line;
      else beats.push({ kind: 'action', text: line.slice(0, 300), dur: 2.5 });
    });
    return { beats: beats, names: names, scenes: scenes };
  };
  VT.scriptText = function (doc) {
    var d = doc.d, names = {};
    d.cast.forEach(function (c) { names[c.id] = c.name; });
    return d.beats.map(function (b) {
      if (b.kind === 'action') return '[ACTION ' + (b.dur || 3) + 's] ' + (b.text || '');
      return (names[b.who] || 'SOMEONE') + ': ' + (b.emo ? '(' + b.emo + ') ' : '') + (b.text || '');
    }).join('\n');
  };
  /* merge a parsed script into the doc: names map to existing cast (or new cast members from VT.CAST, matched by name) */
  Doc.prototype.applyScript = function (text, mode) {
    var p = VT.parseScript(text), self = this;
    if (!p.beats.length) return 0;
    var map = {};
    this.d.cast.forEach(function (c) { map[c.name.toUpperCase()] = c.id; });
    var usedChars = this.d.cast.map(function (c) { return c.char; });
    p.names.forEach(function (n) {
      if (map[n]) return;
      var hit = VT.CAST.filter(function (c) { return c.name.toUpperCase().split(' ').indexOf(n) >= 0 || c.id.toUpperCase() === n; })[0];
      if (!hit) hit = VT.CAST.filter(function (c) { return usedChars.indexOf(c.id) < 0; })[0] || VT.CAST[0];
      usedChars.push(hit.id);
      map[n] = self.addCast(hit.id, n);
    });
    return this.change('script', function (d) {
      var beats = p.beats.map(function (b) {
        return b.kind === 'action' ? { id: VT.uid('b'), kind: 'action', who: null, text: b.text, dur: b.dur, gap: 0.35, emo: '' }
          : { id: VT.uid('b'), kind: 'line', who: map[b.name], text: b.text, emo: b.emo || '', gap: 0.35 };
      });
      if (mode === 'replace') {
        d.beats = beats; d.keys = { move: [], emo: [], act: [], look: [] }; d.shots = []; d.sfx = []; d.sel = {};
      } else d.beats = d.beats.concat(beats);
      return beats.length;
    });
  };
  /* a new production from a template */
  VT.TEMPLATES = [
    { id: 'blank', label: 'Blank page', set: 'soundstage', cast: ['max', 'rosie'], script: 'MAX: (happy) Hello there!\nROSIE: (smug) You again?' },
    { id: 'meet', label: 'Meet cute', set: 'diner', cast: ['max', 'rosie'], grade: 'pastel', music: 'romance',
      script: 'MAX: (shy) Is this seat taken?\nROSIE: (thinking) Depends. Do you like pie?\nMAX: (happy) I love pie!\nROSIE: (laugh) Then sit down, pie person.' },
    { id: 'showdown', label: 'Showdown', set: 'western', cast: ['duke', 'baron'], grade: 'sepia', music: 'western',
      script: 'DUKE: (angry) Draw, partner.\nBARON: (smug) Draw what? A bath?\n[ACTION 2s] They stare each other down.\nDUKE: (surprised) ...Actually, a bath sounds nice.' },
    { id: 'mystery', label: 'Mystery', set: 'noir', cast: ['vera', 'lou'], grade: 'noir', music: 'noir',
      script: 'VERA: (thinking) Somebody took the crown jewels.\nLOU: (scared) In this weather?\nVERA: (smug) Crime never checks the forecast, Lou.' },
    { id: 'space', label: 'Space opera', set: 'space', cast: ['nova', 'bolt'], grade: 'neon', music: 'space',
      script: 'NOVA: (happy) Set a course for adventure!\nBOLT: (scared) Adventure is not on the map, Captain.\nNOVA: (smug) Then we draw a new map.' },
    { id: 'spooky', label: 'Spooky night', set: 'haunted', cast: ['boo', 'pip'], grade: 'moonlight', music: 'spooky',
      script: 'PIP: (scared) Is anybody there?\nBOO: (scared) I was going to ask you the same thing!\nPIP: (laugh) You are a ghost scared of the dark?' }
  ];
  VT.newDoc = function (title, templateId, opts) {
    opts = opts || {};
    var tp = VT.TEMPLATES.filter(function (x) { return x.id === templateId; })[0] || VT.TEMPLATES[0];
    var doc = new Doc({ title: title || tp.label, set: opts.set || tp.set, look: { grade: tp.grade || 'technicolor', aspect: VT.ASPECT_BY && VT.ASPECT_BY[opts.aspect] ? opts.aspect : '16:9', fps: 24 }, music: { id: tp.music || 'none', vol: 0.3 } });
    var names = [];
    tp.cast.forEach(function (c) { var id = doc.addCast(c); names.push(doc.actor(id).name); });
    var script = tp.script;
    // template scripts use the default short names: map them to whatever names the cast got
    doc.applyScript(script, 'replace');
    VT.autoDirect(doc);
    doc.undoStack = []; doc.redoStack = [];
    return doc;
  };

  /* ------------------------------------------------------------------ voice effects (live playback, the editor, exports) */
  VT.voiceChain = function (ctx, fx) {
    var input = ctx.createGain(), output = ctx.createGain(), stops = [];
    function curve(k) { var n = 256, c = new Float32Array(n); for (var i = 0; i < n; i++) { var x = i * 2 / n - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); } return c; }
    function filt(type, f, q) { var b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; return b; }
    if (fx === 'radio' || fx === 'phone' || fx === 'megaphone') {
      var hp = filt('highpass', fx === 'phone' ? 700 : fx === 'megaphone' ? 650 : 450), lp = filt('lowpass', fx === 'phone' ? 2800 : fx === 'megaphone' ? 4200 : 3200);
      var sh = ctx.createWaveShaper(); sh.curve = curve(fx === 'megaphone' ? 18 : fx === 'phone' ? 8 : 4);
      input.connect(hp); hp.connect(lp); lp.connect(sh); sh.connect(output); output.gain.value = 0.8;
    } else if (fx === 'robot') {
      var ring = ctx.createGain(); ring.gain.value = 0;
      var osc = ctx.createOscillator(); osc.frequency.value = 55; osc.type = 'square'; osc.connect(ring.gain); osc.start(); stops.push(osc);
      input.connect(ring); ring.connect(output); var dry = ctx.createGain(); dry.gain.value = 0.25; input.connect(dry); dry.connect(output);
    } else if (fx === 'echo' || fx === 'cave') {
      var dl = ctx.createDelay(1.0); dl.delayTime.value = fx === 'cave' ? 0.09 : 0.24;
      var fb = ctx.createGain(); fb.gain.value = fx === 'cave' ? 0.55 : 0.33;
      var wet = ctx.createGain(); wet.gain.value = fx === 'cave' ? 0.5 : 0.4;
      var lp2 = filt('lowpass', fx === 'cave' ? 1800 : 5000);
      input.connect(output); input.connect(dl); dl.connect(lp2); lp2.connect(fb); fb.connect(dl); lp2.connect(wet); wet.connect(output);
    } else input.connect(output);
    return { input: input, output: output, stop: function () { stops.forEach(function (s) { try { s.stop(); } catch (e) {} }); } };
  };
})();
