/* vt-xr.js: VT.Perform, the performance stage: record one role of a production (head + both hands + voice).

   new VT.Perform(el, {doc, takes, actor, from, to, onPass, onState, others: true, test})
   One PASS = one role through a run of beats. The performer's own lines advance by voice (the teleprompter moves on when
   you stop talking) or with A / Space; the other characters play their chosen takes (voice + body) or, when nothing is
   recorded yet, read their lines on the teleprompter for an estimated time. The pass is cut into clips per beat:
   the performer's lines (which set the beat lengths) and reactions during the other beats.
     VR          immersive-vr: you stand on your character's mark, at your character's height (the world scales);
                 a teleprompter floats ahead, the director's monitor shows the film camera (you, as the toon).
     Passthrough immersive-ar: your room, the characters in it (no set).
     Flat        no headset: the mouse is your right hand, the keys move your head (a desk puppet), same recording.
   Controllers: A / X = action, next line, cut;  B / Y = retake;  thumbstick left/right = switch role (between takes);
                the fingers follow the touch sensors (trigger = index, grip = the other fingers, a thumb off the buttons =
                thumbs up); the laser picks menu buttons.
   Hands (hand tracking, no controllers): the wrist and every finger's curl come from the WebXR hand joints; a pinch
                presses menu buttons. Takes record four curls per hand (thumb, index, middle, ring + little finger).
   Live view: startPreview() renders what the performer sees (or the film camera) into a small canvas ~12 times a second
                and returns its stream; vt-live.js sends it to the director's computer over WebRTC.
   stage.live[actorId] drives the performer from the headset instead of the film. */
