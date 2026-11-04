/* vt-ed.js: VT.ed, plain rows and small jobs for the Python panels of the editor (client_code/vt.py calls these).
   Rows come back as JSON strings: Python turns them into lists of dicts for RepeatingPanels in one step. */
(function () {
  'use strict';
  var VT = window.VT = window.VT || {};
  var ed = VT.ed = {};
  function nameOf(doc, id) { var a = doc.actor(id); return a ? a.name : ''; }
  function fmt(t) { return VT.fmtTime ? VT.fmtTime(t || 0) : String(t); }

  ed.beats = function (doc, takes) {
    var L = doc.layout(takes && takes.map), cols = VT.ACTOR_COLS || [];
    var colOf = {}; doc.d.cast.forEach(function (c, i) { colOf[c.id] = cols[i % cols.length]; });
    return JSON.stringify(doc.d.beats.map(function (b, i) {
      var lb = L.by[b.id] || {};
      var uid = b.who && doc.d.sel[b.id + '|' + b.who], tk = uid && takes && takes.map[uid];
      return { id: b.id, n: i + 1, kind: b.kind, who: b.who || '', name: b.kind === 'action' ? 'ACTION' : nameOf(doc, b.who), text: b.text || '', emo: b.emo || '',
        gap: b.gap == null ? 0.35 : b.gap, dur: Math.round((lb.dur || 0) * 10) / 10, start: fmt(lb.start), recorded: !!tk,
        col: b.kind === 'action' ? '#8a7e82' : (colOf[b.who] || '#888'), source: tk ? tk.source : '' };
    }));
  };
  ed.cast = function (doc) {
    return JSON.stringify(doc.d.cast.map(function (c, i) {
      var def = VT.charDef(c.char, doc.d.custom), lines = doc.d.beats.filter(function (b) { return b.kind === 'line' && b.who === c.id; });
      var rec = lines.filter(function (b) { return !!doc.d.sel[b.id + '|' + c.id]; }).length;
      return { id: c.id, name: c.name, char: c.char, charName: def.name, fx: c.fx || 'none', vol: c.vol == null ? 1 : c.vol, lines: lines.length, recorded: rec,
        col: (VT.ACTOR_COLS || [])[i % 8], portrait: VT.portrait(def, { emo: 'happy', size: 160 }) };
    }));
  };
  ed.takes = function (doc, takes) {
    var list = takes.list().filter(function (t) { return !t.temp; });
    list.sort(function (a, b) { return String(b.created || '').localeCompare(String(a.created || '')); });
    return JSON.stringify(list.map(function (t) {
      var used = (t.clips || []).filter(function (c) { return doc.d.sel[c.beat + '|' + t.actor] === t.uid; }).length;
      var lines = (t.clips || []).filter(function (c) { return c.line; }).length;
      return { uid: t.uid, actor: t.actor, name: nameOf(doc, t.actor) || '(gone)', source: t.source || 'vr', clips: (t.clips || []).length, lines: lines,
        used: used, dur: Math.round((t.dur || 0) * 10) / 10, stars: t.stars || 0, created: t.created || '', builtin: !!(t.audioUrl && t.audioUrl.indexOf('_/theme/') === 0),
        face: !!(t.face || t.faceUrl) };
    }));
  };
  ed.shots = function (doc, takes) {
    var L = doc.layout(takes && takes.map);
    var list = doc.d.shots.map(function (s) { return { id: s.id, t: L.abs(s.beat, s.at), type: s.type, a: s.a || '', b: s.b || '', move: s.move || 'static' }; })
      .filter(function (s) { return s.t != null; }).sort(function (x, y) { return x.t - y.t; });
    list.forEach(function (s) { s.time = fmt(s.t); s.aName = nameOf(doc, s.a); });
    return JSON.stringify(list);
  };
  ed.key = function (doc, takes, id) {
    var f = doc.findKey(id); if (!f) return '';
    var L = doc.layout(takes && takes.map), t = L.abs(f.key.beat, f.key.at);
    return JSON.stringify(Object.assign({ kind: f.kind, time: fmt(t), t: t, actorName: nameOf(doc, f.key.actor) }, f.key));
  };
  ed.anchor = function (doc, takes, t) { return JSON.stringify(doc.anchor(t, doc.layout(takes && takes.map))); };
  ed.stats = function (doc, takes) {
    var L = doc.layout(takes && takes.map), lines = doc.d.beats.filter(function (b) { return b.kind === 'line'; });
    var rec = lines.filter(function (b) { return b.who && doc.d.sel[b.id + '|' + b.who]; }).length;
    return JSON.stringify({ total: L.total, time: fmt(L.total), lines: lines.length, recorded: rec, beats: doc.d.beats.length, shots: doc.d.shots.length, cast: doc.d.cast.length, lead: L.lead });
  };
  // select every clip of a take for its actor ("use this take")
  ed.useTake = function (doc, takes, uid) {
    var t = takes.map[uid]; if (!t) return 0;
    doc.change('sel', function (d) { (t.clips || []).forEach(function (c) { if (doc.beat(c.beat)) d.sel[c.beat + '|' + t.actor] = uid; }); });
    return (t.clips || []).length;
  };
  ed.dropTake = function (doc, takes, uid) {
    takes.remove(uid);
    doc.change('sel', function (d) { Object.keys(d.sel).forEach(function (k) { if (d.sel[k] === uid) delete d.sel[k]; }); });
  };
  ed.mergeSel = function (doc, sel) {
    var n = 0;
    Object.keys(sel || {}).forEach(function (k) { if (doc.d.sel[k] !== sel[k]) { doc.d.sel[k] = sel[k]; n++; } });
    if (n) doc.emit('sel');
    return n;
  };

  /* the PC voice booth: record one line from the microphone, trim the silence, make a voice-only take */
  ed.recorder = function () {
    var r = { chunks: [], stream: null, rec: null, t0: 0, pass: null };
    r.start = function () {
      return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(function (s) {
        r.stream = s; r.chunks = [];
        var mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].filter(function (m) { return window.MediaRecorder && MediaRecorder.isTypeSupported(m); })[0] || '';
        r.rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
        r.rec.ondataavailable = function (e) { if (e.data && e.data.size) r.chunks.push(e.data); };
        r.rec.start(250); r.t0 = performance.now();
        return true;
      }).catch(function (e) { r.error = String(e && e.message || e); return false; });
    };
    r.stop = function (beatId, actorId) {
      return new Promise(function (res) {
        if (!r.rec) { res(null); return; }
        r.rec.onstop = function () {
          r.stream.getTracks().forEach(function (t) { t.stop(); });
          var blob = new Blob(r.chunks, { type: (r.chunks[0] && r.chunks[0].type) || 'audio/webm' });
          blob.arrayBuffer().then(function (ab) { return new Promise(function (ok) { VT.audioCtx().decodeAudioData(ab, ok, function () { ok(null); }); }); }).then(function (buf) {
            var dur = buf ? buf.duration : (performance.now() - r.t0) / 1000, m = buf ? VT.analyzeVoice(buf, 30) : '';
            var span = VT.speechSpan(m, 30);
            var s0 = span ? span.start : 0, s1 = span ? span.end : dur;
            var off = Math.max(0, s0 - 0.08), len = Math.max(0.5, Math.min(dur - off, s1 - s0 + 0.25));
            r.pass = { uid: VT.uid('t'), actor: actorId, source: 'voice', dur: dur, clips: [{ beat: beatId, off: Math.round(off * 1000) / 1000, dur: Math.round(len * 1000) / 1000, line: true }],
              motion: { fps: 30, n: 0, f: new Float32Array(0), m: m }, audio: blob, buffer: buf, heard: !!span, len: Math.round(len * 10) / 10 };
            res(r.pass);
          });
        };
        r.rec.stop();
      });
    };
    r.play = function () { if (!r.pass || !r.pass.buffer) return; var ctx = VT.audioCtx(), s = ctx.createBufferSource(); s.buffer = r.pass.buffer; s.connect(ctx.destination); s.start(0, r.pass.clips[0].off, r.pass.clips[0].dur); };
    r.cancel = function () { try { if (r.rec && r.rec.state !== 'inactive') r.rec.stop(); } catch (e) {} if (r.stream) r.stream.getTracks().forEach(function (t) { t.stop(); }); };
    return r;
  };
  ed.passMeta = function (p) { return JSON.stringify({ uid: p.uid, actor: p.actor, source: p.source, dur: Math.round((p.dur || 0) * 1000) / 1000, clips: p.clips }); };
  ed.passMotion = function (p) { return JSON.stringify(VT.packMotion(p.motion)); };
  /* add a kept pass to the engine's takes (after the server saved it) */
  ed.addPass = function (takes, p, savedJson) {
    var saved = savedJson ? JSON.parse(savedJson) : null;
    var t = takes.add({ uid: p.uid, actor: p.actor, source: p.source, clips: (saved && saved.clips) || p.clips, dur: p.dur, motion: p.motion, created: saved && saved.created, stars: 0, temp: false });
    if (saved) { t.motionUrl = saved.motion_key ? VT.mediaUrl(saved.motion_key) : null; t.audioUrl = saved.audio_key ? VT.mediaUrl(saved.audio_key) : null; t.faceUrl = saved.face_key ? VT.mediaUrl(saved.face_key) : null; }
    if (p.buffer) t.buffer = p.buffer;
    else if (p.audio) p.audio.arrayBuffer().then(function (ab) { VT.audioCtx().decodeAudioData(ab, function (b) { t.buffer = b; }, function () {}); });
    return t.uid;
  };
  /* after a face pass was saved (or removed): the take's recordings have a new key on the server */
  ed.takeSaved = function (takes, savedJson) {
    var saved = JSON.parse(savedJson), t = takes.map[saved.uid];
    if (!t) return false;
    t.motionUrl = saved.motion_key ? VT.mediaUrl(saved.motion_key) : null;
    if (!t.audioUrl || t.audioUrl.indexOf('_/theme/') !== 0 || saved.audio_key) t.audioUrl = saved.audio_key ? VT.mediaUrl(saved.audio_key) : (saved.asset ? '_/theme/' + saved.asset : null);
    t.faceUrl = saved.face_key ? VT.mediaUrl(saved.face_key) : null;
    if (!saved.face_key) t.face = null;
    return true;
  };
  ed.exportVideo = function (stage, o, bar) {
    var job = VT.exportVideo(stage, Object.assign({}, o, { onProgress: function (p) { if (bar) bar.style.width = Math.round(p * 100) + '%'; } }));
    ed._job = job;
    return job.done;
  };
  ed.cancelExport = function () { if (ed._job) ed._job.cancel(); };
  ed.copy = function (text) { try { navigator.clipboard.writeText(text); return true; } catch (e) { return false; } };
  ed.lists = function () {
    return JSON.stringify({ sets: VT.SETS.map(function (x) { return { id: x.id, name: x.name, blurb: x.blurb }; }),
      sfx: VT.SFX.map(function (x) { return { id: x.id, label: x.label }; }) });
  };
  ed.device = function () { var u = navigator.userAgent; return /OculusBrowser|Quest/i.test(u) ? 'Meta Quest' : /Pico/i.test(u) ? 'Pico' : /Vision/i.test(u) ? 'Vision Pro' : /Mobile/i.test(u) ? 'Phone' : 'Computer'; };
})();
