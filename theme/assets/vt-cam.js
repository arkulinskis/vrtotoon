/* vt-cam.js: the webcam puppet. No headset: the computer's camera drives the performer's toon on the stage.

   new VT.CamPuppet({host, onState})   host = the stage's element (a small camera window is added to its corner)
     start()        camera + MediaPipe Hand Landmarker (2 hands, 21 points each) + Face Landmarker (head pose)
     recenter()     take the performer's resting head again (where "straight ahead" and the shoulders are)
     pose(actor, base)  a frame for VT.Perform in the character's own space: base (VT.proceduralPose) with the tracked
                    head (turn, nod, tilt, a little lean) and each hand that is seen (position, wrist turn, finger curls)
     info()         {state: off|loading|live|nocam, msg, hands, face}
     close()        camera off, window removed
   It works like a mirror: raise your right hand and the toon raises the hand on the same side of the screen (its left,
   the rig's 'r' arm on +X). The camera picture never leaves the browser; only the pose numbers reach the take.
   Joints are mapped onto WebXR hand-joint names so VT.fingerCurls / VT.handFrameXR (vt-xr.js) work unchanged. */
(function () {
  'use strict';
  var VT = window.VT = window.VT || {};
  var T = window.THREE;
  if (!T) return;
  var MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  var HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  var HAND_OFF = new T.Quaternion(0, Math.SQRT1_2, Math.SQRT1_2, 0);  // same as vt-xr.js: toon fingers (-Y) along -Z, back (+Z) along +Y
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, k) { return a + (b - a) * k; }

  // MediaPipe's 21 hand points -> WebXR joint names (each finger's "metacarpal" starts at the wrist, as in WebXR)
  var JOINTS = { 'wrist': 0, 'thumb-metacarpal': 1, 'thumb-phalanx-proximal': 2, 'thumb-phalanx-distal': 3, 'thumb-tip': 4 };
  [['index-finger', 5], ['middle-finger', 9], ['ring-finger', 13], ['pinky-finger', 17]].forEach(function (f) {
    JOINTS[f[0] + '-metacarpal'] = 0; JOINTS[f[0] + '-phalanx-proximal'] = f[1]; JOINTS[f[0] + '-phalanx-intermediate'] = f[1] + 1;
    JOINTS[f[0] + '-phalanx-distal'] = f[1] + 2; JOINTS[f[0] + '-tip'] = f[1] + 3;
  });
  var BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];

  /* world landmarks (metres; x right, y down, z away from the camera, unmirrored picture) -> joint positions in the
     character's space, mirrored (x flipped), y up, z towards the camera = the character's forward */
  VT.camJoints = function (world) {
    var out = {};
    Object.keys(JOINTS).forEach(function (n) { var p = world[JOINTS[n]]; if (p) out[n] = new T.Vector3(-p.x, -p.y, -p.z); });
    return out;
  };
  /* head angles (degrees) and the head's place from the face points (normalised, unmirrored); asp = width / height */
  VT.camHead = function (pts, asp) {
    var r = pts[33], l = pts[263], n = pts[1];
    if (!r || !l || !n) return null;
    var cx = (r.x + l.x) / 2, cy = (r.y + l.y) / 2, dx = (l.x - r.x) * asp, dy = l.y - r.y, w = Math.sqrt(dx * dx + dy * dy);
    if (w < 1e-4) return null;
    return { yaw: (n.x - cx) * asp / w, pitch: (n.y - cy) / w, roll: Math.atan2(dy, dx) * 180 / Math.PI, cx: cx, cy: cy, w: w };
  };
  // the mirror maths: a raw head reading against the resting one -> {yaw, pitch, roll} in degrees (VT.quatYXZ order)
  VT.camHeadAngles = function (h, ref) {
    return { yaw: clamp(-(h.yaw - ref.yaw) * 110, -60, 60), pitch: clamp((h.pitch - ref.pitch) * 120, -40, 40), roll: clamp(h.roll - ref.roll, -35, 35) };
  };
  /* one tracked hand -> where the toon's hand goes (root space) for rig arm `key` ('r' = +X), from the image points
     (normalised) relative to the resting head (ref: cx, cy, w = eye distance in picture heights). Units of eye distance:
     a grown-up's shoulders sit about 3 to each side and 3.5 below the eyes, an arm reaches about 9. */
  VT.camHandTarget = function (lm, key, ref, asp, a) {
    var P = a.P, side = key === 'r' ? 1 : -1, reach = (P.upper + P.fore), k = reach / 9;
    var px = (lm[0].x + lm[9].x) / 2, py = (lm[0].y + lm[9].y) / 2;
    var u = -(px - ref.cx) * asp / ref.w, v = -(py - ref.cy) / ref.w;
    var palm = Math.sqrt(Math.pow((lm[9].x - lm[0].x) * asp, 2) + Math.pow(lm[9].y - lm[0].y, 2)) / ref.w;  // ~1.5 at the face's distance
    var near = clamp((palm / 1.5 - 1) * 0.6, -0.15, 0.8);
    var shY = P.hipY + P.torsoH * 0.8;
    return [side * P.torsoW * 1.1 + (u - side * 3) * k, shY + (v + 3.5) * k, reach * (0.18 + near)];
  };

  VT.loadHandModel = function () {
    if (VT._handModel) return VT._handModel;
    VT._handModel = import(MP + '/vision_bundle.mjs').then(function (V) {
      return V.FilesetResolver.forVisionTasks(MP + '/wasm').then(function (files) {
        function make(delegate) {
          return V.HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: HAND_MODEL, delegate: delegate }, runningMode: 'VIDEO',
            numHands: 2, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
        }
        return make('GPU').catch(function () { return make('CPU'); });
      });
    });
    VT._handModel.catch(function () { VT._handModel = null; });
    return VT._handModel;
  };

  function CamPuppet(o) {
    this.o = o || {};
    this.state = 'off'; this.msg = ''; this.hands = {}; this.head = null; this.ref = null; this.calib = null; this.frames = 0;
    var box = this.box = document.createElement('div');
    box.className = 'vt-cam';
    box.innerHTML = '<div class="vt-cam-pic"><video playsinline muted></video><canvas></canvas></div><div class="vt-cam-msg">Starting the camera...</div>';
    this.video = box.querySelector('video'); this.overlay = box.querySelector('canvas'); this.msgEl = box.querySelector('.vt-cam-msg');
    (this.o.host || document.body).appendChild(box);
  }
  VT.CamPuppet = CamPuppet;

  CamPuppet.prototype._say = function (state, msg) {
    if (state) this.state = state;
    if (msg != null && msg !== this.msg) { this.msg = msg; this.msgEl.textContent = msg; }
    this.box.classList.toggle('on', this.state === 'live');
    if (this.o.onState) this.o.onState(this.info());
  };
  CamPuppet.prototype.info = function () {
    return { state: this.state, msg: this.msg, hands: Object.keys(this.hands).filter(function (k) { return this.hands[k].seen; }, this).length, face: !!(this.head && this.head.seen), frames: this.frames };
  };
  // start() without handing a promise back to Python (it would wait for the camera and both models)
  CamPuppet.prototype.begin = function () { this.start(); return true; };
  CamPuppet.prototype.start = function () {
    var self = this;
    this._say('loading', 'Starting the camera...');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { this._say('nocam', 'This browser has no camera access.'); return Promise.resolve(false); }
    return navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false }).then(function (s) {
      if (self.closed) { s.getTracks().forEach(function (t) { t.stop(); }); throw new Error('closed'); }
      self.stream = s;
      var v = self.video; v.srcObject = s; v.muted = true;
      return v.play().catch(function () {});
    }).then(function () {
      self._say(null, 'Loading the hand and face trackers (the first time takes a few seconds)...');
      return Promise.all([VT.loadHandModel(), VT.loadFaceModel ? VT.loadFaceModel().catch(function () { return null; }) : null]);
    }).then(function (m) {
      if (self.closed) return false;
      self.hl = m[0]; self.fl = m[1];
      self._say('live', 'Sit back so your head and both hands are in the picture.');
      self._loop();
      return true;
    }).catch(function (e) {
      if (self.closed) return false;
      var name = e && e.name;
      self._say('nocam', name === 'NotAllowedError' ? 'The camera is blocked. Allow it in the address bar, then press Webcam again.' :
        name === 'NotFoundError' ? 'No camera was found on this computer.' : 'The camera or the trackers didn\'t start: ' + (e && e.message || e));
      return false;
    });
  };
  CamPuppet.prototype._loop = function () {
    var self = this, last = -1, n = 0;
    function step() {
      if (self.closed) return;
      self._raf = requestAnimationFrame(step);
      var v = self.video, now = performance.now();
      if (v.readyState < 2 || now - (self._at || 0) < 32 || v.currentTime === last) return;
      last = v.currentTime; self._at = now; n++;
      var hr = null, fr = null;
      try { hr = self.hl.detectForVideo(v, now); } catch (e) { hr = null; }
      if (self.fl && (n % 2 === 0 || !self.ref)) { try { fr = self.fl.detectForVideo(v, now); } catch (e) { fr = null; } }
      self._read(hr, fr, v);
    }
    step();
  };
  CamPuppet.prototype._read = function (hr, fr, v) {
    var asp = (v.videoWidth || 4) / (v.videoHeight || 3), self = this, was = this.info();
    this.asp = asp; this.frames++;
    // the head
    if (fr) {
      var pts = fr.faceLandmarks && fr.faceLandmarks[0], h = pts ? VT.camHead(pts, asp) : null;
      this.facePts = pts || null;
      if (h) {
        if (!this.ref && !this.calib) this.calib = [];
        if (this.calib) {
          this.calib.push(h);
          if (this.calib.length >= 8) {
            var avg = { yaw: 0, pitch: 0, roll: 0, cx: 0, cy: 0, w: 0 }, c = this.calib;
            c.forEach(function (x) { Object.keys(avg).forEach(function (kk) { avg[kk] += x[kk] / c.length; }); });
            this.ref = avg; this.calib = null;
          }
        }
        var prev = this.head && this.head.seen ? this.head : null;
        h.seen = true;
        if (prev) ['yaw', 'pitch', 'roll', 'cx', 'cy'].forEach(function (kk) { h[kk] = lerp(prev[kk], h[kk], 0.45); });
        this.head = h;
      } else if (this.head) this.head.seen = false;
    }
    // the hands
    var list = [];
    if (hr && hr.landmarks) hr.landmarks.forEach(function (lm, i) {
      var cat = hr.handednesses && hr.handednesses[i] && hr.handednesses[i][0];
      // MediaPipe names hands as if the picture were mirrored: "Left" = the performer's right hand = the rig's 'r' (mirror)
      list.push({ lm: lm, world: hr.worldLandmarks && hr.worldLandmarks[i], key: cat && cat.categoryName === 'Right' ? 'l' : 'r', x: (lm[0].x + lm[9].x) / 2 });
    });
    if (list.length === 2) { list.sort(function (a, b) { return a.x - b.x; }); list[0].key = 'r'; list[1].key = 'l'; }  // picture left = your right
    var seen = {};
    list.forEach(function (it) { if (it.world) { seen[it.key] = true; self._hand(it); } });
    ['l', 'r'].forEach(function (k) { if (self.hands[k] && !seen[k]) self.hands[k].seen = false; });
    this._draw(list, v);
    var now = this.info();
    if (this.state === 'live' && (now.hands !== was.hands || now.face !== was.face)) {
      this._say(null, !now.face && !now.hands ? 'Nobody in the picture: sit in front of the camera.' :
        !now.hands ? 'Got your head. Lift your hands into the picture.' :
          now.hands === 1 ? 'Got one hand. Both work too.' : 'Got you: head, both hands and every finger.');
    }
  };
  CamPuppet.prototype._hand = function (it) {
    var J = VT.camJoints(it.world), left = it.key === 'r';  // mirrored: your right hand becomes the toon's left (rig 'r')
    var qx = VT.handFrameXR ? VT.handFrameXR(J, left) : null, c = VT.fingerCurls ? VT.fingerCurls(J) : null;
    if (!qx || !c) return;
    var q = qx.multiply(HAND_OFF), H = this.hands[it.key];
    if (!H || !H.seen) H = this.hands[it.key] = { lm: it.lm, q: q, c: c, w: H ? H.w : 0, seen: true };
    else {
      H.q.slerp(q, 0.5);
      for (var i = 0; i < 4; i++) H.c[i] = lerp(H.c[i], c[i], 0.5);
      H.lm = it.lm.map(function (p, j) { var o = H.lm[j]; return { x: lerp(o.x, p.x, 0.55), y: lerp(o.y, p.y, 0.55), z: p.z }; });
      H.seen = true;
    }
  };
  CamPuppet.prototype._draw = function (list, v) {
    var cv = this.overlay, g = cv.getContext('2d');
    if (v.videoWidth && cv.width !== v.videoWidth) { cv.width = v.videoWidth; cv.height = v.videoHeight; }
    var w = cv.width, h = cv.height;
    g.clearRect(0, 0, w, h);
    g.lineWidth = Math.max(2, w / 220); g.strokeStyle = 'rgba(240, 192, 96, .9)'; g.fillStyle = '#ffd36b';
    list.forEach(function (it) {
      g.beginPath();
      BONES.forEach(function (b) { var p = it.lm[b[0]], q = it.lm[b[1]]; g.moveTo(p.x * w, p.y * h); g.lineTo(q.x * w, q.y * h); });
      g.stroke();
      it.lm.forEach(function (p) { g.fillRect(p.x * w - 2, p.y * h - 2, 4, 4); });
    });
    if (this.facePts) {
      g.fillStyle = 'rgba(233, 74, 91, .95)';
      [33, 263, 1, 61, 291, 152, 10].forEach(function (id) { var p = this.facePts[id]; if (p) { g.beginPath(); g.arc(p.x * w, p.y * h, Math.max(2.5, w / 160), 0, Math.PI * 2); g.fill(); } }, this);
    }
  };
  CamPuppet.prototype.recenter = function () { this.ref = null; this.calib = []; this._say(null, 'Sit naturally and look at the screen...'); return true; };

  /* the frame for VT.Perform: base = VT.proceduralPose(actor, ...) (breathing, resting hands) with the tracked parts */
  CamPuppet.prototype.pose = function (a, base) {
    var ref = this.ref || { yaw: 0, pitch: 0.55, roll: 0, cx: 0.5, cy: 0.38, w: 0.13 }, asp = this.asp || 4 / 3, h = a.def.build.h || 1;
    var hd = this.head;
    if (hd && hd.seen) {
      var ang = VT.camHeadAngles(hd, ref), hp = base.head.p;
      var lean = clamp(-(hd.cx - ref.cx) * asp / ref.w, -2, 2), rise = clamp(-(hd.cy - ref.cy) / ref.w, -1.5, 1.5);
      base.head = { p: [hp[0] + lean * 0.04 * h, hp[1] + rise * 0.02 * h, hp[2]], q: VT.quatYXZ(ang.pitch, ang.yaw, ang.roll) };
    }
    var self = this;
    ['l', 'r'].forEach(function (k) {
      var H = self.hands[k];
      if (!H) return;
      H.w = clamp((H.w || 0) + (H.seen ? 0.25 : -0.12), 0, 1);  // fade in when seen, back to rest when lost
      if (H.w <= 0) return;
      var tp = VT.camHandTarget(H.lm, k, ref, asp, a), rest = base[k] || { p: [a.handRest[k].x, a.handRest[k].y, a.handRest[k].z] }, w = H.w;
      var p = [lerp(rest.p[0], tp[0], w), lerp(rest.p[1], tp[1], w), lerp(rest.p[2], tp[2], w)];
      var q = H.q;
      if (w < 1 && rest.q) { var rq = new T.Quaternion(rest.q[0], rest.q[1], rest.q[2], rest.q[3]); q = rq.slerp(H.q, w); }
      var c = H.c.map(function (x) { return Math.round(x * 1000) / 1000; });
      base[k] = { p: p, q: [q.x, q.y, q.z, q.w], g: VT.nearestShape ? VT.nearestShape(c) : 7, c: c };
    });
    return base;
  };
  CamPuppet.prototype.close = function () {
    this.closed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this.stream) this.stream.getTracks().forEach(function (t) { t.stop(); });
    if (this.box && this.box.parentNode) this.box.parentNode.removeChild(this.box);
    this.state = 'off';
  };
})();
