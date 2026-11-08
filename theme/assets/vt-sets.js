/* vt-sets.js: the sets (stages), lights, film looks (grades), sound effects and music cues of VRtoToon.

   VT.SETS[i] = {id, name, blurb, sky, build(api) -> {update(t)}, light: {...}, marks: [[x, z, faceDeg]], wide: {pos, look}}
   Everything is drawn in code from simple shapes (no downloads), so it renders in a headset, in the editor and in exports.
   Stage space: floor y = 0, the acting area is about x -3..3, z -2..2, the audience/camera side is +Z.
   VT.GRADES: the film looks applied by the stage's post pass (saturation, contrast, tint, vignette, grain, black & white).
   VT.SFX / VT.MUSIC: synthesised with OfflineAudioContext (no licensed audio anywhere, so exports are free to publish).
   Ids never change: productions reference them. */
(function () {
  'use strict';
  var VT = window.VT = window.VT || {};
  var T = window.THREE;
  if (!T) return;
  var D2R = Math.PI / 180;

  /* ------------------------------------------------------------------ building helpers */
  function Api(root) { this.root = root; this.anim = []; }
  Api.prototype.add = function (o, parent) { (parent || this.root).add(o); return o; };
  Api.prototype.box = function (w, h, d, col, x, y, z, o) {
    o = o || {};
    var m = VT.mesh(VT.roundedBox(w, h, d, o.r != null ? o.r : Math.min(0.04, w / 4, h / 4, d / 4)), col, { outline: o.outline !== false, recv: true, emissive: o.emissive, ei: o.ei, ow: o.ow || 0.0022 });
    m.position.set(x || 0, (y || 0) + (o.base ? h / 2 : 0), z || 0);
    if (o.ry) m.rotation.y = o.ry * D2R;
    if (o.rz) m.rotation.z = o.rz * D2R;
    if (o.rx) m.rotation.x = o.rx * D2R;
    return this.add(m, o.parent);
  };
  Api.prototype.cyl = function (rt, rb, h, col, x, y, z, o) {
    o = o || {};
    var m = VT.mesh(VT.CYL(rt / Math.max(rb, 1e-4), o.seg || 24), col, { outline: o.outline !== false, recv: true, emissive: o.emissive, ei: o.ei, ow: o.ow || 0.0022, opacity: o.opacity });
    m.scale.set(rb, h, rb);
    m.position.set(x || 0, (y || 0) + (o.base !== false ? h / 2 : 0), z || 0);
    if (o.rx) m.rotation.x = o.rx * D2R;
    if (o.rz) m.rotation.z = o.rz * D2R;
    return this.add(m, o.parent);
  };
  Api.prototype.sph = function (r, col, x, y, z, o) {
    o = o || {};
    var m = VT.mesh(VT.SPH(), col, { outline: o.outline !== false, recv: true, emissive: o.emissive, ei: o.ei, ow: o.ow || 0.0022, opacity: o.opacity, basic: o.basic });
    m.scale.set(r * (o.sx || 1), r * (o.sy || 1), r * (o.sz || 1));
    m.position.set(x || 0, y || 0, z || 0);
    return this.add(m, o.parent);
  };
  Api.prototype.cone = function (r, h, col, x, y, z, o) {
    o = o || {};
    var m = VT.mesh(VT.CONE(), col, { outline: o.outline !== false, recv: true, emissive: o.emissive, opacity: o.opacity, basic: o.basic });
    m.scale.set(r, h, r);
    m.position.set(x || 0, (y || 0) + h / 2, z || 0);
    if (o.rx) m.rotation.x = o.rx * D2R;
    if (o.rz) m.rotation.z = o.rz * D2R;
    return this.add(m, o.parent);
  };
  Api.prototype.floor = function (col, size, o) {
    o = o || {};
    var mat = o.tex ? new T.MeshToonMaterial({ color: '#ffffff', map: o.tex, gradientMap: VT.mat('#fff').gradientMap }) : VT.mat(col);
    var m = new T.Mesh(new T.PlaneGeometry(size || 30, size || 30), mat);
    m.rotation.x = -Math.PI / 2; m.receiveShadow = true; m.name = 'floor'; m.userData.floor = true;
    return this.add(m);
  };
  Api.prototype.canvasTex = function (w, h, draw) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    var t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
    return t;
  };
  // a painted backdrop: a curved cyclorama around the back of the set (unlit)
  Api.prototype.backdrop = function (draw, o) {
    o = o || {};
    var tex = this.canvasTex(2048, 768, draw);
    var r = o.r || 14, h = o.h || 9;
    var g = new T.CylinderGeometry(r, r, h, 48, 1, true, Math.PI * 0.5 + (o.open || 0.6), Math.PI * 2 - 2 * (o.open || 0.6));
    var m = new T.Mesh(g, new T.MeshBasicMaterial({ map: tex, side: T.BackSide, fog: false }));
    m.position.set(0, h / 2 - (o.sink || 0.3), o.z || 0); m.rotation.y = Math.PI;
    m.userData.backdrop = true;
    return this.add(m);
  };
  Api.prototype.sign = function (text, w, h, col, bg, x, y, z, o) {
    o = o || {};
    var tex = this.canvasTex(512, Math.round(512 * h / w), function (c, W, H) {
      if (bg) { c.fillStyle = bg; c.fillRect(0, 0, W, H); }
      c.fillStyle = col; c.font = (o.font || '900') + ' ' + Math.round(H * 0.62) + 'px ' + (o.family || '"Bebas Neue", Impact, sans-serif');
      c.textAlign = 'center'; c.textBaseline = 'middle';
      if (o.glow) { c.shadowColor = col; c.shadowBlur = 24; }
      c.fillText(text, W / 2, H / 2 + H * 0.04);
    });
    var m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex, transparent: !bg, toneMapped: false }));
    m.position.set(x, y, z);
    if (o.ry) m.rotation.y = o.ry * D2R;
    return this.add(m, o.parent);
  };
  Api.prototype.bulbs = function (x0, x1, y0, y1, z, n, col) {
    var list = [];
    for (var i = 0; i < n; i++) {
      var u = n > 1 ? i / (n - 1) : 0;
      list.push(this.sph(0.05, col || '#fff1b8', x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, z, { emissive: col || '#ffe28a', ei: 1.2, outline: false }));
    }
    this.anim.push(function (t) { list.forEach(function (b, i) { var on = (Math.floor(t * 6) + i) % 3 !== 0; b.material = VT.mat(on ? '#fff6cf' : '#8a6a3a', { emissive: on ? '#ffd76a' : null, ei: 1.3 }); }); });
    return list;
  };
  Api.prototype.lightCone = function (x, y, z, len, r, col, aim) {
    var g = new T.ConeGeometry(r, len, 24, 1, true);
    g.translate(0, -len / 2, 0);
    var m = new T.Mesh(g, new T.MeshBasicMaterial({ color: col || '#fff2c8', transparent: true, opacity: 0.11, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false }));
    m.position.set(x, y, z);
    if (aim) m.rotation.set(aim[0] * D2R, 0, aim[1] * D2R);
    m.userData.fx = true;
    return this.add(m);
  };
  Api.prototype.particles = function (n, spread, col, size, update) {
    var pos = new Float32Array(n * 3), seeds = [];
    for (var i = 0; i < n; i++) { seeds.push([Math.random(), Math.random(), Math.random()]); }
    var g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
    var m = new T.Points(g, new T.PointsMaterial({ color: col, size: size || 0.05, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
    m.frustumCulled = false; m.userData.fx = true;
    this.add(m);
    this.anim.push(function (t) {
      for (var i = 0; i < n; i++) { var p = update(seeds[i], t, i); pos[i * 3] = p[0] * spread[0]; pos[i * 3 + 1] = p[1] * spread[1]; pos[i * 3 + 2] = p[2] * spread[2]; }
      g.attributes.position.needsUpdate = true;
    });
    return m;
  };
  function grad(c, H, stops) { var g = c.createLinearGradient(0, 0, 0, H); stops.forEach(function (s) { g.addColorStop(s[0], s[1]); }); return g; }
  function rnd(seed) { var s = seed; return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
  VT._setsHelpers = { grad: grad, rnd: rnd };

  /* ------------------------------------------------------------------ the sets */
  VT.SETS = [
    { id: 'soundstage', name: 'Stage 7', blurb: 'A classic sound stage with a painted sunset backdrop, lights and the director\'s chair.',
      light: { hemi: ['#fff1dc', '#40303a', 1.1], key: ['#fff3dd', 2.2, [3, 6, 5]], rim: ['#ffb36b', 1.3, [-4, 4, -5]], fog: ['#2a1d22', 14, 40], bg: '#20161a' },
      marks: [[-1.2, 0.2, 20], [1.2, 0.2, -20], [0, -0.6, 0], [-2.4, -0.4, 30], [2.4, -0.4, -30]],
      build: function (a) {
        a.floor('#5a4448', 40);
        a.box(9, 0.04, 5.5, '#8a6a5a', 0, 0, -0.2, { base: true, r: 0.01 });  // stage boards
        for (var i = -4; i <= 4; i++) a.box(0.02, 0.045, 5.4, '#6d5346', i, 0.0, -0.2, { base: true, outline: false, r: 0.005 });
        a.backdrop(function (c, W, H) {
          c.fillStyle = grad(c, H, [[0, '#2b2350'], [0.35, '#d0507a'], [0.62, '#ffb35c'], [0.78, '#ffe0a0'], [0.8, '#3b2a4a'], [1, '#2a1d2a']]); c.fillRect(0, 0, W, H);
          c.fillStyle = '#fff2b8'; c.beginPath(); c.arc(W * 0.5, H * 0.66, 90, 0, Math.PI * 2); c.fill();
          c.fillStyle = 'rgba(255,240,220,.55)';
          for (var k = 0; k < 7; k++) { var x = (k * 311) % W, y = 120 + (k * 53) % 160; c.beginPath(); c.ellipse(x, y, 140, 28, 0, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(x + 60, y - 16, 90, 24, 0, 0, Math.PI * 2); c.fill(); }
          c.fillStyle = '#3b2a4a'; c.beginPath(); c.moveTo(0, H * 0.8);
          for (var x2 = 0; x2 <= W; x2 += 64) c.lineTo(x2, H * 0.8 - 40 - Math.abs(Math.sin(x2 * 0.004)) * 120);
          c.lineTo(W, H); c.lineTo(0, H); c.fill();
        }, { r: 9, h: 7, open: 0.9 });
        // light stands
        [[-4.2, 1.8], [4.2, 1.8], [-3.6, -2.8], [3.6, -2.8]].forEach(function (p, i) {
          a.cyl(0.03, 0.03, 2.4, '#2b2b2f', p[0], 0, p[1]);
          [-1, 0, 1].forEach(function (k) { var leg = a.cyl(0.02, 0.02, 0.6, '#2b2b2f', p[0] + k * 0.18, 0, p[1] + (k ? 0 : 0.2), { rz: k * 30 }); leg.position.y = 0.2; });
          var head = a.cyl(0.22, 0.18, 0.32, '#151214', p[0], 2.4, p[1], { rx: 90 });
          head.lookAt(0, 1, 0); head.rotateX(Math.PI / 2);
          a.lightCone(p[0], 2.5, p[1], 3.2, 1.1, '#fff2c8').lookAt(0, 0, 0);
        });
        // director's chair + clapperboard + sandbags + crates
        var ch = new T.Group(); ch.position.set(3.4, 0, 2.3); ch.rotation.y = -40 * D2R; a.add(ch);
        a.box(0.5, 0.04, 0.45, '#2b1d18', 0, 0.55, 0, { parent: ch });
        a.box(0.5, 0.32, 0.03, '#151214', 0, 0.95, -0.2, { parent: ch });
        a.sign('DIRECTOR', 0.44, 0.12, '#e8b54a', null, 0, 0.95, -0.18, { parent: ch });
        [[-0.23, -0.2], [0.23, -0.2], [-0.23, 0.2], [0.23, 0.2]].forEach(function (q) { a.cyl(0.02, 0.02, 0.85, '#5a3a24', q[0], 0, q[1], { parent: ch }); });
        a.box(0.7, 0.5, 0.5, '#7a5a3a', -3.8, 0, 2.1, { base: true }); a.box(0.5, 0.35, 0.5, '#8a6a46', -3.75, 0.5, 2.1, { base: true, ry: 12 });
        a.sign('STAGE 7', 1.6, 0.5, '#e8b54a', '#151214', -3.0, 3.6, -5.6);
        a.box(0.35, 0.12, 0.2, '#2a2a2a', -3.4, 0, 2.6, { base: true }); a.box(0.3, 0.1, 0.18, '#3a3a3a', 3.9, 0, 1.4, { base: true });
        return {};
      } },
    { id: 'diner', name: 'Moonbeam Diner', blurb: 'Checkered floor, chrome stools, a jukebox and a neon sign that hums all night.',
      light: { hemi: ['#ffe9f0', '#3a2a3a', 1.15], key: ['#fff6ea', 2.0, [2, 6, 4]], rim: ['#ff5fa2', 1.4, [-4, 3, -4]], fog: ['#1a1424', 16, 40], bg: '#140f1c' },
      marks: [[-1, 0.4, 25], [1, 0.4, -25], [0, -0.4, 0], [-2.3, 0.8, 40], [2.3, 0.8, -40]],
      build: function (a) {
        var tex = a.canvasTex(512, 512, function (c, W) { var n = 16, s = W / n; for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) { c.fillStyle = (i + j) % 2 ? '#f4efe6' : '#1d1a22'; c.fillRect(i * s, j * s, s, s); } });
        tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(6, 6);
        a.floor('#fff', 24, { tex: tex });
        a.box(14, 4.2, 0.3, '#2f9e9a', 0, 0, -3.6, { base: true, r: 0.02 });
        a.box(14, 0.5, 0.32, '#e6e0d4', 0, 1.2, -3.55, { base: true, r: 0.02 });
        a.box(14, 0.12, 0.34, '#c9ccd2', 0, 1.7, -3.55, { base: true, r: 0.03 });
        // counter + stools
        a.box(5.2, 1.0, 0.7, '#e44a5a', 0, 0, -2.4, { base: true }); a.box(5.4, 0.08, 0.86, '#c9ccd2', 0, 1.0, -2.4, { base: true });
        for (var i = -2; i <= 2; i++) { a.cyl(0.04, 0.06, 0.62, '#c9ccd2', i * 1.0, 0, -1.6); a.cyl(0.24, 0.24, 0.12, '#e44a5a', i * 1.0, 0.62, -1.6); }
        // booth
        a.box(1.4, 0.5, 0.6, '#e44a5a', -4.2, 0, 0.6, { base: true }); a.box(1.4, 1.0, 0.2, '#e44a5a', -4.2, 0, 0.25, { base: true });
        a.box(1.2, 0.06, 0.8, '#f4efe6', -4.2, 0.76, 1.15, { base: true }); a.cyl(0.05, 0.05, 0.76, '#c9ccd2', -4.2, 0, 1.15);
        // jukebox
        var jb = a.box(0.8, 1.5, 0.55, '#7b3fa0', 4.3, 0, -1.8, { base: true, r: 0.2 }); jb.rotation.y = -30 * D2R;
        a.sph(0.38, '#ffcf5a', 4.3, 1.35, -1.6, { sy: 0.6, sz: 0.4, emissive: '#ffb020', ei: 0.8 });
        // neon sign + window with night
        a.sign('EAT', 1.6, 0.7, '#ff5fa2', null, 2.6, 3.0, -3.42, { glow: true });
        a.sign('MOONBEAM', 2.8, 0.5, '#7ff9ff', null, -2.2, 3.05, -3.42, { glow: true });
        a.backdrop(function (c, W, H) { c.fillStyle = grad(c, H, [[0, '#0b0820'], [1, '#2a1a4a']]); c.fillRect(0, 0, W, H); for (var k = 0; k < 120; k++) { c.fillStyle = 'rgba(255,255,255,' + (0.3 + (k % 5) / 8) + ')'; c.fillRect((k * 397) % W, (k * 211) % (H * 0.6), 2, 2); } }, { r: 16, h: 10 });
        var pts = []; for (var p = -1; p <= 1; p++) pts.push(a.sph(0.18, '#fff3c4', p * 2.2, 3.5, -1.2, { emissive: '#ffe08a', ei: 1.2, outline: false }));
        a.anim.push(function (t) { var on = Math.sin(t * 31) > -0.95; });
        return {};
      } },
    { id: 'western', name: 'Dusty Gulch', blurb: 'A saloon, a water tower, cactus and a sky the colour of a peach.',
      light: { hemi: ['#ffe6c4', '#7a4a2a', 1.25], key: ['#fff0d0', 2.4, [-5, 7, 4]], rim: ['#ff9b5a', 1.2, [5, 3, -6]], fog: ['#f0b98a', 18, 60], bg: '#f2b68a' },
      marks: [[-1.6, 0.4, 70], [1.6, 0.4, -70], [0, -0.6, 0], [-3, 1, 50], [3, 1, -50]],
      build: function (a) {
        a.floor('#d9a46a', 60);
        a.backdrop(function (c, W, H) {
          c.fillStyle = grad(c, H, [[0, '#7fb3e0'], [0.45, '#ffcf9a'], [0.66, '#ff9a6a'], [0.67, '#b0603a'], [1, '#c98a5a']]); c.fillRect(0, 0, W, H);
          c.fillStyle = '#a24e30';
          [[0.08, 0.36, 0.18], [0.36, 0.42, 0.12], [0.62, 0.32, 0.2], [0.86, 0.4, 0.14]].forEach(function (m) { c.fillRect(W * m[0], H * m[1] + 20, W * m[2], H * 0.67 - H * m[1]); c.fillRect(W * m[0] - 20, H * 0.6, W * m[2] + 40, H * 0.1); });
          c.fillStyle = '#fff1c0'; c.beginPath(); c.arc(W * 0.78, H * 0.2, 60, 0, Math.PI * 2); c.fill();
        }, { r: 22, h: 12 });
        // saloon
        var s = new T.Group(); s.position.set(-0.5, 0, -4.2); a.add(s);
        a.box(6, 3.2, 0.3, '#9a6a3e', 0, 0, 0, { base: true, parent: s });
        a.box(6.4, 1.4, 0.3, '#8a5a32', 0, 3.2, 0, { base: true, parent: s });
        a.sign('SALOON', 3.2, 0.8, '#3a2414', '#e9cfa0', 0, 3.85, 0.17, { parent: s });
        a.box(6.4, 0.12, 1.4, '#6b4424', 0, 2.5, 0.75, { base: true, parent: s });
        [-3, -1, 1, 3].forEach(function (x) { a.cyl(0.08, 0.08, 2.5, '#6b4424', x, 0, 1.4, { parent: s }); });
        a.box(0.7, 0.9, 0.06, '#c58b3a', -0.38, 0.7, 0.2, { base: true, parent: s, ry: 15 }); a.box(0.7, 0.9, 0.06, '#c58b3a', 0.38, 0.7, 0.2, { base: true, parent: s, ry: -15 });
        a.box(1.2, 0.9, 0.05, '#4a2c17', -2.2, 1.0, 0.17, { base: true, parent: s }); a.box(1.2, 0.9, 0.05, '#4a2c17', 2.2, 1.0, 0.17, { base: true, parent: s });
        // water tower
        var wx = 5, wz = -3;
        [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]].forEach(function (q) { a.cyl(0.07, 0.07, 3.2, '#6b4424', wx + q[0], 0, wz + q[1]); });
        a.cyl(1.0, 1.0, 1.4, '#9a6a3e', wx, 3.2, wz); a.cone(1.15, 0.7, '#7a4a2a', wx, 4.6, wz);
        // cacti, barrels, tumbleweed
        function cactus(x, z, h) { a.cyl(0.18, 0.2, h, '#4f9a4a', x, 0, z); a.sph(0.18, '#4f9a4a', x, h, z); var arm = a.cyl(0.11, 0.11, 0.5, '#4f9a4a', x + 0.3, h * 0.55, z); arm.position.y = h * 0.6; a.cyl(0.11, 0.11, 0.25, '#4f9a4a', x + 0.18, h * 0.5, z, { rz: 90 }).position.y = h * 0.5; }
        cactus(-5, -1.5, 1.8); cactus(4.2, 1.4, 1.3); cactus(-6.5, 2.5, 2.2);
        a.cyl(0.32, 0.3, 0.8, '#7a4a2a', -3.6, 0, 0.8); a.cyl(0.32, 0.3, 0.8, '#7a4a2a', -3.0, 0, 1.2);
        var tw = a.sph(0.35, '#b88a4a', 0, 0.35, 0, { opacity: 0.9, outline: true });
        a.anim.push(function (t) { var u = (t * 0.18) % 1; tw.position.set(-8 + u * 16, 0.35 + Math.abs(Math.sin(t * 4)) * 0.3, 2.6); tw.rotation.z = -t * 4; });
        a.particles(60, [10, 1.2, 5], '#e8c38a', 0.04, function (s, t) { return [((s[0] + t * 0.05 * (0.5 + s[1])) % 1) * 2 - 1, s[1] * 0.6, s[2] * 2 - 1]; });
        return {};
      } },
    { id: 'noir', name: 'Rain Street', blurb: 'A brick alley at midnight: one lamp, wet stones, and something in the fog.',
      light: { hemi: ['#b8c8e8', '#3a3a4a', 1.35], key: ['#fff2cf', 3.0, [-1.5, 6, 3]], rim: ['#9fbcff', 1.8, [4, 3, -5]], fog: ['#1e2433', 13, 40], bg: '#121622',
        points: [[-2.2, 3.2, -0.6, '#ffd890', 6, 7]] },
      marks: [[-1.1, 0.2, 30], [1.1, 0.4, -30], [0, -0.8, 0], [-2.2, 1, 20], [2.4, 1, -20]],
      build: function (a) {
        a.floor('#3a4050', 40);
        var bt = a.canvasTex(512, 512, function (c, W, H) { c.fillStyle = '#8a5a50'; c.fillRect(0, 0, W, H); for (var y = 0; y < 16; y++) for (var x = 0; x < 8; x++) { c.fillStyle = ['#b06a5a', '#a05e50', '#bb7564'][(x * 7 + y * 3) % 3]; c.fillRect(x * 64 + (y % 2) * 32 + 2, y * 32 + 2, 60, 28); } });
        bt.wrapS = bt.wrapT = T.RepeatWrapping; bt.repeat.set(3, 2);
        var wallMat = new T.MeshToonMaterial({ map: bt, gradientMap: VT.mat('#fff').gradientMap });
        [[-4.5, 0, 90], [4.5, 0, -90], [0, -3.4, 0]].forEach(function (w) {
          var m = new T.Mesh(new T.PlaneGeometry(9, 7), wallMat); m.position.set(w[0], 3.5, w[1]); m.rotation.y = w[2] * D2R; m.receiveShadow = true; a.add(m);
        });
        // lamp post
        a.cyl(0.06, 0.09, 3.4, '#1c1c22', -2.2, 0, -0.6); a.box(0.6, 0.06, 0.06, '#1c1c22', -2.0, 3.35, -0.6, { base: true });
        a.cyl(0.14, 0.2, 0.3, '#1c1c22', -1.75, 3.05, -0.6); a.sph(0.12, '#fff3c4', -1.75, 3.05, -0.6, { emissive: '#ffd890', ei: 1.5, outline: false });
        a.lightCone(-1.75, 3.0, -0.6, 3.0, 1.2, '#ffd890');
        // fire escape, bins, crates, door
        a.box(2.2, 0.06, 0.8, '#1c1c22', 3.2, 2.6, -2.95, { base: true }); a.box(2.2, 0.5, 0.04, '#1c1c22', 3.2, 2.66, -2.56, { base: true, outline: true });
        a.cyl(0.32, 0.28, 0.75, '#4a5560', 3.4, 0, -2.2); a.cyl(0.34, 0.34, 0.06, '#5a6570', 3.4, 0.75, -2.2);
        a.box(0.7, 0.6, 0.6, '#5a4632', -3.6, 0, -2.4, { base: true, ry: 10 });
        a.box(1.1, 2.2, 0.1, '#2a1f1a', 0.6, 0, -3.35, { base: true }); a.sph(0.04, '#e8b54a', 0.95, 1.1, -3.28, { outline: false });
        a.sign('NO PARKING', 1.2, 0.3, '#f4efe6', '#7a1a1a', -2.4, 2.0, -3.37);
        // rain + puddle glints
        a.particles(500, [9, 7, 6], '#a8c4ff', 0.035, function (s, t) { return [s[0] * 2 - 1, 1 - ((s[1] + t * (1.4 + s[2])) % 1), s[2] * 2 - 1]; });
        return {};
      } },
    { id: 'space', name: 'Starship Comet', blurb: 'The bridge of a starship: blinking consoles and a planet out of the window.',
      light: { hemi: ['#dfeaff', '#3a3a5a', 1.3], key: ['#eef4ff', 2.3, [2, 6, 4]], rim: ['#7f5bff', 1.6, [-4, 3, -5]], fog: ['#0c0f24', 16, 40], bg: '#070818',
        points: [[0, 2.6, -2.5, '#7ff9ff', 2.5, 6]] },
      marks: [[-1.2, 0.3, 20], [1.2, 0.3, -20], [0, -0.7, 0], [-2.5, 0.6, 30], [2.5, 0.6, -30]],
      build: function (a) {
        var ft = a.canvasTex(512, 512, function (c, W) { c.fillStyle = '#3a4258'; c.fillRect(0, 0, W, W); c.strokeStyle = '#262c3d'; c.lineWidth = 6; for (var i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * 128, 0); c.lineTo(i * 128, W); c.moveTo(0, i * 128); c.lineTo(W, i * 128); c.stroke(); } });
        ft.wrapS = ft.wrapT = T.RepeatWrapping; ft.repeat.set(8, 8);
        a.floor('#fff', 30, { tex: ft });
        a.backdrop(function (c, W, H) {
          c.fillStyle = '#05061a'; c.fillRect(0, 0, W, H);
          for (var k = 0; k < 400; k++) { c.fillStyle = 'rgba(255,255,255,' + (0.3 + (k % 7) / 10) + ')'; var s = k % 13 === 0 ? 3 : 1.5; c.fillRect((k * 733) % W, (k * 389) % H, s, s); }
          var g = c.createRadialGradient(W * 0.6, H * 0.55, 20, W * 0.6, H * 0.55, 210); g.addColorStop(0, '#ffb36b'); g.addColorStop(0.6, '#d0507a'); g.addColorStop(1, '#3a1a5a');
          c.fillStyle = g; c.beginPath(); c.arc(W * 0.6, H * 0.55, 200, 0, Math.PI * 2); c.fill();
          c.strokeStyle = 'rgba(255,220,180,.6)'; c.lineWidth = 8; c.beginPath(); c.ellipse(W * 0.6, H * 0.55, 330, 60, -0.25, 0, Math.PI * 2); c.stroke();
        }, { r: 15, h: 10 });
        // window frame (back wall with a big opening)
        a.box(14, 0.8, 0.3, '#c9d2e3', 0, 0, -3.6, { base: true }); a.box(14, 1.2, 0.3, '#c9d2e3', 0, 4.0, -3.6, { base: true });
        [-6.5, -2.2, 2.2, 6.5].forEach(function (x) { a.box(0.5, 3.4, 0.4, '#aab4c8', x, 0.7, -3.6, { base: true }); });
        // consoles
        var cons = [];
        [[-2.6, -1.4, 25], [2.6, -1.4, -25], [0, -2.4, 0]].forEach(function (p) {
          var g = new T.Group(); g.position.set(p[0], 0, p[1]); g.rotation.y = p[2] * D2R; a.add(g);
          a.box(1.6, 0.9, 0.6, '#5a6582', 0, 0, 0, { base: true, parent: g }); a.box(1.6, 0.08, 0.7, '#2b3550', 0, 0.95, 0.05, { base: true, parent: g, rx: -18 });
          for (var i = 0; i < 6; i++) cons.push(a.sph(0.05, ['#ff4f6d', '#7ff9ff', '#ffd166'][i % 3], -0.55 + i * 0.22, 1.02, 0.12, { parent: g, outline: false, emissive: ['#ff4f6d', '#7ff9ff', '#ffd166'][i % 3], ei: 1 }));
        });
        a.anim.push(function (t) { cons.forEach(function (b, i) { b.visible = Math.sin(t * (2 + i % 4) + i) > -0.6; }); });
        // captain's chair
        a.cyl(0.08, 0.2, 0.45, '#2b3550', 4.2, 0, 0.6); a.box(0.7, 0.12, 0.6, '#ff7a1a', 4.2, 0.45, 0.6, { base: true }); a.box(0.7, 0.8, 0.12, '#ff7a1a', 4.2, 0.5, 0.3, { base: true });
        return {};
      } },
    { id: 'forest', name: 'Whisper Woods', blurb: 'Moonlit trees, giant mushrooms and fireflies that never stop dancing.',
      light: { hemi: ['#dcefff', '#2f4a3a', 1.25], key: ['#e2eeff', 2.1, [-3, 7, 3]], rim: ['#9be564', 1.1, [4, 3, -5]], fog: ['#16283a', 10, 34], bg: '#0f1d2c' },
      marks: [[-1.2, 0.3, 30], [1.2, 0.3, -30], [0, -0.6, 0], [-2.6, 1, 40], [2.6, 1, -40]],
      build: function (a) {
        a.floor('#2f5a3a', 50);
        a.backdrop(function (c, W, H) {
          c.fillStyle = grad(c, H, [[0, '#0a1430'], [0.7, '#24406a'], [1, '#1a3a2a']]); c.fillRect(0, 0, W, H);
          c.fillStyle = '#f4f1d8'; c.beginPath(); c.arc(W * 0.3, H * 0.22, 70, 0, Math.PI * 2); c.fill();
          c.fillStyle = '#16303a'; for (var k = 0; k < 40; k++) { var x = (k * 211) % W, h = 160 + (k * 97) % 200; c.beginPath(); c.moveTo(x - 60, H * 0.82); c.lineTo(x, H * 0.82 - h); c.lineTo(x + 60, H * 0.82); c.fill(); }
          c.fillStyle = '#1a3a2a'; c.fillRect(0, H * 0.82, W, H);
        }, { r: 18, h: 10 });
        var R = rnd(7);
        function tree(x, z, s) { a.cyl(0.18 * s, 0.24 * s, 1.6 * s, '#5a3a24', x, 0, z); a.sph(0.9 * s, '#2f7a4a', x, 2.0 * s, z, { sy: 1.1 }); a.sph(0.65 * s, '#3a8a54', x + 0.4 * s, 2.5 * s, z + 0.2 * s); a.sph(0.6 * s, '#276a40', x - 0.45 * s, 2.3 * s, z - 0.1 * s); }
        [[-4.5, -2.5, 1.3], [4.6, -2.2, 1.4], [-6, 1, 1.1], [6, 1.5, 1.2], [-2.5, -4, 1.6], [2.4, -4.2, 1.5], [0, -5.5, 1.8], [-7.5, -3, 1.7], [7.5, -3.5, 1.6]].forEach(function (t) { tree(t[0], t[1], t[2]); });
        function shroom(x, z, s, col) { a.cyl(0.12 * s, 0.16 * s, 0.6 * s, '#f4efe6', x, 0, z); var cap = a.sph(0.45 * s, col, x, 0.62 * s, z, { sy: 0.55 }); for (var i = 0; i < 4; i++) a.sph(0.07 * s, '#ffffff', x + Math.cos(i * 1.7) * 0.25 * s, 0.82 * s, z + Math.sin(i * 1.7) * 0.25 * s, { outline: false }); return cap; }
        shroom(-3, 1.2, 1.2, '#d7263d'); shroom(3.2, 0.8, 0.9, '#ff7a1a'); shroom(-1.8, -2.4, 1.6, '#9b5de5');
        for (var i = 0; i < 18; i++) a.cone(0.06, 0.25 + R() * 0.2, '#4f9a4a', (R() - 0.5) * 10, 0, (R() - 0.5) * 6, { outline: false });
        a.particles(40, [7, 2.2, 4], '#d9ff7a', 0.08, function (s, t) { return [Math.sin(t * 0.3 * (0.5 + s[0]) + s[1] * 9) * (s[2] * 2 - 1), 0.25 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.7 + s[0] * 7)), Math.cos(t * 0.27 + s[2] * 8) * (s[0] * 2 - 1)]; });
        return {};
      } },
    { id: 'living', name: 'Sitcom Living Room', blurb: 'The comfy couch, the lamp, the door everyone walks through. Cue the laugh track.',
      light: { hemi: ['#fff4e6', '#5a4a40', 1.3], key: ['#fff1da', 2.0, [2, 6, 5]], rim: ['#ffd29a', 1.0, [-4, 4, -5]], fog: ['#3a2c26', 18, 40], bg: '#2a201c',
        points: [[-3.2, 1.8, -1.6, '#ffd08a', 2, 5]] },
      marks: [[-1, 0.6, 15], [1, 0.6, -15], [0, -0.3, 0], [-2.6, 0.9, 30], [2.6, 0.9, -30]],
      build: function (a) {
        var ft = a.canvasTex(512, 512, function (c, W) { for (var i = 0; i < 8; i++) { c.fillStyle = ['#a8764a', '#9a6a40', '#b0804f'][i % 3]; c.fillRect(0, i * 64, W, 62); } });
        ft.wrapS = ft.wrapT = T.RepeatWrapping; ft.repeat.set(4, 4);
        a.floor('#fff', 24, { tex: ft });
        var wt = a.canvasTex(256, 256, function (c, W) { c.fillStyle = '#e9d8b4'; c.fillRect(0, 0, W, W); c.fillStyle = '#dcc79c'; for (var i = 0; i < 8; i++) c.fillRect(i * 32, 0, 12, W); });
        wt.wrapS = wt.wrapT = T.RepeatWrapping; wt.repeat.set(6, 2);
        var wm = new T.MeshToonMaterial({ map: wt, gradientMap: VT.mat('#fff').gradientMap });
        [[0, -3.4, 0, 12], [-5.5, 0, 90, 8], [5.5, 0, -90, 8]].forEach(function (w) { var m = new T.Mesh(new T.PlaneGeometry(w[3], 4.5), wm); m.position.set(w[0], 2.25, w[1]); m.rotation.y = w[2] * D2R; m.receiveShadow = true; a.add(m); });
        // couch, rug, lamp, tv, door, window, picture
        a.cyl(1.6, 1.6, 0.02, '#c0504d', 0, 0, 0.3, { seg: 40 }).scale.set(2.6, 0.02, 1.4);
        var cg = new T.Group(); cg.position.set(0, 0, -2.4); a.add(cg);
        a.box(2.8, 0.45, 0.9, '#3f7a8c', 0, 0, 0, { base: true, parent: cg }); a.box(2.8, 0.7, 0.3, '#3f7a8c', 0, 0.45, -0.32, { base: true, parent: cg });
        a.box(0.3, 0.65, 0.9, '#356a7a', -1.45, 0, 0, { base: true, parent: cg }); a.box(0.3, 0.65, 0.9, '#356a7a', 1.45, 0, 0, { base: true, parent: cg });
        [-0.65, 0.65].forEach(function (x) { a.box(1.25, 0.18, 0.75, '#4a8a9c', x, 0.45, 0.05, { base: true, parent: cg }); });
        a.sph(0.18, '#ffd166', -0.9, 0.85, -0.15, { sy: 0.8, parent: cg }); a.sph(0.18, '#e76f51', 0.95, 0.85, -0.15, { sy: 0.8, parent: cg });
        a.cyl(0.03, 0.12, 1.6, '#3a2a20', -3.2, 0, -1.6); a.cyl(0.22, 0.35, 0.4, '#f6e2b0', -3.2, 1.55, -1.6, { emissive: '#ffcf7a', ei: 0.4 });
        a.box(1.2, 0.6, 0.45, '#6b4a2b', 3.4, 0, -2.0, { base: true, ry: -25 }); var tv = a.box(1.0, 0.65, 0.35, '#222', 3.4, 0.6, -2.0, { base: true, ry: -25 });
        a.box(1.1, 2.3, 0.08, '#8a5a32', -5.45, 0, 1.2, { base: true, ry: 90 });
        a.box(1.6, 1.2, 0.08, '#cfe8ff', 1.8, 1.4, -3.37, { base: true, emissive: '#9fc8ff', ei: 0.3 }); a.box(1.7, 0.08, 0.12, '#ffffff', 1.8, 1.4, -3.33, { base: true });
        a.box(0.9, 0.7, 0.05, '#e8b54a', -1.6, 1.7, -3.37, { base: true });
        a.cyl(0.25, 0.25, 0.45, '#f4efe6', 2.6, 0, 1.6); a.sph(0.3, '#4f9a4a', 2.6, 0.75, 1.6);
        return {};
      } },
    { id: 'premiere', name: 'Red Carpet', blurb: 'The premiere: velvet ropes, flashing cameras, searchlights and your name in lights.',
      light: { hemi: ['#ffe6ea', '#2a1820', 1.0], key: ['#fff3e0', 2.3, [3, 7, 5]], rim: ['#ffcf6a', 1.6, [-4, 4, -4]], fog: ['#1a0f14', 14, 40], bg: '#120a0e' },
      marks: [[-0.9, 0.6, 10], [0.9, 0.6, -10], [0, -0.6, 0], [-2.2, 1.4, 25], [2.2, 1.4, -25]],
      build: function (a) {
        a.floor('#1d1418', 40);
        a.box(2.6, 0.03, 12, '#b3182b', 0, 0, -1.5, { base: true, r: 0.01, outline: false });
        [-1.6, 1.6].forEach(function (x) {
          for (var z = -5; z <= 3; z += 2) { a.cyl(0.05, 0.08, 0.95, '#e8b54a', x, 0, z); a.sph(0.08, '#e8b54a', x, 0.98, z); }
          var rope = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3([-5, -4, -3, -2, -1, 0, 1, 2, 3].map(function (z) { return new T.Vector3(x, 0.85 - (Math.abs((z + 5) % 2 - 1) < 0.01 ? 0 : 0.12), z); })), 64, 0.03, 8), VT.mat('#7a0f1f'));
          a.add(rope);
        });
        // marquee wall
        a.box(9, 4.6, 0.3, '#151012', 0, 0, -4.6, { base: true });
        a.box(6.4, 1.3, 0.2, '#e8b54a', 0, 3.0, -4.38, { base: true, r: 0.08 });
        a.sign('WORLD PREMIERE', 6.0, 1.0, '#151012', '#f6e7b8', 0, 3.65, -4.26);
        a.bulbs(-3.1, 3.1, 4.38, 4.38, -4.25, 22); a.bulbs(-3.1, 3.1, 2.92, 2.92, -4.25, 22);
        // photographers' flashes + searchlights
        var flashes = [];
        for (var i = 0; i < 8; i++) flashes.push(a.sph(0.09, '#ffffff', (i % 2 ? 3.4 : -3.4) + (i % 4 < 2 ? 0.4 : -0.3), 1.3 + (i % 3) * 0.25, -3 + i * 0.75, { emissive: '#ffffff', ei: 2, outline: false }));
        a.anim.push(function (t) { flashes.forEach(function (f, i) { f.visible = ((t * 7 + i * 2.3) % 5) < 0.25; }); });
        var s1 = a.lightCone(-5, 0.2, -6, 16, 1.4, '#cfe8ff'), s2 = a.lightCone(5, 0.2, -6, 16, 1.4, '#cfe8ff');
        a.anim.push(function (t) { s1.rotation.set(Math.PI + 0.15, 0, -0.5 + Math.sin(t * 0.6) * 0.45); s2.rotation.set(Math.PI + 0.15, 0, 0.5 - Math.sin(t * 0.6 + 1) * 0.45); });
        a.backdrop(function (c, W, H) { c.fillStyle = grad(c, H, [[0, '#08060f'], [1, '#2a1424']]); c.fillRect(0, 0, W, H); c.fillStyle = '#1a1220'; for (var k = 0; k < 30; k++) { var x = (k * 167) % W, w = 50 + (k * 37) % 70, h = 120 + (k * 59) % 220; c.fillRect(x, H * 0.85 - h, w, h); c.fillStyle = 'rgba(255,214,120,.5)'; for (var j = 0; j < 6; j++) c.fillRect(x + 8 + (j % 3) * 14, H * 0.85 - h + 12 + Math.floor(j / 3) * 22, 6, 9); c.fillStyle = '#1a1220'; } }, { r: 16, h: 10 });
        return {};
      } },
    { id: 'haunted', name: 'Gloom Manor', blurb: 'Creaky stairs, crooked portraits and candles that flicker when you lie.',
      light: { hemi: ['#d8ccff', '#3a2a40', 1.3], key: ['#efe6ff', 2.1, [2, 6, 4]], rim: ['#b07cf0', 1.8, [-4, 3, -4]], fog: ['#1f1428', 13, 38], bg: '#140d1c',
        points: [[-2.6, 1.9, -1.8, '#ffb35c', 3, 6], [2.6, 1.9, -1.8, '#ffb35c', 3, 6]] },
      marks: [[-1.1, 0.4, 25], [1.1, 0.4, -25], [0, -0.6, 0], [-2.4, 1, 30], [2.4, 1, -30]],
      build: function (a) {
        a.floor('#3a2a32', 30);
        a.box(14, 5, 0.3, '#3a2a4a', 0, 0, -3.6, { base: true }); a.box(0.3, 5, 9, '#33243f', -5.5, 0, 0.5, { base: true }); a.box(0.3, 5, 9, '#33243f', 5.5, 0, 0.5, { base: true });
        for (var s = 0; s < 7; s++) a.box(2.0, 0.24 * (s + 1), 0.42, '#5a3a32', 3.8, 0, -0.9 - s * 0.42, { base: true });  // the creaky stairs
        a.cyl(0.04, 0.04, 2.3, '#2a1a14', 2.85, 0.5, -1.6, { rx: -30 });
        [-2.6, 2.6].forEach(function (x) { a.cyl(0.06, 0.12, 1.5, '#2a2018', x, 0, -1.8); a.cyl(0.04, 0.04, 0.3, '#f4efe6', x, 1.5, -1.8); });
        var flames = [a.sph(0.06, '#ffcf5a', -2.6, 1.86, -1.8, { emissive: '#ff9b2a', ei: 1.6, outline: false, sy: 1.6 }), a.sph(0.06, '#ffcf5a', 2.6, 1.86, -1.8, { emissive: '#ff9b2a', ei: 1.6, outline: false, sy: 1.6 })];
        a.anim.push(function (t) { flames.forEach(function (f, i) { f.scale.y = 0.06 * (1.4 + Math.sin(t * 17 + i * 3) * 0.3 + Math.sin(t * 7 + i) * 0.2); }); });
        [[-3, 2.6, -8], [0, 2.9, 4], [-1.5, 2.2, 12]].forEach(function (p) { a.box(0.8, 1.1, 0.06, '#e8b54a', p[0], p[1], -3.42, { base: true, rz: p[2] }); a.box(0.65, 0.92, 0.05, '#4a3a5a', p[0], p[1] + 0.09, -3.38, { base: true, rz: p[2] }); });
        a.particles(30, [9, 3, 5], '#c8b8ff', 0.06, function (s, t) { return [Math.sin(t * 0.1 + s[0] * 9) * (s[1] * 2 - 1), 0.1 + s[2] * 0.6, Math.cos(t * 0.13 + s[1] * 7) * (s[0] * 2 - 1)]; });
        return {};
      } },
    { id: 'rooftop', name: 'City Rooftop', blurb: 'Above the city lights: a water tank, an antenna and a long way down.',
      light: { hemi: ['#d8d0ff', '#2a2034', 0.95], key: ['#e8e6ff', 1.8, [-3, 6, 4]], rim: ['#ff8fab', 1.4, [4, 3, -5]], fog: ['#1a1a33', 18, 50], bg: '#121226' },
      marks: [[-1.2, 0.3, 30], [1.2, 0.3, -30], [0, -0.6, 0], [-2.6, 0.9, 20], [2.6, 0.9, -20]],
      build: function (a) {
        a.floor('#4a4654', 30);
        a.box(12, 0.5, 0.25, '#6a6474', 0, 0, -3.2, { base: true }); a.box(0.25, 0.5, 7, '#6a6474', -6, 0, 0.2, { base: true }); a.box(0.25, 0.5, 7, '#6a6474', 6, 0, 0.2, { base: true });
        [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]].forEach(function (q) { a.cyl(0.07, 0.07, 1.6, '#3a2a20', -4 + q[0], 0, -1.8 + q[1]); });
        a.cyl(1.0, 1.0, 1.6, '#8a5a32', -4, 1.6, -1.8); a.cone(1.1, 0.6, '#6b4424', -4, 3.2, -1.8);
        a.cyl(0.04, 0.05, 3.6, '#2a2a30', 4.4, 0, -2.2); var tip = a.sph(0.08, '#ff4f6d', 4.4, 3.65, -2.2, { emissive: '#ff4f6d', ei: 1.4, outline: false });
        a.anim.push(function (t) { tip.visible = (t % 1.4) < 0.6; });
        a.box(1.4, 1.0, 1.0, '#6a6474', 3.2, 0, 1.6, { base: true }); a.box(0.5, 0.4, 0.5, '#8a8494', 3.2, 1.0, 1.6, { base: true });
        a.backdrop(function (c, W, H) {
          c.fillStyle = grad(c, H, [[0, '#0b0b24'], [0.55, '#3a2a5a'], [0.8, '#ff8f6b'], [1, '#2a1a34']]); c.fillRect(0, 0, W, H);
          for (var k = 0; k < 46; k++) { var x = (k * 97) % W, w = 40 + (k * 31) % 90, h = 80 + (k * 71) % 300; c.fillStyle = k % 2 ? '#1a1430' : '#221a3a'; c.fillRect(x, H * 0.92 - h, w, h);
            c.fillStyle = 'rgba(255,220,140,.75)'; for (var j = 0; j < 10; j++) if ((j + k) % 3) c.fillRect(x + 6 + (j % 3) * 12, H * 0.92 - h + 10 + Math.floor(j / 3) * 20, 5, 8); }
          for (var s = 0; s < 80; s++) { c.fillStyle = 'rgba(255,255,255,.7)'; c.fillRect((s * 389) % W, (s * 157) % (H * 0.4), 2, 2); }
        }, { r: 18, h: 11 });
        return {};
      } }
  ];
  VT.SET_BY = {};
  VT.SETS.forEach(function (s) { VT.SET_BY[s.id] = s; });

  /* Build a set into a scene: returns {group, update(t), lights, light (the preset)} */
  VT.buildSet = function (id, scene, opts) {
    opts = opts || {};
    var S = VT.SET_BY[id] || VT.SETS[0], L = S.light;
    var g = new T.Group(); g.name = 'set_' + S.id;
    var api = new Api(g);
    S.build(api);
    var lights = new T.Group(); lights.name = 'lights';
    var hemi = new T.HemisphereLight(L.hemi[0], L.hemi[1], L.hemi[2]); lights.add(hemi);
    var key = new T.DirectionalLight(L.key[0], L.key[1]); key.position.set(L.key[2][0], L.key[2][1], L.key[2][2]); key.name = 'key';
    key.castShadow = opts.shadows !== false;
    key.shadow.mapSize.set(opts.shadowSize || 1024, opts.shadowSize || 1024);
    var sc = key.shadow.camera; sc.left = -7; sc.right = 7; sc.top = 7; sc.bottom = -7; sc.near = 0.5; sc.far = 30;
    key.shadow.bias = -0.0008; key.shadow.normalBias = 0.02;
    lights.add(key); lights.add(key.target);
    var rim = new T.DirectionalLight(L.rim[0], L.rim[1]); rim.position.set(L.rim[2][0], L.rim[2][1], L.rim[2][2]); rim.name = 'rim'; lights.add(rim);
    (L.points || []).forEach(function (p, i) { var pl = new T.PointLight(p[3], p[4], p[5], 2); pl.position.set(p[0], p[1], p[2]); pl.name = 'practical' + i; lights.add(pl); });
    g.add(lights);
    scene.add(g);
    if (!opts.transparent) {
      scene.background = new T.Color(L.bg);
      scene.fog = L.fog ? new T.Fog(L.fog[0], L.fog[1], L.fog[2]) : null;
    }
    return {
      group: g, preset: S, lights: lights, key: key,
      update: function (t) { api.anim.forEach(function (f) { f(t); }); },
      // passthrough (AR): hide everything but the actors' floor shadows
      // .ar says whether it is on. Leaving puts back each part's own visibility and the floor's own material.
      ar: false,
      setAR: function (on) {
        on = !!on;
        if (on === this.ar) return;
        this.ar = on;
        g.traverse(function (o) {
          var U = o.userData;
          if (o === lights || o.parent === lights) return;
          if (U.floor) {
            if (on) { U.mat0 = o.material; o.material = U.shadowMat || (U.shadowMat = new T.ShadowMaterial({ opacity: 0.35 })); }
            else if (U.mat0) { o.material = U.mat0; U.mat0 = null; }
            return;
          }
          if (!(U.backdrop || o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;  // dust, rain and signs go too
          if (on) { U.vis0 = o.visible; o.visible = !!U.keepAR; }
          else if (U.vis0 != null) { o.visible = U.vis0; U.vis0 = null; }
        });
        scene.background = on ? null : new T.Color(L.bg); scene.fog = on ? null : (L.fog ? new T.Fog(L.fog[0], L.fog[1], L.fog[2]) : null);
      },
      dispose: function () { scene.remove(g); }
    };
  };

  /* ------------------------------------------------------------------ film looks (the stage's post pass reads these) */
  VT.GRADES = [
    { id: 'technicolor', label: 'Technicolor', note: 'Rich, warm, saturated', sat: 1.3, con: 1.08, exp: 1.04, tint: [1.05, 1.0, 0.94], vig: 0.35, grain: 0.03 },
    { id: 'clean', label: 'Clean', note: 'True colours', sat: 1.05, con: 1.02, exp: 1.0, tint: [1, 1, 1], vig: 0.15, grain: 0 },
    { id: 'noir', label: 'Film noir', note: 'Black & white, deep shadows', sat: 0, con: 1.25, exp: 1.18, tint: [1, 1, 1], vig: 0.45, grain: 0.09, bw: 1 },
    { id: 'golden', label: 'Golden hour', note: 'Honey light, soft glow', sat: 1.15, con: 0.98, exp: 1.08, tint: [1.12, 1.0, 0.82], vig: 0.4, grain: 0.03 },
    { id: 'moonlight', label: 'Moonlight', note: 'Blue night, cool shadows', sat: 0.9, con: 1.06, exp: 1.04, tint: [0.86, 0.96, 1.16], vig: 0.5, grain: 0.04 },
    { id: 'neon', label: 'Neon nights', note: 'Pink and teal, punchy', sat: 1.45, con: 1.15, exp: 1.0, tint: [1.08, 0.92, 1.12], vig: 0.45, grain: 0.03 },
    { id: 'sepia', label: 'Old West sepia', note: 'Dusty, faded, warm', sat: 0.25, con: 1.05, exp: 1.04, tint: [1.18, 1.0, 0.74], vig: 0.55, grain: 0.08 },
    { id: 'pastel', label: 'Sitcom pastel', note: 'Bright, soft, friendly', sat: 0.95, con: 0.9, exp: 1.1, tint: [1.02, 1.0, 1.04], vig: 0.12, grain: 0 }
  ];
  VT.GRADE_BY = {};
  VT.GRADES.forEach(function (g) { VT.GRADE_BY[g.id] = g; });
  /* canvases: the shape of the film. ids are stored in productions (look.aspect): never rename. sizes[0] = the export
     default (pixels, even numbers). safe = the parts of the frame an app's buttons and captions cover (fractions):
     subtitles stay inside it and the editor shades it. */
  VT.ASPECTS = [
    { id: '16:9', name: 'Widescreen', label: 'Widescreen 16:9', use: 'YouTube, TV and laptops', r: 16 / 9, sizes: [[1280, 720], [1920, 1080]] },
    { id: '9:16', name: 'Reel', label: 'Reel 9:16', use: 'Instagram Reels and Stories, TikTok, YouTube Shorts', r: 9 / 16, sizes: [[1080, 1920], [720, 1280]],
      safe: { t: 0.14, b: 0.35, l: 0.06, r: 0.12, who: 'Instagram' } },
    { id: '1:1', name: 'Square', label: 'Instagram square 1:1', use: 'Instagram and Facebook feed posts', r: 1, sizes: [[1080, 1080], [720, 720]] },
    { id: '4:5', name: 'Portrait', label: 'Instagram portrait 4:5', use: 'The tallest feed post: fills more of a phone', r: 4 / 5, sizes: [[1080, 1350], [720, 900]] },
    { id: '2.39:1', name: 'CinemaScope', label: 'CinemaScope 2.39:1', use: 'The big-screen movie look', r: 2.39, sizes: [[1280, 536], [1920, 804]] },
    { id: '4:3', name: 'Academy', label: 'Academy 4:3', use: 'Classic cartoon shorts', r: 4 / 3, sizes: [[960, 720], [1440, 1080]] }
  ];
  VT.ASPECT_BY = {};
  VT.ASPECTS.forEach(function (a) { VT.ASPECT_BY[a.id] = a; });
  VT.aspectOf = function (id) { return VT.ASPECT_BY[id] || VT.ASPECTS[0]; };

  /* ------------------------------------------------------------------ sound: effects + music, synthesised once and cached */
  var RATE = 44100;
  function noiseBuf(ctx, secs) { var b = ctx.createBuffer(1, Math.ceil(secs * ctx.sampleRate), ctx.sampleRate), d = b.getChannelData(0), s = 12345; for (var i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823.5 - 1; } return b; }
  function env(g, t, a, peak, d, sus, r, end) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * sus), t + a + d); g.gain.setValueAtTime(Math.max(0.0001, peak * sus), end); g.gain.exponentialRampToValueAtTime(0.0001, end + r); }
  function tone(ctx, out, type, f0, f1, t, len, vol, o) {
    o = o || {};
    var osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(f0, t); if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + len);
    if (o.vib) { var l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = o.vib[0]; lg.gain.value = o.vib[1]; l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + len + 0.5); }
    env(g, t, o.a || 0.005, vol, o.d || 0.08, o.s == null ? 0.6 : o.s, o.r || 0.08, t + len);
    var node = g;
    if (o.lp) { var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; g.connect(f); node = f; }
    osc.connect(g); node.connect(out); osc.start(t); osc.stop(t + len + (o.r || 0.08) + 0.05);
  }
  function hiss(ctx, out, t, len, vol, type, freq, q, o) {
    o = o || {};
    var src = ctx.createBufferSource(); src.buffer = noiseBuf(ctx, len + 0.5);
    var f = ctx.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.setValueAtTime(freq || 1000, t); if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + len); f.Q.value = q || 1;
    var g = ctx.createGain(); env(g, t, o.a || 0.002, vol, o.d || 0.05, o.s == null ? 0.4 : o.s, o.r || 0.1, t + len);
    src.connect(f); f.connect(g); g.connect(out); src.start(t); src.stop(t + len + 0.5);
  }
  VT.SFX = [
    { id: 'clapper', label: 'Clapperboard', len: 0.4, draw: function (c, o) { hiss(c, o, 0, 0.03, 0.9, 'highpass', 2500, 0.7, { r: 0.06 }); tone(c, o, 'triangle', 900, 300, 0, 0.04, 0.5); } },
    { id: 'applause', label: 'Applause', len: 3.2, draw: function (c, o) { for (var i = 0; i < 140; i++) { var t = Math.random() * 2.8; hiss(c, o, t, 0.015, 0.12 + Math.random() * 0.12, 'bandpass', 1400 + Math.random() * 1800, 1.4, { r: 0.04 }); } } },
    { id: 'rimshot', label: 'Ba-dum-tss', len: 1.4, draw: function (c, o) { tone(c, o, 'sine', 180, 120, 0, 0.12, 0.8); tone(c, o, 'sine', 140, 90, 0.18, 0.12, 0.8); hiss(c, o, 0.38, 0.6, 0.35, 'highpass', 6000, 0.6, { s: 0.3, r: 0.5 }); } },
    { id: 'drumroll', label: 'Drumroll', len: 2.6, draw: function (c, o) { for (var t = 0; t < 2.1; t += 0.045) hiss(c, o, t, 0.03, 0.18 + t * 0.12, 'bandpass', 1800, 0.8, { r: 0.03 }); tone(c, o, 'sine', 120, 60, 2.15, 0.2, 0.9); hiss(c, o, 2.15, 0.4, 0.5, 'highpass', 5000, 0.5, { r: 0.4 }); } },
    { id: 'boing', label: 'Boing', len: 0.9, draw: function (c, o) { tone(c, o, 'sine', 160, 520, 0, 0.6, 0.6, { vib: [14, 60], s: 0.8, r: 0.2 }); } },
    { id: 'whoosh', label: 'Whoosh', len: 0.8, draw: function (c, o) { hiss(c, o, 0, 0.6, 0.6, 'bandpass', 300, 1.2, { f1: 3000, a: 0.2, s: 0.8, r: 0.2 }); } },
    { id: 'slide', label: 'Slide whistle', len: 1.0, draw: function (c, o) { tone(c, o, 'sine', 500, 1800, 0, 0.7, 0.4, { s: 0.9 }); } },
    { id: 'crash', label: 'Crash', len: 1.5, draw: function (c, o) { hiss(c, o, 0, 1.0, 0.9, 'lowpass', 2500, 0.5, { s: 0.3, r: 0.5 }); tone(c, o, 'square', 90, 40, 0, 0.3, 0.3); } },
    { id: 'thunder', label: 'Thunder', len: 3.0, draw: function (c, o) { hiss(c, o, 0, 2.4, 1.0, 'lowpass', 180, 0.7, { a: 0.05, d: 0.3, s: 0.6, r: 0.6 }); hiss(c, o, 0.05, 0.2, 0.5, 'bandpass', 1200, 0.5); } },
    { id: 'pop', label: 'Pop', len: 0.3, draw: function (c, o) { tone(c, o, 'sine', 900, 300, 0, 0.08, 0.7); } },
    { id: 'bell', label: 'Bell', len: 2.2, draw: function (c, o) { [1, 2.76, 5.4].forEach(function (k, i) { tone(c, o, 'sine', 660 * k, 660 * k, 0, 1.8, 0.4 / (i + 1), { d: 0.3, s: 0.3, r: 0.4 }); }); } },
    { id: 'knock', label: 'Door knock', len: 1.0, draw: function (c, o) { [0, 0.22, 0.44].forEach(function (t) { tone(c, o, 'sine', 160, 90, t, 0.07, 0.9); hiss(c, o, t, 0.03, 0.3, 'bandpass', 900, 1); }); } },
    { id: 'gasp', label: 'Crowd gasp', len: 1.4, draw: function (c, o) { hiss(c, o, 0, 0.9, 0.5, 'bandpass', 900, 0.8, { a: 0.15, f1: 600, s: 0.5, r: 0.4 }); } },
    { id: 'tada', label: 'Ta-da!', len: 1.6, draw: function (c, o) { tone(c, o, 'sawtooth', 523, 523, 0, 0.12, 0.25, { lp: 2500 }); [523, 659, 784, 1046].forEach(function (f) { tone(c, o, 'sawtooth', f, f, 0.18, 1.0, 0.13, { lp: 2800, s: 0.7, r: 0.4 }); }); } }
  ];
  VT.SFX_BY = {};
  VT.SFX.forEach(function (s) { VT.SFX_BY[s.id] = s; });
  var NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function hz(n) { var m = /^([A-G])(#|b)?(\d)$/.exec(n); if (!m) return 0; var k = NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (+m[3] + 1) * 12; return 440 * Math.pow(2, (k - 69) / 12); }
  // music: 2 bars x 16 steps, tracks of tokens ("C4", "C4+E4" chord, "." rest, "-" hold); drums "x" hit
  VT.MUSIC = [
    { id: 'none', label: 'No music' },
    { id: 'comedy', label: 'Comedy pizzicato', bpm: 132, tracks: [
      { w: 'triangle', v: 0.35, s: 'C3 . G3 . C3 . G3 . F3 . C4 . F3 . C4 . G3 . D4 . G3 . D4 . C3 . G3 . E3 . G3 .', len: 0.12 },
      { w: 'square', v: 0.09, lp: 2600, s: 'E5 . G5 . . . E5 . F5 . A5 . . . F5 . G5 . B5 . D6 . B5 . C6 . . . . . . .', len: 0.1 },
      { d: 'hat', v: 0.08, s: 'x . x . x . x . x . x . x . x . x . x . x . x . x . x . x . x . x . x .' }] },
    { id: 'suspense', label: 'Suspense', bpm: 70, tracks: [
      { w: 'sawtooth', v: 0.12, lp: 500, s: 'C2 - - - - - - - - - - - - - - - Db2 - - - - - - - - - - - - - - -', len: 0.2 },
      { w: 'sine', v: 0.14, s: 'G4 . . . G4 . . . Ab4 . . . G4 . . . G4 . . . G4 . . . Ab4 . . . B4 . . .', len: 0.25 },
      { d: 'kick', v: 0.25, s: 'x . . . . . . . x . . . . . . . x . . . . . . . x . . . x . . .' }] },
    { id: 'heroic', label: 'Heroic fanfare', bpm: 112, tracks: [
      { w: 'sawtooth', v: 0.1, lp: 1800, s: 'C4+E4+G4 - - - - - - - F4+A4+C5 - - - G4+B4+D5 - - - C4+E4+G4 - - - - - - - A3+C4+E4 - - - G3+B3+D4 - - -', len: 0.3 },
      { w: 'square', v: 0.08, lp: 3000, s: 'G4 . . G4 C5 - - - E5 . D5 . C5 . G4 . C5 . . C5 E5 - - - G5 - - - - - - -', len: 0.15 },
      { d: 'kick', v: 0.3, s: 'x . . . x . . . x . . . x . x . x . . . x . . . x . . . x . x .' }] },
    { id: 'western', label: 'Western trot', bpm: 104, tracks: [
      { w: 'triangle', v: 0.3, s: 'A2 . E3 . A2 . E3 . D3 . A3 . D3 . A3 . E3 . B3 . E3 . B3 . A2 . E3 . A2 . E3 .', len: 0.14 },
      { w: 'sine', v: 0.16, s: 'A5 - - C6 B5 - A5 - E5 - - - - - - - G5 - - A5 G5 - E5 - D5 - - - - - - -', len: 0.25, vib: [5, 6] },
      { d: 'hat', v: 0.06, s: 'x . x x x . x x x . x x x . x x x . x x x . x x x . x x x . x x' }] },
    { id: 'noir', label: 'Noir jazz', bpm: 84, tracks: [
      { w: 'sine', v: 0.25, s: 'D2 . . . F2 . . . A2 . . . C3 . . . G2 . . . Bb2 . . . D3 . . . A2 . . .', len: 0.35 },
      { w: 'triangle', v: 0.09, lp: 1400, s: 'D4+F4+A4+C5 - - - - - - - - - - - - - - - G3+Bb3+D4+F4 - - - - - - - A3+C#4+E4+G4 - - - - - - -', len: 0.3 },
      { d: 'hat', v: 0.05, s: '. . x . . . x . . . x . . . x . . . x . . . x . . . x . . . x .' }] },
    { id: 'space', label: 'Space arpeggio', bpm: 120, tracks: [
      { w: 'square', v: 0.07, lp: 2200, s: 'A3 C4 E4 A4 E4 C4 A3 C4 F3 A3 C4 F4 C4 A3 F3 A3 G3 B3 D4 G4 D4 B3 G3 B3 E3 G#3 B3 E4 B3 G#3 E3 G#3', len: 0.1 },
      { w: 'sine', v: 0.18, s: 'A2 - - - - - - - F2 - - - - - - - G2 - - - - - - - E2 - - - - - - -', len: 0.5 }] },
    { id: 'spooky', label: 'Spooky organ', bpm: 76, tracks: [
      { w: 'square', v: 0.06, lp: 1200, s: 'D3+F3+A3 - - - - - - - C#3+E3+G3 - - - - - - - D3+F3+A3 - - - - - - - Bb2+D3+F3 - - - A2+C#3+E3 - - -', len: 0.4 },
      { w: 'sine', v: 0.14, s: 'A4 . . F4 . . D4 . . . E4 . C#4 . . . A4 . . F4 . . D4 . . . Bb4 . A4 . . .', len: 0.3, vib: [6, 8] }] },
    { id: 'romance', label: 'Romance', bpm: 72, tracks: [
      { w: 'sine', v: 0.12, s: 'C4+E4+G4 - - - - - - - A3+C4+E4 - - - - - - - F3+A3+C4 - - - - - - - G3+B3+D4 - - - - - - -', len: 0.5 },
      { w: 'triangle', v: 0.12, s: 'G5 - - E5 - - C5 - - - E5 - G5 - - - A5 - - G5 - - E5 - - - D5 - - - - -', len: 0.4 }] }
  ];
  VT.MUSIC_BY = {};
  VT.MUSIC.forEach(function (m) { VT.MUSIC_BY[m.id] = m; });
  function drum(c, o, kind, t, v) {
    if (kind === 'kick') tone(c, o, 'sine', 140, 45, t, 0.12, v * 2.5, { d: 0.1, s: 0.2 });
    else if (kind === 'hat') hiss(c, o, t, 0.02, v * 2, 'highpass', 7000, 0.7, { r: 0.04 });
    else hiss(c, o, t, 0.06, v * 2, 'bandpass', 1800, 0.8, { r: 0.08 });
  }
  function renderMusic(m) {
    var step = 60 / m.bpm / 4, len = step * 32;
    var c = new OfflineAudioContext(1, Math.ceil((len + 0.01) * RATE), RATE), o = c.destination;
    m.tracks.forEach(function (tr) {
      var tok = tr.s.split(/\s+/);
      tok.forEach(function (k, i) {
        if (k === '.' || k === '-') return;
        var t = i * step;
        if (tr.d) { drum(c, o, tr.d, t, tr.v); return; }
        var holds = 0; for (var j = i + 1; j < tok.length && tok[j] === '-'; j++) holds++;
        var dur = Math.max(tr.len || 0.15, (holds + 1) * step * 0.95);
        k.split('+').forEach(function (n) { var f = hz(n); if (f) tone(c, o, tr.w, f, f, t, Math.min(dur, len - t - 0.02), tr.v, { lp: tr.lp, vib: tr.vib, s: 0.55, r: 0.12 }); });
      });
    });
    return c.startRendering();
  }
  var _sfxCache = {}, _musicCache = {};
  VT.sfxBuffer = function (id) {
    if (_sfxCache[id]) return _sfxCache[id];
    var s = VT.SFX_BY[id]; if (!s) return Promise.resolve(null);
    var c = new OfflineAudioContext(1, Math.ceil(s.len * RATE), RATE);
    s.draw(c, c.destination);
    return (_sfxCache[id] = c.startRendering());
  };
  VT.musicBuffer = function (id) {
    if (!id || id === 'none' || !VT.MUSIC_BY[id]) return Promise.resolve(null);
    return _musicCache[id] || (_musicCache[id] = renderMusic(VT.MUSIC_BY[id]));
  };
  VT._noiseBuf = noiseBuf;
})();
