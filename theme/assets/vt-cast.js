/* vt-cast.js: the toon characters of VRtoToon (window.VT, needs three.js r158 as window.THREE).

   A character is DATA (VT.CAST[i] = {id, name, species, build, colors, hair, hat, acc, ...}); VT.buildActor(def) turns it into
   a three.js rig made of simple shapes with toon shading and ink outlines:
     root (floor, faces +Z) > hips > torso > neck > head (face: eyes, lids, brows, mouth, nose, ears, hair, hat)
                                     torso > armL/armR: upper > fore > hand (mitten: palm, thumb, fingers, index)
                            hips  > legL/legR: thigh > shin > foot          (+ tail)
   actor.setPose(p) places it from a performance frame: head + both hands (position + rotation, in the actor's own space,
   metres, +Z = forward), hand shapes, emotion, mouth, blink, gaze, walking. Arms reach the hands with two-bone IK; the torso
   leans and the hips step to follow the head, so a VR performer's head and hands drive the whole upper body.
   Custom characters = a premade def + overrides (VT.makeDef(base, overrides)), so the wardrobe and future editors only
   change data. Ids in VT.CAST never change (productions reference them). */
(function () {
  'use strict';
  var VT = window.VT = window.VT || {};
  var T = window.THREE;
  if (!T) { console.warn('vt-cast: three.js missing'); return; }
  var V3 = T.Vector3, Q = T.Quaternion, D2R = Math.PI / 180;
  var UP = new V3(0, 1, 0), DOWN = new V3(0, -1, 0);
  var INK = '#1d1416';

  /* ------------------------------------------------------------------ materials + shapes */
  var _grad = null;
  function gradient() {
    if (!_grad) {
      _grad = new T.DataTexture(new Uint8Array([96, 178, 255]), 3, 1, T.RedFormat);
      _grad.minFilter = _grad.magFilter = T.NearestFilter;
      _grad.needsUpdate = true;
    }
    return _grad;
  }
  var _mats = {};
  VT.mat = function (color, o) {
    o = o || {};
    var key = color + '|' + (o.emissive || '') + '|' + (o.opacity || 1) + '|' + (o.basic ? 1 : 0) + '|' + (o.side || 0);
    if (_mats[key]) return _mats[key];
    var m;
    if (o.basic) m = new T.MeshBasicMaterial({ color: color });
    else m = new T.MeshToonMaterial({ color: color, gradientMap: gradient() });
    if (o.emissive) { m.emissive = new T.Color(o.emissive); m.emissiveIntensity = o.ei || 0.9; }
    if (o.opacity && o.opacity < 1) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = false; }
    if (o.side) m.side = o.side;
    m.userData.vtColor = color;
    _mats[key] = m;
    return m;
  };
  var _outline = {};
  VT.outlineMat = function (w, color) {
    var key = (w || 0.0032) + (color || INK);
    if (_outline[key]) return _outline[key];
    var m = new T.ShaderMaterial({
      uniforms: { w: { value: w || 0.0032 }, c: { value: new T.Color(color || INK) } },
      vertexShader: 'uniform float w; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0);' +
        ' vec3 n = normalize(normalMatrix * normal); mv.xyz += n * w * clamp(-mv.z, 0.5, 30.0); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 c; void main() { gl_FragColor = vec4(c, 1.0); }',
      side: T.BackSide
    });
    _outline[key] = m;
    return m;
  };
  var _geo = {};
  function geo(key, make) { return _geo[key] || (_geo[key] = make()); }
  var r2 = function (v) { return Math.round(v * 1000) / 1000; };
  var SPH = function () { return geo('sph', function () { return new T.SphereGeometry(1, 28, 18); }); };
  var DOME = function () { return geo('dome', function () { return new T.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2); }); };
  var CYL = function (top, seg) { top = top == null ? 1 : top; return geo('cyl' + top + '|' + (seg || 24), function () { return new T.CylinderGeometry(top, 1, 1, seg || 24); }); };
  var CONE = function () { return geo('cone', function () { return new T.ConeGeometry(1, 1, 22); }); };
  var CAPS = function (r, len) { r = r2(r); len = r2(len); return geo('cap' + r + '|' + len, function () { return new T.CapsuleGeometry(r, len, 6, 16); }); };
  var TOR = function (R, t, arc) { R = r2(R); t = r2(t); return geo('tor' + R + '|' + t + '|' + (arc || 0), function () { return new T.TorusGeometry(R, t, 10, 28, arc || Math.PI * 2); }); };
  VT.roundedBox = function (w, h, d, r) {
    w = r2(w); h = r2(h); d = r2(d); r = r2(Math.min(r, w / 2, h / 2, d / 2));
    return geo('rbox' + [w, h, d, r].join('|'), function () {
      var g = new T.BoxGeometry(w, h, d, 6, 6, 6), p = g.attributes.position, n = g.attributes.normal;
      var hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r, v = new V3(), c = new V3();
      for (var i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        c.set(Math.max(-hx, Math.min(hx, v.x)), Math.max(-hy, Math.min(hy, v.y)), Math.max(-hz, Math.min(hz, v.z)));
        v.sub(c).normalize();
        n.setXYZ(i, v.x, v.y, v.z);
        v.multiplyScalar(r).add(c);
        p.setXYZ(i, v.x, v.y, v.z);
      }
      return g;
    });
  };
  function outline(m, w) {
    var o = new T.Mesh(m.geometry, VT.outlineMat(w));
    o.userData.outline = true; o.castShadow = false; o.receiveShadow = false;
    o.raycast = function () {};
    m.add(o);
    return m;
  }
  function mesh(g, color, o) {
    o = o || {};
    var m = new T.Mesh(g, VT.mat(color, o));
    m.castShadow = o.shadow !== false; m.receiveShadow = !!o.recv;
    if (o.outline !== false && !(o.opacity < 1)) outline(m, o.ow);
    return m;
  }
  VT.mesh = mesh; VT.SPH = SPH; VT.CYL = CYL; VT.CONE = CONE; VT.CAPS = CAPS; VT.TOR = TOR; VT.DOME = DOME;
  function at(obj, x, y, z, sx, sy, sz) {
    obj.position.set(x || 0, y || 0, z || 0);
    if (sx != null) obj.scale.set(sx, sy == null ? sx : sy, sz == null ? sx : sz);
    return obj;
  }
  function grp(name, parent) { var g = new T.Group(); g.name = name || ''; if (parent) parent.add(g); return g; }
  function rot(o, x, y, z) { o.rotation.set((x || 0) * D2R, (y || 0) * D2R, (z || 0) * D2R); return o; }
  function shade(hex, k) { var c = new T.Color(hex); c.offsetHSL(0, 0, k); return '#' + c.getHexString(); }
  VT.shade = shade;

  /* ------------------------------------------------------------------ emotions */
  // lid: 0 open .. 1 closed (negative = wide); browY: raise; browTilt: + inner up (worried), - inner down (angry);
  // curve: -1 frown .. 1 smile; open: mouth open; wide: mouth width; pupil: size; tilt: head tilt (deg)
  VT.EMOTIONS = [
    { id: 'neutral', label: 'Neutral', emoji: '😐', f: { lid: 0.12, browY: 0, browTilt: 0, curve: 0.15, open: 0, wide: 0.5, pupil: 1 } },
    { id: 'happy', label: 'Happy', emoji: '😀', f: { lid: 0.08, browY: 0.25, browTilt: 4, curve: 0.9, open: 0.12, wide: 0.65, pupil: 1.05, tilt: 4 } },
    { id: 'laugh', label: 'Laughing', emoji: '😆', f: { lid: 0.62, browY: 0.45, browTilt: 10, curve: 1, open: 0.62, wide: 0.75, pupil: 1, tilt: -6 } },
    { id: 'sad', label: 'Sad', emoji: '😢', f: { lid: 0.38, browY: 0.1, browTilt: 22, curve: -0.75, open: 0, wide: 0.45, pupil: 1.15, tear: 1, tilt: 8 } },
    { id: 'angry', label: 'Angry', emoji: '😠', f: { lid: 0.3, browY: -0.35, browTilt: -28, curve: -0.55, open: 0.08, wide: 0.7, pupil: 0.8, tilt: -3 } },
    { id: 'surprised', label: 'Surprised', emoji: '😲', f: { lid: -0.3, browY: 0.85, browTilt: 6, curve: 0, open: 0.55, wide: 0.35, pupil: 0.75 } },
    { id: 'scared', label: 'Scared', emoji: '😨', f: { lid: -0.15, browY: 0.55, browTilt: 26, curve: -0.35, open: 0.3, wide: 0.8, pupil: 0.65, sweat: 1, tilt: -4 } },
    { id: 'smug', label: 'Smug', emoji: '😏', f: { lid: 0.48, browY: 0.15, browTilt: -6, browAsym: 0.6, curve: 0.55, open: 0, wide: 0.55, pupil: 1, tilt: 7 } },
    { id: 'love', label: 'In love', emoji: '😍', f: { lid: 0.28, browY: 0.35, browTilt: 14, curve: 0.85, open: 0.1, wide: 0.55, pupil: 1.45, blush: 1, tilt: 10 } },
    { id: 'thinking', label: 'Thinking', emoji: '🤔', f: { lid: 0.3, browY: 0.2, browTilt: -4, browAsym: 0.8, curve: -0.15, open: 0, wide: 0.4, pupil: 1, tilt: -9, look: 1 } },
    { id: 'sleepy', label: 'Sleepy', emoji: '😴', f: { lid: 0.78, browY: -0.1, browTilt: 8, curve: 0, open: 0.12, wide: 0.35, pupil: 1, tilt: 12 } },
    { id: 'shy', label: 'Shy', emoji: '😳', f: { lid: 0.2, browY: 0.3, browTilt: 16, curve: 0.35, open: 0, wide: 0.35, pupil: 1.2, blush: 1, tilt: 12 } }
  ];
  VT.EMO = {};
  VT.EMOTIONS.forEach(function (e) { VT.EMO[e.id] = e; });
  var FACE_KEYS = ['lid', 'browY', 'browTilt', 'browAsym', 'curve', 'open', 'wide', 'pupil', 'tear', 'sweat', 'blush', 'tilt', 'look'];
  VT.faceOf = function (emo) {
    // emo: 'happy' | {happy: .7, neutral: .3}
    var w = typeof emo === 'string' ? (function () { var o = {}; o[emo] = 1; return o; })() : (emo || { neutral: 1 });
    var out = {}, tot = 0;
    FACE_KEYS.forEach(function (k) { out[k] = 0; });
    Object.keys(w).forEach(function (id) {
      var e = VT.EMO[id] || VT.EMO.neutral, a = w[id];
      tot += a;
      FACE_KEYS.forEach(function (k) {
        var v = e.f[k] != null ? e.f[k] : (k === 'pupil' ? 1 : k === 'wide' ? 0.5 : 0);
        out[k] += v * a;
      });
    });
    if (tot > 0 && Math.abs(tot - 1) > 1e-6) FACE_KEYS.forEach(function (k) { out[k] /= tot; });
    return out;
  };

  /* ------------------------------------------------------------------ the cast */
  // build: h height scale, head, girth, legs, arms, torso ('round' | 'pear' | 'box' | 'dress' | 'coat' | 'tall' | 'egg')
  var SKIN = { a: '#f6cfae', b: '#e8b48c', c: '#c98c5e', d: '#9a6440', e: '#6e4429', pale: '#eadfd6' };
  VT.ROLES = [
    { id: 'lead', label: 'Leading roles' }, { id: 'sidekick', label: 'Sidekicks' }, { id: 'villain', label: 'Villains' },
    { id: 'character', label: 'Character actors' }, { id: 'creature', label: 'Creatures & critters' }
  ];
  VT.CAST = [
    { id: 'max', name: 'Max Marquee', role: 'lead', tag: 'The eager hero who was born ready', species: 'human',
      colors: { skin: SKIN.a, hair: '#6b3a1e', shirt: '#d7263d', pants: '#2b2d42', shoes: '#1b1b1b', accent: '#ffd166', eyes: '#3a2a1a' },
      hair: 'spiky', acc: ['collar'], voice: 'bright' },
    { id: 'rosie', name: 'Rosie Reel', role: 'lead', tag: 'Sharp, witty and always one step ahead', species: 'human',
      build: { torso: 'dress' }, colors: { skin: SKIN.c, hair: '#3b1f14', shirt: '#ffc23d', pants: '#ffc23d', shoes: '#c2185b', accent: '#e63946', eyes: '#2a1a10' },
      hair: 'bob', hat: 'beret', acc: [], voice: 'warm' },
    { id: 'duke', name: 'Duke Dawson', role: 'lead', tag: 'Fastest drawl in the West', species: 'human',
      build: { h: 1.06, girth: 1.08 }, colors: { skin: SKIN.b, hair: '#4a2c17', shirt: '#3a6ea5', pants: '#5b4636', shoes: '#3a2414', accent: '#c58b3a', eyes: '#2a1a10' },
      hair: 'short', hat: 'cowboy', acc: ['vest', 'mustache', 'badge'], voice: 'deep' },
    { id: 'vera', name: 'Vera Velvet', role: 'lead', tag: 'Private eye. Public smirk.', species: 'human',
      build: { torso: 'coat', h: 1.03 }, colors: { skin: SKIN.a, hair: '#151012', shirt: '#c9b48a', pants: '#3b3438', shoes: '#151012', accent: '#b3182b', eyes: '#2b4a2b' },
      hair: 'long', hat: 'fedora', acc: ['scarf'], voice: 'smoky' },
    { id: 'nova', name: 'Captain Nova', role: 'lead', tag: 'Brave, bold and slightly lost in space', species: 'human',
      colors: { skin: SKIN.d, hair: '#1a1210', shirt: '#eef2f7', pants: '#eef2f7', shoes: '#ff7a1a', accent: '#ff7a1a', eyes: '#1a1210' },
      hair: 'short', hat: 'space', acc: ['belt'], voice: 'radio' },
    { id: 'reggie', name: 'Sir Reginald', role: 'lead', tag: 'A knight in slightly rusty armour', species: 'human',
      build: { girth: 1.1, h: 1.04 }, colors: { skin: SKIN.a, hair: '#c9a14a', shirt: '#b9c2cc', pants: '#8b95a1', shoes: '#6b7480', accent: '#2457a6', eyes: '#2a3a5a' },
      hair: 'short', hat: 'knight', acc: ['cape'], voice: 'grand' },
    { id: 'biscuit', name: 'Biscuit', role: 'sidekick', tag: 'Good boy. Best actor on set.', species: 'dog',
      build: { h: 0.78, head: 1.12 }, colors: { skin: '#d9a05b', fur2: '#f3dcb8', shirt: '#d9a05b', pants: '#d9a05b', shoes: '#c08847', accent: '#d7263d', eyes: '#2a1a10' },
      acc: ['collar'], voice: 'bright' },
    { id: 'mittens', name: 'Mittens', role: 'sidekick', tag: 'A tuxedo cat with a criminal streak', species: 'cat',
      build: { h: 0.74, head: 1.1 }, colors: { skin: '#2a2628', fur2: '#f4f1ea', shirt: '#2a2628', pants: '#2a2628', shoes: '#f4f1ea', accent: '#b3182b', eyes: '#9acd32' },
      acc: ['bowtie'], voice: 'smoky' },
    { id: 'bolt', name: 'Bolt', role: 'sidekick', tag: 'A helpful robot with a dramatic streak', species: 'robot',
      build: { h: 0.92 }, colors: { skin: '#5fb8b2', fur2: '#d9eceb', shirt: '#5fb8b2', pants: '#3c7f7b', shoes: '#2d5f5c', accent: '#ffd166', eyes: '#7ff9ff' },
      voice: 'robot' },
    { id: 'pip', name: 'Pip', role: 'sidekick', tag: 'Small rabbit, very big feelings', species: 'rabbit',
      build: { h: 0.7, head: 1.12 }, colors: { skin: '#f4efe9', fur2: '#ffc6d3', shirt: '#4d8fd6', pants: '#4d8fd6', shoes: '#f4efe9', accent: '#ff8fab', eyes: '#2a1a10' },
      voice: 'bright' },
    { id: 'gus', name: 'Gus', role: 'sidekick', tag: 'The gentlest bear in pictures', species: 'bear',
      build: { h: 1.1, girth: 1.35, torso: 'round' }, colors: { skin: '#8a5a36', fur2: '#d8b48c', shirt: '#8a5a36', pants: '#8a5a36', shoes: '#5e3c22', accent: '#d7263d', eyes: '#1a1210' },
      acc: ['scarf'], voice: 'deep' },
    { id: 'fenna', name: 'Fenna Fox', role: 'sidekick', tag: 'Clever, quick and never without a plan', species: 'fox',
      build: { h: 0.86 }, colors: { skin: '#e8762d', fur2: '#fbf3ea', shirt: '#2f6e4f', pants: '#2f6e4f', shoes: '#2a1a10', accent: '#ffd166', eyes: '#2a1a10' },
      acc: ['glasses'], voice: 'warm' },
    { id: 'baron', name: 'Baron Von Boo', role: 'villain', tag: 'Twirls his moustache professionally', species: 'human',
      build: { h: 1.08, girth: 0.92, legs: 1.08 }, colors: { skin: SKIN.pale, hair: '#141014', shirt: '#4b2a6b', pants: '#1f1724', shoes: '#141014', accent: '#b3182b', eyes: '#3a1020' },
      hair: 'slick', hat: 'top', acc: ['cape', 'monocle', 'mustache'], voice: 'grand' },
    { id: 'nightshade', name: 'Madame Nightshade', role: 'villain', tag: 'Potions, curses and perfect timing', species: 'human',
      build: { torso: 'dress', h: 1.04 }, colors: { skin: '#b9d8a6', hair: '#2d1b3d', shirt: '#4a2a6a', pants: '#4a2a6a', shoes: '#141014', accent: '#9be564', eyes: '#6a1b9a' },
      hair: 'long', hat: 'witch', acc: [], voice: 'smoky' },
    { id: 'grumble', name: 'Grumble', role: 'villain', tag: 'A monster who just wants to be understood', species: 'ogre',
      build: { h: 1.15, girth: 1.4, head: 1.08, torso: 'round' }, colors: { skin: '#7cb342', fur2: '#c5e1a5', shirt: '#6d4c41', pants: '#4e342e', shoes: '#3e2723', accent: '#fff3c4', eyes: '#ffca28' },
      voice: 'deep' },
    { id: 'zorp', name: 'Dr. Zorp', role: 'villain', tag: 'Came in peace. Mostly.', species: 'alien',
      build: { h: 0.9, head: 1.2 }, colors: { skin: '#7ee0c4', fur2: '#c8f7ea', shirt: '#6a3fd1', pants: '#6a3fd1', shoes: '#2b1a5a', accent: '#ff4fa3', eyes: '#111111' },
      acc: ['belt'], voice: 'robot' },
    { id: 'dee', name: 'Director Dee', role: 'character', tag: 'Says "Action!" like nobody else', species: 'human',
      colors: { skin: SKIN.b, hair: '#2a1a14', shirt: '#151214', pants: '#3b3438', shoes: '#151214', accent: '#e8b54a', eyes: '#2a1a10' },
      hair: 'bob', hat: 'beret', acc: ['shades', 'scarf'], voice: 'bright' },
    { id: 'gaston', name: 'Chef Gaston', role: 'character', tag: 'Three stars, one temper', species: 'human',
      build: { girth: 1.25, torso: 'round' }, colors: { skin: SKIN.a, hair: '#3a2a1a', shirt: '#f7f4ee', pants: '#2d2d2d', shoes: '#1b1b1b', accent: '#d7263d', eyes: '#2a1a10' },
      hair: 'short', hat: 'chef', acc: ['mustache', 'scarf'], voice: 'grand' },
    { id: 'granny', name: 'Granny Gold', role: 'character', tag: 'Knits, scolds and steals every scene', species: 'human',
      build: { h: 0.9, girth: 1.08 }, colors: { skin: SKIN.a, hair: '#d9d9dc', shirt: '#e58fae', pants: '#7a5c8a', shoes: '#5a3a4a', accent: '#f6e27a', eyes: '#3a4a6a' },
      hair: 'bun', acc: ['glasses', 'necklace'], voice: 'warm' },
    { id: 'comet', name: 'Kid Comet', role: 'character', tag: 'Too fast, too curious, too much', species: 'human',
      build: { h: 0.74, head: 1.14 }, colors: { skin: SKIN.c, hair: '#1a1210', shirt: '#39b54a', pants: '#3a5fa8', shoes: '#f7f4ee', accent: '#ff7a1a', eyes: '#2a1a10' },
      hair: 'curly', hat: 'cap', acc: [], voice: 'bright' },
    { id: 'lou', name: 'Officer Lou', role: 'character', tag: 'By the book. The book is lost.', species: 'human',
      build: { girth: 1.15 }, colors: { skin: SKIN.d, hair: '#1a1210', shirt: '#2c4a8a', pants: '#1d2f5a', shoes: '#111111', accent: '#e8b54a', eyes: '#1a1210' },
      hair: 'short', hat: 'police', acc: ['badge', 'mustache'], voice: 'deep' },
    { id: 'frankie', name: 'Frankie', role: 'creature', tag: 'A lounge-singing frog', species: 'frog',
      build: { h: 0.72, head: 1.1 }, colors: { skin: '#5fbf4a', fur2: '#d6f0a8', shirt: '#5fbf4a', pants: '#5fbf4a', shoes: '#4aa53a', accent: '#d7263d', eyes: '#1a1210' },
      acc: ['bowtie'], voice: 'smoky' },
    { id: 'boo', name: 'Boo', role: 'creature', tag: 'A ghost afraid of the dark', species: 'ghost',
      build: { h: 0.85 }, colors: { skin: '#f4f6ff', fur2: '#dfe4ff', shirt: '#f4f6ff', pants: '#f4f6ff', shoes: '#f4f6ff', accent: '#9fb3ff', eyes: '#1a1a2e' },
      voice: 'echo' },
    { id: 'tux', name: 'Tux', role: 'creature', tag: 'Dressed for the premiere since birth', species: 'penguin',
      build: { h: 0.72 }, colors: { skin: '#1f2430', fur2: '#f7f7f2', shirt: '#1f2430', pants: '#1f2430', shoes: '#ff9f1a', accent: '#d7263d', eyes: '#1a1210' },
      acc: ['bowtie'], voice: 'bright' },
    { id: 'rex', name: 'Tiny Rex', role: 'creature', tag: 'Tiny arms. Huge ambitions.', species: 'dino',
      build: { h: 0.92, head: 1.08 }, colors: { skin: '#4fa3a5', fur2: '#cfe8d8', shirt: '#4fa3a5', pants: '#4fa3a5', shoes: '#3b8183', accent: '#ffb627', eyes: '#1a1210' },
      voice: 'deep' }
  ];
  VT.CAST_BY = {};
  VT.CAST.forEach(function (c) { VT.CAST_BY[c.id] = c; });
  VT.VOICE_FX = [
    { id: 'none', label: 'Natural' }, { id: 'radio', label: 'Radio' }, { id: 'robot', label: 'Robot' }, { id: 'echo', label: 'Echo hall' },
    { id: 'megaphone', label: 'Megaphone' }, { id: 'phone', label: 'Telephone' }, { id: 'cave', label: 'Cave' }
  ];
  // what each premade voice note suggests in the mixer (the performer's own voice, coloured)
  VT.VOICE_HINT = { bright: 'none', warm: 'none', deep: 'none', smoky: 'none', grand: 'echo', radio: 'radio', robot: 'robot', echo: 'echo' };
  VT.HAIRS = ['none', 'short', 'spiky', 'bob', 'long', 'bun', 'curly', 'afro', 'mohawk', 'slick', 'pigtails'];
  VT.HATS = ['none', 'top', 'fedora', 'cowboy', 'beret', 'crown', 'space', 'witch', 'chef', 'cap', 'police', 'knight', 'bow', 'headphones'];
  VT.ACCS = ['bowtie', 'tie', 'cape', 'scarf', 'glasses', 'shades', 'monocle', 'mustache', 'beard', 'badge', 'necklace', 'belt', 'vest', 'collar', 'gloves'];
  VT.SPECIES = ['human', 'dog', 'cat', 'bear', 'rabbit', 'fox', 'frog', 'robot', 'ghost', 'alien', 'ogre', 'penguin', 'dino'];
  VT.TORSOS = ['round', 'pear', 'box', 'egg', 'dress', 'coat'];
  VT.EARS = ['auto', 'none', 'human', 'round', 'point', 'long', 'flop', 'horn', 'antenna'];
  VT.VOICES = ['bright', 'warm', 'deep', 'smoky', 'grand', 'radio', 'robot', 'echo'];
  // what the character editor's face sliders change (1 = as built; nose 0 = no nose)
  var FACE0 = { eyes: 1, spread: 1, lift: 0, tall: 1, brows: 1, nose: 1, mouth: 1, ears: 'auto', earSize: 1, freckles: 0, lashes: 0, cheeks: 0 };
  VT.FACE0 = FACE0;

  var BUILD0 = { h: 1, head: 1, girth: 1, legs: 1, arms: 1, hand: 1, torso: 'round' };
  var COLORS0 = { skin: SKIN.a, fur2: '#ffffff', hair: '#4a2c17', shirt: '#4d8fd6', pants: '#2b2d42', shoes: '#1b1b1b', accent: '#ffd166', eyes: '#2a1a10' };
  VT.normalize = function (def) {
    def = def || VT.CAST[0];
    var base = def.base && VT.CAST_BY[def.base] ? VT.CAST_BY[def.base] : null;
    var d = JSON.parse(JSON.stringify(base ? VT.makeDef(base, def) : def));
    d.build = Object.assign({}, BUILD0, d.build || {});
    d.colors = Object.assign({}, COLORS0, d.colors || {});
    d.face = Object.assign({}, FACE0, d.face || {});
    if (VT.EARS.indexOf(d.face.ears) < 0) d.face.ears = 'auto';
    d.species = VT.SPECIES.indexOf(d.species) >= 0 ? d.species : 'human';
    d.hair = d.hair || (d.species === 'human' ? 'short' : 'none');
    d.hat = d.hat || 'none';
    d.acc = (d.acc || []).slice(0, 6);
    return d;
  };
  /* A variant of a premade character: overrides win, colours, build and face merge (the wardrobe saves {base, ...overrides}). */
  VT.makeDef = function (base, over) {
    var b = typeof base === 'string' ? VT.CAST_BY[base] : base;
    var d = JSON.parse(JSON.stringify(b || VT.CAST[0]));
    over = over || {};
    Object.keys(over).forEach(function (k) {
      if (k === 'colors' || k === 'build' || k === 'face') d[k] = Object.assign({}, d[k] || {}, over[k]);
      else if (k !== 'base') d[k] = over[k];
    });
    d.base = b ? b.id : null;
    return d;
  };
  VT.charDef = function (ref, custom) {
    // ref: a premade id or a custom character uid; custom: {uid: def} from the production / the user's wardrobe
    if (custom && custom[ref]) return VT.normalize(custom[ref]);
    return VT.normalize(VT.CAST_BY[ref] || VT.CAST[0]);
  };

  /* ------------------------------------------------------------------ the rig */
  function Actor(def) {
    var d = this.def = VT.normalize(def);
    var b = d.build, c = d.colors, sp = d.species, S = b.h;
    var self = this;
    this.root = grp('actor_' + (d.id || 'x'));
    this.root.userData.actor = this;
    // proportions (metres), species first
    var P = {
      headR: 0.23 * b.head, torsoH: 0.4, torsoW: 0.2 * b.girth, torsoD: 0.15 * b.girth, neck: 0.05,
      thigh: 0.22 * b.legs, shin: 0.21 * b.legs, foot: 0.055, hipW: 0.085 * b.girth, upper: 0.21 * b.arms, fore: 0.19 * b.arms,
      armR: 0.042, legR: 0.055, hand: 1
    };
    if (sp === 'penguin') { P.thigh = 0.05; P.shin = 0.04; P.torsoH = 0.55; P.torsoW = 0.24; P.torsoD = 0.22; P.headR = 0.2; P.upper = 0.16; P.fore = 0.15; }
    if (sp === 'ghost') { P.thigh = 0.18; P.shin = 0.16; P.torsoH = 0.38; }
    if (sp === 'frog') { P.thigh = 0.16; P.shin = 0.16; P.headR *= 1.05; }
    if (sp === 'dino') { P.upper = 0.11; P.fore = 0.1; P.armR = 0.035; P.thigh = 0.2; P.shin = 0.18; P.torsoW *= 1.15; }
    if (sp === 'ogre') { P.armR = 0.06; P.legR = 0.07; P.upper *= 1.12; P.fore *= 1.12; }
    if (sp === 'robot') { P.armR = 0.045; }
    Object.keys(P).forEach(function (k) { if (k !== 'hand') P[k] *= S; });
    P.hipY = P.thigh + P.shin + P.foot * 0.6;
    this.P = P;

    var skin = c.skin, fur2 = c.fur2;
    var bodyCol = sp === 'human' || sp === 'robot' || sp === 'alien' || sp === 'ogre' ? c.shirt : (c.shirt || skin);
    var hips = this.hips = grp('hips', this.root); hips.position.y = P.hipY;
    var torso = this.torso = grp('torso', hips);
    var tH = P.torsoH, tW = P.torsoW, tD = P.torsoD;

    // ---- torso
    var body;
    var tShape = b.torso;
    if (sp === 'robot') body = mesh(VT.roundedBox(tW * 2.1, tH, tD * 2.1, 0.045 * S), bodyCol);
    else if (sp === 'penguin' || sp === 'ghost' || tShape === 'egg') body = mesh(SPH(), bodyCol);
    else if (tShape === 'box') body = mesh(VT.roundedBox(tW * 2, tH, tD * 2, 0.07 * S), bodyCol);
    else body = mesh(SPH(), bodyCol);
    body.name = 'body';
    if (body.geometry === SPH()) {
      var pear = tShape === 'pear' || tShape === 'dress' || tShape === 'coat' ? 1.08 : 1;
      at(body, 0, tH * 0.5, 0, tW * pear, tH * 0.58, tD);
    } else at(body, 0, tH * 0.5, 0);
    torso.add(body);
    if (sp === 'ghost') { body.scale.set(tW * 1.2, tH * 0.85, tD * 1.15); body.position.y = tH * 0.45; }
    if (sp === 'penguin') { body.scale.set(tW, tH * 0.62, tD); body.position.y = tH * 0.45; var belly = mesh(SPH(), fur2, { outline: false }); at(belly, 0, tH * 0.42, tD * 0.25, tW * 0.78, tH * 0.5, tD * 0.8); torso.add(belly); }
    if (['dog', 'cat', 'bear', 'rabbit', 'fox', 'frog', 'dino', 'ogre', 'alien'].indexOf(sp) >= 0 && fur2) {
      var tum = mesh(SPH(), fur2, { outline: false }); at(tum, 0, tH * 0.44, tD * 0.42, tW * 0.68, tH * 0.38, tD * 0.62); torso.add(tum);
    }
    if (tShape === 'dress') {
      var skirt = mesh(CYL(0.55), c.shirt); at(skirt, 0, -0.02 * S, 0, tW * 1.75, tH * 0.55, tD * 1.75); skirt.position.y = tH * 0.05; torso.add(skirt);
      skirt.name = 'skirt';
    }
    if (tShape === 'coat') {
      var coat = mesh(CYL(0.8), c.shirt); at(coat, 0, -0.04 * S, 0, tW * 1.25, tH * 0.6, tD * 1.25); torso.add(coat);
      var lap = mesh(VT.roundedBox(0.05 * S, tH * 0.5, 0.02 * S, 0.008 * S), shade(c.shirt, -0.12)); at(lap, -0.04 * S, tH * 0.62, tD * 0.93); rot(lap, 0, 0, 14); torso.add(lap);
      var lap2 = lap.clone(); lap2.position.x = 0.04 * S; lap2.rotation.z = -14 * D2R; torso.add(lap2);
    }
    this.torsoTop = tH * (sp === 'penguin' ? 0.86 : 0.98);

    // ---- neck + head
    var neck = this.neck = grp('neck', torso); neck.position.y = this.torsoTop;
    var head = this.head = grp('head', neck);
    var hR = P.headR;
    var headC = this.headC = sp === 'penguin' || sp === 'ghost' ? hR * 0.55 : hR * 0.88 + P.neck;
    head.position.y = 0;
    var hm = this.headMesh = grp('headShape', head); hm.position.y = headC;
    this._buildHead(hm, d, hR, S);

    // ---- arms
    this.arms = {};
    var self2 = this;
    [-1, 1].forEach(function (side) {
      var key = side < 0 ? 'l' : 'r';  // l = the character's left (screen right when facing us)
      var sh = new V3(side * (tW * (sp === 'penguin' ? 0.98 : 1.05)), tH * (sp === 'penguin' ? 0.62 : 0.8), 0);
      var upper = grp('arm_' + key + '_upper', torso); upper.position.copy(sh);
      var armCol = sp === 'human' || sp === 'robot' ? c.shirt : sp === 'penguin' ? skin : (sp === 'alien' || sp === 'ogre' ? skin : skin);
      if (sp === 'human' && d.build.torso === 'dress') armCol = skin;
      var ar = P.armR;
      var u = mesh(sp === 'penguin' ? SPH() : CAPS(ar, Math.max(0.001, P.upper - ar)), armCol); u.position.y = -P.upper / 2;
      if (sp === 'penguin') u.scale.set(0.035 * S, P.upper * 0.6, 0.06 * S);
      upper.add(u);
      var fore = grp('arm_' + key + '_fore', upper); fore.position.y = -P.upper;
      var fc = sp === 'human' && d.build.torso !== 'dress' && sp !== 'robot' ? (d.hat === 'knight' ? c.shirt : skin) : armCol;
      if (sp === 'robot') fc = c.pants;
      var f = mesh(sp === 'penguin' ? SPH() : CAPS(ar * 0.92, Math.max(0.001, P.fore - ar)), sp === 'penguin' ? skin : fc);
      if (sp === 'penguin') f.scale.set(0.03 * S, P.fore * 0.6, 0.05 * S);
      f.position.y = -P.fore / 2; fore.add(f);
      if (sp !== 'penguin') { var el = mesh(SPH(), armCol, { outline: false }); at(el, 0, 0, 0, ar * 0.98); fore.add(el); }
      var hand = grp('arm_' + key + '_hand', fore); hand.position.y = -P.fore;
      var gloves = d.acc.indexOf('gloves') >= 0;
      var handCol = gloves ? (c.gloves || '#f7f4ee') : sp === 'robot' ? c.accent : sp === 'penguin' ? skin : (sp === 'human' && (d.acc.indexOf('cape') >= 0 && d.hat === 'top') ? '#f7f4ee' : skin);
      var H = self2._buildHand(hand, handCol, S * (sp === 'dino' ? 0.75 : sp === 'penguin' ? 0.6 : 1) * (d.build.hand || 1), side, sp, gloves);
      self2.arms[key] = { side: side, shoulder: sh, upper: upper, fore: fore, hand: hand, a: P.upper, b: P.fore, H: H };
    });

    // ---- legs
    this.legs = {};
    [-1, 1].forEach(function (side) {
      var key = side < 0 ? 'l' : 'r';
      var thigh = grp('leg_' + key + '_thigh', hips); thigh.position.set(side * P.hipW, 0, 0);
      var shin = grp('leg_' + key + '_shin', thigh); shin.position.y = -P.thigh;
      var foot = grp('leg_' + key + '_foot', shin); foot.position.y = -P.shin;
      var legCol = sp === 'human' || sp === 'robot' || sp === 'alien' ? c.pants : skin;
      if (sp === 'human' && d.build.torso === 'dress') legCol = skin;
      if (sp === 'ghost') {
        if (side < 0) { var tail = mesh(CONE(), c.skin); at(tail, 0.08 * S, -P.thigh * 0.4, -0.02 * S, P.torsoW * 0.95, P.thigh * 1.6, P.torsoD * 0.9); tail.rotation.x = Math.PI; tail.rotation.z = 0.25; thigh.add(tail); }
      } else if (sp !== 'penguin') {
        var t = mesh(CAPS(P.legR, Math.max(0.001, P.thigh - P.legR)), legCol); t.position.y = -P.thigh / 2; thigh.add(t);
        var s = mesh(CAPS(P.legR * 0.9, Math.max(0.001, P.shin - P.legR)), sp === 'human' && d.build.torso === 'coat' ? c.pants : legCol); s.position.y = -P.shin / 2; shin.add(s);
      }
      if (sp !== 'ghost') {
        var shoeCol = sp === 'human' || sp === 'robot' || sp === 'penguin' || sp === 'alien' ? c.shoes : shade(skin, -0.06);
        var sh = mesh(SPH(), shoeCol); at(sh, 0, -P.foot * 0.15, 0.045 * S, 0.06 * S * (sp === 'penguin' ? 1.2 : 1), P.foot * 0.62, 0.1 * S); foot.add(sh);
      }
      self.legs[key] = { thigh: thigh, shin: shin, foot: foot, side: side };
    });

    // ---- clothes + accessories on the body
    this._buildBody(d, S);
    // ---- tails
    var tailCol = sp === 'fox' ? skin : skin;
    if (['dog', 'cat', 'fox', 'dino', 'rabbit', 'bear'].indexOf(sp) >= 0) {
      var tg = this.tail = grp('tail', hips); tg.position.set(0, 0.04 * S, -P.torsoD * 0.9);
      var tl;
      if (sp === 'rabbit' || sp === 'bear') { tl = mesh(SPH(), sp === 'rabbit' ? '#ffffff' : skin); at(tl, 0, 0, -0.03 * S, 0.06 * S); }
      else if (sp === 'fox') { tl = mesh(SPH(), skin); at(tl, 0, 0.06 * S, -0.16 * S, 0.08 * S, 0.08 * S, 0.2 * S); var tip = mesh(SPH(), fur2, { outline: false }); at(tip, 0, 0, -0.85, 0.7, 0.7, 0.35); tl.add(tip); }
      else if (sp === 'dino') { tl = mesh(CONE(), skin); at(tl, 0, -0.04 * S, -0.2 * S, 0.1 * S, 0.42 * S, 0.1 * S); tl.rotation.x = -100 * D2R; }
      else { tl = mesh(CAPS(0.025 * S, 0.3 * S), skin); at(tl, 0, 0.13 * S, -0.06 * S); tl.rotation.x = -30 * D2R; }
      tg.add(tl);
    }

    // rest pose targets (actor space)
    this.headRest = new V3(0, P.hipY + this.torsoTop + headC, 0);
    this.height = this.headRest.y + hR;
    this.eyeY = this.headRest.y + hR * 0.12;
    var shY = P.hipY + tH * 0.8;
    this.handRest = {
      l: new V3(-tW * 1.25, shY - P.upper - P.fore * 0.92, 0.05 * S),
      r: new V3(tW * 1.25, shY - P.upper - P.fore * 0.92, 0.05 * S)
    };
    this.face = this.face || {};
    this._blinkSeed = (d.id || 'x').split('').reduce(function (a, ch) { return a + ch.charCodeAt(0); }, 0) % 97;
    this.setPose({});
  }

  /* ---- the head: shape, ears, eyes, lids, brows, mouth, nose, hair, hats, face accessories */
  Actor.prototype._buildHead = function (hm, d, hR, S) {
    var c = d.colors, sp = d.species, f = this.face = {}, FX = d.face || FACE0;
    var skin = c.skin, fur2 = c.fur2;
    var rx = hR, ry = hR * 0.94, rz = hR * 0.92;
    var shape;
    if (sp === 'robot') { shape = mesh(VT.roundedBox(hR * 2.05, hR * 1.75, hR * 1.8, 0.07 * S), skin); }
    else if (sp === 'frog') { rx = hR * 1.22; ry = hR * 0.78; shape = mesh(SPH(), skin); at(shape, 0, 0, 0, rx, ry, rz); }
    else if (sp === 'alien') { ry = hR * 1.12; shape = mesh(SPH(), skin); at(shape, 0, hR * 0.1, 0, rx * 0.95, ry, rz * 0.95); }
    else if (sp === 'ghost') { ry = hR * 1.05; shape = mesh(SPH(), skin); at(shape, 0, 0, 0, rx, ry, rz); }
    else if (sp === 'penguin') { shape = mesh(SPH(), skin); at(shape, 0, 0, 0, rx, ry, rz); var mask = mesh(SPH(), fur2, { outline: false }); at(mask, 0, -0.05, 0.42, 0.78, 0.7, 0.6); shape.add(mask); }
    else if (sp === 'ogre') { rx = hR * 1.08; shape = mesh(SPH(), skin); at(shape, 0, 0, 0, rx, ry, rz); }
    else { shape = mesh(SPH(), skin); at(shape, 0, 0, 0, rx, ry, rz); }
    shape.name = 'head_shape';
    hm.add(shape);
    this.headR = hR;
    var front = rz;
    var self = this;
    function onFace(yaw, pitch, out) {  // a point on the head's surface, yaw/pitch in degrees from straight ahead
      var y = yaw * D2R, p = pitch * D2R;
      return new V3(Math.sin(y) * Math.cos(p) * rx * (out || 1), Math.sin(p) * ry * (out || 1), Math.cos(y) * Math.cos(p) * rz * (out || 1));
    }
    // snout / muzzle
    var snoutZ = 0, mouthY = -0.42, mouthYaw = 0;
    if (['dog', 'bear', 'fox', 'dino', 'cat', 'rabbit', 'ogre'].indexOf(sp) >= 0) {
      var sn = { dog: [0.48, 0.38, 0.42, -0.25], bear: [0.42, 0.33, 0.36, -0.28], fox: [0.34, 0.26, 0.5, -0.3], dino: [0.56, 0.36, 0.58, -0.2], cat: [0.36, 0.24, 0.2, -0.3], rabbit: [0.32, 0.22, 0.18, -0.28], ogre: [0.48, 0.32, 0.26, -0.3] }[sp];
      var snout = mesh(SPH(), sp === 'dino' || sp === 'ogre' ? shade(skin, 0.04) : fur2);
      if (sp === 'fox') { snout = mesh(SPH(), fur2); }
      at(snout, 0, sn[3] * hR, front * 0.72 + sn[2] * hR * 0.5, sn[0] * hR, sn[1] * hR, (0.3 + sn[2]) * hR);
      hm.add(snout);
      snoutZ = snout.position.z + snout.scale.z * 0.85;
      var noseCol = sp === 'ogre' || sp === 'dino' ? shade(skin, -0.12) : sp === 'cat' || sp === 'rabbit' ? '#ff8fab' : '#1d1416';
      var nose = mesh(SPH(), noseCol), nk = FX.nose == null ? 1 : FX.nose;
      at(nose, 0, snout.position.y + sn[1] * hR * 0.45, snoutZ - 0.01 * S, (sp === 'cat' || sp === 'rabbit' ? 0.06 : 0.11) * hR * nk, 0.06 * hR * nk, 0.06 * hR * nk);
      if (nk > 0.05) hm.add(nose);
      mouthY = (snout.position.y - sn[1] * hR * 0.35) / ry;
      f.mouthZ = snoutZ - 0.035 * S;
    }
    // ears
    function ear(side, kind) {
      var g = grp('ear', hm), e, inner;
      if (kind === 'round') { e = mesh(SPH(), skin); at(e, 0, 0, 0, 0.3 * hR, 0.3 * hR, 0.14 * hR); inner = mesh(SPH(), fur2, { outline: false }); at(inner, 0, 0, 0.5, 0.6, 0.6, 0.5); e.add(inner); g.position.set(side * rx * 0.72, ry * 0.72, 0); }
      else if (kind === 'point') { e = mesh(CONE(), skin); at(e, 0, 0.18 * hR, 0, 0.26 * hR, 0.5 * hR, 0.12 * hR); inner = mesh(CONE(), sp === 'fox' ? '#2a1a10' : fur2, { outline: false }); at(inner, 0, -0.05, 0.4, 0.62, 0.8, 0.5); e.add(inner); g.position.set(side * rx * 0.58, ry * 0.8, 0); g.rotation.z = -side * 18 * D2R; }
      else if (kind === 'long') { e = mesh(CAPS(0.11 * hR, 0.75 * hR), skin); e.position.y = 0.5 * hR; e.scale.z = 0.5; inner = mesh(CAPS(0.07 * hR, 0.6 * hR), fur2, { outline: false }); inner.position.z = 0.08 * hR; e.add(inner); g.position.set(side * rx * 0.36, ry * 0.85, -0.05 * hR); g.rotation.z = -side * 10 * D2R; }
      else if (kind === 'flop') { e = mesh(SPH(), shade(skin, -0.1)); at(e, 0, -0.3 * hR, 0, 0.2 * hR, 0.42 * hR, 0.1 * hR); g.position.set(side * rx * 0.86, ry * 0.45, -0.05 * hR); g.rotation.z = side * 18 * D2R; }
      else if (kind === 'human') { e = mesh(SPH(), skin); at(e, 0, 0, 0, 0.1 * hR, 0.17 * hR, 0.08 * hR); g.position.set(side * rx * 0.97, -0.02 * hR, -0.04 * hR); }
      else if (kind === 'horn') { e = mesh(CONE(), c.accent); at(e, 0, 0.18 * hR, 0, 0.11 * hR, 0.38 * hR, 0.11 * hR); g.position.set(side * rx * 0.52, ry * 0.78, 0); g.rotation.z = -side * 22 * D2R; }
      else if (kind === 'antenna') { e = mesh(CYL(1, 8), INK, { outline: false }); at(e, 0, 0.22 * hR, 0, 0.012 * S, 0.45 * hR, 0.012 * S); var ball = mesh(SPH(), c.accent); at(ball, 0, 0.47 * hR, 0, 0.07 * hR); g.add(ball); g.position.set(side * rx * 0.35, ry * 0.92, 0); g.rotation.z = -side * 20 * D2R; }
      if (e) g.add(e);
      g.scale.multiplyScalar(FX.earSize || 1);
      return g;
    }
    var earKind = { human: 'human', dog: 'flop', cat: 'point', bear: 'round', rabbit: 'long', fox: 'point', ogre: 'horn', alien: 'antenna' }[sp];
    if (FX.ears && FX.ears !== 'auto') earKind = FX.ears === 'none' ? null : FX.ears;
    var hidden = (sp === 'human' && (d.hat === 'space' || d.hat === 'knight')) || (earKind === 'human' && sp === 'human' && (d.hair === 'long' || d.hair === 'bob'));
    if (earKind && !hidden) { ear(-1, earKind); ear(1, earKind); }
    if (sp === 'ogre' && (!FX.ears || FX.ears === 'auto')) { ear(-1, 'human'); ear(1, 'human'); }
    if (sp === 'robot') {
      var ant = grp('antenna', hm); ant.position.y = hR * 0.85;
      var stick = mesh(CYL(1, 8), INK, { outline: false }); at(stick, 0, 0.1 * hR, 0, 0.012 * S, 0.22 * hR, 0.012 * S); ant.add(stick);
      var bulb = mesh(SPH(), c.accent, { emissive: c.accent, ei: 0.6 }); at(bulb, 0, 0.25 * hR, 0, 0.07 * hR); ant.add(bulb);
      [-1, 1].forEach(function (s) { var bolt = mesh(CYL(1, 16), c.fur2); at(bolt, s * rx * 1.02, 0, 0, 0.12 * hR, 0.08 * hR, 0.12 * hR); bolt.rotation.z = Math.PI / 2; hm.add(bolt); });
    }
    if (sp === 'dino') {
      for (var k = 0; k < 4; k++) { var sp1 = mesh(CONE(), c.accent); at(sp1, 0, ry * (0.92 - k * 0.32), -rz * (0.25 + k * 0.28), 0.06 * hR, 0.16 * hR, 0.06 * hR); sp1.rotation.x = -(30 + k * 25) * D2R; hm.add(sp1); }
    }
    if (sp === 'ogre') {
      [-1, 1].forEach(function (s) { var t = mesh(CONE(), '#fff8e1'); at(t, s * 0.1 * hR, mouthY * ry + 0.08 * hR, (f.mouthZ || front) + 0.0, 0.035 * hR, 0.1 * hR, 0.035 * hR); hm.add(t); });
    }

    // eyes
    var eyeYaw = sp === 'frog' ? 34 : sp === 'alien' ? 27 : sp === 'robot' ? 25 : sp === 'penguin' ? 23 : 25;
    var eyePitch = sp === 'frog' ? 48 : sp === 'robot' ? 10 : sp === 'alien' ? 6 : ['dog', 'bear', 'fox', 'dino', 'cat', 'rabbit', 'ogre'].indexOf(sp) >= 0 ? 18 : 8;
    var eyeR = (sp === 'alien' ? 0.27 : sp === 'frog' ? 0.25 : sp === 'robot' ? 0.26 : sp === 'ghost' ? 0.2 : 0.205) * hR;
    var eyeTall = sp === 'alien' ? 1.35 : sp === 'ghost' ? 1.4 : 1.12;
    eyeR *= FX.eyes || 1; eyeYaw *= FX.spread || 1; eyePitch += (FX.lift || 0) * 10; eyeTall *= FX.tall || 1;
    f.eyes = [];
    [-1, 1].forEach(function (side) {
      var pos = onFace(side * eyeYaw, eyePitch, sp === 'frog' ? 1.02 : 0.94);
      var eg = grp('eye_' + (side < 0 ? 'l' : 'r'), hm);
      eg.position.copy(pos);
      eg.lookAt(new V3(pos.x * 0.35, pos.y, pos.z + 4));
      var sock = grp('', eg);  // eye at origin facing +Z
      var white = mesh(SPH(), sp === 'robot' ? '#0d2a30' : '#ffffff', { ow: 0.0026 });
      at(white, 0, 0, 0, eyeR, eyeR * eyeTall, eyeR * 0.8);
      sock.add(white);
      var ball = grp('', sock);  // rotates for gaze
      var irisCol = sp === 'robot' ? c.eyes : c.eyes;
      var iris = mesh(SPH(), irisCol, { outline: false, emissive: sp === 'robot' ? c.eyes : null });
      at(iris, 0, 0, eyeR * 0.68, eyeR * 0.56, eyeR * 0.56 * eyeTall, eyeR * 0.22);
      ball.add(iris);
      var pupil = mesh(SPH(), sp === 'robot' ? '#ffffff' : '#0c0809', { outline: false, basic: sp === 'robot' });
      at(pupil, 0, 0, eyeR * 0.82, eyeR * 0.3, eyeR * 0.3 * eyeTall, eyeR * 0.1);
      ball.add(pupil);
      var shine = mesh(SPH(), '#ffffff', { outline: false, basic: true });
      at(shine, eyeR * 0.16, eyeR * 0.2, eyeR * 0.88, eyeR * 0.11, eyeR * 0.11, eyeR * 0.05);
      ball.add(shine);
      // upper lid: a dome over the eye (rotates down to blink)
      var lid = grp('lid', sock);
      var lm = mesh(DOME(), sp === 'robot' ? shade(skin, -0.15) : sp === 'penguin' ? skin : skin, { ow: 0.0026 });
      at(lm, 0, 0, 0, eyeR * 1.1, eyeR * eyeTall * 1.1, eyeR * 0.9);
      lid.add(lm);
      if (FX.lashes) {  // three lashes on the lid's rim, outer side longest (they blink with the lid)
        for (var li = 0; li < 3; li++) {
          var la = (side * (10 + li * 26)) * D2R;
          var lash = mesh(CAPS(0.0045 * S, eyeR * (0.22 + li * 0.08)), INK, { outline: false, basic: true });
          lash.position.set(Math.sin(la) * eyeR * 1.08, eyeR * 0.06, Math.cos(la) * eyeR * 0.88);
          lash.rotation.set(-35 * D2R, 0, -side * (20 + li * 22) * D2R);
          lid.add(lash);
        }
      }
      // brow
      var brow = grp('brow', hm);
      var bp = onFace(side * eyeYaw * 0.95, eyePitch + (sp === 'frog' ? 18 : 24), 1.0);
      brow.position.copy(bp);
      brow.lookAt(new V3(bp.x * 0.3, bp.y, bp.z + 4));
      var bm = mesh(CAPS(0.024 * hR / 0.23 * (sp === 'human' ? 1 : 0.85) * (FX.brows == null ? 1 : FX.brows), eyeR * 0.95), sp === 'human' ? c.hair : shade(skin, -0.28), { outline: false });
      if (FX.brows != null && FX.brows < 0.15) bm.visible = false;
      bm.rotation.z = Math.PI / 2; bm.scale.set(1, 1, 0.6);
      var bpiv = grp('', brow); bpiv.add(bm);
      f.eyes.push({ side: side, g: eg, ball: ball, pupil: pupil, iris: iris, lid: lid, brow: brow, bpiv: bpiv, browY0: 0, eyeR: eyeR, tall: eyeTall });
    });
    if (sp === 'alien') {  // a third eye, of course
      var e3 = grp('eye_c', hm), p3 = onFace(0, 34, 0.92); e3.position.copy(p3); e3.lookAt(new V3(0, p3.y + 0.2, p3.z + 4));
      var w3 = mesh(SPH(), '#ffffff', { ow: 0.0024 }); at(w3, 0, 0, 0, eyeR * 0.6); e3.add(w3);
      var p3m = mesh(SPH(), '#0c0809', { outline: false }); at(p3m, 0, 0, eyeR * 0.45, eyeR * 0.25, eyeR * 0.25, eyeR * 0.15); e3.add(p3m);
    }

    // mouth
    var mz = f.mouthZ || onFace(0, mouthY * 60, 0.95).z;
    var my = sp === 'robot' ? -0.42 * hR : mouthY * ry;
    if (sp === 'frog') { my = -0.18 * ry; mz = rz * 0.97; }
    if (sp === 'penguin') { my = -0.18 * hR; }
    if (sp === 'ghost' || sp === 'alien' || sp === 'human') { my = (sp === 'human' ? -0.43 : -0.38) * ry; mz = Math.sqrt(Math.max(0.0001, 1 - (my * my) / (ry * ry))) * rz * 0.97; }
    var mg = this.mouth = grp('mouth', hm);
    mg.position.set(0, my, mz);
    var mw = (sp === 'frog' ? 0.52 : sp === 'ogre' ? 0.42 : sp === 'robot' ? 0.4 : 0.3) * hR * (FX.mouth || 1);
    var hole = mesh(SPH(), sp === 'robot' ? '#0d2a30' : '#5a1420', { outline: false });
    at(hole, 0, 0, -0.012 * S, mw, 0.001, 0.04 * S);
    mg.add(hole);
    var tongue = mesh(SPH(), sp === 'robot' ? c.eyes : '#e8566b', { outline: false, emissive: sp === 'robot' ? c.eyes : null });
    at(tongue, 0, -0.2, 0.2, 0.55, 0.35, 0.5);
    hole.add(tongue);
    var line = mesh(TOR(mw * 0.62, 0.0085 * S, Math.PI), INK, { outline: false, basic: true });
    mg.add(line);
    f.mouth = { g: mg, hole: hole, line: line, w: mw };
    if (sp === 'penguin') {  // beak over the mouth
      var beak = mesh(CONE(), '#ff9f1a'); at(beak, 0, -0.05 * hR, rz * 1.02, 0.14 * hR, 0.3 * hR, 0.08 * hR); beak.rotation.x = 90 * D2R; hm.add(beak);
    }
    if (sp === 'human' || sp === 'alien' || sp === 'ogre') {
      var nose2 = mesh(SPH(), sp === 'human' ? shade(skin, -0.04) : shade(skin, -0.05));
      var np = onFace(0, -8, 0.98);
      at(nose2, 0, np.y, np.z, 0.075 * hR, 0.08 * hR, 0.09 * hR);
      if (sp === 'ogre') nose2.scale.multiplyScalar(1.6);
      var nk2 = FX.nose == null ? 1 : FX.nose;
      nose2.scale.multiplyScalar(nk2);
      if (nk2 > 0.05) hm.add(nose2);
    }
    if (FX.freckles) {  // a few dots across each cheek
      [-1, 1].forEach(function (side) {
        [[34, -12], [42, -6], [46, -17], [38, -21], [50, -10]].forEach(function (yp) {
          var fp = onFace(side * yp[0], yp[1], 1.0), dot = mesh(SPH(), shade(skin, -0.2), { outline: false });
          at(dot, fp.x, fp.y, fp.z, 0.016 * hR, 0.016 * hR, 0.008 * hR); dot.lookAt(fp.clone().multiplyScalar(2)); hm.add(dot);
        });
      });
    }
    // blush, tear, sweat (shown by emotions)
    f.blush = [];
    [-1, 1].forEach(function (side) {
      var bl = mesh(SPH(), '#ff7b9c', { outline: false, opacity: 0.75 });
      var bp2 = onFace(side * 42, -14, 0.97);
      at(bl, bp2.x, bp2.y, bp2.z, 0.09 * hR, 0.05 * hR, 0.02 * hR);
      bl.lookAt(bp2.clone().multiplyScalar(2));
      bl.visible = false; hm.add(bl); f.blush.push(bl);
    });
    var tear = mesh(SPH(), '#6ec6ff', { ow: 0.002 });
    var tp = onFace(-eyeYaw - 6, eyePitch - 22, 1.0);
    at(tear, tp.x, tp.y, tp.z, 0.035 * hR, 0.055 * hR, 0.03 * hR); tear.visible = false; hm.add(tear); f.tear = tear; f.tearY = tp.y;
    var sweat = mesh(SPH(), '#bfe9ff', { ow: 0.002 });
    var swp = onFace(48, 40, 1.03); at(sweat, swp.x, swp.y, swp.z, 0.04 * hR, 0.065 * hR, 0.03 * hR); sweat.visible = false; hm.add(sweat); f.sweat = sweat;
    if (sp === 'cat') {  // whiskers
      [-1, 1].forEach(function (s) {
        for (var w = 0; w < 2; w++) {
          var wh = mesh(CYL(1, 6), INK, { outline: false, basic: true }); at(wh, s * 0.3 * hR, -0.27 * hR - w * 0.05 * hR, (f.mouthZ || front) + 0.0, 0.004 * S, 0.34 * hR, 0.004 * S);
          wh.rotation.z = s * (80 + w * 12) * D2R; hm.add(wh);
        }
      });
    }

    this._buildHair(hm, d, hR, rx, ry, rz, S);
    this._buildHat(hm, d, hR, rx, ry, rz, S);
    this._buildFaceAcc(hm, d, hR, rx, ry, rz, S, onFace, eyeYaw, eyePitch, eyeR);
  };

  Actor.prototype._buildHair = function (hm, d, hR, rx, ry, rz, S) {
    if (d.species !== 'human' || d.hair === 'none' || d.hat === 'space' || d.hat === 'knight') return;
    var col = d.colors.hair, h = d.hair, g = grp('hair', hm), m;
    var hatted = d.hat && d.hat !== 'none' && d.hat !== 'bow' && d.hat !== 'headphones';
    function cap(scaleY, lift) {
      var cp = mesh(DOME(), col); at(cp, 0, (lift || 0.16) * hR, -0.06 * hR, rx * 1.06, ry * (scaleY || 0.78), rz * 1.06); cp.rotation.x = -18 * D2R; g.add(cp); return cp;
    }
    if (h === 'short' || h === 'slick') { cap(h === 'slick' ? 0.75 : 0.85); if (h === 'slick') { m = mesh(SPH(), col); at(m, 0.22 * hR, 0.62 * hR, 0.6 * hR, 0.32 * hR, 0.14 * hR, 0.22 * hR); m.rotation.z = -20 * D2R; g.add(m); } }
    if (h === 'spiky') {
      cap(0.8);
      if (!hatted) for (var i = 0; i < 7; i++) { var a = (i - 3) * 22; m = mesh(CONE(), col); at(m, Math.sin(a * D2R) * 0.5 * hR, 0.85 * hR - Math.abs(i - 3) * 0.04 * hR, 0.15 * hR - Math.abs(i - 3) * 0.06 * hR, 0.14 * hR, 0.42 * hR, 0.14 * hR); m.rotation.z = -a * 0.9 * D2R; m.rotation.x = -18 * D2R; g.add(m); }
      m = mesh(CONE(), col); at(m, 0.12 * hR, 0.7 * hR, 0.78 * hR, 0.12 * hR, 0.3 * hR, 0.12 * hR); m.rotation.x = 70 * D2R; m.rotation.z = -25 * D2R; g.add(m);
    }
    if (h === 'bob' || h === 'long') {
      var shell = mesh(SPH(), col); at(shell, 0, 0.02 * hR, -0.1 * hR, rx * 1.14, ry * 1.06, rz * 1.02); g.add(shell);
      var bang = mesh(SPH(), col); at(bang, 0, 0.58 * hR, 0.5 * hR, rx * 0.9, ry * 0.32, rz * 0.48); bang.rotation.x = 20 * D2R; g.add(bang);
      [-1, 1].forEach(function (s) { var side = mesh(SPH(), col); at(side, s * rx * 0.88, -0.3 * hR, 0.05 * hR, 0.26 * hR, 0.52 * hR, 0.42 * hR); g.add(side); });
      if (h === 'long') { var back = mesh(CAPS(0.42 * hR, 0.7 * hR), col); back.position.set(0, -0.55 * hR, -0.32 * hR); back.scale.set(1.05, 1, 0.6); g.add(back); }
    }
    if (h === 'bun') { cap(0.86); m = mesh(SPH(), col); at(m, 0, 0.9 * hR, -0.35 * hR, 0.34 * hR); g.add(m); }
    if (h === 'curly' || h === 'afro') {
      var n = h === 'afro' ? 16 : 11, R = h === 'afro' ? 1.3 : 1.02;
      for (var j = 0; j < n; j++) {
        var th = (j / n) * Math.PI * 2, ph = (j % 2 ? 0.55 : 0.25) * Math.PI;
        m = mesh(SPH(), col);
        at(m, Math.cos(th) * Math.sin(ph) * rx * R, Math.cos(ph) * ry * R * 0.9 + 0.12 * hR, Math.sin(th) * Math.sin(ph) * rz * R - 0.12 * hR, (h === 'afro' ? 0.42 : 0.3) * hR);
        if (m.position.z > 0.35 * hR && m.position.y < 0.4 * hR) continue;
        g.add(m);
      }
      cap(0.86);
    }
    if (h === 'mohawk') { for (var k = 0; k < 5; k++) { m = mesh(CONE(), col); at(m, 0, 0.95 * hR - Math.abs(k - 2) * 0.05 * hR, (0.45 - k * 0.24) * hR, 0.09 * hR, 0.5 * hR, 0.18 * hR); m.rotation.x = (k - 2) * -18 * D2R; g.add(m); } }
    if (h === 'pigtails') { cap(0.86); [-1, 1].forEach(function (s) { var p = mesh(SPH(), col); at(p, s * rx * 1.12, 0.1 * hR, -0.2 * hR, 0.22 * hR, 0.32 * hR, 0.22 * hR); g.add(p); }); }
  };

  Actor.prototype._buildHat = function (hm, d, hR, rx, ry, rz, S) {
    var h = d.hat, c = d.colors, g = grp('hat', hm), m;
    var hc = function (dflt) { return c.hat || dflt; };  // the editor's hat colour, else the hat's own
    var top = ry * 0.95;
    if (h === 'top') {
      m = mesh(CYL(1), hc('#151214')); at(m, 0, top + 0.32 * hR, -0.04 * hR, 0.58 * hR, 0.7 * hR, 0.58 * hR); g.add(m);
      m = mesh(CYL(1), hc('#151214')); at(m, 0, top - 0.02 * hR, -0.04 * hR, 0.95 * hR, 0.05 * hR, 0.95 * hR); g.add(m);
      m = mesh(CYL(1), c.accent, { outline: false }); at(m, 0, top + 0.06 * hR, -0.04 * hR, 0.595 * hR, 0.1 * hR, 0.595 * hR); g.add(m);
      g.rotation.z = -6 * D2R;
    } else if (h === 'fedora') {
      m = mesh(CYL(0.85), hc('#5b5560')); at(m, 0, top + 0.16 * hR, 0, 0.72 * hR, 0.42 * hR, 0.72 * hR); g.add(m);
      m = mesh(CYL(1), hc('#5b5560')); at(m, 0, top - 0.04 * hR, 0, 1.18 * hR, 0.04 * hR, 1.18 * hR); g.add(m);
      m = mesh(CYL(1), '#1d1416', { outline: false }); at(m, 0, top + 0.03 * hR, 0, 0.705 * hR, 0.09 * hR, 0.705 * hR); g.add(m);
      g.rotation.set(-8 * D2R, 0, 8 * D2R);
    } else if (h === 'cowboy') {
      m = mesh(CYL(0.85), hc('#8a5a2b')); at(m, 0, top + 0.18 * hR, 0, 0.66 * hR, 0.42 * hR, 0.7 * hR); g.add(m);
      m = mesh(TOR(1.0 * hR, 0.1 * hR), hc('#8a5a2b')); at(m, 0, top - 0.02 * hR, 0); m.rotation.x = Math.PI / 2; m.scale.set(1.15, 1, 2.2); g.add(m);
      m = mesh(CYL(1), hc('#8a5a2b')); at(m, 0, top - 0.04 * hR, 0, 1.15 * hR, 0.035 * hR, 1.15 * hR); g.add(m);
      m = mesh(CYL(1), '#3a2414', { outline: false }); at(m, 0, top + 0.03 * hR, 0, 0.665 * hR, 0.08 * hR, 0.705 * hR); g.add(m);
    } else if (h === 'beret') {
      m = mesh(SPH(), c.accent); at(m, 0.1 * hR, top + 0.08 * hR, -0.04 * hR, 0.95 * hR, 0.26 * hR, 0.92 * hR); m.rotation.z = -14 * D2R; g.add(m);
      m = mesh(CYL(1, 8), c.accent); at(m, 0.12 * hR, top + 0.34 * hR, -0.04 * hR, 0.04 * hR, 0.1 * hR, 0.04 * hR); g.add(m);
    } else if (h === 'crown') {
      m = mesh(CYL(1, 24), hc('#f2c14e')); at(m, 0, top + 0.1 * hR, 0, 0.55 * hR, 0.22 * hR, 0.55 * hR); g.add(m);
      for (var i = 0; i < 6; i++) { var a = i / 6 * Math.PI * 2; var p = mesh(CONE(), hc('#f2c14e')); at(p, Math.sin(a) * 0.48 * hR, top + 0.3 * hR, Math.cos(a) * 0.48 * hR, 0.1 * hR, 0.22 * hR, 0.1 * hR); g.add(p); }
      m = mesh(SPH(), '#d7263d', { outline: false }); at(m, 0, top + 0.12 * hR, 0.55 * hR, 0.07 * hR); g.add(m);
    } else if (h === 'space') {
      m = mesh(SPH(), '#bfe6ff', { opacity: 0.28 }); at(m, 0, 0.04 * hR, 0, rx * 1.38, ry * 1.38, rz * 1.38); g.add(m);
      m = mesh(TOR(rx * 1.18, 0.08 * hR), c.shirt); at(m, 0, -ry * 0.98, 0); m.rotation.x = Math.PI / 2; g.add(m);
      m = mesh(SPH(), c.accent); at(m, rx * 1.2, 0.2 * hR, 0, 0.1 * hR); g.add(m);
    } else if (h === 'witch') {
      m = mesh(CONE(), hc('#2d1b3d')); at(m, 0, top + 0.5 * hR, -0.06 * hR, 0.62 * hR, 1.15 * hR, 0.62 * hR); m.rotation.set(-12 * D2R, 0, 10 * D2R); g.add(m);
      m = mesh(CYL(1), hc('#2d1b3d')); at(m, 0, top - 0.02 * hR, -0.02 * hR, 1.25 * hR, 0.035 * hR, 1.25 * hR); g.add(m);
      m = mesh(CYL(1), c.accent, { outline: false }); at(m, 0, top + 0.05 * hR, -0.02 * hR, 0.6 * hR, 0.08 * hR, 0.6 * hR); g.add(m);
    } else if (h === 'chef') {
      m = mesh(CYL(1), hc('#ffffff')); at(m, 0, top + 0.18 * hR, -0.02 * hR, 0.7 * hR, 0.42 * hR, 0.7 * hR); g.add(m);
      [-0.32, 0, 0.32].forEach(function (x) { var p = mesh(SPH(), hc('#ffffff')); at(p, x * hR, top + 0.52 * hR, -0.02 * hR, 0.38 * hR); g.add(p); });
    } else if (h === 'cap') {
      m = mesh(DOME(), c.accent); at(m, 0, top - 0.12 * hR, -0.02 * hR, rx * 1.06, ry * 0.62, rz * 1.06); g.add(m);
      m = mesh(CYL(1), c.accent); at(m, 0, top - 0.1 * hR, -rz * 1.1, 0.5 * hR, 0.035 * hR, 0.52 * hR); m.scale.x *= 1.2; g.add(m);
    } else if (h === 'police') {
      m = mesh(CYL(1.15), hc('#1d2f5a')); at(m, 0, top + 0.06 * hR, 0, 0.8 * hR, 0.3 * hR, 0.8 * hR); g.add(m);
      m = mesh(CYL(1), '#111111'); at(m, 0, top - 0.06 * hR, 0.42 * hR, 0.5 * hR, 0.035 * hR, 0.42 * hR); g.add(m);
      m = mesh(SPH(), '#e8b54a', { outline: false }); at(m, 0, top + 0.08 * hR, 0.78 * hR, 0.1 * hR, 0.1 * hR, 0.04 * hR); g.add(m);
    } else if (h === 'knight') {
      m = mesh(SPH(), hc('#b9c2cc')); at(m, 0, 0.06 * hR, -0.02 * hR, rx * 1.12, ry * 1.12, rz * 1.12); g.add(m);
      m = mesh(VT.roundedBox(1.6 * hR, 0.14 * hR, 0.3 * hR, 0.05 * hR), '#6b7480'); at(m, 0, 0.18 * hR, rz * 0.92); g.add(m);
      m = mesh(SPH(), d.colors.accent); at(m, 0, ry * 1.2, -0.25 * hR, 0.16 * hR, 0.4 * hR, 0.45 * hR); m.rotation.x = -30 * D2R; g.add(m);
      this._visor = true;
    } else if (h === 'bow') {
      [-1, 1].forEach(function (s) { var b = mesh(CONE(), c.accent); at(b, s * 0.2 * hR, top + 0.1 * hR, 0.1 * hR, 0.16 * hR, 0.3 * hR, 0.1 * hR); b.rotation.z = s * 90 * D2R; g.add(b); });
      m = mesh(SPH(), c.accent); at(m, 0, top + 0.1 * hR, 0.1 * hR, 0.07 * hR); g.add(m);
      g.rotation.z = -25 * D2R;
    } else if (h === 'headphones') {
      m = mesh(TOR(rx * 1.05, 0.05 * hR, Math.PI), hc('#222222')); at(m, 0, 0.1 * hR, 0); g.add(m);
      [-1, 1].forEach(function (s) { var e = mesh(CYL(1), c.accent); at(e, s * rx * 1.05, 0.05 * hR, 0, 0.25 * hR, 0.14 * hR, 0.25 * hR); e.rotation.z = Math.PI / 2; g.add(e); });
    }
  };

  Actor.prototype._buildFaceAcc = function (hm, d, hR, rx, ry, rz, S, onFace, eyeYaw, eyePitch, eyeR) {
    var acc = d.acc, c = d.colors, m;
    var eye = this.face.eyes;
    if (acc.indexOf('glasses') >= 0 || acc.indexOf('shades') >= 0) {
      var shades = acc.indexOf('shades') >= 0;
      eye.forEach(function (e) {
        var ring = mesh(TOR(e.eyeR * 1.25, 0.018 * hR, 0), shades ? '#151214' : '#3a2a1a', { outline: false });
        e.g.add(ring); ring.position.z = e.eyeR * 0.85;
        if (shades) { var lens = mesh(SPH(), '#151214', { outline: false }); at(lens, 0, 0, e.eyeR * 0.85, e.eyeR * 1.25, e.eyeR * 1.2, 0.01 * S); e.g.add(lens); }
      });
      var p = onFace(0, eyePitch, 1.02); m = mesh(CYL(1, 8), '#3a2a1a', { outline: false }); at(m, p.x, p.y, p.z, 0.012 * hR, eyeR * 0.9, 0.012 * hR); m.rotation.z = Math.PI / 2; hm.add(m);
    }
    if (acc.indexOf('monocle') >= 0) {
      var e0 = eye[1]; m = mesh(TOR(e0.eyeR * 1.3, 0.02 * hR, 0), '#e8b54a', { outline: false }); m.position.z = e0.eyeR * 0.85; e0.g.add(m);
      var ch = mesh(CYL(1, 6), '#e8b54a', { outline: false }); at(ch, e0.eyeR * 1.2, -e0.eyeR * 2.2, e0.eyeR * 0.6, 0.005 * S, e0.eyeR * 3, 0.005 * S); e0.g.add(ch);
    }
    if (acc.indexOf('mustache') >= 0) {
      var mo = this.mouth;
      [-1, 1].forEach(function (s) { var t = mesh(SPH(), c.hair || '#2a1a10'); at(t, s * 0.13 * hR, mo.position.y + 0.11 * hR, mo.position.z + 0.02 * hR, 0.17 * hR, 0.07 * hR, 0.06 * hR); t.rotation.z = s * -12 * D2R; hm.add(t); var curl = mesh(SPH(), c.hair || '#2a1a10'); at(curl, s * 0.29 * hR, mo.position.y + 0.15 * hR, mo.position.z - 0.02 * hR, 0.05 * hR); hm.add(curl); });
    }
    if (acc.indexOf('beard') >= 0) {
      m = mesh(SPH(), c.hair); at(m, 0, -0.62 * hR, 0.45 * hR, 0.55 * hR, 0.42 * hR, 0.38 * hR); hm.add(m);
    }
  };

  Actor.prototype._buildBody = function (d, S) {
    var acc = d.acc, c = d.colors, P = this.P, t = this.torso, m, tH = P.torsoH, tW = P.torsoW, tD = P.torsoD;
    var neckY = this.torsoTop;
    if (acc.indexOf('bowtie') >= 0) {
      var g = grp('bowtie', t); g.position.set(0, neckY - 0.03 * S, tD * 0.95);
      [-1, 1].forEach(function (s) { var b = mesh(CONE(), c.accent); at(b, s * 0.04 * S, 0, 0, 0.035 * S, 0.07 * S, 0.025 * S); b.rotation.z = s * 90 * D2R; g.add(b); });
      m = mesh(SPH(), c.accent); at(m, 0, 0, 0.005 * S, 0.02 * S); g.add(m);
    }
    if (acc.indexOf('tie') >= 0) { m = mesh(VT.roundedBox(0.05 * S, tH * 0.55, 0.015 * S, 0.006 * S), c.accent); at(m, 0, neckY - tH * 0.3, tD * 0.98); t.add(m); }
    if (acc.indexOf('collar') >= 0) { m = mesh(TOR(tW * 0.62, 0.02 * S), c.accent); at(m, 0, neckY - 0.01 * S, 0); m.rotation.x = Math.PI / 2; m.scale.set(1, tD / tW, 1); t.add(m);
      if (d.species === 'dog' || d.species === 'cat') { var bell = mesh(SPH(), '#f2c14e'); at(bell, 0, neckY - 0.045 * S, tD * 0.95, 0.025 * S); t.add(bell); } }
    if (acc.indexOf('scarf') >= 0) {
      m = mesh(TOR(tW * 0.66, 0.035 * S), c.accent); at(m, 0, neckY - 0.01 * S, 0); m.rotation.x = Math.PI / 2; m.scale.set(1, tD / tW, 1); t.add(m);
      m = mesh(VT.roundedBox(0.07 * S, tH * 0.42, 0.025 * S, 0.012 * S), c.accent); at(m, 0.07 * S, neckY - tH * 0.22, tD * 0.95); rot(m, 6, 0, 8); t.add(m);
    }
    if (acc.indexOf('cape') >= 0) {
      var cg = grp('cape', t); cg.position.set(0, neckY - 0.02 * S, -tD * 0.7);
      var capeCol = d.hat === 'knight' ? c.accent : '#151214';
      m = mesh(CYL(0.55, 24), capeCol); at(m, 0, -(tH + P.thigh) * 0.5, -0.06 * S, tW * 1.6, tH + P.thigh * 0.9, tD * 1.1); cg.add(m);
      m.geometry = geo('capecyl', function () { return new T.CylinderGeometry(0.55, 1, 1, 24, 1, true, Math.PI * 0.55, Math.PI * 0.9); });
      m.material = VT.mat(capeCol, { side: T.DoubleSide });
      if (d.hat === 'top') { var lin = new T.Mesh(geo('capein', function () { return new T.CylinderGeometry(0.53, 0.98, 1, 24, 1, true, Math.PI * 0.55, Math.PI * 0.9); }), VT.mat(c.accent, { side: T.DoubleSide })); lin.scale.copy(m.scale); lin.position.copy(m.position); cg.add(lin); }
      this.cape = cg;
    }
    if (acc.indexOf('badge') >= 0) { m = mesh(CYL(1, 5), '#e8b54a'); at(m, -tW * 0.45, tH * 0.68, tD * 0.95, 0.04 * S, 0.012 * S, 0.04 * S); m.rotation.x = Math.PI / 2; t.add(m); }
    if (acc.indexOf('necklace') >= 0) { m = mesh(TOR(tW * 0.6, 0.012 * S), '#f7f4ee', { outline: false }); at(m, 0, neckY - 0.04 * S, 0.01 * S); m.rotation.x = 70 * D2R; t.add(m); }
    if (acc.indexOf('belt') >= 0) { m = mesh(CYL(1), '#2a1a10'); at(m, 0, tH * 0.12, 0, tW * 1.02, 0.04 * S, tD * 1.02); t.add(m); var bk = mesh(VT.roundedBox(0.05 * S, 0.04 * S, 0.02 * S, 0.008 * S), c.accent); at(bk, 0, tH * 0.12, tD * 1.0); t.add(bk); }
    if (acc.indexOf('vest') >= 0) {
      [-1, 1].forEach(function (s) { var v = mesh(SPH(), '#6b4a2b', { outline: false }); at(v, s * tW * 0.5, tH * 0.48, tD * 0.42, tW * 0.55, tH * 0.48, tD * 0.65); t.add(v); });
    }
  };

  /* ---- hand shapes. A shape is four curls, 0 straight .. 1 curled: [thumb, index, middle, ring]. Recordings store the
     curls per frame (hand tracking or controller touch sensors); the first four ids are the old shape numbers 0-3. */
  VT.HAND_SHAPES = [
    { id: 'open', label: 'Open hand', emoji: '🖐️', c: [0.05, 0.04, 0.04, 0.06] },
    { id: 'fist', label: 'Fist', emoji: '✊', c: [0.85, 1, 1, 1] },
    { id: 'point', label: 'Point', emoji: '👉', c: [0.75, 0, 1, 1] },
    { id: 'thumbs', label: 'Thumbs up', emoji: '👍', c: [0, 1, 1, 1] },
    { id: 'peace', label: 'Peace', emoji: '✌️', c: [0.85, 0, 0, 1] },
    { id: 'okay', label: 'OK', emoji: '👌', c: [0.62, 0.66, 0.08, 0.12] },
    { id: 'rock', label: 'Rock on', emoji: '🤘', c: [0.75, 0, 1, 0] },
    { id: 'relaxed', label: 'Relaxed', emoji: '🫳', c: [0.25, 0.2, 0.3, 0.4] }
  ];
  VT.HAND_BY = {};
  VT.HAND_SHAPES.forEach(function (h, i) { h.n = i; VT.HAND_BY[h.id] = h; });
  VT.handCurls = function (g) {
    var s = VT.HAND_SHAPES[Math.max(0, Math.min(VT.HAND_SHAPES.length - 1, Math.round(g || 0)))];
    return s.c.slice();
  };
  // the nearest named shape to a set of curls (old players read the shape number)
  VT.nearestShape = function (c) {
    var best = 0, bd = 1e9;
    VT.HAND_SHAPES.forEach(function (h, i) { var d = 0; for (var k = 0; k < 4; k++) d += Math.abs(h.c[k] - (c[k] || 0)); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  /* a hand's rotation (actor space) from where the fingers point and where the palm faces: easier to author than angles */
  VT.handQ = function (fx, fy, fz, px, py, pz) {
    var y = new V3(-fx, -fy, -fz).normalize(), z = new V3(-px, -py, -pz);
    z.sub(y.clone().multiplyScalar(z.dot(y))).normalize();
    var x = new V3().crossVectors(y, z);
    var q = new Q().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, z));
    return [q.x, q.y, q.z, q.w];
  };

  /* ---- toon hands: a palm, a thumb and three fingers (index, middle, ring), two joints each. Built hanging down (-Y),
     the palm towards -Z, the back of the hand +Z, the thumb towards the body's middle (-side x). WebXR's hand space maps
     onto it with one fixed turn (vt-xr.js HAND_OFF: the XR fingers point -Z, the back of the hand +Y). */
  Actor.prototype._buildHand = function (hand, col, S, side, sp, gloves) {
    var H = { side: side, f: [] };
    var palm = mesh(SPH(), col); at(palm, 0, -0.042 * S, -0.002 * S, 0.04 * S, 0.044 * S, 0.024 * S); hand.add(palm);
    if (sp === 'robot') palm.scale.multiplyScalar(1.1);
    if (gloves) { var cuff = mesh(TOR(0.034 * S, 0.012 * S), col); cuff.rotation.x = Math.PI / 2; cuff.position.y = -0.006 * S; hand.add(cuff); }
    var R = 0.0108 * S;
    var LEN = [[0.03, 0.024], [0.034, 0.026], [0.029, 0.022]];
    for (var i = 0; i < 3; i++) {
      var root = grp('finger_' + ['index', 'middle', 'ring'][i], hand);
      root.position.set(-(1 - i) * side * 0.022 * S, -0.074 * S, -0.002 * S);
      var a = LEN[i][0] * S, b = LEN[i][1] * S;
      var s1 = grp('', root); var m1 = mesh(CAPS(R, Math.max(0.001, a - R)), col); m1.position.y = -a / 2; s1.add(m1);
      var s2 = grp('', s1); s2.position.y = -a; var m2 = mesh(CAPS(R * 0.94, Math.max(0.001, b - R)), col); m2.position.y = -b / 2; s2.add(m2);
      H.f.push({ root: root, a: s1, b: s2, splay: (i - 1) * side * 7 * D2R });
    }
    var th = grp('thumb', hand); th.position.set(-side * 0.032 * S, -0.03 * S, -0.008 * S);
    var ta = 0.026 * S, tb = 0.022 * S;
    var t1 = grp('', th); var tm1 = mesh(CAPS(R * 1.1, Math.max(0.001, ta - R)), col); tm1.position.y = -ta / 2; t1.add(tm1);
    var t2 = grp('', t1); t2.position.y = -ta; var tm2 = mesh(CAPS(R, Math.max(0.001, tb - R)), col); tm2.position.y = -tb / 2; t2.add(tm2);
    H.th = { root: th, a: t1, b: t2 };
    this._handShape(H, 0);
    return H;
  };
  // g = a shape number (VT.HAND_SHAPES), c = curls [thumb, index, middle, ring] (wins when given)
  Actor.prototype._handShape = function (H, g, c) {
    if (!H.f) return;
    c = c && c.length >= 4 ? c : VT.handCurls(g);
    for (var i = 0; i < 3; i++) {
      var F = H.f[i], k = Math.max(0, Math.min(1, c[i + 1] || 0));
      F.root.rotation.set(0, 0, F.splay * (1 - k));
      F.a.rotation.x = k * 88 * D2R;
      F.b.rotation.x = k * 100 * D2R;
    }
    var t = Math.max(0, Math.min(1, c[0] || 0)), s = H.side;
    // open: out to the side and down; curled: folded across the front of the palm
    H.th.root.rotation.set((18 + t * 62) * D2R, 0, -s * (58 - t * 70) * D2R, 'XZY');
    H.th.b.rotation.x = t * 55 * D2R;
  };

  /* ------------------------------------------------------------------ posing */
  var _v = new V3(), _v2 = new V3(), _v3 = new V3(), _q = new Q(), _q2 = new Q(), _q3 = new Q(), _e = new T.Euler();
  function qArr(a) { return a ? _q3.set(a[0], a[1], a[2], a[3]) : null; }
  /* p = {head: {p: [x,y,z], q: [x,y,z,w]}, l: {p, q, g}, r: {p, q, g}, face: VT.faceOf(...), mouth: {open, wide},
          blink: 0..1, gaze: V3 (actor space) | null, walk: {phase, amt}, crouch, turn (deg body yaw offset), tilt} */
  Actor.prototype.setPose = function (p) {
    p = p || {};
    var P = this.P, root = this.root;
    var hp = p.head && p.head.p ? _v.set(p.head.p[0], p.head.p[1], p.head.p[2]) : _v.copy(this.headRest);
    var hq = p.head && p.head.q ? new Q(p.head.q[0], p.head.q[1], p.head.q[2], p.head.q[3]) : new Q();
    if (p.tilt) hq.multiply(_q.setFromEuler(_e.set(0, 0, p.tilt * D2R)));
    // hips follow the head beyond what a lean can reach; crouch when the head drops
    var off = _v2.set(hp.x, 0, hp.z), lean = 0.11 * this.def.build.h, dist = off.length();
    var hipXZ = dist > lean ? off.clone().multiplyScalar((dist - lean) / dist) : new V3();
    var drop = Math.max(0, this.headRest.y - hp.y - 0.02);
    var legL = P.thigh + P.shin, crouch = Math.min(drop * 0.75, legL * 0.45);
    var walk = p.walk || { phase: 0, amt: 0 };
    var bob = walk.amt ? Math.abs(Math.cos(walk.phase)) * 0.025 * walk.amt * this.def.build.h : 0;
    this.hips.position.set(hipXZ.x, P.hipY - crouch + bob, hipXZ.z);
    // torso: from the hips towards the neck base (under the head), limited lean, part of the head's yaw
    var neckBase = _v3.copy(hp).sub(new V3(0, this.headC, 0)).sub(this.hips.position);
    var dirUp = neckBase.normalize();
    if (dirUp.y < 0.5) { dirUp.y = 0.5; dirUp.normalize(); }
    _e.setFromQuaternion(hq, 'YXZ');
    var yaw = _e.y;
    _q.setFromUnitVectors(UP, dirUp);
    _q2.setFromEuler(new T.Euler(0, yaw * 0.35 + (p.twist || 0), 0));
    this.torso.quaternion.copy(_q).multiply(_q2);
    if (walk.amt) this.torso.rotation.z += Math.sin(walk.phase) * 0.04 * walk.amt;
    // head: world rotation hq, local = inverse(torso) * hq
    this.root.updateMatrixWorld(true);
    var tq = new Q(); this.torso.getWorldQuaternion(tq);
    var rq = new Q(); this.root.getWorldQuaternion(rq);
    var torsoInRoot = rq.clone().invert().multiply(tq);
    this.neck.quaternion.copy(torsoInRoot.clone().invert().multiply(hq));
    // arms
    var self = this;
    ['l', 'r'].forEach(function (k) {
      var A = self.arms[k], h = p[k];
      var tp = h && h.p ? new V3(h.p[0], h.p[1], h.p[2]) : self.handRest[k].clone().add(self.hips.position).sub(new V3(0, P.hipY, 0));
      var tq2 = h && h.q ? new Q(h.q[0], h.q[1], h.q[2], h.q[3]) : null;
      self._reach(A, tp, tq2, torsoInRoot);
      self._handShape(A.H, h && h.g != null ? h.g : 0, h && h.c);
    });
    // legs: walk cycle or crouch
    var ka = crouch > 0 ? Math.acos(Math.max(-1, Math.min(1, 1 - crouch / legL))) : 0;
    ['l', 'r'].forEach(function (k) {
      var L = self.legs[k], ph = walk.phase + (k === 'l' ? 0 : Math.PI), a = walk.amt || 0;
      var swing = Math.sin(ph) * 0.55 * a;
      var knee = Math.max(0, Math.sin(ph + 1.4)) * 0.95 * a;
      L.thigh.rotation.set(-ka - swing, 0, 0);
      L.shin.rotation.set(2 * ka + knee, 0, 0);
      L.foot.rotation.set(-ka + swing * 0.3 - knee * 0.4, 0, 0);
    });
    if (this.tail) this.tail.rotation.set(0, Math.sin((p.time || 0) * 2.3) * 0.35 + Math.sin(walk.phase) * 0.3 * (walk.amt || 0), 0);
    if (this.cape) this.cape.rotation.x = -0.08 - (walk.amt || 0) * 0.35;
    this._face(p);
  };

  // two-bone IK in torso space; target position given in actor (root) space
  Actor.prototype._reach = function (A, targetRoot, targetQ, torsoInRoot) {
    var torsoPos = new V3(); this.torso.getWorldPosition(torsoPos); this.root.worldToLocal(torsoPos);
    var inv = torsoInRoot.clone().invert();
    var t = targetRoot.clone().sub(torsoPos).applyQuaternion(inv);
    var s = A.shoulder, a = A.a, b = A.b;
    var d = t.clone().sub(s), dist = d.length();
    dist = Math.max(0.02, Math.min(dist, (a + b) * 0.999));
    var dir = d.normalize();
    var pole = new V3(A.side * 0.35, -0.6, -1).normalize();
    var perp = pole.clone().sub(dir.clone().multiplyScalar(dir.dot(pole)));
    if (perp.lengthSq() < 1e-6) perp.set(0, 0, -1);
    perp.normalize();
    var cosA = (a * a + dist * dist - b * b) / (2 * a * dist), A0 = Math.acos(Math.max(-1, Math.min(1, cosA)));
    var elbow = s.clone().add(dir.clone().multiplyScalar(Math.cos(A0) * a)).add(perp.multiplyScalar(Math.sin(A0) * a));
    var hand = s.clone().add(dir.clone().multiplyScalar(dist));
    A.upper.quaternion.setFromUnitVectors(DOWN, elbow.clone().sub(s).normalize());
    var fdir = hand.clone().sub(elbow).normalize().applyQuaternion(A.upper.quaternion.clone().invert());
    A.fore.quaternion.setFromUnitVectors(DOWN, fdir);
    if (targetQ) {
      var chain = A.upper.quaternion.clone().multiply(A.fore.quaternion);
      A.hand.quaternion.copy(chain.invert().multiply(inv.clone().multiply(targetQ)));
    } else {
      A.hand.quaternion.identity();
      A.hand.rotation.y = -A.side * 0.25;
    }
  };

  Actor.prototype._face = function (p) {
    var F = this.face, f = p.face || VT.faceOf('neutral');
    var m = p.mouth || {}, open = Math.max(f.open || 0, m.open || 0);
    var talking = (m.open || 0) > 0.05;
    var blink = p.blink || 0;
    var lid = Math.max(-0.4, Math.min(1, (f.lid || 0) + (1 - (f.lid || 0)) * blink));
    var self = this;
    // a webcam face (vt-face.js) sets each eye and brow on its own: side +1 (+X) is the character's left = the performer's left
    var perEye = f.lidL != null;
    F.eyes.forEach(function (e, i) {
      var lidE = lid;
      if (perEye) { var l0 = e.side > 0 ? f.lidL : f.lidR; lidE = Math.max(-0.4, Math.min(1, l0 + (1 - l0) * blink)); }
      e.lid.rotation.x = (-40 + lidE * 130) * D2R;
      var by = perEye ? (e.side > 0 ? f.browL : f.browR) : (f.browY || 0) + (i === 1 ? (f.browAsym || 0) * 0.5 : 0);
      e.bpiv.position.y = by * e.eyeR * 0.6;
      e.bpiv.rotation.z = -e.side * (f.browTilt || 0) * D2R * 1.0;
      var ps = f.pupil || 1;
      e.pupil.scale.set(e.eyeR * 0.3 * ps, e.eyeR * 0.3 * e.tall * ps, e.eyeR * 0.1);
      // gaze: aim the eyeball (pupils) at a point in actor space, limited
      var gx = 0, gy = (f.look ? 0.35 : 0);
      if (p.gaze) {
        var gp = new V3(p.gaze[0], p.gaze[1], p.gaze[2]);
        e.g.updateMatrixWorld(true);
        var local = e.g.worldToLocal(self.root.localToWorld(gp.clone()));
        gx = Math.atan2(local.x, Math.max(0.05, local.z)); gy = Math.atan2(local.y, Math.max(0.05, local.z)) + gy;
      }
      gx += (f.gx || 0) * 0.42; gy += (f.gy || 0) * 0.32;  // where the performer's eyes went (webcam), on top of the look
      e.ball.rotation.set(-Math.max(-0.45, Math.min(0.45, gy)), Math.max(-0.5, Math.min(0.5, gx)), 0);
    });
    var M = F.mouth, w = M.w * (0.55 + (m.wide != null ? m.wide : f.wide || 0.5) * 0.9);
    var curve = f.curve || 0;
    M.g.rotation.z = (f.smirk || 0) * 0.24;  // one corner up (webcam smirk): + lifts the character's left (+X) corner
    if (open > 0.06) {
      M.hole.visible = true;
      M.hole.scale.set(w, Math.max(0.004, open * M.w * 0.95), 0.04 * this.def.build.h);
      M.hole.position.y = -open * M.w * 0.25 + curve * M.w * 0.08;
      M.line.visible = open < 0.18 && !talking;
    } else { M.hole.visible = false; M.line.visible = true; }
    var cy = Math.max(0.18, Math.abs(curve));
    M.line.scale.set(w / M.w, cy, 1);
    M.line.rotation.z = curve >= 0 ? Math.PI : 0;
    M.line.position.y = curve >= 0 ? M.w * 0.62 * cy * 0.5 : -M.w * 0.62 * cy * 0.5;
    var rosy = this.def.face && this.def.face.cheeks;
    F.blush.forEach(function (b) { b.visible = rosy || (f.blush || 0) > 0.4; });
    F.tear.visible = (f.tear || 0) > 0.4;
    if (F.tear.visible) F.tear.position.y = F.tearY - (((p.time || 0) * 0.6) % 1) * this.headR * 0.4;
    F.sweat.visible = (f.sweat || 0) > 0.4;
  };

  /* hide the performer's own head in first person: its meshes go to layer 3 (the XR eyes don't see it, the monitor does) */
  Actor.prototype.firstPerson = function (on) {
    this.headMesh.traverse(function (o) { if (o.isMesh) { if (on) o.layers.set(3); else o.layers.set(0); } });
  };
  Actor.prototype.dispose = function () { if (this.root.parent) this.root.parent.remove(this.root); };
  VT.Actor = Actor;
  VT.buildActor = function (def) { return new Actor(def); };

  /* ------------------------------------------------------------------ procedural acting (no recording yet) */
  // returns a pose p for an actor at time t: idle breathing + talking hands + a gesture (VT.GESTURES), all deterministic
  VT.GESTURES = [
    { id: 'wave', label: 'Wave', emoji: '👋', len: 1.6 }, { id: 'point', label: 'Point', emoji: '👉', len: 1.4 },
    { id: 'shrug', label: 'Shrug', emoji: '🤷', len: 1.3 }, { id: 'cheer', label: 'Cheer', emoji: '🙌', len: 1.6 },
    { id: 'facepalm', label: 'Facepalm', emoji: '🤦', len: 1.8 }, { id: 'bow', label: 'Bow', emoji: '🎭', len: 1.8 },
    { id: 'jump', label: 'Jump', emoji: '⬆️', len: 0.9 }, { id: 'dance', label: 'Dance', emoji: '🕺', len: 3.2 },
    { id: 'think', label: 'Chin scratch', emoji: '🤔', len: 2.4 }, { id: 'nod', label: 'Nod', emoji: '🙂', len: 1.1 },
    { id: 'shake', label: 'Head shake', emoji: '🙅', len: 1.2 }, { id: 'clap', label: 'Clap', emoji: '👏', len: 1.6 },
    { id: 'thumbs', label: 'Thumbs up', emoji: '👍', len: 1.4 }, { id: 'armsup', label: 'Hands up', emoji: '😱', len: 1.5 },
    { id: 'cross', label: 'Arms crossed', emoji: '😤', len: 2.5 },
    // finger work (the toon hands have real fingers since Nov 2026)
    { id: 'peace', label: 'Peace sign', emoji: '✌️', len: 1.8 }, { id: 'okay', label: 'OK sign', emoji: '👌', len: 1.6 },
    { id: 'rock', label: 'Rock on', emoji: '🤘', len: 1.8 }, { id: 'count', label: 'Count to three', emoji: '🔢', len: 2.6 },
    { id: 'beckon', label: 'Come here', emoji: '🫴', len: 2.0 }, { id: 'shush', label: 'Shush', emoji: '🤫', len: 1.8 }
  ];
  VT.GEST = {};
  VT.GESTURES.forEach(function (g) { VT.GEST[g.id] = g; });
  function quatYXZ(x, y, z) { var q = new Q().setFromEuler(new T.Euler(x * D2R, y * D2R, z * D2R, 'YXZ')); return [q.x, q.y, q.z, q.w]; }
  VT.quatYXZ = quatYXZ;
  function ease(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
  function noise(t, s) { return Math.sin(t * 1.3 + s) * 0.5 + Math.sin(t * 2.7 + s * 1.7) * 0.3 + Math.sin(t * 0.7 + s * 0.3) * 0.2; }
  VT.noise = noise;
  /* ctx: {t, talk (0..1 mouth level now), speaking (bool), gesture: {id, u (0..1 progress)}, look: [x,y,z] actor space, seed} */
  VT.proceduralPose = function (actor, ctx) {
    var t = ctx.t || 0, s = ctx.seed || 0, h = actor.def.build.h;
    var hr = actor.headRest, br = Math.sin(t * 1.6 + s) * 0.006 * h;
    var head = [hr.x + noise(t * 0.4, s) * 0.012 * h, hr.y + br, hr.z + noise(t * 0.35, s + 4) * 0.012 * h];
    var yaw = noise(t * 0.3, s + 9) * 7, pitch = noise(t * 0.33, s + 2) * 4, roll = noise(t * 0.27, s + 5) * 3;
    if (ctx.look) {
      var dx = ctx.look[0] - head[0], dz = ctx.look[2] - head[2], dy = ctx.look[1] - head[1];
      yaw += Math.max(-65, Math.min(65, Math.atan2(dx, dz) / D2R)) * 0.85;
      pitch += Math.max(-25, Math.min(25, -Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) / D2R)) * 0.7;
    }
    var L = actor.handRest.l.clone(), R = actor.handRest.r.clone();
    L.y += br * 1.5; R.y += br * 1.5;
    var Lq = null, Rq = null, Lg = 7, Rg = 7, Lc = null, Rc = null;  // 7 = relaxed fingers
    if (ctx.speaking) {  // talking hands: beats follow the voice
      var k = Math.min(1, (ctx.talk || 0) * 1.6), beat = Math.sin(t * 5.5 + s) * 0.5 + 0.5;
      var side = Math.sin(t * 0.9 + s) > 0 ? 1 : -1;
      var Hh = side > 0 ? R : L;
      Hh.y += (0.17 + 0.05 * beat * k) * h; Hh.z += 0.16 * h; Hh.x *= 0.72;
      var O = side > 0 ? L : R; O.y += 0.04 * h * k; O.z += 0.05 * h;
      pitch += -beat * 3 * k; yaw += Math.sin(t * 1.7 + s) * 4 * k;
    }
    var g = ctx.gesture, sh = actor.P.hipY + actor.P.torsoH * 0.8, hh = actor.headRest.y;
    if (g && VT.GEST[g.id]) {
      var u = g.u, inout = ease(u / 0.18) * ease((1 - u) / 0.2), tt = u * VT.GEST[g.id].len;
      var lerp3 = function (A, x, y, z, w) { A.x += (x - A.x) * w; A.y += (y - A.y) * w; A.z += (z - A.z) * w; };
      var tw = actor.P.torsoW;
      switch (g.id) {
        case 'wave': lerp3(R, tw * 2.2, hh + 0.08 * h, 0.08 * h, inout); R.x += Math.sin(tt * 14) * 0.06 * h * inout; Rq = quatYXZ(180, 0, Math.sin(tt * 14) * 25); break;
        case 'point': lerp3(R, tw * 1.4, sh + 0.02 * h, 0.5 * h, inout); Rg = 2; Rq = VT.handQ(0.12, 0.08, 1, -1, 0, 0); yaw += 10 * inout; break;
        case 'shrug': lerp3(L, -tw * 2.4, sh - 0.12 * h, 0.12 * h, inout); lerp3(R, tw * 2.4, sh - 0.12 * h, 0.12 * h, inout); roll += 9 * inout; head[1] -= 0.03 * h * inout; Lq = quatYXZ(-60, 0, 80); Rq = quatYXZ(-60, 0, -80); break;
        case 'cheer': lerp3(L, -tw * 1.8, hh + 0.32 * h, 0.05 * h, inout); lerp3(R, tw * 1.8, hh + 0.32 * h, 0.05 * h, inout); Lg = Rg = 1; head[1] += Math.abs(Math.sin(tt * 9)) * 0.03 * h * inout; pitch -= 12 * inout; break;
        case 'facepalm': lerp3(R, 0.03 * h, hh + 0.02 * h, actor.headR * 1.05, inout); pitch += 18 * inout; head[2] += 0.03 * h * inout; Rq = quatYXZ(150, 0, 0); break;
        case 'bow': head[2] += 0.22 * h * inout; head[1] -= 0.18 * h * inout; pitch += 40 * inout; lerp3(R, tw * 0.6, sh - 0.2 * h, 0.22 * h, inout); break;
        case 'jump': var jh = Math.sin(Math.min(1, u) * Math.PI) * 0.3 * h; head[1] += jh; L.y += jh + 0.1 * h * inout; R.y += jh + 0.1 * h * inout; L.x -= 0.08 * h; R.x += 0.08 * h; break;
        case 'dance': var b2 = Math.sin(tt * 7); head[0] += b2 * 0.05 * h * inout; head[1] += Math.abs(Math.cos(tt * 7)) * 0.04 * h * inout; lerp3(L, -tw * 2, hh + 0.1 * h + b2 * 0.12 * h, 0.1 * h, inout); lerp3(R, tw * 2, hh + 0.1 * h - b2 * 0.12 * h, 0.1 * h, inout); roll += b2 * 10 * inout; Lg = Rg = 2; break;
        case 'think': lerp3(R, 0.02 * h, hh - actor.headR * 0.85, actor.headR * 1.05, inout); Rg = 1; lerp3(L, 0, sh - 0.12 * h, 0.15 * h, inout); pitch -= 8 * inout; yaw += 12 * inout; roll -= 6 * inout; break;
        case 'nod': pitch += Math.sin(tt * 11) * 12 * inout; break;
        case 'shake': yaw += Math.sin(tt * 12) * 18 * inout; break;
        case 'clap': var cl = Math.abs(Math.sin(tt * 9)); lerp3(L, -0.03 * h - cl * 0.08 * h, sh - 0.05 * h, 0.28 * h, inout); lerp3(R, 0.03 * h + cl * 0.08 * h, sh - 0.05 * h, 0.28 * h, inout); Lq = VT.handQ(0, 0.5, 1, 1, 0, 0); Rq = VT.handQ(0, 0.5, 1, -1, 0, 0); Lg = Rg = 0; break;
        case 'thumbs': lerp3(R, tw * 1.3, sh, 0.32 * h, inout); Rg = 3; Rq = VT.handQ(0, 0, 1, -1, 0, 0); break;
        case 'peace': lerp3(R, tw * 1.7, hh + 0.02 * h, 0.14 * h, inout); Rg = 4; Rq = VT.handQ(0.15, 1, -0.1, -0.15, 0, 1); roll -= 6 * inout; break;
        case 'okay': lerp3(R, tw * 1.5, sh + 0.06 * h, 0.3 * h, inout); Rg = 5; Rq = VT.handQ(0.1, 1, 0.1, -0.35, 0, 1); break;
        case 'rock': lerp3(R, tw * 1.9, hh + 0.14 * h, 0.1 * h, inout); Rg = 6; Rq = VT.handQ(0.2, 1, -0.1, 0, 0, 1); head[1] += Math.abs(Math.sin(tt * 8)) * 0.02 * h * inout; pitch += Math.sin(tt * 8) * 6 * inout; break;
        case 'count':
          lerp3(R, tw * 1.6, sh + 0.08 * h, 0.26 * h, inout); Rq = VT.handQ(0.05, 1, -0.1, -0.1, 0, 1);
          var n3 = u < 0.36 ? 1 : u < 0.66 ? 2 : 3; Rc = [0.85, 0, n3 >= 2 ? 0 : 1, n3 >= 3 ? 0 : 1]; Rg = n3 === 1 ? 2 : n3 === 2 ? 4 : 0; break;
        case 'beckon':
          lerp3(R, tw * 1.3, sh - 0.04 * h, 0.34 * h, inout); Rq = VT.handQ(-0.1, 0.25, 1, 0, 1, 0);
          var bk = 0.5 + 0.5 * Math.sin(tt * 9); Rc = [0.6, bk, 0.55 + bk * 0.45, 0.7 + bk * 0.3]; Rg = 2; pitch -= 5 * inout; break;
        case 'shush': lerp3(R, 0.03 * h, hh - actor.headR * 0.42, actor.headR * 1.25, inout); Rg = 2; Rq = VT.handQ(0, 1, 0.05, -1, 0, -0.3); pitch += 6 * inout; break;
        case 'armsup': lerp3(L, -tw * 2.2, hh + 0.2 * h, 0.12 * h, inout); lerp3(R, tw * 2.2, hh + 0.2 * h, 0.12 * h, inout); head[2] -= 0.05 * h * inout; break;
        case 'cross': lerp3(L, tw * 0.7, sh - 0.12 * h, 0.2 * h, inout); lerp3(R, -tw * 0.7, sh - 0.1 * h, 0.22 * h, inout); Lq = quatYXZ(0, 0, -100); Rq = quatYXZ(0, 0, 100); pitch -= 5 * inout; break;
      }
    }
    // gestures blend the fingers in and out with the arm (inout), from relaxed
    if (g && VT.GEST[g.id]) {
      var wIn = ease(g.u / 0.18) * ease((1 - g.u) / 0.2), rel = VT.HAND_SHAPES[7].c;
      var mix = function (cur, n) { var to = cur || VT.handCurls(n); return rel.map(function (v, i) { return v + (to[i] - v) * wIn; }); };
      Rc = mix(Rc, Rg); Lc = mix(Lc, Lg);
    }
    return {
      head: { p: head, q: quatYXZ(pitch, yaw, roll) },
      l: { p: [L.x, L.y, L.z], q: Lq, g: Lg, c: Lc }, r: { p: [R.x, R.y, R.z], q: Rq, g: Rg, c: Rc }
    };
  };

  /* ------------------------------------------------------------------ "Surprise me" (the character editor) */
  var PAL = ['#d7263d', '#b3182b', '#ff7a1a', '#ffc23d', '#e8b54a', '#7ee0c4', '#39b54a', '#5fb8b2', '#4d8fd6', '#2b2d42', '#6a3fd1', '#4b2a6b', '#ff8fab', '#e58fae', '#f7f4ee', '#b9c2cc', '#5b5560', '#8a5a36', '#151214'];
  var FUR = { dog: ['#d9a05b', '#8a5a36', '#f4efe9', '#2a2628'], cat: ['#2a2628', '#e8762d', '#b9c2cc', '#f4efe9'], bear: ['#8a5a36', '#4a2c17', '#f4efe9'],
    rabbit: ['#f4efe9', '#b9a08a', '#5b5560'], fox: ['#e8762d', '#c2410c', '#f4efe9'], frog: ['#5fbf4a', '#2f9e77', '#c0d84a'], robot: ['#5fb8b2', '#b9c2cc', '#ffc23d', '#d7263d'],
    ghost: ['#f4f6ff', '#d9f2ff', '#f4e1ff'], alien: ['#7ee0c4', '#9be564', '#c8a2ff'], ogre: ['#7cb342', '#8d6e63', '#78909c'], penguin: ['#1f2430', '#2b2d42'], dino: ['#4fa3a5', '#9be564', '#ff8f3d', '#6a3fd1'] };
  var SKINS = ['#eadfd6', '#f6cfae', '#e8b48c', '#c98c5e', '#9a6440', '#6e4429'];
  VT.randomDef = function (seed) {
    var s = (seed || Math.floor(Math.random() * 1e9)) % 2147483646 + 1, rnd = function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    var pick = function (a) { return a[Math.floor(rnd() * a.length)]; }, rng = function (a, b) { return Math.round((a + rnd() * (b - a)) * 100) / 100; };
    var sp = rnd() < 0.45 ? 'human' : pick(VT.SPECIES.slice(1));
    var human = sp === 'human', skin = human ? pick(SKINS) : pick(FUR[sp]);
    var accs = VT.ACCS.slice(), acc = [];
    for (var i = 0, n = Math.floor(rnd() * 3); i < n; i++) { var a = accs.splice(Math.floor(rnd() * accs.length), 1)[0]; if (a !== 'beard' || human) acc.push(a); }
    return {
      species: sp, hair: human ? pick(VT.HAIRS.slice(1)) : 'none', hat: rnd() < 0.45 ? pick(VT.HATS.slice(1)) : 'none', acc: acc,
      colors: { skin: skin, fur2: human ? '#ffffff' : pick(['#f7f4ee', '#ffe2c6', '#ffc6d3', '#d6f0a8']), hair: pick(['#151012', '#3b1f14', '#6b3a1e', '#c9a14a', '#d9d9dc', '#e8762d', '#6a3fd1', '#ff8fab']),
        shirt: pick(PAL), pants: pick(PAL), shoes: pick(['#151214', '#3a2414', '#f7f4ee', '#d7263d', '#2b2d42']), accent: pick(PAL), eyes: pick(['#2a1a10', '#2b4a2b', '#2a3a5a', '#6a1b9a', '#1a1210']) },
      build: { h: rng(0.8, 1.12), girth: rng(0.85, 1.3), head: rng(0.92, 1.18), legs: rng(0.9, 1.1), arms: 1, hand: rng(0.95, 1.2), torso: human ? pick(VT.TORSOS) : 'round' },
      face: { eyes: rng(0.85, 1.3), spread: rng(0.9, 1.12), lift: rng(-0.4, 0.4), tall: rng(0.9, 1.2), brows: rng(0.7, 1.5), nose: rng(0.6, 1.4), mouth: rng(0.85, 1.2),
        ears: 'auto', earSize: rng(0.85, 1.25), freckles: rnd() < 0.2 ? 1 : 0, lashes: rnd() < 0.3 ? 1 : 0, cheeks: rnd() < 0.3 ? 1 : 0 },
      voice: pick(VT.VOICES)
    };
  };

  /* ------------------------------------------------------------------ portraits (one shared offscreen renderer) */
  var _pr = null, _pcache = {};
  VT.portrait = function (def, opts) {
    opts = opts || {};
    var d = VT.normalize(def);
    var key = JSON.stringify([d, opts.emo || 'happy', opts.size || 256, opts.full ? 1 : 0, opts.bg || '']);
    if (_pcache[key]) return _pcache[key];
    try {
      if (!_pr) {
        var cv = document.createElement('canvas');
        _pr = { r: new T.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true }), scene: new T.Scene() };
        _pr.r.setPixelRatio(1);
        var hemi = new T.HemisphereLight('#fff6e8', '#5b4a66', 1.6); _pr.scene.add(hemi);
        var key2 = new T.DirectionalLight('#ffffff', 1.9); key2.position.set(1.2, 2, 2.5); _pr.scene.add(key2);
        var rim = new T.DirectionalLight('#ffd9a0', 1.1); rim.position.set(-2, 1.5, -2); _pr.scene.add(rim);
        _pr.cam = new T.PerspectiveCamera(30, 1, 0.05, 20);
      }
      var size = opts.size || 256, ratio = opts.full ? 0.75 : 1;
      _pr.r.setSize(size * ratio, size, false);
      _pr.cam.aspect = ratio; _pr.cam.updateProjectionMatrix();
      var a = new Actor(d);
      var pose = VT.proceduralPose(a, { t: 1.2, seed: 3 });
      pose.face = VT.faceOf(opts.emo || 'happy');
      pose.head.q = quatYXZ(4, -12, 3);
      if (opts.full) { pose.r = { p: [a.P.torsoW * 2.0, a.headRest.y + 0.05, 0.1], q: quatYXZ(180, 0, 10), g: 0 }; }
      a.setPose(pose);
      a.root.rotation.y = 18 * D2R;
      _pr.scene.add(a.root);
      if (opts.full) { _pr.cam.position.set(0.15, a.height * 0.55, a.height * 2.6); _pr.cam.lookAt(0, a.height * 0.5, 0); }
      else { var hy = a.headRest.y; _pr.cam.position.set(0.05, hy + 0.06, a.headR * 7.2 + 0.25); _pr.cam.lookAt(0, hy - a.headR * 0.35, 0); }
      _pr.scene.background = opts.bg ? new T.Color(opts.bg) : null;
      _pr.r.setClearColor(0x000000, 0);
      _pr.r.render(_pr.scene, _pr.cam);
      var url = _pr.r.domElement.toDataURL('image/png');
      _pr.scene.remove(a.root);
      _pcache[key] = url;
      return url;
    } catch (e) {
      console.warn('portrait failed', e);
      return '';
    }
  };
})();
