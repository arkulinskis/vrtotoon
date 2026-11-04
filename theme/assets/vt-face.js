/* vt-face.js: face capture from the webcam (the face booth). After a take is recorded (body in VR or with the desk puppet,
   walks on the PC), the performer replays it in front of the computer's camera and acts the FACE: eyelids, eyebrows,
   smile and frown, jaw, mouth width, a lopsided smirk and where the eyes look. The voice can be recorded again at the
   same time.

   How: Google's open-source MediaPipe Face Landmarker (in the browser, nothing leaves the device) finds 478 points on the
   face ~30 times a second. VT.faceMeasure reads 25 KEY POINTS of them (VT.FACE_POINTS: eye corners and lids, irises,
   brows, mouth corners and lips, nose, chin, forehead) in a frame that turns and scales with the head, so moving the head
   doesn't change the expression. VT.faceFromMeasures compares them with the performer's own neutral face (calibrated in
   the first second, or with "Neutral face") and gives the 11 controls of VT.FACE_CH. Only those numbers are kept.

   face track (stored with the take, /_/api/m/<key>-f):
     {v: 1, fps: 30, n, k: 11, s: 'string, k chars per frame (64 steps each)', gain, mouth (bool: mouth from the camera),
      vm: 'mouth string' (only when the voice was recorded again with the face)}
   VT.packFace / VT.unpackFace / VT.faceAt(face, t) -> controls at take time t (null outside the recording)
   VT.mixCamFace(feelingFace, cam, w): the camera face over the directed feeling (tears, blush, sweat, pupils stay)
   new VT.FaceBooth({...}) the booth (see below), used by Dialogs/FaceBooth. */
