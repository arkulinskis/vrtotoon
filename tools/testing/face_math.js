// The face booth's maths (theme/assets/vt-face.js) on real face points: python tools/check.py runs it.
//   node tools/testing/face_math.js     -> ALL FACE MATHS OK
// face_points.json = the 478 MediaPipe points of tools/ui/face-cam.mjpeg (the UI tests' fake webcam).
const fs = require('fs'), path = require('path');
global.window = {}; global.performance = { now: () => Date.now() };
eval(fs.readFileSync(path.join(__dirname, '..', '..', 'theme', 'assets', 'vt-face.js'), 'utf8'));
const VT = window.VT;
const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'face_points.json'), 'utf8')).map(p => ({ x: p[0], y: p[1], z: p[2] }));
const A = 4 / 3, FP = VT.FACE_POINTS;
const m0 = VT.faceMeasure(base, A);
console.log('neutral measures', JSON.stringify(m0, (k, v) => typeof v === 'number' ? Math.round(v * 1000) / 1000 : v));
const rest = VT.faceFromMeasures(m0, m0, null);
let fails = 0;
function check(name, cond, info) { console.log((cond ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!cond) fails++; }
check('neutral face = rest', VT.FACE_CH.every(c => Math.abs(rest[c.id] - VT.FACE_REST[c.id]) < 1e-6), JSON.stringify(rest));
function moved(fn) { const p = base.map(q => ({ ...q })); fn(p); return VT.faceFromMeasures(VT.faceMeasure(p, A), m0, null); }
const iod = Math.hypot((base[FP.lOut].x - base[FP.rOut].x) * A, base[FP.lOut].y - base[FP.rOut].y);  // in x-units of the picture height
const dy = (f) => f * iod;  // picture-y units
let o = moved(p => { p[FP.mR].y -= dy(0.05); p[FP.mL].y -= dy(0.05); p[FP.mR].x -= 0.01; p[FP.mL].x += 0.01; });
check('smile: corners up + wider', o.curve > 0.8 && o.wide > 0.6, 'curve ' + o.curve.toFixed(2) + ' wide ' + o.wide.toFixed(2));
o = moved(p => { p[FP.mR].y += dy(0.04); p[FP.mL].y += dy(0.04); });
check('frown: corners down', o.curve < -0.4, 'curve ' + o.curve.toFixed(2));
o = moved(p => { p[FP.rUp].y = p[FP.rLo].y - 0.001; });
check('wink right: right lid closed, left open', o.lidR > 0.9 && o.lidL < 0.2, 'lidR ' + o.lidR.toFixed(2) + ' lidL ' + o.lidL.toFixed(2));
o = moved(p => { const d = p[FP.lLo].y - p[FP.lUp].y; p[FP.lUp].y -= d * 0.4; p[FP.rUp].y -= d * 0.4; });
check('eyes wide: lids negative', o.lidL < 0 && o.lidR < 0, 'lidL ' + o.lidL.toFixed(2));
o = moved(p => { [FP.rBrowIn, FP.rBrowMid, FP.rBrowOut, FP.lBrowIn, FP.lBrowMid, FP.lBrowOut].forEach(i => { p[i].y -= dy(0.07); }); });
check('brows up', o.browL > 0.9 && o.browR > 0.9 && Math.abs(o.browTilt) < 0.1, 'browL ' + o.browL.toFixed(2) + ' tilt ' + o.browTilt.toFixed(2));
o = moved(p => { p[FP.rBrowIn].y -= dy(0.04); p[FP.lBrowIn].y -= dy(0.04); });
check('worried: inner brows up -> tilt +', o.browTilt > 0.7, 'tilt ' + o.browTilt.toFixed(2));
o = moved(p => { p[FP.rBrowIn].y += dy(0.04); p[FP.lBrowIn].y += dy(0.04); });
check('cross: inner brows down -> tilt -', o.browTilt < -0.7, 'tilt ' + o.browTilt.toFixed(2));
o = moved(p => { p[FP.lipLo].y += dy(0.3); });
check('jaw open', o.open > 0.85, 'open ' + o.open.toFixed(2));
o = moved(p => { p[FP.mL].y -= dy(0.045); });
check('smirk: your left corner up -> +', o.smirk > 0.9, 'smirk ' + o.smirk.toFixed(2));
o = moved(p => { const w = (p[FP.lOut].x - p[FP.lIn].x); p[FP.lIris].x += w * 0.15; p[FP.rIris].x += w * 0.15; });
check('look to your left (picture right): gx +', o.gx > 0.8, 'gx ' + o.gx.toFixed(2));
o = moved(p => { const w = (p[FP.lOut].x - p[FP.lIn].x); p[FP.lIris].y -= w * A * 0.09; p[FP.rIris].y -= w * A * 0.09; });
check('look up: gy +', o.gy > 0.8, 'gy ' + o.gy.toFixed(2));
// the head turning and moving doesn't change the face: rotate the picture 15 degrees, shift and scale it
o = moved(p => { const c = Math.cos(0.26), s = Math.sin(0.26); p.forEach(q => { const x = (q.x - 0.5) * A, y = q.y - 0.5; q.x = (x * c - y * s) * 0.8 / A + 0.55; q.y = (x * s + y * c) * 0.8 + 0.45; q.z *= 0.8; }); });
check('head roll + move + scale: still neutral', VT.FACE_CH.every(ch => Math.abs(o[ch.id] - VT.FACE_REST[ch.id]) < 0.05), JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(2)]))));
// blendshapes: a both-eyes blink closes both lids; a wink in the scores alone doesn't
o = VT.faceFromMeasures(m0, m0, { smile: 0, frown: 0, jaw: 0, pucker: 0, blink: 0.95 });
check('blink from blendshapes', o.lidL > 0.85 && o.lidR > 0.85);
// the stored track round-trips
const samples = [0, 0.4, 1.0, 1.6].map((t, i) => ({ t, v: VT.faceArr(Object.assign({}, VT.FACE_REST, { curve: i * 0.3 - 0.2, lidR: i === 2 ? 1 : 0.12 })) }));
const pk = VT.packFace(samples, { gain: 1, mouth: true });
check('pack: n = 1.6 s * 30 + 1', pk.n === 49 && pk.s.length === 49 * 11 && /^[0-9A-Za-z_-]+$/.test(pk.s), 'n ' + pk.n);
const fa = VT.unpackFace(JSON.parse(JSON.stringify(pk)));
const at1 = VT.faceAt(fa, 1.0, true);
check('faceAt(1.0) = the sample (within a quantisation step)', Math.abs(at1.curve - 0.4) < 0.04 && Math.abs(at1.lidR - 1) < 0.03 && at1.mouth === true, 'curve ' + at1.curve.toFixed(3));
check('faceAt outside the take = null', VT.faceAt(fa, 2.5) === null && VT.faceAt(fa, -1) === null);
const g = VT.faceGain(Object.assign({}, VT.FACE_REST, { curve: 0.55 }), 1.5);
check('gain scales from rest', Math.abs(g.curve - (0.15 + 0.4 * 1.5)) < 1e-6);
console.log(fails ? fails + ' FAILED' : 'ALL FACE MATHS OK');
process.exitCode = fails ? 1 : 0;
