/* vt-stage.js: VT.Stage, the 3D stage that plays a production (three.js r158).

   new VT.Stage(el, {mode, doc, takes, autoplay, loop, muted, interactive, onTime, onSelect, onPlace, onState})
     mode 'film'      the player: film camera, letterbox, grade, titles + subtitles, audio
     mode 'edit'      the director's editor: film or director (free orbit) view, click/drag actors on the floor
     mode 'hero'      the landing page: plays muted in a loop
     mode 'turntable' one character on a podium (casting): {char: def, emo}
   stage.play() pause() seek(t) toggle(); stage.time, stage.playing, stage.total
   stage.view = 'film' | 'director'; stage.select(actorId); stage.refresh() after the doc changed; stage.destroy()
   stage.renderAt(t, w, h, target2d) draws one finished frame (grade, letterbox, titles, subtitles) into a 2D canvas (exports).
   XR (vt-xr.js) plugs in through stage.hooks and stage.live[actorId] (a live pose instead of the film's). */
(function () {
  'use strict';
  var VT = window.VT = window.VT || {};
  var T = window.THREE;
  if (!T) return;
  var D2R = Math.PI / 180;

  var GRADE_VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  var GRADE_FS = [
    'uniform sampler2D tDiffuse; uniform float sat, con, expo, vig, grain, bw, time, fade; uniform vec3 tint; varying vec2 vUv;',
    'float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time * 7.0) * 43758.5453); }',
    'void main() {',
    '  vec4 c = texture2D(tDiffuse, vUv); vec3 col = c.rgb * expo * tint;',
    '  float l = dot(col, vec3(0.299, 0.587, 0.114));',
    '  col = mix(vec3(l), col, sat); col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), bw);',
    '  col = (col - 0.5) * con + 0.5;',
    '  vec2 d = vUv - 0.5; col *= 1.0 - vig * smoothstep(0.25, 0.75, length(d * vec2(1.15, 1.0)));',
    '  col += (rnd(vUv * 731.0) - 0.5) * grain;',
    '  gl_FragColor = vec4(clamp(col, 0.0, 1.0) * fade, 1.0);',
    '}'].join('\n');

  function Stage(el, o) {
    o = o || {};
    this.el = el; this.o = o; this.mode = o.mode || 'film';
    this.view = o.view || (this.mode === 'edit' ? 'film' : 'film');
    this.time = 0; this.playing = false; this.selected = null; this.hooks = {}; this.live = {};
    this.muted = !!o.muted; this.loop = !!o.loop;
    this._sources = []; this._dirty = true; this._last = performance.now();
    var self = this;
    el.classList.add('vt-stage');
    this.canvas = document.createElement('canvas'); this.canvas.className = 'vt-gl';
    this.over = document.createElement('canvas'); this.over.className = 'vt-over';
    el.appendChild(this.canvas); el.appendChild(this.over);
    try {
      this.renderer = new T.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    } catch (e) {
      el.classList.add('vt-nogl');
      var msg = document.createElement('div'); msg.className = 'vt-nogl-msg'; msg.textContent = 'This browser can\'t show 3D (WebGL is off).';
      el.appendChild(msg); this.dead = true; return;
    }
    var r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, o.maxDpr || 2));
    r.outputColorSpace = T.SRGBColorSpace;
    r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
    r.autoClear = false;
    this.scene = new T.Scene();
    this.cam = new T.PerspectiveCamera(38, 16 / 9, 0.05, 120);
    this.cam.layers.enable(3);  // the film camera sees everyone, even a first-person performer's head
    this.dcam = new T.PerspectiveCamera(45, 16 / 9, 0.05, 160);
    this.dcam.layers.enable(3);
    this.orbit = { theta: -0.35, phi: 1.05, r: 11, target: new T.Vector3(0, 0.8, 0) };
    this.actorsGroup = new T.Group(); this.actorsGroup.name = 'actors'; this.scene.add(this.actorsGroup);
    this.helpers = new T.Group(); this.helpers.name = 'helpers'; this.scene.add(this.helpers);
    this.actors = {};
    // grade pass
    this.rt = new T.WebGLRenderTarget(16, 16, { samples: 4 });
    this.rt.texture.colorSpace = T.SRGBColorSpace;
    this.post = new T.ShaderMaterial({ vertexShader: GRADE_VS, fragmentShader: GRADE_FS, depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: this.rt.texture }, sat: { value: 1 }, con: { value: 1 }, expo: { value: 1 }, vig: { value: 0 }, grain: { value: 0 }, bw: { value: 0 }, time: { value: 0 }, fade: { value: 1 }, tint: { value: new T.Vector3(1, 1, 1) } } });
    this.postScene = new T.Scene(); this.postCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postScene.add(new T.Mesh(new T.PlaneGeometry(2, 2), this.post));
    if (this.mode === 'turntable') this._turntable(o);
    else this.setDoc(o.doc, o.takes);
    // input
    if (o.interactive !== false && (this.mode === 'edit' || this.mode === 'turntable')) this._input();
    this._ro = window.ResizeObserver ? new ResizeObserver(function () { self.resize(); }) : null;
    if (this._ro) this._ro.observe(el); else window.addEventListener('resize', this._onResize = function () { self.resize(); });
    this.resize();
    r.setAnimationLoop(function () { self._frame(); });
    if (o.autoplay) this.play();
  }
  VT.Stage = Stage;

  /* ------------------------------------------------------------------ scene setup */
  Stage.prototype.setDoc = function (doc, takes) {
    if (this.dead) return;
    this.doc = doc || this.doc || VT.newDoc('Untitled');
    this.takes = takes || this.takes || new VT.Takes();
    this.film = new VT.Film(this.doc, this.takes);
    this._buildSet();
    this._syncActors(true);
    this._dirty = true;
  };
  Stage.prototype._buildSet = function () {
    var id = this.doc.d.set;
    if (this.set && this.setId === id) return;
    if (this.set) this.set.dispose();
    this.set = VT.buildSet(id, this.scene, { shadows: true, transparent: this.o.transparent });
    this.setId = id;
    this._helpers();
  };
  Stage.prototype._syncActors = function (force) {
    var d = this.doc.d, self = this, keep = {};
    d.cast.forEach(function (c) {
      var def = VT.charDef(c.char, d.custom), sig = JSON.stringify(def);
      var a = self.actors[c.id];
      if (!a || a._sig !== sig) {
        if (a) a.dispose();
        a = VT.buildActor(def); a._sig = sig; a.root.userData.aid = c.id;
        self.actors[c.id] = a; self.actorsGroup.add(a.root);
      }
      keep[c.id] = true;
    });
    Object.keys(this.actors).forEach(function (k) { if (!keep[k]) { self.actors[k].dispose(); delete self.actors[k]; } });
  };
  Stage.prototype.refresh = function (what) {
    if (this.dead) return;
    if (this.doc.d.set !== this.setId) this._buildSet();
    this._syncActors();
    this.film.refresh();
    this._helpers();
    this.time = Math.min(this.time, this.film.total);
    this._dirty = true;
    if (this.playing && what !== 'sel-only') this._restartAudio();
  };
  Object.defineProperty(Stage.prototype, 'total', { get: function () { return this.film ? this.film.total : 0; } });

  /* director helpers: marks, walk paths, the selection ring, the film camera */
  Stage.prototype._helpers = function () {
    var h = this.helpers, self = this;
    while (h.children.length) h.remove(h.children[0]);
    if (this.mode !== 'edit' || !this.film) return;
    var set = VT.SET_BY[this.doc.d.set] || VT.SETS[0];
    var mm = new T.MeshBasicMaterial({ color: '#e8b54a', transparent: true, opacity: 0.55, depthWrite: false });
    set.marks.forEach(function (m) {
      var x1 = new T.Mesh(new T.PlaneGeometry(0.32, 0.05), mm), x2 = x1.clone();
      x1.rotation.set(-Math.PI / 2, 0, 0.785); x2.rotation.set(-Math.PI / 2, 0, -0.785);
      x1.position.set(m[0], 0.012, m[1]); x2.position.set(m[0], 0.012, m[1]);
      h.add(x1); h.add(x2);
    });
    var cols = ['#ff5a6e', '#ffd166', '#7ff9ff', '#9be564', '#ff9f1a', '#c792ea', '#f4efe6'];
    this.doc.d.cast.forEach(function (c, i) {
      var P = self.film.paths[c.id]; if (!P) return;
      var pts = [new T.Vector3(P.x0, 0.03, P.z0)];
      P.segs.forEach(function (s) { pts.push(new T.Vector3(s.x1, 0.03, s.z1)); });
      if (pts.length > 1) {
        var g = new T.BufferGeometry().setFromPoints(pts);
        var line = new T.Line(g, new T.LineDashedMaterial({ color: cols[i % cols.length], dashSize: 0.12, gapSize: 0.08 }));
        line.computeLineDistances(); h.add(line);
        P.segs.forEach(function (s) { var dot = new T.Mesh(new T.CircleGeometry(0.09, 20), new T.MeshBasicMaterial({ color: cols[i % cols.length] })); dot.rotation.x = -Math.PI / 2; dot.position.set(s.x1, 0.025, s.z1); h.add(dot); });
      }
    });
    this.ring = new T.Mesh(new T.RingGeometry(0.42, 0.5, 40), new T.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.9, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.visible = false; h.add(this.ring);
    this.ghost = new T.Mesh(new T.RingGeometry(0.3, 0.42, 40), new T.MeshBasicMaterial({ color: '#ff5a6e', transparent: true, opacity: 0.85, depthWrite: false }));
    this.ghost.rotation.x = -Math.PI / 2; this.ghost.visible = false; h.add(this.ghost);
    // the film camera as a little camera body
    var cg = this.camGizmo = new T.Group();
    var body = new T.Mesh(new T.BoxGeometry(0.22, 0.16, 0.3), new T.MeshBasicMaterial({ color: '#151214' }));
    var lens = new T.Mesh(new T.CylinderGeometry(0.06, 0.08, 0.14, 16), new T.MeshBasicMaterial({ color: '#e8b54a' })); lens.rotation.x = Math.PI / 2; lens.position.z = -0.2;
    var reel1 = new T.Mesh(new T.CylinderGeometry(0.08, 0.08, 0.04, 16), new T.MeshBasicMaterial({ color: '#b3182b' })); reel1.rotation.z = Math.PI / 2; reel1.position.set(0, 0.14, 0.05);
    cg.add(body); cg.add(lens); cg.add(reel1);
    var fr = new T.LineSegments(new T.EdgesGeometry(new T.ConeGeometry(0.5, 1, 4, 1, true)), new T.LineBasicMaterial({ color: '#e8b54a' }));
    fr.rotation.x = -Math.PI / 2; fr.rotation.y = Math.PI / 4; fr.position.z = -0.7; cg.add(fr);
    h.add(cg);
  };

  /* ------------------------------------------------------------------ the frame */
  Stage.prototype._clock = function () {
    var now = performance.now(), dt = Math.min(0.1, (now - this._last) / 1000); this._last = now;
    if (this.playing) {
      if (this._audioT0 != null && this._ctx && this._ctx.state === 'running') this.time = this._filmT0 + (this._ctx.currentTime - this._audioT0);
      else this.time += dt;
      if (this.time >= this.total) {
        if (this.loop) { this.seek(0); this.play(); }
        else { this.time = this.total; this.pause(); if (this.o.onEnd) this.o.onEnd(); }
      }
    }
    return dt;
  };
  Stage.prototype._frame = function () {
    if (this.dead || !this.film) return;
    var dt = this._clock();
    if (this.o.onTime && (this.playing || this._dirty)) this.o.onTime(this.time);
    if (this.hooks.beforeFrame) this.hooks.beforeFrame(this.time, dt);
    var visible = !document.hidden && this.el.offsetParent !== null || this.renderer.xr.isPresenting;
    if (!visible) return;
    var need = this.playing || this._dirty || this.hooks.always || this.mode === 'turntable' || this.mode === 'hero' || this._dragging ||
      (this.mode === 'edit' && this.view === 'director') || this.renderer.xr.isPresenting;
    if (!need) return;
    // before the first play, the player shows a still from the first scene (not the black of the fade-in)
    var t = this.mode === 'film' && !this._started && !this.playing && this.time === 0 && this.film.L.beats.length ? this.film.L.beats[0].start + 0.9 : this.time;
    this._drawT = t;
    this.pose(t);
    this.set.update(this.playing || this.mode === 'hero' ? t : performance.now() / 1000);
    this.draw();
    this._dirty = false;
  };
  // put every actor and the film camera where they are at time t
  Stage.prototype.pose = function (t) {
    var self = this, d = this.doc.d;
    var camPos = this.cam.position;
    d.cast.forEach(function (c) {
      var a = self.actors[c.id]; if (!a) return;
      if (self.live[c.id]) { self.live[c.id](a, t); return; }
      var st = self.film.actorAt(a, c.id, t, { actors: self.actors, cam: camPos });
      a.root.position.set(st.x, 0, st.z); a.root.rotation.set(0, st.rot, 0);
      a.setPose(st.pose);
    });
    var cm = this.film.camera(t, this.actors, this._frameAspect());
    this.cam.position.copy(cm.pos); this.cam.up.set(0, 1, 0); this.cam.lookAt(cm.look);
    if (cm.roll) this.cam.rotateZ(cm.roll);
    this.cam.fov = cm.fov; this.cam.updateProjectionMatrix();
    this.camShot = cm;
    if (this.mode === 'edit' && this.camGizmo) {
      this.camGizmo.position.copy(this.cam.position); this.camGizmo.quaternion.copy(this.cam.quaternion);
      this.camGizmo.visible = this.view === 'director';
      if (this.selected && this.actors[this.selected]) { var p = this.actors[this.selected].root.position; this.ring.position.set(p.x, 0.02, p.z); this.ring.visible = true; } else if (this.ring) this.ring.visible = false;
    }
    if (this.hooks.afterPose) this.hooks.afterPose(t);
  };
  Stage.prototype._frameAspect = function () { var a = VT.ASPECT_BY[this.doc.d.look.aspect] || VT.ASPECTS[0]; return a.r; };
  // the letterboxed film frame inside a w x h canvas
  Stage.prototype._frameRect = function (w, h) {
    if (this.mode === 'hero') return { x: 0, y: 0, w: w, h: h };  // the hero fills its screen (no letterbox)
    var ar = this._frameAspect(), fw = w, fh = Math.round(w / ar);
    if (fh > h) { fh = h; fw = Math.round(h * ar); }
    return { x: Math.round((w - fw) / 2), y: Math.round((h - fh) / 2), w: fw, h: fh };
  };
  Stage.prototype.draw = function () {
    var r = this.renderer, size = r.getSize(new T.Vector2()), w = size.x, h = size.y;
    this.helpers.visible = this.mode === 'edit' && this.view === 'director';
    if (r.xr.isPresenting) { r.clear(); r.render(this.scene, this.hooks.xrCamera || this.cam); return; }
    r.setScissorTest(false); r.setClearColor(0x000000, 1); r.setRenderTarget(null); r.clear();
    if (this.mode === 'edit' && this.view === 'director') {
      this._orbitCam(w / h);
      r.setViewport(0, 0, w, h); r.render(this.scene, this.dcam);
      this.over.getContext('2d').clearRect(0, 0, this.over.width, this.over.height);
      return;
    }
    var fr = this._frameRect(w, h);
    this.cam.aspect = fr.w / fr.h; this.cam.updateProjectionMatrix();
    this._renderGraded(fr.w, fr.h, fr.x, h - fr.y - fr.h, null);
    this._overlay(this.over, fr, this._drawT != null ? this._drawT : this.time);
  };
  Stage.prototype._applyGrade = function (t) {
    var g = VT.GRADE_BY[this.doc.d.look.grade] || VT.GRADES[0], u = this.post.uniforms;
    u.sat.value = g.sat; u.con.value = g.con; u.expo.value = g.exp; u.vig.value = g.vig; u.grain.value = g.grain; u.bw.value = g.bw || 0; u.time.value = t % 100;
    u.tint.value.set(g.tint[0], g.tint[1], g.tint[2]);
    // fade in from black at the very start and out at the end (titles)
    var total = this.total, fade = 1;
    if (this.doc.d.look.fades !== false && this.o.fades !== false && this.mode !== 'edit') fade = Math.min(1, t / 0.6 + 0.0001, (total - t) / 0.8 + 0.0001);
    u.fade.value = Math.max(0, fade);
  };
  Stage.prototype._renderGraded = function (fw, fh, vx, vy, target) {
    var r = this.renderer, dpr = r.getPixelRatio();
    var pw = Math.max(16, Math.round(fw * dpr)), ph = Math.max(16, Math.round(fh * dpr));
    if (this.rt.width !== pw || this.rt.height !== ph) this.rt.setSize(pw, ph);
    if (this.o.shift && fw > 700) this.cam.setViewOffset(fw, fh, -fw * this.o.shift, 0, fw, fh);  // push the picture right (hero copy sits left)
    else if (this.cam.view) this.cam.clearViewOffset();
    r.setRenderTarget(this.rt); r.setClearColor(this.scene.background || new T.Color('#000'), 1); r.clear(); r.render(this.scene, this.cam);
    r.setRenderTarget(target || null);
    this._applyGrade(this._drawT != null ? this._drawT : this.time);
    r.setViewport(vx, vy, fw, fh); r.setScissor(vx, vy, fw, fh); r.setScissorTest(true);
    r.render(this.postScene, this.postCam);
    r.setScissorTest(false);
  };
  /* titles, subtitles and the "REC" tally, drawn on a 2D canvas over the film frame */
  Stage.prototype._overlay = function (cv, fr, t, ctx2) {
    var dpr = window.devicePixelRatio || 1, own = !ctx2;
    var c = ctx2 || cv.getContext('2d');
    if (own) {
      var W = Math.round(this.el.clientWidth * dpr), H = Math.round(this.el.clientHeight * dpr);
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    }
    VT.drawTitles(c, fr, t, this.doc, this.film, { subs: this.o.subs != null ? this.o.subs : this.doc.d.look.subs, mode: this.mode, titles: this.o.titles });
    if (this.hooks.overlay) this.hooks.overlay(c, fr, t);
  };
  VT.drawTitles = function (c, fr, t, doc, film, o) {
    o = o || {};
    var d = doc.d, total = film.total, s = fr.h / 360;
    function txt(str, x, y, size, font, color, alpha, spacing) {
      c.save(); c.globalAlpha = alpha; c.fillStyle = color; c.font = font.replace('#', Math.round(size * s) + 'px'); c.textAlign = 'center'; c.textBaseline = 'middle';
      if (spacing) { try { c.letterSpacing = Math.round(spacing * s) + 'px'; } catch (e) {} }
      c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 8 * s; c.fillText(str, x, y); c.restore();
    }
    if (d.look.titles !== false && o.titles !== false && o.mode !== 'edit') {
      var a = Math.min(1, t / 0.5) * Math.min(1, (2.8 - t) / 0.6);
      if (a > 0) {
        txt('VRTOTOON PICTURES PRESENTS', fr.x + fr.w / 2, fr.y + fr.h * 0.36, 11, '600 # "DM Sans", sans-serif', '#f0c060', a, 4);
        txt(d.title || 'Untitled', fr.x + fr.w / 2, fr.y + fr.h * 0.5, d.title && d.title.length > 22 ? 30 : 40, '400 # "Bebas Neue", Impact, sans-serif', '#fff8ec', a, 2);
      }
      var e = Math.min(1, (t - (total - 1.6)) / 0.5);
      if (e > 0) txt('THE END', fr.x + fr.w / 2, fr.y + fr.h * 0.5, 34, 'italic 400 # "Playfair Display", Georgia, serif', '#fff8ec', e * Math.min(1, (total - t) / 0.3 + 0.2));
    }
    if (o.subs) {
      var b = film.L.beatAt(t);
      if (b && b.kind === 'line' && b.text && t < b.end + 0.15) {
        var who = doc.actor(b.who), line = (who ? who.name + ': ' : '') + b.text;
        c.save(); c.font = '600 ' + Math.round(13 * s) + 'px "DM Sans", sans-serif'; c.textAlign = 'center';
        var words = line.split(' '), rows = [], cur = '', maxW = fr.w * 0.82;
        words.forEach(function (w) { var test = cur ? cur + ' ' + w : w; if (c.measureText(test).width > maxW && cur) { rows.push(cur); cur = w; } else cur = test; });
        if (cur) rows.push(cur);
        rows = rows.slice(-2);
        rows.forEach(function (row, i) {
          var y = fr.y + fr.h - (rows.length - i) * 18 * s - 8 * s, tw = c.measureText(row).width;
          c.fillStyle = 'rgba(10,6,8,.62)'; c.fillRect(fr.x + fr.w / 2 - tw / 2 - 8 * s, y - 11 * s, tw + 16 * s, 18 * s);
          c.fillStyle = '#fff8ec'; c.textBaseline = 'middle'; c.fillText(row, fr.x + fr.w / 2, y - 2 * s);
        });
        c.restore();
      }
    }
  };
  /* one finished frame of the film at time t, w x h, drawn into a 2D canvas context (exports + posters) */
  Stage.prototype.renderAt = function (t, w, h, ctx2, opts) {
    opts = opts || {};
    var r = this.renderer, prevSize = r.getSize(new T.Vector2()), prevDpr = r.getPixelRatio(), prevT = this.time;
    this.time = t; var prevD = this._drawT; this._drawT = t;
    this.pose(t); this.set.update(t);
    r.setPixelRatio(1); r.setSize(w, h, false);
    this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
    r.setScissorTest(false); r.setRenderTarget(null); r.setClearColor(0x000000, 1); r.clear();
    var savedMode = this.mode; if (opts.final) this.mode = 'film';
    this._renderGraded(w, h, 0, 0, null);
    ctx2.drawImage(this.canvas, 0, 0, w, h);
    if (opts.titles !== false) VT.drawTitles(ctx2, { x: 0, y: 0, w: w, h: h }, t, this.doc, this.film, { subs: opts.subs, mode: this.mode });
    this.mode = savedMode;
    r.setPixelRatio(prevDpr); r.setSize(prevSize.x, prevSize.y, false);
    this.time = prevT; this._drawT = prevD; this._dirty = true;
  };
  Stage.prototype.snapshot = function (w, h, t) {
    var c = document.createElement('canvas'); c.width = w || 640; c.height = h || 360;
    this.renderAt(t == null ? this.time : t, c.width, c.height, c.getContext('2d'), { titles: false, final: true });
    return c.toDataURL('image/jpeg', 0.82);
  };
  Stage.prototype.resize = function () {
    if (this.dead) return;
    var w = Math.max(10, this.el.clientWidth), h = Math.max(10, this.el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = this.over.style.width = w + 'px';
    this.canvas.style.height = this.over.style.height = h + 'px';
    this.dcam.aspect = w / h; this.dcam.updateProjectionMatrix();
    this._dirty = true;
  };

  /* ------------------------------------------------------------------ playback + audio */
  Stage.prototype.play = function () {
    if (this.dead || this.playing) return;
    if (this.time >= this.total - 0.05) this.time = 0;
    this.playing = true; this._started = true; this._last = performance.now();
    this._restartAudio();
    if (this.o.onState) this.o.onState('play');
  };
  Stage.prototype.pause = function () {
    if (!this.playing) return;
    this.playing = false; this._stopAudio(); this._dirty = true;
    if (this.o.onState) this.o.onState('pause');
  };
  Stage.prototype.toggle = function () { if (this.playing) this.pause(); else this.play(); };
  Stage.prototype.seek = function (t) {
    this.time = VT.clamp(t, 0, this.total); this._dirty = true; this._started = true;
    if (this.playing) this._restartAudio();
    if (this.o.onTime) this.o.onTime(this.time);
  };
  Stage.prototype._stopAudio = function () { this._sources.forEach(function (s) { try { s.stop(); } catch (e) {} try { s.disconnect(); } catch (e) {} }); this._sources = []; (this._chains || []).forEach(function (c) { c.stop(); }); this._chains = []; this._audioT0 = null; };
  Stage.prototype._restartAudio = function () {
    this._stopAudio();
    if (this.muted) return;
    var ctx = this._ctx = VT.audioCtx(), self = this;
    var now = ctx.currentTime + 0.05, t0 = this.time;
    this._audioT0 = now; this._filmT0 = t0;
    var master = this._master || (this._master = ctx.createGain()); master.gain.value = 1;
    if (!this._masterOn) { master.connect(ctx.destination); this._masterOn = true; }
    VT.scheduleAudio(ctx, master, this.doc, this.film, t0, now, this._sources, this._chains = [], function () { return self.playing; });
  };
  /* schedule everything audible from film time t0 at context time `when`: voices (with each actor's voice FX), effects, music */
  VT.scheduleAudio = function (ctx, out, doc, film, t0, when, sources, chains, alive) {
    var d = doc.d, jobs = [];
    var fxFor = {};
    d.cast.forEach(function (c) { var ch = VT.voiceChain(ctx, c.fx || 'none'); var g = ctx.createGain(); g.gain.value = c.vol == null ? 1 : c.vol; ch.output.connect(g); g.connect(out); fxFor[c.id] = ch; chains.push(ch); });
    film.L.beats.forEach(function (b) {
      if (b.kind !== 'line' || !b.who || b.end < t0) return;
      var src = film.source(b.who, b);
      if (!src) return;
      jobs.push(film.takes.load(src.uid).then(function (tk) {
        if (!tk || !tk.buffer || (alive && !alive())) return;
        var startFilm = Math.max(t0, b.start), offset = src.clip.off + (startFilm - b.start), dur = b.end + 0.12 - startFilm;
        if (dur <= 0.02) return;
        var s = ctx.createBufferSource(); s.buffer = tk.buffer;
        s.connect(fxFor[b.who] ? fxFor[b.who].input : out);
        var at = when + (startFilm - t0);
        s.start(Math.max(ctx.currentTime, at), Math.max(0, offset + (tk.lag || 0)), dur);
        sources.push(s);
      }));
    });
    film.sfx.forEach(function (x) {
      if (x.t < t0 - 0.05) return;
      jobs.push(VT.sfxBuffer(x.sfx).then(function (buf) {
        if (!buf || (alive && !alive())) return;
        var s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = buf; g.gain.value = x.vol == null ? 0.8 : x.vol;
        s.connect(g); g.connect(out); s.start(Math.max(ctx.currentTime, when + (x.t - t0))); sources.push(s);
      }));
    });
    if (d.music && d.music.id && d.music.id !== 'none') {
      jobs.push(VT.musicBuffer(d.music.id).then(function (buf) {
        if (!buf || (alive && !alive())) return;
        var s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = buf; s.loop = true;
        g.gain.value = d.music.vol == null ? 0.3 : d.music.vol;
        var end = film.total;
        g.gain.setValueAtTime(g.gain.value, when + Math.max(0, end - 1.5 - t0)); g.gain.linearRampToValueAtTime(0.0001, when + Math.max(0.01, end - t0));
        s.connect(g); g.connect(out); s.start(when, t0 % buf.duration); s.stop(when + Math.max(0.05, end - t0) + 0.05); sources.push(s);
      }));
    }
    return Promise.all(jobs);
  };

  /* ------------------------------------------------------------------ editor input: select + drag actors, orbit the director cam */
  Stage.prototype._orbitCam = function (aspect) {
    var o = this.orbit, c = this.dcam;
    c.aspect = aspect; c.updateProjectionMatrix();
    c.position.set(o.target.x + o.r * Math.sin(o.phi) * Math.sin(o.theta), o.target.y + o.r * Math.cos(o.phi), o.target.z + o.r * Math.sin(o.phi) * Math.cos(o.theta));
    c.lookAt(o.target);
  };
  Stage.prototype._activeCam = function () {
    if (this.view === 'director') return this.dcam;
    return this.cam;
  };
  Stage.prototype._ndc = function (ev) {
    var rc = this.canvas.getBoundingClientRect(), x = ev.clientX - rc.left, y = ev.clientY - rc.top;
    if (this.view !== 'director') {
      var fr = this._frameRect(rc.width, rc.height);
      return new T.Vector2(((x - fr.x) / fr.w) * 2 - 1, -((y - fr.y) / fr.h) * 2 + 1);
    }
    return new T.Vector2((x / rc.width) * 2 - 1, -(y / rc.height) * 2 + 1);
  };
  Stage.prototype.pick = function (ev) {
    var ray = new T.Raycaster(); ray.setFromCamera(this._ndc(ev), this._activeCam());
    ray.layers.enableAll();
    var hits = ray.intersectObjects(this.actorsGroup.children, true);
    for (var i = 0; i < hits.length; i++) { var o = hits[i].object; while (o && !o.userData.aid) o = o.parent; if (o) return o.userData.aid; }
    return null;
  };
  Stage.prototype.floorPoint = function (ev) {
    var ray = new T.Raycaster(); ray.setFromCamera(this._ndc(ev), this._activeCam());
    var p = new T.Vector3();
    return ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), p) ? p : null;
  };
  Stage.prototype.select = function (aid) { this.selected = aid || null; this._dirty = true; };
  Stage.prototype._input = function () {
    var self = this, cv = this.over, drag = null;
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', function (ev) {
      if (self.mode === 'turntable') { drag = { kind: 'spin', x: ev.clientX, rot: self.spin || 0 }; cv.setPointerCapture(ev.pointerId); return; }
      var aid = self.pick(ev);
      if (aid) {
        self.select(aid); if (self.o.onSelect) self.o.onSelect(aid);
        drag = { kind: 'actor', aid: aid, x: ev.clientX, y: ev.clientY, moved: false };
        self._dragging = true;
      } else if (self.view === 'director') {
        drag = { kind: ev.button === 2 || ev.shiftKey ? 'pan' : 'orbit', x: ev.clientX, y: ev.clientY, theta: self.orbit.theta, phi: self.orbit.phi, target: self.orbit.target.clone() };
      } else {
        self.select(null); if (self.o.onSelect) self.o.onSelect(null);
      }
      cv.setPointerCapture(ev.pointerId);
    });
    cv.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (drag.kind === 'spin') { self.spin = drag.rot + dx * 0.01; return; }
      if (drag.kind === 'actor') {
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        var p = drag.moved && self.floorPoint(ev);
        if (p && self.ghost) { p.x = VT.clamp(p.x, -6, 6); p.z = VT.clamp(p.z, -4, 4); self.ghost.position.set(p.x, 0.03, p.z); self.ghost.visible = true; drag.p = p; self.helpers.visible = true; self._dirty = true; }
      } else if (drag.kind === 'orbit') {
        self.orbit.theta = drag.theta - dx * 0.008; self.orbit.phi = VT.clamp(drag.phi - dy * 0.006, 0.15, 1.5);
      } else if (drag.kind === 'pan') {
        var right = new T.Vector3().setFromMatrixColumn(self.dcam.matrixWorld, 0), fwd = new T.Vector3(-Math.sin(self.orbit.theta), 0, -Math.cos(self.orbit.theta));
        self.orbit.target.copy(drag.target).addScaledVector(right, -dx * 0.012).addScaledVector(fwd, dy * 0.012);
      }
    });
    function up(ev) {
      if (!drag) return;
      if (drag.kind === 'actor' && drag.moved && drag.p && self.o.onPlace) self.o.onPlace(drag.aid, Math.round(drag.p.x * 100) / 100, Math.round(drag.p.z * 100) / 100);
      if (self.ghost) self.ghost.visible = false;
      drag = null; self._dragging = false; self._dirty = true;
    }
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('contextmenu', function (ev) { if (self.view === 'director') ev.preventDefault(); });
    cv.addEventListener('wheel', function (ev) {
      if (self.view !== 'director') return;
      ev.preventDefault(); self.orbit.r = VT.clamp(self.orbit.r * (1 + ev.deltaY * 0.001), 2, 30);
    }, { passive: false });
  };

  /* ------------------------------------------------------------------ the casting turntable */
  Stage.prototype._turntable = function (o) {
    var self = this;
    this.doc = new VT.Doc({ set: 'soundstage', cast: [] });
    this.takes = new VT.Takes();
    this.film = new VT.Film(this.doc, this.takes);
    var hemi = new T.HemisphereLight('#fff1dc', '#40303a', 1.3); this.scene.add(hemi);
    var key = new T.DirectionalLight('#fff3dd', 2.3); key.position.set(2, 5, 4); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); this.scene.add(key);
    var rim = new T.DirectionalLight('#ffb36b', 1.5); rim.position.set(-3, 3, -4); this.scene.add(rim);
    this.scene.background = new T.Color(o.bg || '#1d1417');
    var pod = VT.mesh(VT.CYL(1, 48), '#b3182b', { recv: true }); pod.scale.set(0.75, 0.12, 0.75); pod.position.y = -0.06; pod.receiveShadow = true; this.scene.add(pod);
    var rim2 = VT.mesh(VT.CYL(1, 48), '#e8b54a', { outline: false }); rim2.scale.set(0.78, 0.04, 0.78); rim2.position.y = -0.1; this.scene.add(rim2);
    var floor = new T.Mesh(new T.CircleGeometry(6, 48), VT.mat('#2a1d22')); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.12; floor.receiveShadow = true; this.scene.add(floor);
    this.set = { update: function () {}, dispose: function () {} };
    this.spin = 0.3;
    this.setChar(o.char, o.emo);
    this.hooks.always = true;
    this.pose = function (t) {
      var a = self.tt; if (!a) return;
      var now = performance.now() / 1000;
      var gest = self.ttGesture ? { id: self.ttGesture, u: ((now - self.ttG0) / (VT.GEST[self.ttGesture] || { len: 1.5 }).len) } : null;
      if (gest && gest.u >= 1) { self.ttGesture = null; gest = null; }
      var p = VT.proceduralPose(a, { t: now, seed: 2, gesture: gest, speaking: self.ttTalk, talk: self.ttTalk ? 0.6 : 0 });
      p.face = VT.faceOf(self.ttEmo || 'happy'); p.blink = VT.blinkAt(now, 3); p.time = now;
      p.mouth = self.ttTalk ? { open: 0.25 + 0.35 * Math.abs(Math.sin(now * 9)), wide: 0.5 } : null;
      p.gaze = [0, a.headRest.y, 3];
      a.setPose(p);
      if (!self._userSpun) self.spin += 0.0;
      a.root.rotation.y = self.spin + Math.sin(now * 0.5) * 0.25;
      var h = a.height;
      self.cam.position.set(0, h * 0.62, h * 1.9 + 1.0); self.cam.lookAt(0, h * 0.5, 0); self.cam.fov = 32; self.cam.updateProjectionMatrix();
    };
    this.draw = function () {
      var r = self.renderer, size = r.getSize(new T.Vector2());
      r.setRenderTarget(null); r.setClearColor(0x000000, 1); r.clear();
      self.cam.aspect = size.x / size.y; self.cam.updateProjectionMatrix();
      r.setViewport(0, 0, size.x, size.y); r.render(self.scene, self.cam);
    };
  };
  Stage.prototype.setChar = function (def, emo) {
    if (this.tt) { this.scene.remove(this.tt.root); }
    this.tt = VT.buildActor(def || VT.CAST[0]);
    this.scene.add(this.tt.root);
    if (emo) this.ttEmo = emo;
  };
  Stage.prototype.setEmotion = function (emo) { this.ttEmo = emo; };
  Stage.prototype.gesture = function (id) { this.ttGesture = id; this.ttG0 = performance.now() / 1000; };
  Stage.prototype.talk = function (on) { this.ttTalk = !!on; };

  Stage.prototype.destroy = function () {
    if (this.dead) { this.el.innerHTML = ''; return; }
    this._stopAudio();
    this.renderer.setAnimationLoop(null);
    if (this._ro) this._ro.disconnect(); else window.removeEventListener('resize', this._onResize);
    if (this.hooks.destroy) this.hooks.destroy();
    this.rt.dispose();
    this.renderer.dispose();
    try { this.renderer.forceContextLoss(); } catch (e) {}
    this.el.innerHTML = ''; this.el.classList.remove('vt-stage');
    this.dead = true;
  };
})();