(function () {
  'use strict';
  var VT = window.VT = window.VT || {};
  var MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  var MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function lerp(a, b, u) { return a + (b - a) * u; }

  /* ------------------------------------------------------------------ the 11 face controls */
  // left / right = the performer's own (the character's left eye follows your left eye)
  VT.FACE_CH = [
    { id: 'lidL', lo: -0.4, hi: 1, label: 'Left eyelid' }, { id: 'lidR', lo: -0.4, hi: 1, label: 'Right eyelid' },
    { id: 'browL', lo: -1, hi: 1, label: 'Left eyebrow' }, { id: 'browR', lo: -1, hi: 1, label: 'Right eyebrow' },
    { id: 'browTilt', lo: -1, hi: 1, label: 'Brow tilt (worried / cross)' }, { id: 'curve', lo: -1, hi: 1, label: 'Smile / frown' },
    { id: 'open', lo: 0, hi: 1, label: 'Jaw' }, { id: 'wide', lo: 0, hi: 1, label: 'Mouth width' },
    { id: 'smirk', lo: -1, hi: 1, label: 'Smirk (one corner up)' }, { id: 'gx', lo: -1, hi: 1, label: 'Eyes left / right' },
    { id: 'gy', lo: -1, hi: 1, label: 'Eyes up / down' }
  ];
  var CH = VT.FACE_CH, K = CH.length;
  VT.FACE_K = K;
  // the controls of a relaxed face (the characters' own neutral: lids a little down, a hint of a smile)
  VT.FACE_REST = { lidL: 0.12, lidR: 0.12, browL: 0, browR: 0, browTilt: 0, curve: 0.15, open: 0, wide: 0.5, smirk: 0, gx: 0, gy: 0 };
  var REST = VT.FACE_REST;

  // the key points read from MediaPipe's face mesh (indices into its 478 points); r = the performer's right
  VT.FACE_POINTS = {
    rOut: 33, rIn: 133, rUp: 159, rLo: 145, rIris: 468, lOut: 263, lIn: 362, lUp: 386, lLo: 374, lIris: 473,
    rBrowIn: 107, rBrowMid: 105, rBrowOut: 70, lBrowIn: 336, lBrowMid: 334, lBrowOut: 300,
    mR: 61, mL: 291, lipUp: 13, lipLo: 14, lipTop: 0, lipBot: 17, nose: 1, chin: 152, top: 10
  };
  var FP = VT.FACE_POINTS;
  VT.FACE_POINT_IDS = Object.keys(FP).map(function (k) { return FP[k]; });

  /* raw measurements from the landmarks, in a head-fixed frame: x along the eyes, y up the face, units = the distance
     between the outer eye corners. pts = [{x, y, z}] normalised (MediaPipe), aspect = picture width / height. */
  VT.faceMeasure = function (pts, aspect) {
    if (!pts || pts.length < 474) return null;
    aspect = aspect || 4 / 3;
    function P(i) { var p = pts[i]; return [p.x * aspect, p.y, (p.z || 0) * aspect]; }
    function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
    function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    function len(a) { return Math.sqrt(dot(a, a)); }
    function norm(a) { var l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
    var ro = P(FP.rOut), lo = P(FP.lOut);
    var s = len(sub(lo, ro));
    if (s < 1e-4) return null;
    var ex = norm(sub(lo, ro));
    var up = sub(P(FP.top), P(FP.chin));
    up = [-up[0], -up[1], -up[2]];  // picture y grows downwards: flip so +y is up the face
    var d = dot(up, ex); var ey = norm([up[0] - ex[0] * d, up[1] - ex[1] * d, up[2] - ex[2] * d]);
    var c = [(ro[0] + lo[0]) / 2, (ro[1] + lo[1]) / 2, (ro[2] + lo[2]) / 2];
    function L(i) { var v = sub(P(i), c); return [dot(v, ex) / s, -dot(v, ey) / s]; }  // x right on the picture, y up
    function dist(a, b) { var A = L(a), B = L(b); return Math.hypot(A[0] - B[0], A[1] - B[1]); }
    var eyeW_R = dist(FP.rOut, FP.rIn), eyeW_L = dist(FP.lOut, FP.lIn);
    var rMidY = (L(FP.rOut)[1] + L(FP.rIn)[1]) / 2, lMidY = (L(FP.lOut)[1] + L(FP.lIn)[1]) / 2;
    function u(iris, inn, out) {  // where the iris sits between the inner (0) and outer (1) corner
      var I = L(iris), A = L(inn), B = L(out), ab = [B[0] - A[0], B[1] - A[1]], l2 = ab[0] * ab[0] + ab[1] * ab[1] || 1;
      return ((I[0] - A[0]) * ab[0] + (I[1] - A[1]) * ab[1]) / l2;
    }
    var lipY = L(FP.lipUp)[1], mR = L(FP.mR), mL = L(FP.mL);
    return {
      eyeR: dist(FP.rUp, FP.rLo) / Math.max(1e-4, eyeW_R), eyeL: dist(FP.lUp, FP.lLo) / Math.max(1e-4, eyeW_L),
      browR: L(FP.rBrowMid)[1] - rMidY, browL: L(FP.lBrowMid)[1] - lMidY,
      tiltR: L(FP.rBrowIn)[1] - L(FP.rBrowOut)[1], tiltL: L(FP.lBrowIn)[1] - L(FP.lBrowOut)[1],
      corner: (mR[1] + mL[1]) / 2 - lipY, open: dist(FP.lipUp, FP.lipLo), width: Math.hypot(mL[0] - mR[0], mL[1] - mR[1]),
      smirk: mL[1] - mR[1],
      // + = looking to your own left (the right side of the picture); the inner corners face each other, so the eyes swap signs
      gx: (u(FP.lIris, FP.lIn, FP.lOut) - u(FP.rIris, FP.rIn, FP.rOut)) / 2,
      gy: ((L(FP.rIris)[1] - rMidY) / Math.max(1e-4, eyeW_R) + (L(FP.lIris)[1] - lMidY) / Math.max(1e-4, eyeW_L)) / 2,
      roll: Math.atan2(ex[1], ex[0])
    };
  };
  // an average relaxed face (used until the performer's own neutral face is taken)
  VT.FACE_NEUTRAL0 = { eyeR: 0.31, eyeL: 0.31, browR: 0.31, browL: 0.31, tiltR: 0.125, tiltL: 0.125, corner: 0.005, open: 0.005, width: 0.6, smirk: 0, gx: 0.07, gy: 0.09,
    bs: { smile: 0, frown: 0, jaw: 0.02, pucker: 0.02 } };
  // the blendshape scores we also use (MediaPipe's own reading of the 478 points), averaged left + right
  VT.faceBs = function (cats) {
    var b = {};
    (cats || []).forEach(function (c) { b[c.categoryName] = c.score; });
    return { smile: ((b.mouthSmileLeft || 0) + (b.mouthSmileRight || 0)) / 2, frown: ((b.mouthFrownLeft || 0) + (b.mouthFrownRight || 0)) / 2,
      jaw: b.jawOpen || 0, pucker: b.mouthPucker || 0, blink: Math.min(b.eyeBlinkLeft || 0, b.eyeBlinkRight || 0) };
  };
  /* measurements + the neutral face (+ blendshapes) -> the 11 controls */
  VT.faceFromMeasures = function (m, n, bs) {
    n = n || VT.FACE_NEUTRAL0;
    function lidOf(r) { return r >= 1 ? REST.lidL - (r - 1) * 1.1 : REST.lidL + (1 - r) * (1 - REST.lidL) / 0.72; }
    var o = {};
    o.lidL = clamp(lidOf(m.eyeL / Math.max(0.02, n.eyeL)), -0.4, 1);
    o.lidR = clamp(lidOf(m.eyeR / Math.max(0.02, n.eyeR)), -0.4, 1);
    o.browL = clamp((m.browL - n.browL) / 0.07, -1, 1);
    o.browR = clamp((m.browR - n.browR) / 0.07, -1, 1);
    o.browTilt = clamp(((m.tiltR - n.tiltR) + (m.tiltL - n.tiltL)) / 2 / 0.045, -1, 1);
    o.curve = (m.corner - n.corner) / 0.05;
    o.open = (m.open - n.open) / 0.32;
    o.wide = 0.5 + (m.width / Math.max(0.05, n.width) - 1) * 2.6;
    o.smirk = clamp((m.smirk - n.smirk) / 0.045, -1, 1);
    o.gx = clamp((m.gx - n.gx) / 0.13, -1, 1);
    o.gy = clamp((m.gy - n.gy) / 0.09, -1, 1);
    if (bs) {  // MediaPipe's own scores steady the mouth and catch blinks (both eyes: a wink stays a wink)
      var nb = n.bs || VT.FACE_NEUTRAL0.bs;
      o.curve = (o.curve + ((bs.smile - nb.smile) * 1.4 - (bs.frown - nb.frown) * 1.3)) / 2;
      o.open = Math.max(o.open, (bs.jaw - nb.jaw) * 1.15);
      o.wide -= Math.max(0, bs.pucker - nb.pucker) * 0.7;
      if (bs.blink > 0.5) { var c = REST.lidL + (bs.blink - 0.5) * 2 * (1 - REST.lidL); o.lidL = Math.max(o.lidL, c); o.lidR = Math.max(o.lidR, c); }
    }
    o.curve = clamp(REST.curve + o.curve, -1, 1);
    o.open = clamp(o.open, 0, 1);
    o.wide = clamp(o.wide, 0, 1);
    return o;
  };
  VT.faceArr = function (o) { return CH.map(function (c) { return o[c.id] == null ? REST[c.id] : o[c.id]; }); };
  VT.faceObj = function (a) { var o = {}; CH.forEach(function (c, i) { o[c.id] = a[i]; }); return o; };
  // bigger (or smaller) expressions: scale every control's distance from the relaxed face
  VT.faceGain = function (o, g) {
    if (g == null || g === 1) return o;
    var out = {};
    CH.forEach(function (c) { var r = REST[c.id]; out[c.id] = clamp(r + (o[c.id] - r) * g, c.lo, c.hi); });
    return out;
  };

  /* ------------------------------------------------------------------ the stored track */
  var ABC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_', IDX = {};
  for (var ai = 0; ai < 64; ai++) IDX[ABC.charAt(ai)] = ai;
  /* samples = [{t, v: [K]}] (any rate, in take time) -> the stored track (resampled to 30 fps up to the last sample) */
  VT.packFace = function (samples, o) {
    o = o || {};
    var fps = 30, list = (samples || []).slice().sort(function (a, b) { return a.t - b.t; });
    var end = list.length ? list[list.length - 1].t : 0, n = list.length ? Math.max(1, Math.floor(end * fps) + 1) : 0;
    var s = '', j = 0;
    for (var i = 0; i < n; i++) {
      var t = i / fps;
      while (j < list.length - 2 && list[j + 1].t <= t) j++;
      var A = list[j], B = list[Math.min(list.length - 1, j + 1)], u = B.t > A.t ? clamp((t - A.t) / (B.t - A.t), 0, 1) : 0;
      if (t < A.t) u = 0;
      for (var k = 0; k < K; k++) {
        var v = lerp(A.v[k], B.v[k], u), c = CH[k];
        s += ABC.charAt(clamp(Math.round((v - c.lo) / (c.hi - c.lo) * 63), 0, 63));
      }
    }
    var out = { v: 1, fps: fps, n: n, k: K, s: s, gain: o.gain == null ? 1.25 : Math.round(o.gain * 100) / 100, mouth: !!o.mouth };
    if (o.vm) out.vm = o.vm;
    return out;
  };
  VT.unpackFace = function (face) {
    if (!face || !face.n || !face.s) return null;
    if (face.f) return face;
    var k = face.k || K, n = Math.min(face.n, Math.floor(face.s.length / k)), f = new Float32Array(n * K);
    for (var i = 0; i < n; i++) for (var j = 0; j < K; j++) {
      var c = CH[j], q = j < k ? IDX[face.s.charAt(i * k + j)] : null;
      f[i * K + j] = q == null ? REST[c.id] : c.lo + (c.hi - c.lo) * q / 63;
    }
    face.f = f; face.n = n;
    return face;
  };
  /* the camera face at take time t: {lidL ... gy, w (fades out at the end), mouth} or null outside the recording */
  VT.faceAt = function (face, t, raw) {
    if (!face || !face.f || !face.n) return null;
    var fps = face.fps || 30, end = (face.n - 1) / fps;
    if (t < -0.05 || t > end + 0.25) return null;
    var x = clamp(t * fps, 0, face.n - 1), i = Math.floor(x), j = Math.min(face.n - 1, i + 1), u = x - i, f = face.f, o = {};
    for (var k = 0; k < K; k++) o[CH[k].id] = lerp(f[i * K + k], f[j * K + k], u);
    if (!raw) o = VT.faceGain(o, face.gain == null ? 1.25 : face.gain);
    o.w = t > end ? 1 - (t - end) / 0.25 : 1;
    o.mouth = !!face.mouth;
    return o;
  };
  /* the camera face over a feeling's face (VT.faceOf): eyes, brows and mouth from the camera, plus a little of the
     directed feeling on top (a "sad" key still softens it); tears, blush, sweat and pupils come from the feeling. */
  VT.mixCamFace = function (fe, cam, w) {
    if (!cam || !(w > 0)) return fe;
    w = clamp(w * (cam.w == null ? 1 : cam.w), 0, 1);
    var n = VT.faceOf ? VT.faceOf('neutral') : { lid: 0.12, browY: 0, browTilt: 0, curve: 0.15, open: 0, wide: 0.5 };
    var tint = 0.3, out = Object.assign({}, fe);
    function d(key) { return ((fe[key] || 0) - (n[key] || 0)) * tint; }
    out.lidL = lerp(fe.lid || 0, cam.lidL + d('lid'), w);
    out.lidR = lerp(fe.lid || 0, cam.lidR + d('lid'), w);
    var asym = (fe.browAsym || 0) * 0.5;
    out.browL = lerp((fe.browY || 0) + asym, cam.browL * 0.85 + d('browY'), w);
    out.browR = lerp(fe.browY || 0, cam.browR * 0.85 + d('browY'), w);
    out.browTilt = lerp(fe.browTilt || 0, cam.browTilt * 28 + d('browTilt'), w);
    out.browAsym = 0;
    out.curve = lerp(fe.curve || 0, clamp(cam.curve + d('curve'), -1, 1), w);
    out.open = lerp(fe.open || 0, cam.open, w);
    out.wide = lerp(fe.wide == null ? 0.5 : fe.wide, cam.wide, w);
    out.smirk = (cam.smirk || 0) * w;
    out.gx = (cam.gx || 0) * w; out.gy = (cam.gy || 0) * w;
    out.lid = (out.lidL + out.lidR) / 2;
    out.cam = w;
    return out;
  };

  /* a recording without its first `skip` seconds, as mono 24 kHz (small enough to upload as WAV) */
  VT.trimBuffer = function (buf, skip) {
    var rate = 24000, src = buf.sampleRate, from = Math.floor((skip || 0) * src), n = Math.max(1, Math.floor((buf.length - from) * rate / src));
    var out = VT.audioCtx().createBuffer(1, n, rate), o = out.getChannelData(0), chs = [];
    for (var c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
    for (var i = 0; i < n; i++) {
      var x = from + i * src / rate, j = Math.floor(x), u = x - j, v = 0;
      for (var k = 0; k < chs.length; k++) { var d = chs[k]; v += (d[j] || 0) * (1 - u) + (d[j + 1] || 0) * u; }
      o[i] = v / chs.length;
    }
    return out;
  };

  /* ------------------------------------------------------------------ MediaPipe */
  VT.loadFaceModel = function () {
    if (VT._faceModel) return VT._faceModel;
    VT._faceModel = import(MP + '/vision_bundle.mjs').then(function (V) {
      return V.FilesetResolver.forVisionTasks(MP + '/wasm').then(function (files) {
        function make(delegate) {
          return V.FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate: delegate }, runningMode: 'VIDEO',
            numFaces: 1, outputFaceBlendshapes: true, minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
        }
        return make('GPU').catch(function () { return make('CPU'); });
      });
    });
    VT._faceModel.catch(function () { VT._faceModel = null; });
    return VT._faceModel;
  };

  /* draw the tracked face on the camera preview: the whole mesh faintly, the 25 key points bright */
  VT.drawFacePoints = function (cv, pts, mirror) {
    var g = cv.getContext('2d'), w = cv.width, h = cv.height;
    g.clearRect(0, 0, w, h);
    if (!pts) return;
    function X(p) { return (mirror ? 1 - p.x : p.x) * w; }
    g.fillStyle = 'rgba(240, 192, 96, 0.35)';
    for (var i = 0; i < pts.length; i += 2) g.fillRect(X(pts[i]) - 0.7, pts[i].y * h - 0.7, 1.4, 1.4);
    g.fillStyle = '#ffd36b'; g.strokeStyle = 'rgba(18, 10, 12, 0.85)'; g.lineWidth = 1.5;
    VT.FACE_POINT_IDS.forEach(function (id) {
      var p = pts[id]; if (!p) return;
      g.beginPath(); g.arc(X(p), p.y * h, Math.max(2.2, w / 190), 0, Math.PI * 2); g.fill(); g.stroke();
    });
  };

  /* ------------------------------------------------------------------ the booth
     new VT.FaceBooth({stageEl, video, overlay, promptEl, clockEl, doc, takes, uid, def, onState})
       open()            camera + face model; the character mirrors your face at once ("live")
       neutral()         take your relaxed face again (1 s); done automatically when a face first appears
       record({voice, mouth, gain})  3-2-1, then the take plays (its voice, or the other characters' lines when you
                         re-voice) and every face reading is kept; ends at the end of the take or with stop()
       stop()  play()  (watch the recorded face back)  result() -> {face: JSON string, audio: Blob | null}
       setGain(g) setMouth(on)  stats() (for tests)  close()
     onState({state: loading|nocam|live|count|rec|review|play, found, msg, n, lost, secs}) */
  function FaceBooth(o) {
    this.o = o; this.state = 'loading'; this.found = false; this.live = null; this.pts = null;
    this.samples = []; this.neutralM = null; this.calib = null; this.gain = o.gain == null ? 1.25 : o.gain; this.mouthCam = !!o.mouth;
    this.take = o.takes && o.takes.map[o.uid];
    this.dur = this.take ? Math.max(0.5, this.take.dur || 0) : 5;
    this.detects = 0; this.lostT = 0; this._sources = []; this.face = null; this.voice = null;
    var self = this;
    var cast = o.doc && this.take && o.doc.actor(this.take.actor);
    var def = o.def || (cast ? VT.charDef(cast.char, o.doc.d.custom) : VT.CAST[0]);
    var st = this.stage = new VT.Stage(o.stageEl, { mode: 'turntable', char: def, emo: 'neutral', interactive: false, bg: '#120a0c', maxDpr: 1.5 });
    if (!st.dead) {
      st.pose = function () { self._pose(); };
      st.ttEmo = 'neutral';
    }
    this.lines = this._lines();
  }
  VT.FaceBooth = FaceBooth;
  FaceBooth.prototype._emit = function (msg) {
    var s = { state: this.state, found: this.found, msg: msg || '', n: this.samples.length, secs: Math.round(this.dur * 10) / 10,
      lost: Math.round(this.lostT * 10) / 10, hasVoice: !!(this.take && this.take.buffer) };
    if (this.o.onState) this.o.onState(s);
  };
  // the take's clips as teleprompter lines: {t0, t1, text, mine}
  FaceBooth.prototype._lines = function () {
    var tk = this.take, doc = this.o.doc, out = [];
    if (!tk || !doc) return out;
    (tk.clips || []).forEach(function (c) {
      var b = doc.beat(c.beat); if (!b) return;
      var who = b.kind === 'line' ? doc.actor(b.who) : null;
      out.push({ t0: c.off, t1: c.off + c.dur, mine: !!c.line, beat: b, text: b.kind === 'line' ? (who ? who.name.toUpperCase() + ': ' : '') + (b.text || '') : '(' + (b.text || 'action') + ')' });
    });
    out.sort(function (a, b) { return a.t0 - b.t0; });
    return out;
  };
  // open() without handing a promise back (Python would wait for the camera and the model)
  FaceBooth.prototype.begin = function () { this.open(); return true; };
  FaceBooth.prototype.open = function () {
    var self = this;
    this.state = 'loading'; this._emit('Starting the camera...');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { this.state = 'nocam'; this._emit('This browser has no camera access.'); return Promise.resolve(false); }
    return navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false }).then(function (s) {
      self.stream = s;
      var v = self.o.video; v.srcObject = s; v.muted = true; v.setAttribute('playsinline', '');
      return v.play().catch(function () {});
    }).then(function () {
      self._emit('Loading the face tracker (the first time takes a few seconds)...');
      return VT.loadFaceModel();
    }).then(function (fl) {
      self.fl = fl; self.state = 'live'; self._emit('Look at the screen with a relaxed face.');
      self._loop();
      return true;
    }).catch(function (e) {
      self.state = 'nocam';
      var name = e && e.name;
      self._emit(name === 'NotAllowedError' ? 'The camera is blocked. Allow it in the address bar, then open the booth again.' :
        name === 'NotFoundError' ? 'No camera was found on this computer.' : 'The camera or the face tracker didn\'t start: ' + (e && e.message || e));
      return false;
    });
  };
  FaceBooth.prototype._loop = function () {
    var self = this, last = -1;
    function step() {
      if (self.closed) return;
      self._raf = requestAnimationFrame(step);
      var v = self.o.video, now = performance.now();
      if (!self.fl || v.readyState < 2 || now - (self._lastDetect || 0) < 30) return;
      if (v.currentTime === last) return;
      last = v.currentTime; self._lastDetect = now;
      var res;
      try { res = self.fl.detectForVideo(v, now); } catch (e) { return; }
      self._read(res, v);
    }
    step();
  };
  FaceBooth.prototype._read = function (res, v) {
    var pts = res && res.faceLandmarks && res.faceLandmarks[0];
    var t = this._time(), was = this.found;
    this.found = !!pts; this.pts = pts || null; this.detects++;
    var cv = this.o.overlay;
    if (cv) {
      if (cv.width !== v.videoWidth && v.videoWidth) { cv.width = v.videoWidth; cv.height = v.videoHeight; }
      VT.drawFacePoints(cv, pts, false);
    }
    if (!pts) {
      if (this._prevT != null && t != null && this.state === 'rec') this.lostT += Math.max(0, t - this._prevT);
      this._prevT = t;
      if (was) this._emit('Your face is out of view. Face the camera.');
      return;
    }
    this._prevT = t;
    var m = VT.faceMeasure(pts, (v.videoWidth || 4) / (v.videoHeight || 3));
    if (!m) return;
    var bs = res.faceBlendshapes && res.faceBlendshapes[0] ? VT.faceBs(res.faceBlendshapes[0].categories) : null;
    this.lastM = m; this.lastBs = bs;
    if (this.calib) {  // taking the neutral face: average a second of readings
      this.calib.push({ m: m, bs: bs });
      if (performance.now() - this.calibT0 > 1000 && this.calib.length >= 4) this._finishNeutral();
    } else if (!this.neutralM && !was) this.neutral();
    var o = VT.faceFromMeasures(m, this.neutralM, bs);
    // smooth (eyelids react faster, so blinks survive)
    if (this.live) CH.forEach(function (c) { var a = c.id === 'lidL' || c.id === 'lidR' ? 0.75 : 0.5; o[c.id] = lerp(this.live[c.id], o[c.id], a); }, this);
    this.live = o;
    if (this.state === 'rec' && t != null && t >= 0) this.samples.push({ t: t, v: VT.faceArr(o) });
    if (!was) this._emit(this.state === 'live' ? 'Got you. Try a big smile, raised eyebrows, a wink.' : '');
  };
  FaceBooth.prototype.neutral = function () {
    this.calib = []; this.calibT0 = performance.now();
    this._emit('Hold a relaxed face for a second...');
  };
  FaceBooth.prototype._finishNeutral = function () {
    var list = this.calib, n = {}, nb = { smile: 0, frown: 0, jaw: 0, pucker: 0 };
    this.calib = null;
    Object.keys(list[0].m).forEach(function (k) { n[k] = list.reduce(function (s, x) { return s + x.m[k]; }, 0) / list.length; });
    var withBs = list.filter(function (x) { return x.bs; });
    if (withBs.length) Object.keys(nb).forEach(function (k) { nb[k] = withBs.reduce(function (s, x) { return s + x.bs[k]; }, 0) / withBs.length; });
    n.bs = nb;
    this.neutralM = n;
    this._emit('Neutral face taken. Now act: the character copies you.');
  };
  // take time now (while counting in: negative), or null when nothing plays
  FaceBooth.prototype._time = function () {
    if (this.t0 == null) return null;
    return VT.audioCtx().currentTime - this.t0;
  };
  FaceBooth.prototype._playAudio = function (at, withOwnVoice, ownBuffer) {
    var ctx = VT.audioCtx(), self = this, tk = this.take, doc = this.o.doc;
    function play(buf, when, off, dur, vol) {
      if (!buf) return;
      var s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = buf; g.gain.value = vol == null ? 1 : vol;
      s.connect(g); g.connect(ctx.destination);
      var w = at + when, o = off;
      if (w < ctx.currentTime) { o += ctx.currentTime - w; w = ctx.currentTime; }
      if (dur != null && dur <= o - off) return;
      try { if (dur != null) s.start(w, o, dur - (o - off)); else s.start(w, o); } catch (e) { return; }
      self._sources.push(s);
    }
    if (withOwnVoice) play(ownBuffer || (tk && tk.buffer), 0, 0, null, 1);
    // the other characters' lines during your reactions (from their chosen takes), so you can react on cue
    this.lines.forEach(function (ln) {
      if (ln.mine || ln.beat.kind !== 'line' || !doc) return;
      var uid = doc.d.sel[ln.beat.id + '|' + ln.beat.who], ot = uid && self.o.takes.map[uid], oc = ot && VT.clipOf(ot, ln.beat.id);
      if (ot && ot.buffer && oc) play(ot.buffer, ln.t0, oc.off, Math.min(oc.dur, ln.t1 - ln.t0 + 0.3), 0.85);
    });
  };
  FaceBooth.prototype._stopAudio = function () {
    this._sources.forEach(function (s) { try { s.stop(); } catch (e) {} try { s.disconnect(); } catch (e) {} });
    this._sources = [];
  };
  FaceBooth.prototype.record = function (opts) {
    opts = opts || {};
    var self = this;
    if (this.state === 'loading' || this.state === 'nocam') return Promise.resolve(false);
    this._stopAudio();
    this.gain = opts.gain == null ? this.gain : opts.gain; this.mouthCam = !!opts.mouth; this.withVoice = !!opts.voice;
    this.samples = []; this.lostT = 0; this.face = null; this.voice = null; this.voiceBuf = null;
    var start = this.withVoice ? this._startMic() : Promise.resolve(true);
    return start.then(function (ok) {
      if (!ok) { self._emit('The microphone didn\'t start. Allow it, or untick “Record my voice again”.'); return false; }
      var ctx = VT.audioCtx(); if (ctx.resume) ctx.resume();
      var lead = (window.VT_TEST && window.VT_TEST.faceLead != null) ? window.VT_TEST.faceLead : 3;
      self.t0 = ctx.currentTime + lead;
      if (self.rec) self.micT0 = ctx.currentTime;  // the microphone already runs: trimmed to t0 when it stops
      self.state = 'count'; self._emit('');
      self._playAudio(self.t0, !self.withVoice);
      self._tick();
      return true;
    });
  };
  FaceBooth.prototype._startMic = function () {
    var self = this;
    if (!navigator.mediaDevices || !window.MediaRecorder) return Promise.resolve(false);
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(function (s) {
      self.mic = s; self.chunks = [];
      var mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].filter(function (m) { return MediaRecorder.isTypeSupported(m); })[0] || '';
      self.rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      self.rec.ondataavailable = function (e) { if (e.data && e.data.size) self.chunks.push(e.data); };
      self.rec.start(250);
      return true;
    }).catch(function () { return false; });
  };
  FaceBooth.prototype._stopMic = function () {
    var self = this, rec = this.rec;
    this.rec = null;
    if (!rec) return Promise.resolve(null);
    return new Promise(function (res) {
      rec.onstop = function () {
        if (self.mic) self.mic.getTracks().forEach(function (t) { t.stop(); });
        self.mic = null;
        var blob = new Blob(self.chunks, { type: (self.chunks[0] && self.chunks[0].type) || 'audio/webm' });
        blob.arrayBuffer().then(function (ab) { return new Promise(function (ok) { VT.audioCtx().decodeAudioData(ab, ok, function () { ok(null); }); }); }).then(function (buf) {
          res({ blob: blob, buffer: buf });
        });
      };
      try { rec.stop(); } catch (e) { res(null); }
    });
  };
  // the clock while counting in / recording / playing back: teleprompter, the end of the take
  FaceBooth.prototype._tick = function () {
    var self = this;
    if (this._tickT) clearTimeout(this._tickT);
    if (this.closed || this.t0 == null) return;
    var t = this._time();
    if (this.state === 'count' && t >= 0) { this.state = 'rec'; this._emit(''); }
    this._prompt(t);
    if (t >= this.dur + 0.05) { if (this.state === 'rec') this.stop(); else if (this.state === 'play') this._endPlay(); return; }
    this._tickT = setTimeout(function () { self._tick(); }, 50);
  };
  FaceBooth.prototype._prompt = function (t) {
    var pe = this.o.promptEl, ce = this.o.clockEl;
    if (ce) ce.textContent = t == null ? '' : t < 0 ? String(Math.ceil(-t)) : (VT.fmtTime ? VT.fmtTime(Math.min(t, this.dur)) : t.toFixed(1)) + ' / ' + (VT.fmtTime ? VT.fmtTime(this.dur) : this.dur.toFixed(1));
    if (!pe) return;
    var cur = null, next = null;
    if (t != null) for (var i = 0; i < this.lines.length; i++) { var l = this.lines[i]; if (l.t0 <= t + 0.15 && t < l.t1 + 0.1) cur = l; else if (l.t0 > t && !next) next = l; }
    var txt = cur ? cur.text : next ? 'Next: ' + next.text : (t == null ? '' : '...');
    if (pe._txt !== txt) { pe._txt = txt; pe.textContent = txt; }
    pe.classList.toggle('mine', !!(cur && cur.mine));
    if (ce) ce.classList.toggle('count', t != null && t < 0);
  };
  FaceBooth.prototype.stop = function () {
    var self = this;
    if (this.state === 'count') { this._stopAudio(); this.t0 = null; this.state = 'live'; this._stopMic(); this._prompt(null); this._emit('Stopped before it started.'); return Promise.resolve(false); }
    if (this.state === 'play') { this._endPlay(); return Promise.resolve(true); }
    if (this.state !== 'rec') return Promise.resolve(false);
    var tEnd = Math.min(this.dur, this._time());
    this._stopAudio(); this.t0 = null; this.state = 'saving';
    return this._stopMic().then(function (v) {
      if (v && v.buffer) {
        // the microphone started before the count-in: cut that part off so the voice starts at take time 0
        var lead = (window.VT_TEST && window.VT_TEST.faceLead != null) ? window.VT_TEST.faceLead : 3;
        v.buffer = VT.trimBuffer(v.buffer, lead);
        v.trim = lead;
        self.voiceBuf = v.buffer; self.voice = v;
      }
      var vm = v && v.buffer ? VT.analyzeVoice(v.buffer, 30) : null;
      self.face = VT.unpackFace(VT.packFace(self.samples, { gain: self.gain, mouth: self.mouthCam, vm: vm }));
      self.state = 'review'; self._prompt(null);
      var got = self.face ? (self.face.n / 30) : 0;
      self._emit(!self.face ? 'No face was seen. Check the camera picture and try again.' :
        got < tEnd - 0.5 ? 'Recorded ' + got.toFixed(1) + ' s of face.' : 'Got it. Watch it back, then print it.');
      return !!self.face;
    });
  };
  FaceBooth.prototype.play = function () {
    if (!this.face || this.state === 'rec' || this.state === 'count') return false;
    this._stopAudio();
    var ctx = VT.audioCtx(); if (ctx.resume) ctx.resume();
    this.t0 = ctx.currentTime + 0.15; this.state = 'play'; this._emit('');
    this._playAudio(this.t0, true, this.voiceBuf || null);
    this._tick();
    return true;
  };
  FaceBooth.prototype._endPlay = function () { this._stopAudio(); this.t0 = null; this.state = this.face ? 'review' : 'live'; this._prompt(null); this._emit(''); };
  FaceBooth.prototype.setGain = function (g) { this.gain = g; if (this.face) this.face.gain = Math.round(g * 100) / 100; };
  FaceBooth.prototype.setMouth = function (on) { this.mouthCam = !!on; if (this.face) this.face.mouth = !!on; };
  FaceBooth.prototype.result = function () {
    if (!this.face) return null;
    var f = this.face, out = { v: 1, fps: f.fps, n: f.n, k: f.k, s: f.s, gain: f.gain, mouth: !!f.mouth };
    if (f.vm) out.vm = f.vm;
    var audio = this.voice ? (VT.wav && this.voice.buffer ? VT.wav(this.voice.buffer) : this.voice.blob) : null;
    return { face: JSON.stringify(out), audio: audio, voice: !!this.voice };
  };
  // apply a kept face to the take in the editor's engine (so the film plays it at once)
  FaceBooth.prototype.applyTo = function (take) {
    take = take || this.take;
    if (!take || !this.face) return;
    take.face = this.face;
    if (this.voice && this.voice.buffer) {
      take.buffer = this.voice.buffer;
      take.motion = take.motion || { fps: 30, n: 0, f: new Float32Array(0) };
      take.motion.m = this.face.vm || take.motion.m;
    }
  };
  /* the character in the booth: body from the take (or idle), mouth from the voice (or the camera), face from the camera
     live, or from the recording while watching it back */
  FaceBooth.prototype._pose = function () {
    var st = this.stage, a = st.tt; if (!a) return;
    var now = performance.now() / 1000, t = this._time(), tk = this.take;
    var tt = t != null && t >= 0 ? t : null;
    var p;
    if (tt != null && tk && tk.motion && tk.motion.n) p = VT.sampleMotion(tk.motion, tt);
    var cam = null;
    if (this.state === 'play' && this.face && tt != null) cam = VT.faceAt(this.face, tt);
    else if (this.live) cam = Object.assign(VT.faceGain(this.live, this.gain), { w: 1, mouth: this.mouthCam });
    var mouth = null, mstr = this.state === 'play' && this.face && this.face.vm ? this.face.vm : (tk && tk.motion && tk.motion.m);
    if (tt != null && mstr && !(this.withVoice && this.state === 'rec')) mouth = VT.mouthAt(mstr, 30, tt);
    if (cam && (cam.mouth || !mouth)) mouth = { open: cam.open, wide: cam.wide };
    if (!p) p = VT.proceduralPose(a, { t: now, seed: 2, speaking: !!(mouth && mouth.open > 0.1), talk: mouth ? mouth.open : 0 });
    var base = VT.faceOf('neutral');
    p.face = cam ? VT.mixCamFace(base, cam, 1) : base;
    p.mouth = mouth;
    p.blink = cam ? 0 : VT.blinkAt(now, 3);
    p.gaze = [0, a.headRest.y, 3];
    p.time = now;
    a.setPose(p);
    a.root.rotation.y = 0;
    var hp = new THREE.Vector3(); a.headMesh.getWorldPosition(hp);
    var r = a.headR;
    st.cam.position.set(hp.x, hp.y + r * 0.35, hp.z + r * 8.5); st.cam.lookAt(hp.x, hp.y - r * 0.15, hp.z); st.cam.fov = 30; st.cam.updateProjectionMatrix();
  };
  FaceBooth.prototype.stats = function () {
    return { state: this.state, found: this.found, points: this.pts ? this.pts.length : 0, keyPoints: VT.FACE_POINT_IDS.length, detects: this.detects,
      samples: this.samples.length, neutral: !!this.neutralM, live: this.live, lastM: this.lastM || null, face: this.face ? { n: this.face.n, gain: this.face.gain, mouth: this.face.mouth, vm: !!this.face.vm } : null,
      voice: !!this.voice, lines: this.lines.length };
  };
  FaceBooth.prototype.close = function () {
    this.closed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._tickT) clearTimeout(this._tickT);
    this._stopAudio();
    if (this.rec) { try { this.rec.stop(); } catch (e) {} this.rec = null; }
    if (this.mic) this.mic.getTracks().forEach(function (t) { t.stop(); });
    if (this.stream) this.stream.getTracks().forEach(function (t) { t.stop(); });
    try { this.o.video.srcObject = null; } catch (e) {}
    if (this.stage) this.stage.destroy();
  };
})();