(function () {
  'use strict';
  var VT = window.VT = window.VT || {};
  var T = window.THREE;
  if (!T) return;
  var D2R = Math.PI / 180, FPS = 30, PREROLL = 1.0;
  var HAND_OFF = new T.Quaternion(0, Math.SQRT1_2, Math.SQRT1_2, 0);  // the toon hand's fingers (-Y) along the XR -Z, its back (+Z) along XR +Y
  /* A held controller: the toon fingers along the grip's -Z, the thumb up (+Y) and the back of the hand facing out, as
     your own hand sits on a Quest controller (WebXR grip space: the right hand's back points +X, the left hand's -X).
     side = the rig arm's side (+1 = 'r', worn by the left hand). Without this the toon palms faced the floor. */
  function gripOff(side) {
    return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(new T.Vector3(0, -side, 0), new T.Vector3(0, 0, 1), new T.Vector3(-side, 0, 0)));
  }
  var GRIP_OFF = { r: gripOff(1), l: gripOff(-1) };
  // The rig names its arms by where they sit: 'r' is the arm on +X. A character faces +Z, so that is its LEFT arm, and the
  // performer's left hand (on their +X once calibrated) must drive it, or the arms cross.
  var RIG_KEY = { left: 'r', right: 'l' };
  var FINGERS = {
    thumb: ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
    index: ['index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'],
    middle: ['middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'],
    ring: ['ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip'],
    pinky: ['pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip']
  };
  function bendOf(ps) {  // the sum of the angles between a finger's bones (radians)
    var s = 0;
    for (var i = 0; i + 2 < ps.length; i++) {
      var a = ps[i + 1].clone().sub(ps[i]), b = ps[i + 2].clone().sub(ps[i + 1]);
      if (a.lengthSq() > 1e-10 && b.lengthSq() > 1e-10) s += a.angleTo(b);
    }
    return s;
  }
  /* finger curls [thumb, index, middle, ring] (0 straight .. 1 curled) from WebXR hand joint positions {name: Vector3};
     the toon's third finger stands for the ring and little fingers together. null when a joint is missing. */
  VT.fingerCurls = function (pos) {
    function f(name) { var out = FINGERS[name].map(function (j) { return pos[j]; }); return out.every(Boolean) ? out : null; }
    var th = f('thumb'), ix = f('index'), md = f('middle'), rg = f('ring'), pk = f('pinky');
    if (!th || !ix || !md || !rg) return null;
    var k = function (b, lo, span) { return VT.clamp((b - lo) / span, 0, 1); };
    var ring = k(bendOf(rg), 0.3, 3.7), pinky = pk ? k(bendOf(pk), 0.3, 3.7) : ring;
    return [k(bendOf(th), 0.35, 1.5), k(bendOf(ix), 0.3, 3.7), k(bendOf(md), 0.3, 3.7), (ring + pinky) / 2];
  };
  /* the hand's rotation in the XR convention (fingers -Z, back of the hand +Y) from the wrist and the knuckles */
  VT.handFrameXR = function (pos, left) {
    var w = pos['wrist'], m = pos['middle-finger-phalanx-proximal'], ix = pos['index-finger-phalanx-proximal'], pk = pos['pinky-finger-phalanx-proximal'] || pos['ring-finger-phalanx-proximal'];
    if (!w || !m || !ix || !pk) return null;
    var f = m.clone().sub(w).normalize(), a = ix.clone().sub(pk).normalize();
    var back = left ? new T.Vector3().crossVectors(a, f) : new T.Vector3().crossVectors(f, a);
    var z = f.clone().negate(), y = back.sub(z.clone().multiplyScalar(back.dot(z))).normalize(), x = new T.Vector3().crossVectors(y, z);
    return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, z));
  };
  /* finger curls from a controller's touch sensors (Quest Touch reports `touched`); without them, from how hard you squeeze */
  VT.touchCurls = function (gp, seenTouch) {
    var b = (gp && gp.buttons) || [], val = function (i) { return b[i] ? b[i].value || (b[i].pressed ? 1 : 0) : 0; };
    var touch = function (i) { return !!(b[i] && (b[i].touched || b[i].pressed)); };
    var trig = val(0), grip = val(1), mid = 0.18 + 0.82 * grip;
    if (!seenTouch) return [grip > 0.5 ? 0.75 : 0.2, 0.15 + 0.85 * trig, mid, Math.min(1, mid + 0.05)];
    var thumbDown = touch(3) || touch(4) || touch(5) || touch(6);
    var index = touch(0) || trig > 0.05 ? 0.35 + 0.65 * trig : 0.03;
    return [thumbDown ? 0.72 : (grip > 0.5 ? 0 : 0.15), index, mid, Math.min(1, mid + 0.05)];
  };

  function Perform(el, o) {
    var self = this;
    this.o = o || {};
    this.doc = o.doc; this.takes = o.takes || new VT.Takes();
    this.state = 'ready'; this.note = ''; this.mode = 'flat'; this.range = [];
    this._puppet = { mx: 0.4, my: 0.1, down: false, point: false, yaw: 0, pitch: 0, lean: 0 };
    this.prompter = document.createElement('canvas'); this.prompter.width = 1024; this.prompter.height = 512;
    this.stage = new VT.Stage(el, { mode: 'film', doc: this.doc, takes: this.takes, interactive: false, muted: true, maxDpr: 1.5 });
    if (this.stage.dead) { this.dead = true; return; }
    var st = this.stage;
    st.o.subs = false;
    st.o.titles = false; st.o.fades = false;
    st.hooks.always = true;
    st.hooks.beforeFrame = function (t, dt) { self._tick(dt); };
    st.hooks.afterPose = function () { self._afterPose(); };
    st.hooks.overlay = function (c, fr) { if (self.mode === 'flat') self._drawFlatPrompter(c, fr); };
    st.renderer.xr.enabled = true;
    this.setRole(o.actor || (this.doc.d.cast[0] && this.doc.d.cast[0].id));
    this.setRange(o.from, o.to);
    this._input(el);
    this.others = o.others !== false;
    this.takes.loadAll().then(function () { st.refresh(); self._emit(); });
    this._emit();
  }
  VT.Perform = Perform;

  Perform.prototype.supports = function () {
    if (!navigator.xr) return Promise.resolve({ vr: false, ar: false });
    return Promise.all([navigator.xr.isSessionSupported('immersive-vr').catch(function () { return false; }),
      navigator.xr.isSessionSupported('immersive-ar').catch(function () { return false; })]).then(function (r) { return { vr: !!r[0], ar: !!r[1] }; });
  };

  /* ------------------------------------------------------------------ role + range */
  Perform.prototype.setRole = function (aid) {
    if (this.state === 'rec' || this.state === 'countdown') return;
    var st = this.stage;
    if (this.actor && st.live[this.actor]) delete st.live[this.actor];
    if (this.actor && st.actors[this.actor]) st.actors[this.actor].firstPerson(false);
    this.actor = aid;
    var self = this;
    st.live[aid] = function (a, t) { self._livePose(a, t); };
    if (this.mode !== 'flat' && st.actors[aid]) st.actors[aid].firstPerson(true);
    this._calib = null;
    if (this.mode !== 'flat') this._needCalib = 6;  // stand on the new character's mark
    this._emit();
  };
  Perform.prototype.cycleRole = function (dir) {
    var ids = this.doc.d.cast.map(function (c) { return c.id; }), i = ids.indexOf(this.actor);
    this.setRole(ids[(i + dir + ids.length) % ids.length]);
  };
  Perform.prototype.setRange = function (from, to) {
    var beats = this.doc.d.beats.map(function (b) { return b.id; });
    var i = from ? beats.indexOf(from) : 0, j = to ? beats.indexOf(to) : beats.length - 1;
    this.range = beats.slice(Math.max(0, i), Math.max(0, j) + 1);
    this._emit();
  };
  Perform.prototype.myLines = function () {
    var a = this.actor;
    return this.doc.d.beats.filter(function (b) { return b.kind === 'line' && b.who === a; }).length;
  };

  /* ------------------------------------------------------------------ entering VR / passthrough */
  Perform.prototype.enterVR = function (ar) {
    var self = this, r = this.stage.renderer;
    if (!navigator.xr) return Promise.reject(new Error('No WebXR here. Open VRtoToon in your headset\'s browser.'));
    if (this.session || this._entering) return Promise.resolve();  // already in (or on the way in)
    this._entering = true;
    return navigator.xr.requestSession(ar ? 'immersive-ar' : 'immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] }).then(function (session) {
      r.xr.setReferenceSpaceType('local-floor');
      return r.xr.setSession(session).then(function () {
        self._entering = false;
        self.mode = ar ? 'ar' : 'vr'; self.session = session;
        // this session's own floor space. Every session has its own: one kept from an earlier session makes three.js
        // throw "XRSpace and XRFrame sessions do not match" on every frame (leave VR, come back in).
        self._baseSpace = r.xr.getReferenceSpace();
        self.stage.set.setAR && self.stage.set.setAR(!!ar);
        if (ar) { r.setClearColor(0x000000, 0); }
        if (self.stage.actors[self.actor]) self.stage.actors[self.actor].firstPerson(true);
        self._buildXR();
        session.addEventListener('end', function () { self._leaveXR(); });
        self._calib = null; self._needCalib = 6;  // calibrate once the headset pose arrives (a few frames)
        self._emit();
      });
    }).catch(function (e) { self._entering = false; throw e; });
  };
  Perform.prototype.exitVR = function () { if (this.session) this.session.end(); };
  Perform.prototype._leaveXR = function () {
    var st = this.stage;
    if (this.state === 'rec' || this.state === 'countdown') this.cut();
    this.mode = 'flat'; this.session = null; this._entering = false;
    this._baseSpace = null; this._needCalib = 0; this._hudYaw = null;  // the next session starts from scratch
    st.set.setAR && st.set.setAR(false);
    st.renderer.setClearColor(0x000000, 1);
    st.scene.scale.setScalar(1);
    (this.ctrl || []).forEach(function (info) { info.off(); });
    this.ctrl = null; this._hover = null;
    if (this.hud) {
      st.scene.remove(this.hud); this.hud = null;
      [this.promptTex, this.menuTex, this.monRT].forEach(function (x) { if (x) x.dispose(); });
    }
    if (st.actors[this.actor]) st.actors[this.actor].firstPerson(false);
    this._calib = null;
    this._emit();
  };
  // the headset furniture: teleprompter, monitor, menu, lasers. Lives in a HUD group that undoes the world scale.
  Perform.prototype._buildXR = function () {
    var st = this.stage, self = this, r = st.renderer;
    var hud = this.hud = new T.Group(); hud.name = 'hud'; st.scene.add(hud);
    st.hooks.xrCamera = st.hooks.xrCamera || new T.PerspectiveCamera(70, 1, 0.03, 120);  // layer 0 only: the eyes never see your own head (layer 3)
    this.promptTex = new T.CanvasTexture(this.prompter); this.promptTex.colorSpace = T.SRGBColorSpace;
    var pm = new T.Mesh(new T.PlaneGeometry(1.0, 0.5), new T.MeshBasicMaterial({ map: this.promptTex, transparent: true, fog: false, toneMapped: false }));
    pm.renderOrder = 10; this.promptMesh = pm; hud.add(pm);
    this.monRT = new T.WebGLRenderTarget(640, 360);
    this.monRT.texture.colorSpace = T.SRGBColorSpace;
    var mon = new T.Mesh(new T.PlaneGeometry(0.8, 0.45), new T.MeshBasicMaterial({ map: this.monRT.texture, fog: false, toneMapped: false }));
    var frame = new T.Mesh(new T.PlaneGeometry(0.86, 0.53), new T.MeshBasicMaterial({ color: '#151214', fog: false })); frame.position.z = -0.005;
    var monG = this.monitor = new T.Group(); monG.add(frame); monG.add(mon); hud.add(monG);
    this.menuCanvas = document.createElement('canvas'); this.menuCanvas.width = 1024; this.menuCanvas.height = 640;
    this.menuTex = new T.CanvasTexture(this.menuCanvas); this.menuTex.colorSpace = T.SRGBColorSpace;
    var menu = this.menuMesh = new T.Mesh(new T.PlaneGeometry(0.8, 0.5), new T.MeshBasicMaterial({ map: this.menuTex, transparent: true, fog: false, toneMapped: false }));
    hud.add(menu);
    this.ctrl = [0, 1].map(function (i) {
      var c = r.xr.getController(i), g = r.xr.getControllerGrip(i), hs = r.xr.getHand(i);
      var laser = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3(0, 0, -1)]), new T.LineBasicMaterial({ color: '#ffd166' }));
      var dot = new T.Mesh(new T.SphereGeometry(0.008, 10, 8), new T.MeshBasicMaterial({ color: '#ffd166' }));
      hud.add(laser); hud.add(dot);
      var info = { c: c, g: g, hs: hs, laser: laser, dot: dot, hand: null, src: null, touch: false, curl: null };
      // three.js keeps the same controller objects for every session: take these off again when VR ends, or each
      // visit adds another set and one trigger pull presses a menu button several times
      var on = {
        connected: function (e) { info.src = e.data; info.hand = e.data.handedness; },
        disconnected: function () { info.src = null; },
        selectstart: function () { if (self._hover && self.state !== 'rec') self._hover.fn(); }
      };
      Object.keys(on).forEach(function (k) { c.addEventListener(k, on[k]); });
      info.off = function () { Object.keys(on).forEach(function (k) { c.removeEventListener(k, on[k]); }); };
      return info;
    });
    this._lastBtn = {};
  };
  // world scale + offset so the performer stands on the mark at the character's height
  Perform.prototype._calibrate = function () {
    var st = this.stage, r = st.renderer, a = st.actors[this.actor];
    if (!a) return;
    var xc = r.xr.getCamera(); xc.updateMatrixWorld(true);
    var hp = new T.Vector3(), hq = new T.Quaternion(); xc.matrixWorld.decompose(hp, hq, new T.Vector3());
    if (hp.y < 0.3) return false;
    var k = VT.clamp(hp.y / a.eyeY, 0.4, 3.0);  // world scale: performer eye height / character eye height
    st.scene.scale.setScalar(k);
    var fwd = new T.Vector3(0, 0, -1).applyQuaternion(hq), yaw0 = Math.atan2(-fwd.x, -fwd.z);
    var pl = st.film.place(this.actor, this._filmT(), true);
    var M = new T.Vector3(pl.x * k, 0, pl.z * k);
    // W maps the physical room into the world: T(M) * R(f + PI - yaw0) * T(-p0)
    var W = new T.Matrix4().makeTranslation(M.x, 0, M.z)
      .multiply(new T.Matrix4().makeRotationY(pl.f + Math.PI - yaw0))
      .multiply(new T.Matrix4().makeTranslation(-hp.x, 0, -hp.z));
    var inv = W.clone().invert(), p = new T.Vector3(), q = new T.Quaternion();
    inv.decompose(p, q, new T.Vector3());
    var base = this._baseSpace;
    if (!base || !this.session || r.xr.getSession() !== this.session) return false;
    r.xr.setReferenceSpace(base.getOffsetReferenceSpace(new XRRigidTransform({ x: p.x, y: p.y, z: p.z, w: 1 }, { x: q.x, y: q.y, z: q.z, w: q.w })));
    this._calib = { k: k, x: pl.x, z: pl.z, f: pl.f, eye: hp.y };
    return true;
  };

  /* ------------------------------------------------------------------ reading the performer (VR or the desk puppet) */
  // returns a frame in the character's own space: head p/q, hands p/q/shape
  Perform.prototype._readXR = function () {
    var st = this.stage, r = st.renderer, C = this._calib, a = st.actors[this.actor];
    if (!C || !a) return null;
    var k = C.k, f = C.f, rinv = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), -f);
    function toLocal(m) {
      var p = new T.Vector3(), q = new T.Quaternion(); m.decompose(p, q, new T.Vector3());
      p.divideScalar(k); p.x -= C.x; p.z -= C.z; p.applyQuaternion(rinv);
      return { p: p, q: rinv.clone().multiply(q) };
    }
    var xc = r.xr.getCamera(); xc.updateMatrixWorld(true);
    var head = toLocal(xc.matrixWorld);
    // the camera sits at the eyes; the head's centre is a little behind and below
    var hc = head.p.clone().add(new T.Vector3(0, -(a.eyeY - a.headRest.y), -a.headR * 0.3).applyQuaternion(head.q));
    var out = { head: { p: [hc.x, hc.y, hc.z], q: [head.q.x, head.q.y, head.q.z, head.q.w] } };
    var self = this;
    (this.ctrl || []).forEach(function (info) {
      if (!info.src) return;
      var key = RIG_KEY[info.hand] || 'l';
      var hand = info.src.hand ? self._readHand(info, toLocal) : null;
      if (hand) { out[key] = hand; return; }
      if (info.src.hand) return;  // a tracked hand that is out of view this frame: the arm rests
      var g = toLocal(info.g.matrix.clone());
      var hq = g.q.clone().multiply(GRIP_OFF[key]);
      var wrist = g.p.clone().add(new T.Vector3(0, 0.055 * a.def.build.h, 0).applyQuaternion(hq));
      var gp = info.src.gamepad;
      if (gp && gp.buttons && !info.touch) info.touch = gp.buttons.some(function (b) { return b && b.touched && !b.pressed; });
      var c = self._smooth(info, VT.touchCurls(gp, info.touch));
      out[key] = { p: [wrist.x, wrist.y, wrist.z], q: [hq.x, hq.y, hq.z, hq.w], g: VT.nearestShape(c), c: c };
      self._buttons(info, gp);
    });
    return out;
  };
  // a tracked hand: wrist position + rotation from the joints, finger curls from the bones
  Perform.prototype._readHand = function (info, toLocal) {
    var J = info.hs && info.hs.joints;
    if (!J || !J['wrist'] || !J['wrist'].visible) return null;
    var pos = {};
    Object.keys(J).forEach(function (n) { if (J[n].visible) pos[n] = J[n].position.clone(); });
    var qx = VT.handFrameXR(pos, info.hand === 'left'), c = VT.fingerCurls(pos);
    if (!qx || !c) return null;
    var m = new T.Matrix4().compose(pos['wrist'], qx, new T.Vector3(1, 1, 1));
    var w = toLocal(m), hq = w.q.clone().multiply(HAND_OFF);
    c = this._smooth(info, c);
    return { p: [w.p.x, w.p.y, w.p.z], q: [hq.x, hq.y, hq.z, hq.w], g: VT.nearestShape(c), c: c };
  };
  Perform.prototype._smooth = function (info, c) {  // a little low-pass so tracking jitter doesn't twitch the fingers
    if (!info.curl) info.curl = c.slice();
    for (var i = 0; i < 4; i++) info.curl[i] += (c[i] - info.curl[i]) * 0.5;
    return info.curl.map(function (v) { return Math.round(v * 1000) / 1000; });
  };
  Perform.prototype._readPuppet = function () {
    var a = this.stage.actors[this.actor]; if (!a) return null;
    var P = this._puppet, h = a.def.build.h, t = performance.now() / 1000;
    var base = VT.proceduralPose(a, { t: t, seed: 4, speaking: this._level > 0.15, talk: this._level });
    var sh = a.P.hipY + a.P.torsoH * 0.8;
    var rx = a.P.torsoW * 1.2 + P.mx * 0.42 * h, ry = sh + P.my * 0.42 * h, rz = 0.22 * h + Math.max(0, 0.2 - Math.abs(P.mx) * 0.2) * h;
    var gr = P.down ? 1 : P.point ? 2 : P.shapeR != null ? P.shapeR : 7;
    var fwd = P.down || P.point || gr === 3;  // fists and points reach forward, palm in; open hands face the camera
    base.r = { p: [rx, ry, rz], q: fwd ? VT.handQ(0.12, 0.1, 1, -1, 0, 0) : VT.handQ(-0.15 + P.mx * 0.2, 1, 0.25 - P.my * 0.35, -0.25, 0, 1), g: gr, c: VT.handCurls(gr) };
    if (P.shapeL != null) { base.l.g = P.shapeL; base.l.c = VT.handCurls(P.shapeL); base.l.p[1] += 0.12 * h; base.l.p[2] += 0.14 * h; base.l.q = VT.handQ(0.15, 1, 0.25, 0.25, 0, 1); }
    var hp = base.head.p;
    var yaw = P.yaw + P.mx * 14, pitch = P.pitch - P.my * 8;
    base.head = { p: [hp[0] + P.lean * 0.08 * h, hp[1], hp[2] + Math.abs(P.lean) * 0.02], q: VT.quatYXZ(pitch, yaw, -P.lean * 8) };
    return base;
  };
  Perform.prototype._input = function (el) {
    var self = this, P = this._puppet;
    this._onMove = function (ev) {
      var rc = el.getBoundingClientRect();
      P.mx = VT.clamp(((ev.clientX - rc.left) / rc.width) * 2 - 1, -1, 1) * 1.2;
      P.my = VT.clamp(-(((ev.clientY - rc.top) / rc.height) * 2 - 1), -1, 1) * 1.1;
    };
    this._onDown = function () { P.down = true; };
    this._onUp = function () { P.down = false; };
    this._onKey = function (ev) {
      var tag = (ev.target && ev.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      var on = ev.type === 'keydown';
      if (ev.code === 'KeyA') P.yaw = on ? 25 : 0;
      if (ev.code === 'KeyD') P.yaw = on ? -25 : 0;
      if (ev.code === 'KeyW') P.pitch = on ? -14 : 0;
      if (ev.code === 'KeyS') P.pitch = on ? 16 : 0;
      if (ev.code === 'KeyQ') P.lean = on ? -1 : 0;
      if (ev.code === 'KeyE') P.lean = on ? 1 : 0;
      if (ev.code === 'KeyF') P.point = on;
      var dg = /^Digit([1-8])$/.exec(ev.code);  // 1-8: a hand shape for the mouse hand (Shift: the other hand); again = relaxed
      if (on && dg && !ev.repeat) {
        var n = +dg[1] - 1, k2 = ev.shiftKey ? 'shapeL' : 'shapeR';
        P[k2] = P[k2] === n ? null : n;
      }
      if (on && ev.code === 'Space' && !ev.repeat) { ev.preventDefault(); self.primary(); }
    };
    el.addEventListener('pointermove', this._onMove);
    el.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKey);
  };
  // A / X button: start, next line, or stop; B / Y: retake; thumbstick: switch role
  Perform.prototype._buttons = function (info, gp) {
    if (!gp || !gp.buttons) return;
    var id = info.hand || 'r', last = this._lastBtn[id] || {}, now = {};
    now.a = gp.buttons[4] && gp.buttons[4].pressed; now.b = gp.buttons[5] && gp.buttons[5].pressed;
    var ax = gp.axes && gp.axes.length >= 4 ? gp.axes[2] : 0;
    now.left = ax < -0.7; now.right = ax > 0.7;
    if (now.a && !last.a) this.primary();
    if (now.b && !last.b) { if (this.state === 'review') this.retake(); else if (this.state === 'rec') this.cut(); }
    if ((now.left && !last.left) || (now.right && !last.right)) { if (this.state === 'ready' || this.state === 'review') { if (this.state === 'review') this.discard(); this.cycleRole(now.left ? -1 : 1); } }
    this._lastBtn[id] = now;
  };
  // the one big button: Action! -> next line -> (last line) cut; in review: keep
  Perform.prototype.primary = function () {
    if (this.state === 'ready') this.action();
    else if (this.state === 'rec') { var cur = this._cur(); if (cur && cur.mine && cur.speaking) this._endLine(); else if (cur && cur.mine) this._endLine(true); else this.cut(); }
    else if (this.state === 'review') this.keep();
  };

  /* ------------------------------------------------------------------ the microphone */
  Perform.prototype._mic = function () {
    var self = this;
    if (this._stream) return Promise.resolve(this._stream);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve(null);
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(function (s) {
      self._stream = s;
      var ctx = VT.audioCtx();
      self._an = ctx.createAnalyser(); self._an.fftSize = 2048;
      ctx.createMediaStreamSource(s).connect(self._an);
      self._buf = new Float32Array(self._an.fftSize);
      return s;
    }).catch(function (e) { console.warn('microphone', e); self._micError = String(e && e.message || e); return null; });
  };
  Perform.prototype._listen = function () {
    if (!this._an) return { rms: 0, zcr: 0 };
    this._an.getFloatTimeDomainData(this._buf);
    var s = 0, z = 0, d = this._buf;
    for (var i = 0; i < d.length; i++) { s += d[i] * d[i]; if (i && (d[i] >= 0) !== (d[i - 1] >= 0)) z++; }
    return { rms: Math.sqrt(s / d.length), zcr: z / d.length };
  };

  /* ------------------------------------------------------------------ a pass */
  Perform.prototype.action = function () {
    var self = this;
    if (this.state !== 'ready' || !this.range.length) return;
    this.discard();
    this.state = 'countdown'; this._count = 3.0; this._noise = [];
    this._emit();
    this._mic().then(function () { self._emit(); });
  };
  Perform.prototype._startRec = function () {
    var self = this, d = this.doc.d, L = this.stage.film.L;
    this.state = 'rec'; this._tau = 0; this._frames = []; this._mouth = []; this._acc = 0;
    var nf = this._noise.length ? this._noise.slice().sort(function (a, b) { return a - b; })[Math.floor(this._noise.length * 0.6)] : 0.004;
    this._thresh = Math.max(0.012, nf * 3.2);
    // the run: each beat in the range with its planned length (others: their take or an estimate; mine: until I stop talking)
    var self2 = this;
    this._run = this.range.map(function (id) {
      var b = self2.doc.beat(id), lb = L.by[id];
      return { id: id, kind: b.kind, who: b.who, text: b.text, emo: b.emo, mine: b.kind === 'line' && b.who === self2.actor,
        filmStart: lb ? lb.start : 0, plan: lb ? lb.dur : VT.estimate(b), gap: lb ? lb.gap : 0.35, start: null, dur: null, heard: false, speaking: false, quiet: 0 };
    });
    this._ri = -1; this._next = PREROLL;
    VT.sfxBuffer('clapper').then(function (buf) { if (!buf) return; var ctx = VT.audioCtx(), s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination); s.start(); });
    // record the voice
    this._chunks = [];
    if (this._stream && window.MediaRecorder) {
      var mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].filter(function (m) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m); })[0] || '';
      try {
        this._rec = new MediaRecorder(this._stream, mime ? { mimeType: mime } : undefined);
        this._rec.ondataavailable = function (e) { if (e.data && e.data.size) self._chunks.push(e.data); };
        this._rec.start(500);
      } catch (e) { console.warn(e); this._rec = null; }
    }
    this._emit();
  };
  Perform.prototype._cur = function () { return this._run && this._run[this._ri]; };
  // move on: called by voice detection, the button, or the planned time
  Perform.prototype._endLine = function (skip) {
    var c = this._cur(); if (!c || c.dur != null) return;
    c.dur = Math.max(0.6, (c.speechEnd != null && !skip ? c.speechEnd + 0.25 : this._tau - c.start));
    this._next = c.start + c.dur + Math.max(0.15, c.gap);
  };
  Perform.prototype._advance = function () {
    var c = this._cur();
    if (c && c.dur == null) c.dur = this._tau - c.start;
    this._ri++;
    var n = this._cur();
    if (!n) { this._finish(); return; }
    n.start = this._tau;
    if (!n.mine) {
      n.dur = n.plan; this._next = n.start + n.dur + Math.max(0.1, n.gap);
      if (this.others) this._playOther(n);
    } else { this._next = null; this._lineT0 = this._tau; }
    this._emit();
  };
  Perform.prototype._playOther = function (n) {
    var film = this.stage.film, lb = film.L.by[n.id];
    if (!lb || n.kind !== 'line') return;
    var src = film.source(n.who, lb);
    if (!src) return;
    var self = this;
    film.takes.load(src.uid).then(function (tk) {
      if (!tk || !tk.buffer || self.state !== 'rec') return;
      var ctx = VT.audioCtx(), cast = self.doc.actor(n.who) || {};
      var ch = VT.voiceChain(ctx, cast.fx || 'none'); ch.output.connect(ctx.destination);
      var s = ctx.createBufferSource(); s.buffer = tk.buffer; s.connect(ch.input);
      s.start(ctx.currentTime, src.clip.off, n.dur + 0.1);
      self._playing = (self._playing || []).concat([s]);
    });
  };
  Perform.prototype.cut = function () {
    if (this.state === 'countdown') { this.state = 'ready'; this._emit(); return; }
    if (this.state !== 'rec') return;
    var c = this._cur(); if (c && c.dur == null) c.dur = Math.max(0.4, this._tau - c.start);
    this._run = this._run.slice(0, Math.max(0, this._ri + 1)).filter(function (x) { return x.start != null; });
    this._finish();
  };
  Perform.prototype._finish = function () {
    var self = this;
    (this._playing || []).forEach(function (s) { try { s.stop(); } catch (e) {} }); this._playing = [];
    this.state = 'review';
    var mouth = this._mouth, peak = mouth.map(function (m) { return m[0]; }).sort(function (a, b) { return a - b; })[Math.floor(mouth.length * 0.97)] || 0.05;
    var floor = this._thresh * 0.6;
    var m = mouth.map(function (x) {
      var o = VT.clamp((x[0] - floor) / Math.max(0.01, peak - floor), 0, 1); o = Math.pow(o, 0.65);
      var w = VT.clamp((x[1] - 0.03) / 0.12, 0, 1);
      return String.fromCharCode(48 + Math.round(o * 9)) + String.fromCharCode(48 + Math.round(w * 9));
    }).join('');
    var n = this._frames.length / VT.FRAME;
    var motion = { fps: FPS, n: n, k: VT.FRAME, f: Float32Array.from(this._frames), m: m };
    var clips = this._run.filter(function (r) { return r.start != null && r.dur != null; }).map(function (r) {
      return { beat: r.id, off: Math.round(r.start * 1000) / 1000, dur: Math.round(r.dur * 1000) / 1000, line: !!r.mine };
    });
    this.pass = { uid: VT.uid('t'), actor: this.actor, source: this.mode === 'flat' ? 'desk' : 'vr', clips: clips, dur: this._tau, motion: motion, mic: !!this._stream };
    var done = function () {
      self.pass.audio = self._chunks.length ? new Blob(self._chunks, { type: self._chunks[0].type || 'audio/webm' }) : null;
      self._previewPass();
      self._emit();
    };
    if (this._rec && this._rec.state !== 'inactive') { this._rec.onstop = done; this._rec.stop(); } else done();
    this._emit();
  };
  // review: the new pass becomes a temporary take, selected for its clips, and the film plays it from the top
  Perform.prototype._previewPass = function () {
    var p = this.pass, self = this, st = this.stage;
    if (!p) return;
    this._prevSel = JSON.parse(JSON.stringify(this.doc.d.sel));
    var tk = this.takes.add({ uid: p.uid, actor: p.actor, clips: p.clips, motion: p.motion, source: p.source, temp: true });
    var go = function () {
      p.clips.forEach(function (c) { self.doc.d.sel[c.beat + '|' + p.actor] = p.uid; });
      delete st.live[self.actor];
      st.muted = false;
      st.refresh();
      var first = st.film.L.by[p.clips[0] && p.clips[0].beat];
      st.seek(Math.max(0, (first ? first.start : 0) - 0.5));
      st.play();
      self._emit();
    };
    if (p.audio) {
      p.audio.arrayBuffer().then(function (ab) { return new Promise(function (res) { VT.audioCtx().decodeAudioData(ab, res, function () { res(null); }); }); })
        .then(function (buf) { tk.buffer = buf; if (buf) p.motion.m = VT.analyzeVoice(buf, FPS); go(); });
    } else go();
  };
  Perform.prototype._endReview = function () {
    var st = this.stage;
    st.pause(); st.muted = true;
    var self = this;
    st.live[this.actor] = function (a, t) { self._livePose(a, t); };
  };
  // keep: hand the pass to the app (it uploads it); the selection stays
  Perform.prototype.keep = function () {
    if (this.state !== 'review' || !this.pass) return null;
    var p = this.pass;
    this.takes.map[p.uid].temp = false;
    this._endReview();
    this.state = 'ready'; this.pass = null;
    this.doc.emit('sel');
    this.stage.refresh();
    if (this.o.onPass) this.o.onPass(p);
    this._emit();
    return p;
  };
  Perform.prototype.discard = function () {
    if (!this.pass) return;
    if (this._prevSel) this.doc.d.sel = this._prevSel;
    this.takes.remove(this.pass.uid);
    this.pass = null;
    this._endReview();
    this.state = 'ready';
    this.stage.refresh();
    this._emit();
  };
  Perform.prototype.retake = function () { this.discard(); this.action(); };

  /* ------------------------------------------------------------------ every frame */
  Perform.prototype._filmT = function () {
    var c = this._cur();
    if (this.state === 'rec' && c) {
      var local = this._tau - c.start;
      return c.filmStart + Math.min(local, c.mine ? Math.max(c.plan, local) : c.plan + c.gap);
    }
    if (this.state === 'rec' && this._run && this._run[0]) return Math.max(0, this._run[0].filmStart - PREROLL + this._tau);
    if (this.state === 'review') return this.stage.time;
    var b = this.range.length ? this.stage.film.L.by[this.range[0]] : null;
    return b ? Math.max(0, b.start - 0.3) : 0;
  };
  Perform.prototype._tick = function () {
    var st = this.stage, nowMs = performance.now();
    var dt = this._tickAt ? Math.min(0.5, (nowMs - this._tickAt) / 1000) : 0; this._tickAt = nowMs;  // real time: the voice recorder runs on the wall clock
    if (this.mode === 'ar' && st.set.setAR && !st.set.ar) st.set.setAR(true);  // a new set arrived mid-session
    if (this.mode !== 'flat' && this._needCalib) { this._needCalib--; if (!this._needCalib && this._calibrate() === false) this._needCalib = 10; }
    var lv = this._listen();
    this._level = VT.clamp((lv.rms - (this._thresh || 0.012) * 0.6) * 18, 0, 1);
    if (this.state === 'countdown') {
      this._noise.push(lv.rms);
      var before = Math.ceil(this._count);
      this._count -= dt;
      if (Math.ceil(this._count) !== before) this._emit();
      if (this._count <= 0) { if (this.mode !== 'flat') this._calibrate(); this._startRec(); }
    }
    if (this.state === 'rec') {
      var test = window.VT_TEST || {};
      this._tau += dt * (test.speed || 1);
      // pre-roll, then the beats one after another
      if (this._ri < 0 && this._tau >= this._next) this._advance();
      var c = this._cur();
      if (c && c.mine) {
        var local = this._tau - c.start;
        var loud = test.lineSecs ? local < test.lineSecs : lv.rms > this._thresh;
        if (loud) { c.heard = true; c.speaking = true; c.quiet = 0; c.speechEnd = null; }
        else if (c.heard) { c.quiet += dt * (test.speed || 1); if (c.quiet > 0.08 && c.speechEnd == null) c.speechEnd = local - c.quiet; if (c.quiet > 0.75) c.speaking = false; }
        if (c.dur == null && c.heard && !c.speaking) this._endLine();
        if (c.dur == null && local > Math.max(14, c.plan * 3)) this._endLine(true);
      }
      if (this._next != null && this._tau >= this._next) this._advance();
      // sample at 30 fps
      this._acc += dt * (test.speed || 1);
      while (this.state === 'rec' && this._acc >= 1 / FPS) {
        this._acc -= 1 / FPS;
        var fr = this._live || this._read();
        if (fr) this._push(fr);
        this._mouth.push([lv.rms, lv.zcr]);
      }
      if (Math.floor(this._tau * 4) !== this._lastEmit) { this._lastEmit = Math.floor(this._tau * 4); this._emit(); }
    }
    if (this.state !== 'review') { st.time = this._filmT(); st._dirty = true; }
    this._live = null;
  };
  Perform.prototype._read = function () { return this.mode === 'flat' ? this._readPuppet() : this._readXR(); };
  Perform.prototype._push = function (fr) {
    var f = this._frames;
    function v(x, n) { for (var i = 0; i < n; i++) f.push(x && x[i] != null ? x[i] : 0); }
    var a = this.stage.actors[this.actor];
    var rest = { l: a.handRest.l, r: a.handRest.r };
    v(fr.head.p, 3); v(fr.head.q || [0, 0, 0, 1], 4);
    ['l', 'r'].forEach(function (k) { var h = fr[k] || { p: [rest[k].x, rest[k].y, rest[k].z] }; v(h.p, 3); v(h.q || [0, 0, 0, 1], 4); });
    f.push(fr.l && fr.l.g || 0); f.push(fr.r && fr.r.g || 0);
    ['l', 'r'].forEach(function (k) { var h = fr[k] || {}; v(h.c || VT.handCurls(h.g || 0), 4); });
  };
  // the performer's toon follows them live (face: the beat's emotion; mouth: the microphone)
  Perform.prototype._livePose = function (a, t) {
    var fr = this._read();
    if (!fr) return;
    this._live = fr;
    var pl = this._calib ? { x: this._calib.x, z: this._calib.z, f: this._calib.f } : this.stage.film.place(this.actor, this._filmT(), true);
    a.root.position.set(pl.x, 0, pl.z); a.root.rotation.set(0, pl.f, 0);
    var c = this._cur(), emo = c && c.mine && c.emo ? c.emo : null;
    var p = Object.assign({}, fr);
    if (!p.l || !p.l.p) delete p.l;
    p.face = VT.faceOf(emo || this.stage.film.emotion(this.actor, this._filmT()));
    p.mouth = { open: this._level, wide: 0.5 };
    p.blink = VT.blinkAt(performance.now() / 1000, 2);
    p.time = performance.now() / 1000;
    a.setPose(p);
  };
  Perform.prototype._afterPose = function () {
    var st = this.stage, a = st.actors[this.actor];
    if (this.mode === 'flat' && a && this.state !== 'review') {  // the desk view: a friendly medium-full shot of the performer
      var r = a.root, h = a.height, f = r.rotation.y;
      var camDir = new T.Vector3(Math.sin(f) * 0.6, 0, Math.cos(f) * 0.6 + 0.8).normalize();
      st.cam.position.set(r.position.x, h * 0.78, r.position.z).addScaledVector(camDir, h * 1.7 + 1.4);
      var side = new T.Vector3(camDir.z, 0, -camDir.x);  // keep the performer left of centre: the teleprompter sits on the right
      st.cam.lookAt(new T.Vector3(r.position.x, h * 0.62, r.position.z).addScaledVector(side, h * 0.6)); st.cam.fov = 38; st.cam.updateProjectionMatrix();
    }
    if (this.mode !== 'flat' && this.hud) this._placeHud();
    if (this._pv) this._capturePreview();
  };

  /* ------------------------------------------------------------------ the live view for the director (vt-live.js) */
  // o = {w, h, fps, view: 'eyes' | 'film'}; returns the canvas's MediaStream
  Perform.prototype.startPreview = function (o) {
    o = o || {};
    if (this._pv) { this.setPreviewView(o.view || this._pv.view); return this._pv.stream; }
    var w = o.w || 640, h = o.h || 360, cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var c = cv.getContext('2d'); c.fillStyle = '#120a0c'; c.fillRect(0, 0, w, h);
    var rt = new T.WebGLRenderTarget(w, h); rt.texture.colorSpace = T.SRGBColorSpace;
    this._pv = { w: w, h: h, every: 1000 / (o.fps || 12), view: o.view || 'eyes', at: 0, canvas: cv, ctx: c, rt: rt,
      buf: new Uint8Array(w * h * 4), img: c.createImageData(w, h), cam: new T.PerspectiveCamera(80, w / h, 0.03, 160), frames: 0 };
    this._pv.stream = cv.captureStream(o.fps || 12);
    return this._pv.stream;
  };
  Perform.prototype.setPreviewView = function (v) { if (this._pv) this._pv.view = v === 'film' ? 'film' : 'eyes'; };
  Perform.prototype.stopPreview = function () {
    var pv = this._pv; if (!pv) return;
    this._pv = null;
    pv.stream.getTracks().forEach(function (t) { t.stop(); });
    pv.rt.dispose();
  };
  Perform.prototype.previewFrames = function () { return this._pv ? this._pv.frames : 0; };
  Perform.prototype._capturePreview = function () {
    var pv = this._pv, now = performance.now();
    if (now - pv.at < pv.every) return;
    pv.at = now;
    var st = this.stage, r = st.renderer, cam = pv.cam, k = this._calib && this.mode !== 'flat' ? this._calib.k : 1;
    if (pv.view === 'film') {  // the director's monitor: the film camera, seeing everyone (the performer's head too)
      var film = st.film.camera(this.state === 'review' ? st.time : this._filmT(), st.actors, pv.w / pv.h);
      cam.position.copy(film.pos).multiplyScalar(k); cam.up.set(0, 1, 0); cam.lookAt(film.look.clone().multiplyScalar(k));
      if (film.roll) cam.rotateZ(film.roll);
      cam.fov = film.fov; cam.layers.enable(3);
    } else if (r.xr.isPresenting) {  // through the performer's eyes (their own head stays hidden: layer 3 off)
      var xc = r.xr.getCamera(); xc.updateMatrixWorld(true);
      xc.matrixWorld.decompose(cam.position, cam.quaternion, new T.Vector3());
      cam.fov = 80; cam.layers.disable(3);
    } else {  // the desk view the performer has on screen
      cam.position.copy(st.cam.position); cam.quaternion.copy(st.cam.quaternion); cam.fov = st.cam.fov; cam.layers.disable(3);
    }
    cam.aspect = pv.w / pv.h; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    var prev = r.getRenderTarget(), xrOn = r.xr.enabled;
    r.xr.enabled = false;
    r.setRenderTarget(pv.rt); r.setClearColor(st.scene.background || new T.Color('#000'), this.mode === 'ar' ? 0 : 1); r.clear(); r.render(st.scene, cam);
    r.readRenderTargetPixels(pv.rt, 0, 0, pv.w, pv.h, pv.buf);
    r.setRenderTarget(prev); r.xr.enabled = xrOn;
    var row = pv.w * 4, d = pv.img.data;  // WebGL rows run bottom-up
    for (var y = 0; y < pv.h; y++) d.set(pv.buf.subarray((pv.h - 1 - y) * row, (pv.h - y) * row), y * row);
    for (var i = 3; i < d.length; i += 4) d[i] = 255;
    pv.ctx.putImageData(pv.img, 0, 0);
    if (this.state === 'rec') { pv.ctx.fillStyle = '#ff3b4f'; pv.ctx.beginPath(); pv.ctx.arc(pv.w - 22, 22, 9, 0, Math.PI * 2); pv.ctx.fill(); }
    pv.frames++;
  };
  Perform.prototype._placeHud = function () {
    var st = this.stage, r = st.renderer, k = this._calib ? this._calib.k : 1;
    var hud = this.hud;
    hud.scale.setScalar(1 / k);  // undo the world scale: the HUD lives in real metres
    var xc = r.xr.getCamera(); xc.updateMatrixWorld(true);
    var hp = new T.Vector3(), hq = new T.Quaternion(); xc.matrixWorld.decompose(hp, hq, new T.Vector3());
    var fwd = new T.Vector3(0, 0, -1).applyQuaternion(hq); fwd.y = 0; fwd.normalize();
    // follow the head's yaw lazily
    var yaw = Math.atan2(fwd.x, fwd.z);
    this._hudYaw = this._hudYaw == null ? yaw : this._hudYaw + VT.angDiff(this._hudYaw, yaw) * 0.04;
    var dir = new T.Vector3(Math.sin(this._hudYaw), 0, Math.cos(this._hudYaw)), side = new T.Vector3(dir.z, 0, -dir.x);
    // the hud's world scale is 1 (scene scale k x hud scale 1/k), so positions inside it are world metres
    hud.position.set(0, 0, 0);
    var toHud = function (p) { return p.clone(); };
    function place(obj, d, up, s) {
      var p = hp.clone().addScaledVector(dir, d).addScaledVector(side, s || 0); p.y += up;
      obj.position.copy(p); obj.lookAt(hp); obj.scale.setScalar(1);
    }
    place(this.promptMesh, 1.3, -0.28);
    place(this.monitor, 1.9, 0.32, 0.75);
    this.menuMesh.visible = this.state === 'ready' || this.state === 'review';
    if (this.menuMesh.visible) place(this.menuMesh, 1.2, 0.18, -0.5);
    this._drawPrompter(this.prompter.getContext('2d'), 1024, 512);
    this.promptTex.needsUpdate = true;
    if (this.menuMesh.visible) { this._drawMenu(); this.menuTex.needsUpdate = true; }
    this._lasers(toHud);
    // the director's monitor: the film camera into a texture, ~20 times a second
    var now = performance.now();
    if (!this._monAt || now - this._monAt > 50) {
      this._monAt = now;
      var prev = r.getRenderTarget(); r.xr.enabled = false;
      var film = st.film.camera(this.state === 'review' ? st.time : this._filmT(), st.actors, 16 / 9);
      st.cam.position.copy(film.pos).multiplyScalar(k); st.cam.lookAt(film.look.clone().multiplyScalar(k)); st.cam.fov = film.fov; st.cam.aspect = 16 / 9; st.cam.updateProjectionMatrix();
      this.monitor.visible = false; this.promptMesh.visible = false; var mv = this.menuMesh.visible; this.menuMesh.visible = false;
      r.setRenderTarget(this.monRT); r.clear(); r.render(st.scene, st.cam);
      r.setRenderTarget(prev); r.xr.enabled = true;
      this.monitor.visible = true; this.promptMesh.visible = true; this.menuMesh.visible = mv;
    }
  };
  Perform.prototype._lasers = function (toHud) {
    var self = this, menu = this.menuMesh;
    this._hover = null;
    (this.ctrl || []).forEach(function (info) {
      info.laser.visible = info.dot.visible = false;
      if (!info.src || !menu.visible) return;
      var p = new T.Vector3(), q = new T.Quaternion(); info.c.matrix.decompose(p, q, new T.Vector3());
      var dir = new T.Vector3(0, 0, -1).applyQuaternion(q);
      menu.updateMatrixWorld(true);
      var mq = new T.Quaternion(), mp = new T.Vector3(); menu.getWorldQuaternion(mq); menu.getWorldPosition(mp);
      var ray = new T.Ray(p.clone(), dir), plane = new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(0, 0, 1).applyQuaternion(mq), mp);
      var hit = new T.Vector3();
      var len = 3;
      if (ray.intersectPlane(plane, hit)) {
        var local = menu.worldToLocal(hit.clone());
        var u = local.x / 0.8 + 0.5, v = 0.5 - local.y / 0.5;
        if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
          len = hit.distanceTo(p);
          var px = u * 1024, py = v * 640;
          (self._menuBtns || []).forEach(function (b) { if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) self._hover = b; });
          info.dot.position.copy(hit); info.dot.visible = true;
        }
      }
      info.laser.position.copy(p); info.laser.quaternion.copy(q); info.laser.scale.set(1, 1, len); info.laser.visible = true;
    });
  };

  /* ------------------------------------------------------------------ the teleprompter + the menu (canvas) */
  Perform.prototype.view = function () {
    // what the teleprompter shows right now: {head, line, who, mine, next, sub}
    var d = this.doc.d, self = this, name = function (id) { var a = self.doc.actor(id); return a ? a.name : ''; };
    var me = name(this.actor);
    if (this.state === 'ready') {
      var first = this.range.map(function (id) { return self.doc.beat(id); }).filter(function (b) { return b && b.kind === 'line' && b.who === self.actor; })[0];
      return { head: 'YOU ARE ' + me, line: first ? first.text : 'No lines in this stretch: perform your reactions.', who: first ? 'YOUR FIRST LINE' : '', mine: true, sub: this.mode === 'flat' ? 'Press Action (Space) when ready' : 'Press A or point at Action!' };
    }
    if (this.state === 'countdown') return { head: 'QUIET ON SET', line: String(Math.max(1, Math.ceil(this._count))), big: true, sub: 'Rolling... ' + me };
    if (this.state === 'review') return { head: 'PLAYBACK', line: 'How was that?', sub: 'Keep it (A) or go again (B)', mine: true };
    var c = this._cur(), n = this._run && this._run[this._ri + 1];
    if (!c) return { head: 'ROLLING', line: '...', sub: 'Places, everyone' };
    var next = n ? (n.kind === 'action' ? 'ACTION: ' + n.text : name(n.who) + ': ' + n.text) : 'Last line';
    if (c.kind === 'action') return { head: 'ACTION BEAT', line: c.text || '(action)', who: '', next: next, mine: false, prog: (this._tau - c.start) / c.dur };
    if (c.mine) return { head: 'YOUR LINE' + (c.emo ? '  (' + c.emo + ')' : ''), who: me, line: c.text, mine: true, next: next, listening: !c.heard, prog: c.heard ? 1 : 0 };
    return { head: name(c.who) + (c.emo ? '  (' + c.emo + ')' : ''), who: name(c.who), line: c.text, mine: false, next: next, prog: (this._tau - c.start) / c.dur };
  };
  Perform.prototype._drawPrompter = function (c, W, H) {
    var v = this.view();
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(15,10,12,.88)'; roundRect(c, 4, 4, W - 8, H - 8, 28); c.fill();
    c.strokeStyle = this.state === 'rec' ? '#ff3b4f' : '#e8b54a'; c.lineWidth = 6; c.stroke();
    c.fillStyle = '#f0c060'; c.font = '600 30px "DM Sans", sans-serif'; c.textAlign = 'left'; c.fillText(v.head || '', 40, 62);
    if (this.state === 'rec') { c.fillStyle = '#ff3b4f'; c.beginPath(); c.arc(W - 70, 52, 14, 0, Math.PI * 2); c.fill(); c.font = '700 26px "DM Sans", sans-serif'; c.fillText('REC', W - 150, 62); }
    if (v.big) { c.fillStyle = '#fff8ec'; c.font = '400 220px "Bebas Neue", Impact, sans-serif'; c.textAlign = 'center'; c.fillText(v.line, W / 2, 330); }
    else wrap(c, v.line || '', 40, 140, W - 80, v.mine ? '#fff8ec' : '#b9aeb2', v.mine ? 54 : 44, 4);
    if (v.prog != null && this.state === 'rec') { c.fillStyle = 'rgba(255,255,255,.15)'; c.fillRect(40, H - 108, W - 80, 8); c.fillStyle = v.mine ? '#ff3b4f' : '#e8b54a'; c.fillRect(40, H - 108, (W - 80) * VT.clamp(v.prog, 0, 1), 8); }
    if (v.listening) { c.fillStyle = '#9be564'; c.font = '600 26px "DM Sans", sans-serif'; c.textAlign = 'left'; c.fillText('Listening... say your line', 40, H - 120); }
    c.fillStyle = '#8a7e82'; c.font = '500 26px "DM Sans", sans-serif'; c.textAlign = 'left';
    c.fillText(v.next ? 'Next: ' + clip(v.next, 60) : (v.sub || ''), 40, H - 46);
    if (this.note) { c.fillStyle = '#7ff9ff'; c.textAlign = 'right'; c.fillText('Director: ' + clip(this.note, 40), W - 40, 100); }
    // a level meter (your voice)
    c.fillStyle = 'rgba(255,255,255,.12)'; c.fillRect(W - 36, 120, 10, H - 260); c.fillStyle = '#9be564'; var lh = (H - 260) * (this._level || 0); c.fillRect(W - 36, 120 + (H - 260) - lh, 10, lh);
  };
  Perform.prototype._drawFlatPrompter = function (c, fr) {
    var w = Math.min(fr.w * 0.44, 470), h = w / 2, x = fr.x + fr.w - w - 10, y = fr.y + 10;
    if (!this._fp) { this._fp = document.createElement('canvas'); this._fp.width = 1024; this._fp.height = 512; }
    this._drawPrompter(this._fp.getContext('2d'), 1024, 512);
    c.save(); c.globalAlpha = 0.96; c.drawImage(this._fp, x, y, w, h); c.restore();
  };
  Perform.prototype._drawMenu = function () {
    var c = this.menuCanvas.getContext('2d'), W = 1024, H = 640, self = this, btns = this._menuBtns = [];
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(20,12,15,.92)'; roundRect(c, 4, 4, W - 8, H - 8, 30); c.fill(); c.strokeStyle = '#e8b54a'; c.lineWidth = 5; c.stroke();
    c.fillStyle = '#f0c060'; c.font = '400 64px "Bebas Neue", Impact, sans-serif'; c.textAlign = 'left'; c.fillText(this.doc.d.title.toUpperCase().slice(0, 28), 40, 86);
    var me = this.doc.actor(this.actor);
    function btn(label, x, y, w, h, fn, primary) {
      var hov = self._hover && self._hover.label === label;
      c.fillStyle = primary ? (hov ? '#ff5a6e' : '#b3182b') : (hov ? '#4a3a40' : '#2e2226'); roundRect(c, x, y, w, h, 18); c.fill();
      c.fillStyle = '#fff8ec'; c.font = '600 38px "DM Sans", sans-serif'; c.textAlign = 'center'; c.fillText(label, x + w / 2, y + h / 2 + 13);
      btns.push({ label: label, x: x, y: y, w: w, h: h, fn: fn });
    }
    c.fillStyle = '#b9aeb2'; c.font = '500 30px "DM Sans", sans-serif'; c.textAlign = 'left'; c.fillText('Role', 40, 170);
    btn('◀', 40, 190, 90, 90, function () { self.cycleRole(-1); });
    c.fillStyle = '#fff8ec'; c.font = '400 70px "Bebas Neue", Impact, sans-serif'; c.textAlign = 'center'; c.fillText(me ? me.name : '?', 340, 258);
    btn('▶', 550, 190, 90, 90, function () { self.cycleRole(1); });
    c.fillStyle = '#b9aeb2'; c.font = '500 28px "DM Sans", sans-serif'; c.textAlign = 'left';
    c.fillText(this.myLines() + ' lines · ' + this.range.length + ' beats in this pass', 40, 330);
    if (this.state === 'review') {
      btn('Keep it', 40, 400, 290, 110, function () { self.keep(); }, true);
      btn('Go again', 350, 400, 290, 110, function () { self.retake(); });
      btn('Next role', 660, 400, 320, 110, function () { self.discard(); self.cycleRole(1); });
    } else {
      btn('Action!', 40, 400, 420, 120, function () { self.action(); }, true);
      btn(this.others ? 'Others: on' : 'Others: off', 480, 400, 260, 120, function () { self.others = !self.others; });
      btn('Leave VR', 760, 400, 220, 120, function () { self.exitVR(); });
    }
  };
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function wrap(c, text, x, y, maxW, col, size, rows) {
    c.fillStyle = col; c.font = '600 ' + size + 'px "DM Sans", sans-serif'; c.textAlign = 'left';
    var words = String(text).split(' '), line = '', n = 0;
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (c.measureText(test).width > maxW && line) { c.fillText(line, x, y + n * size * 1.18); n++; line = words[i]; if (n >= rows) return; }
      else line = test;
    }
    if (line && n < rows) c.fillText(n === rows - 1 ? clip(line, 40) : line, x, y + n * size * 1.18);
  }

  Perform.prototype._emit = function () {
    if (!this.o.onState) return;
    var v = this.view(), me = this.doc.actor(this.actor);
    this.o.onState({ state: this.state, mode: this.mode, role: this.actor, roleName: me ? me.name : '', head: v.head, line: v.line, next: v.next || '',
      sub: v.sub || '', count: this.state === 'countdown' ? Math.max(1, Math.ceil(this._count)) : 0, time: this._tau || 0,
      beat: this._ri == null ? -1 : this._ri, beats: this.range.length, lines: this.myLines(), mic: !!this._stream, micError: this._micError || '',
      clips: this.pass ? this.pass.clips.length : 0 });
  };
  Perform.prototype.setNote = function (text) { this.note = text || ''; };
  Perform.prototype.replaceDoc = function (data) {
    if (this.state === 'rec' || this.state === 'countdown' || this.state === 'review') return false;
    this.doc.replace(typeof data === 'string' ? JSON.parse(data) : data); this.stage.refresh(); this.setRange(); return true;
  };
  Perform.prototype.destroy = function () {
    if (this.session) { try { this.session.end(); } catch (e) {} }
    if (this._rec && this._rec.state !== 'inactive') { try { this._rec.stop(); } catch (e) {} }
    if (this._stream) this._stream.getTracks().forEach(function (t) { t.stop(); });
    this.stopPreview();
    window.removeEventListener('keydown', this._onKey); window.removeEventListener('keyup', this._onKey); window.removeEventListener('pointerup', this._onUp);
    if (this.stage) this.stage.destroy();
  };
})();
