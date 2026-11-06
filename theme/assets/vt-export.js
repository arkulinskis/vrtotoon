/* vt-export.js: getting films out of VRtoToon, all in the browser (nothing is uploaded to export).
     VT.exportVideo(stage, {w, h, fps, subs, onProgress}) -> {done: Promise<{blob, mime, ext}>, cancel()}
        real-time render of the finished film (grade, letterbox, titles, subtitles) + the full sound mix, via MediaRecorder
     VT.exportGLB(stage, {fps}) -> Promise<{blob, info}>   glTF 2.0 binary: the set, every character as a jointed
        hierarchy with baked animation (head, hands, arms, legs, face: eyelids, brows, mouth), the film camera (cuts and
        lens changes in extras), the lights (KHR_lights_punctual). Blender imports it with File > Import > glTF.
     VT.mixdown(stage) -> Promise<AudioBuffer>; VT.wav(buffer) -> Blob; VT.srt(stage) -> string
     VT.blenderKit(stage, {fps}) -> Promise<Blob> a .zip: film.glb, dialogue.wav, subtitles.srt, import_vrtotoon.py, README.txt
     VT.zip([{name, data: Uint8Array | string}]) -> Blob (stored, no compression)
     VT.download(blob, name) */
(function () {
  'use strict';
  var VT = window.VT = window.VT || {};
  var T = window.THREE;
  if (!T) return;

  VT.download = function (blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  };
  VT.slug = function (s) { return String(s || 'film').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'film'; };
  VT.videoMime = function () {
    if (!window.MediaRecorder) return null;
    var list = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (var i = 0; i < list.length; i++) if (MediaRecorder.isTypeSupported(list[i])) return list[i];
    return null;
  };
  function preload(stage) {
    var d = stage.doc.d, jobs = [stage.takes.loadAll()];
    stage.film.sfx.forEach(function (x) { jobs.push(VT.sfxBuffer(x.sfx)); });
    jobs.push(VT.musicBuffer(d.music && d.music.id));
    return Promise.all(jobs);
  }

  /* ------------------------------------------------------------------ video */
  VT.exportVideo = function (stage, o) {
    o = o || {};
    var cancelled = false, rec = null, sources = [], chains = [];
    var done = preload(stage).then(function () {
      var mime = VT.videoMime();
      if (!mime) throw new Error('This browser can\'t record video. Try Chrome, Edge or Safari.');
      stage.pause(); stage.film.refresh();
      var w = o.w || 1280, h = o.h || 720, fps = o.fps || 30, total = stage.total;
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      var c2 = cv.getContext('2d');
      c2.fillStyle = '#000'; c2.fillRect(0, 0, w, h);
      var vstream = cv.captureStream(fps);
      var ctx = VT.audioCtx(), dest = ctx.createMediaStreamDestination();
      var tracks = vstream.getVideoTracks().concat(dest.stream.getAudioTracks());
      var stream = new MediaStream(tracks), chunks = [];
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: o.bitrate || (w * h > 1e6 ? 8e6 : 5e6) });
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      var when = ctx.currentTime + 0.35;
      return VT.scheduleAudio(ctx, dest, stage.doc, stage.film, 0, when, sources, chains).then(function () {
        return new Promise(function (resolve, reject) {
          rec.onstop = function () {
            if (cancelled) { reject(new Error('cancelled')); return; }
            var type = mime.split(';')[0];
            resolve({ blob: new Blob(chunks, { type: type }), mime: type, ext: type.indexOf('mp4') >= 0 ? 'mp4' : 'webm' });
          };
          rec.start(1000);
          var lastT = -1;
          function step() {
            if (cancelled) { try { rec.stop(); } catch (e) {} return; }
            var t = ctx.currentTime - when;
            if (t >= total + 0.25) { setTimeout(function () { rec.stop(); }, 150); return; }
            var tt = Math.max(0, Math.min(total, t));
            if (tt !== lastT) { stage.renderAt(tt, w, h, c2, { subs: o.subs, final: true }); lastT = tt; }
            if (o.onProgress) o.onProgress(Math.max(0, Math.min(1, t / total)));
            if (document.hidden) setTimeout(step, 1000 / fps); else requestAnimationFrame(step);
          }
          step();
        });
      });
    });
    return { done: done.finally(function () { sources.forEach(function (s) { try { s.stop(); } catch (e) {} }); chains.forEach(function (c) { c.stop(); }); }),
      cancel: function () { cancelled = true; } };
  };

  /* ------------------------------------------------------------------ audio out */
  VT.mixdown = function (stage, o) {
    o = o || {};
    return preload(stage).then(function () {
      var rate = 48000, total = stage.total, ctx = new OfflineAudioContext(2, Math.ceil(rate * total), rate);
      var sources = [], chains = [];
      var doc = stage.doc;
      if (o.dialogueOnly) doc = new VT.Doc(Object.assign(JSON.parse(stage.doc.json()), { sfx: [], music: { id: 'none' } }));
      var film = o.dialogueOnly ? new VT.Film(doc, stage.takes) : stage.film;
      return VT.scheduleAudio(ctx, ctx.destination, doc, film, 0, 0, sources, chains).then(function () { return ctx.startRendering(); });
    });
  };
  VT.wav = function (buf) {
    var ch = buf.numberOfChannels, n = buf.length, rate = buf.sampleRate, bytes = 44 + n * ch * 2;
    var ab = new ArrayBuffer(bytes), v = new DataView(ab), p = 0;
    function s(str) { for (var i = 0; i < str.length; i++) v.setUint8(p++, str.charCodeAt(i)); }
    function u32(x) { v.setUint32(p, x, true); p += 4; } function u16(x) { v.setUint16(p, x, true); p += 2; }
    s('RIFF'); u32(bytes - 8); s('WAVE'); s('fmt '); u32(16); u16(1); u16(ch); u32(rate); u32(rate * ch * 2); u16(ch * 2); u16(16); s('data'); u32(n * ch * 2);
    var data = []; for (var c = 0; c < ch; c++) data.push(buf.getChannelData(c));
    for (var i = 0; i < n; i++) for (var k = 0; k < ch; k++) { var x = Math.max(-1, Math.min(1, data[k][i])); v.setInt16(p, x < 0 ? x * 32768 : x * 32767, true); p += 2; }
    return new Blob([ab], { type: 'audio/wav' });
  };
  function stamp(t) {
    var ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, r = ms % 1000;
    function z(x, n) { x = String(x); while (x.length < n) x = '0' + x; return x; }
    return z(h, 2) + ':' + z(m, 2) + ':' + z(s, 2) + ',' + z(r, 3);
  }
  VT.srt = function (stage) {
    var out = [], n = 1;
    stage.film.L.beats.forEach(function (b) {
      if (b.kind !== 'line' || !b.text) return;
      var a = stage.doc.actor(b.who);
      out.push(n++ + '\n' + stamp(b.start) + ' --> ' + stamp(b.end + 0.1) + '\n' + (a ? a.name + ': ' : '') + b.text + '\n');
    });
    return out.join('\n');
  };

  /* ------------------------------------------------------------------ zip (stored) */
  var CRC = null;
  function crc32(u8) {
    if (!CRC) { CRC = new Uint32Array(256); for (var i = 0; i < 256; i++) { var c = i; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[i] = c >>> 0; } }
    var x = 0xFFFFFFFF; for (var j = 0; j < u8.length; j++) x = CRC[(x ^ u8[j]) & 255] ^ (x >>> 8);
    return (x ^ 0xFFFFFFFF) >>> 0;
  }
  VT.zip = function (files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, name = enc.encode(f.name), crc = crc32(data);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
      parts.push(h.buffer, name, data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(c.buffer, name);
      offset += 30 + name.length + data.length;
    });
    var size = central.reduce(function (a, b) { return a + (b.byteLength || b.length); }, 0);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [e.buffer]), { type: 'application/zip' });
  };

  /* ------------------------------------------------------------------ glTF 2.0 binary */
  function Gltf() {
    this.j = { asset: { version: '2.0', generator: 'VRtoToon' }, scene: 0, scenes: [{ name: 'Film', nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [], animations: [], cameras: [], textures: [], images: [], samplers: [] };
    this.bin = []; this.len = 0; this.geo = {}; this.mats = {};
  }
  Gltf.prototype.view = function (typed, target) {
    var bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength), pad = (4 - (this.len % 4)) % 4;
    if (pad) { this.bin.push(new Uint8Array(pad)); this.len += pad; }
    var v = { buffer: 0, byteOffset: this.len, byteLength: bytes.length }; if (target) v.target = target;
    this.bin.push(bytes); this.len += bytes.length;
    this.j.bufferViews.push(v); return this.j.bufferViews.length - 1;
  };
  Gltf.prototype.acc = function (typed, type, comp, target, minmax) {
    var n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    var a = { bufferView: this.view(typed, target), componentType: comp, count: typed.length / n, type: type };
    if (minmax) {
      var mn = [], mx = [];
      for (var k = 0; k < n; k++) { mn.push(Infinity); mx.push(-Infinity); }
      for (var i = 0; i < typed.length; i++) { var c = i % n; if (typed[i] < mn[c]) mn[c] = typed[i]; if (typed[i] > mx[c]) mx[c] = typed[i]; }
      a.min = mn; a.max = mx;
    }
    this.j.accessors.push(a); return this.j.accessors.length - 1;
  };
  Gltf.prototype.material = function (m) {
    var key = m.uuid;
    if (this.mats[key] != null) return this.mats[key];
    var col = m.color || new T.Color(1, 1, 1), op = m.transparent ? (m.opacity == null ? 1 : m.opacity) : 1;
    var mat = { name: (m.userData && m.userData.vtColor) || m.type, pbrMetallicRoughness: { baseColorFactor: [col.r, col.g, col.b, op], metallicFactor: 0, roughnessFactor: 0.85 }, doubleSided: m.side === T.DoubleSide || m.side === T.BackSide };
    if (op < 1) mat.alphaMode = 'BLEND';
    if (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0) mat.emissiveFactor = [Math.min(1, m.emissive.r * (m.emissiveIntensity || 1)), Math.min(1, m.emissive.g * (m.emissiveIntensity || 1)), Math.min(1, m.emissive.b * (m.emissiveIntensity || 1))];
    if (m.isMeshBasicMaterial) { mat.extensions = { KHR_materials_unlit: {} }; this.used('KHR_materials_unlit'); }
    if (m.map && m.map.image && m.map.image.toDataURL) {
      var url = m.map.image.toDataURL('image/png'), raw = atob(url.split(',')[1]), u8 = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
      this.j.images.push({ bufferView: this.view(u8), mimeType: 'image/png' });
      if (!this.j.samplers.length) this.j.samplers.push({ wrapS: 10497, wrapT: 10497 });
      this.j.textures.push({ source: this.j.images.length - 1, sampler: 0 });
      var info = { index: this.j.textures.length - 1 };
      var rep = m.map.repeat;
      if (rep && (rep.x !== 1 || rep.y !== 1)) { info.extensions = { KHR_texture_transform: { scale: [rep.x, rep.y] } }; this.used('KHR_texture_transform'); }
      mat.pbrMetallicRoughness.baseColorTexture = info;
    }
    this.j.materials.push(mat);
    return (this.mats[key] = this.j.materials.length - 1);
  };
  Gltf.prototype.used = function (ext) { this.j.extensionsUsed = this.j.extensionsUsed || []; if (this.j.extensionsUsed.indexOf(ext) < 0) this.j.extensionsUsed.push(ext); };
  Gltf.prototype.mesh = function (o) {
    var g = o.geometry, key = g.uuid + '|' + o.material.uuid;
    if (this.geo[key] != null) return this.geo[key];
    var at = g.attributes, prim = { attributes: {}, material: this.material(o.material) };
    prim.attributes.POSITION = this.acc(new Float32Array(at.position.array), 'VEC3', 5126, 34962, true);
    if (at.normal) prim.attributes.NORMAL = this.acc(new Float32Array(at.normal.array), 'VEC3', 5126, 34962);
    if (at.uv && o.material.map) prim.attributes.TEXCOORD_0 = this.acc(flipV(at.uv.array), 'VEC2', 5126, 34962);
    if (g.index) { var big = at.position.count > 65535; prim.indices = this.acc(big ? new Uint32Array(g.index.array) : new Uint16Array(g.index.array), 'SCALAR', big ? 5125 : 5123, 34963); }
    this.j.meshes.push({ name: o.name || 'mesh', primitives: [prim] });
    return (this.geo[key] = this.j.meshes.length - 1);
  };
  function flipV(a) { var o = new Float32Array(a.length); for (var i = 0; i < a.length; i += 2) { o[i] = a[i]; o[i + 1] = 1 - a[i + 1]; } return o; }
  Gltf.prototype.glb = function () {
    var json = new TextEncoder().encode(JSON.stringify(this.j)), jpad = (4 - json.length % 4) % 4;
    var bpad = (4 - this.len % 4) % 4, binLen = this.len + bpad;
    var total = 12 + 8 + json.length + jpad + 8 + binLen, out = new Uint8Array(total), v = new DataView(out.buffer), p = 0;
    v.setUint32(p, 0x46546C67, true); v.setUint32(p + 4, 2, true); v.setUint32(p + 8, total, true); p += 12;
    v.setUint32(p, json.length + jpad, true); v.setUint32(p + 4, 0x4E4F534A, true); p += 8;
    out.set(json, p); p += json.length; for (var i = 0; i < jpad; i++) out[p++] = 0x20;
    v.setUint32(p, binLen, true); v.setUint32(p + 4, 0x004E4942, true); p += 8;
    this.bin.forEach(function (b) { out.set(b, p); p += b.length; });
    return out;
  };
  function keepNode(o) {
    if (o.userData.outline || o.userData.fx || o.isPoints || o.isLine || o.isLineSegments || o.isLight) return false;
    if (o.name === 'lights' || o.name === 'helpers' || o.name === 'hud') return false;
    if (o.isMesh && o.material && o.material.isShaderMaterial) return false;
    return true;
  }
  VT.exportGLB = function (stage, o) {
    o = o || {};
    return stage.takes.loadAll().then(function () {
      stage.pause(); stage.film.refresh();
      var G = new Gltf(), fps = o.fps || 24, total = stage.total, N = Math.max(2, Math.ceil(total * fps) + 1);
      var nodeOf = new Map(), animated = [];
      function add(obj, parentIdx, track) {
        if (!keepNode(obj)) return;
        if (!obj.visible && !track) return;
        var n = { name: (obj.name || obj.type) + '' };
        obj.updateMatrix();
        var p = obj.position, q = obj.quaternion, s = obj.scale;
        n.translation = [p.x, p.y, p.z]; n.rotation = [q.x, q.y, q.z, q.w]; n.scale = [s.x, s.y, s.z];
        if (obj.isMesh) n.mesh = G.mesh(obj);
        G.j.nodes.push(n);
        var idx = G.j.nodes.length - 1;
        nodeOf.set(obj, idx);
        if (parentIdx == null) G.j.scenes[0].nodes.push(idx);
        else { var par = G.j.nodes[parentIdx]; (par.children = par.children || []).push(idx); }
        if (track) animated.push({ obj: obj, idx: idx, T: new Float32Array(N * 3), R: new Float32Array(N * 4), S: new Float32Array(N * 3), V: new Uint8Array(N) });
        obj.children.forEach(function (c) { add(c, idx, track); });
      }
      // the set (static) and the actors (animated); the scene's own XR scale is ignored
      var setRoot = { name: 'Set_' + stage.doc.d.set };
      G.j.nodes.push(setRoot); G.j.scenes[0].nodes.push(G.j.nodes.length - 1);
      var setIdx = G.j.nodes.length - 1;
      stage.set.group.children.forEach(function (c) { add(c, setIdx, false); });
      stage.pose(0);
      var castRoot = { name: 'Cast' }; G.j.nodes.push(castRoot); G.j.scenes[0].nodes.push(G.j.nodes.length - 1);
      var castIdx = G.j.nodes.length - 1;
      stage.doc.d.cast.forEach(function (c) { var a = stage.actors[c.id]; if (a) { a.root.name = c.name; add(a.root, castIdx, true); } });
      // the film camera
      var cam = stage.cam, ar = VT.aspectOf(stage.aspectId()).r;
      G.j.cameras.push({ type: 'perspective', name: 'FilmCam', perspective: { yfov: 38 * Math.PI / 180, aspectRatio: ar, znear: 0.05, zfar: 200 } });
      G.j.nodes.push({ name: 'FilmCam', camera: 0 });
      var camIdx = G.j.nodes.length - 1; G.j.scenes[0].nodes.push(camIdx);
      var camTrack = { obj: cam, idx: camIdx, T: new Float32Array(N * 3), R: new Float32Array(N * 4), S: new Float32Array(N * 3), V: new Uint8Array(N), cam: true };
      animated.push(camTrack);
      var fovKeys = [], cuts = [], lastShot = null;
      // lights
      var lights = [];
      stage.set.lights.children.forEach(function (l) {
        if (!l.isDirectionalLight && !l.isPointLight) return;
        var def = { name: l.name, type: l.isPointLight ? 'point' : 'directional', color: [l.color.r, l.color.g, l.color.b], intensity: l.intensity * (l.isPointLight ? 40 : 1) };
        if (l.isPointLight && l.distance) def.range = l.distance;
        lights.push(def);
        var node = { name: 'Light_' + l.name, translation: [l.position.x, l.position.y, l.position.z], extensions: { KHR_lights_punctual: { light: lights.length - 1 } } };
        if (l.isDirectionalLight) { var m = new T.Matrix4().lookAt(l.position, l.target.position, new T.Vector3(0, 1, 0)), qq = new T.Quaternion().setFromRotationMatrix(m); node.rotation = [qq.x, qq.y, qq.z, qq.w]; }
        G.j.nodes.push(node); G.j.scenes[0].nodes.push(G.j.nodes.length - 1);
      });
      if (lights.length) { G.j.extensions = { KHR_lights_punctual: { lights: lights } }; G.used('KHR_lights_punctual'); }
      // bake every frame
      for (var f = 0; f < N; f++) {
        var t = Math.min(total, f / fps);
        stage.pose(t);
        animated.forEach(function (a) {
          var p = a.obj.position, q = a.obj.quaternion, s = a.obj.scale;
          a.T.set([p.x, p.y, p.z], f * 3); a.R.set([q.x, q.y, q.z, q.w], f * 4); a.S.set([s.x, s.y, s.z], f * 3); a.V[f] = a.obj.visible ? 1 : 0;
        });
        var sh = stage.camShot;
        fovKeys.push([f, Math.round(cam.fov * 100) / 100]);
        var sid = sh && sh.shot ? sh.shot.id : 'none';
        if (sid !== lastShot) { cuts.push([f, sh ? sh.type : 'wide']); lastShot = sid; }
      }
      // channels (constant ones are dropped; mouth / lids that switch visibility become scale 0)
      var times = new Float32Array(N); for (var i = 0; i < N; i++) times[i] = i / fps;
      var tAcc = G.acc(times, 'SCALAR', 5126, null, true);
      var anim = { name: VT.slug(stage.doc.d.title), samplers: [], channels: [] };
      function constant(arr, n) { for (var i = n; i < arr.length; i++) if (Math.abs(arr[i] - arr[i % n]) > 1e-5) return false; return true; }
      animated.forEach(function (a) {
        for (var k = 0; k < N; k++) if (!a.V[k]) { a.S[k * 3] = a.S[k * 3 + 1] = a.S[k * 3 + 2] = 0.0001; }
        [['translation', a.T, 3, 'VEC3'], ['rotation', a.R, 4, 'VEC4'], ['scale', a.S, 3, 'VEC3']].forEach(function (ch) {
          if (constant(ch[1], ch[2])) return;
          anim.samplers.push({ input: tAcc, output: G.acc(ch[1], ch[3], 5126), interpolation: a.cam ? 'STEP' : 'LINEAR' });
          anim.channels.push({ sampler: anim.samplers.length - 1, target: { node: a.idx, path: ch[0] } });
        });
      });
      if (anim.channels.length) G.j.animations.push(anim);
      ['textures', 'images', 'samplers', 'cameras', 'animations'].forEach(function (k) { if (!G.j[k].length) delete G.j[k]; });
      G.j.buffers = [{ byteLength: G.len + ((4 - G.len % 4) % 4) }];
      G.j.scenes[0].extras = { vrtotoon: { title: stage.doc.d.title, fps: fps, frames: N, fov: fovKeys.filter(function (k, i) { return i === 0 || k[1] !== fovKeys[i - 1][1]; }), cuts: cuts, set: stage.doc.d.set, grade: stage.doc.d.look.grade, aspect: stage.aspectId() } };
      stage.pose(stage.time); stage._dirty = true;
      var bytes = G.glb();
      return { blob: new Blob([bytes], { type: 'model/gltf-binary' }), info: { frames: N, nodes: G.j.nodes.length, meshes: G.j.meshes.length, channels: anim.channels.length, bytes: bytes.length, cuts: cuts.length } };
    });
  };

  /* ------------------------------------------------------------------ the Blender kit */
  var BLENDER_PY = [
    '# VRtoToon -> Blender. Open Blender (3.6 or newer), go to the Scripting tab, open this file and press Run Script.',
    '# It imports film.glb, sets the frame rate and length, plays the dialogue, cuts between the film camera\'s shots,',
    '# animates the lens, turns on toon outlines (Freestyle) and picks Eevee. Keep this file next to film.glb and dialogue.wav.',
    'import bpy, os, json',
    '',
    'def folder():',
    '    for t in bpy.data.texts:',
    '        if t.name.startswith("import_vrtotoon") and t.filepath:',
    '            return os.path.dirname(bpy.path.abspath(t.filepath))',
    '    return os.path.dirname(bpy.data.filepath) if bpy.data.filepath else os.getcwd()',
    '',
    'HERE = folder()',
    'scene = bpy.context.scene',
    'bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, "film.glb"))',
    'info = {}',
    'for s in bpy.data.scenes:',
    '    if "vrtotoon" in s.keys():',
    '        info = s["vrtotoon"].to_dict() if hasattr(s["vrtotoon"], "to_dict") else dict(s["vrtotoon"])',
    'if not info:',
    '    try:',
    '        info = json.load(open(os.path.join(HERE, "film.json")))',
    '    except Exception:',
    '        info = {}',
    'fps = int(info.get("fps", 24))',
    'scene.render.fps = fps',
    'scene.frame_start = 0',
    'scene.frame_end = int(info.get("frames", 240)) - 1',
    'cam = bpy.data.objects.get("FilmCam")',
    'if cam:',
    '    scene.camera = cam',
    '    for frame, fov in info.get("fov", []):',
    '        cam.data.angle_y = fov * 3.14159265 / 180.0',
    '        cam.data.keyframe_insert("lens", frame=int(frame))',
    '    for frame, kind in info.get("cuts", []):',
    '        m = scene.timeline_markers.new(str(kind), frame=int(frame))',
    '        m.camera = cam',
    'aspect = info.get("aspect", "16:9")',
    'w, h = {"16:9": (1920, 1080), "2.39:1": (1920, 804), "4:3": (1440, 1080), "9:16": (1080, 1920), "1:1": (1080, 1080), "4:5": (1080, 1350)}.get(aspect, (1920, 1080))',
    'scene.render.resolution_x, scene.render.resolution_y = w, h',
    'wav = os.path.join(HERE, "dialogue.wav")',
    'if os.path.exists(wav):',
    '    if not scene.sequence_editor:',
    '        scene.sequence_editor_create()',
    '    se = scene.sequence_editor',
    '    strips = getattr(se, "strips", None) or se.sequences  # Blender 5 renamed sequences to strips',
    '    strips.new_sound("Dialogue", wav, channel=1, frame_start=0)',
    'try:',
    '    scene.render.engine = "BLENDER_EEVEE_NEXT"',
    'except TypeError:',
    '    scene.render.engine = "BLENDER_EEVEE"',
    'scene.render.use_freestyle = True',
    'try:',
    '    ls = scene.view_layers[0].freestyle_settings.linesets[0].linestyle',
    '    ls.thickness = 2.2',
    '    ls.color = (0.11, 0.08, 0.09)',
    'except Exception:',
    '    pass',
    'scene.view_settings.view_transform = "Standard"',
    'print("VRtoToon: imported", info.get("title", "film"), "-", scene.frame_end + 1, "frames at", fps, "fps")'
  ].join('\n');
  VT.blenderKit = function (stage, o) {
    o = o || {};
    var fps = o.fps || 24;
    return VT.exportGLB(stage, { fps: fps }).then(function (g) {
      return VT.mixdown(stage, { dialogueOnly: !o.fullMix }).then(function (buf) {
        return Promise.all([g.blob.arrayBuffer(), VT.wav(buf).arrayBuffer()]).then(function (arr) {
          var d = stage.doc.d;
          var extras = { title: d.title, fps: fps, frames: g.info.frames };
          var readme = [d.title + ' - made with VRtoToon', '', 'film.glb            the set, the cast (animated) and the film camera (glTF 2.0)',
            'dialogue.wav        every recorded line, mixed and in sync (frame 0 = 0 s)', 'subtitles.srt       the lines with their times',
            'import_vrtotoon.py  Blender: Scripting tab > Open > Run Script (sets everything up)', 'film.json           frame rate, frames, lens changes and cuts',
            '', 'Other 3D apps: import film.glb (glTF 2.0). Cuts and lens changes are in film.json.'].join('\n');
          var info = JSON.parse(JSON.stringify(Object.assign(extras, { fov: [], cuts: [] })));
          try { info = Object.assign(info, JSON.parse(JSON.stringify(stage._lastExtras || {}))); } catch (e) {}
          return VT.zip([{ name: 'film.glb', data: new Uint8Array(arr[0]) }, { name: 'dialogue.wav', data: new Uint8Array(arr[1]) },
            { name: 'subtitles.srt', data: VT.srt(stage) }, { name: 'import_vrtotoon.py', data: BLENDER_PY }, { name: 'README.txt', data: readme },
            { name: 'film.json', data: JSON.stringify(glbExtras(new Uint8Array(arr[0])) || info, null, 1) }]);
        });
      });
    });
  };
  // read our extras back out of the GLB (so film.json matches it exactly)
  function glbExtras(u8) {
    try {
      var v = new DataView(u8.buffer, u8.byteOffset), len = v.getUint32(12, true);
      var j = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + len)));
      return j.scenes[0].extras.vrtotoon;
    } catch (e) { return null; }
  }
  VT._glbExtras = glbExtras;
})();
