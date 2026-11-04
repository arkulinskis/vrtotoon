/* vt-timeline.js: VT.Timeline, the editor's timeline (one canvas).
   new VT.Timeline(el, {doc, film: () => VT.Film, onSeek(t), onSelect({kind, id} | null)})
   Rows: SCRIPT (beats, coloured by speaker; a dot = recorded, stripes = still an estimate), one row per actor (walks ◆,
   emotions, gestures, looks; a bar under a beat = that actor's recorded clip), CAMERA (shots), SOUND (effects).
   Click = seek; click an item = select it; drag a key / shot / effect = move it (it re-anchors to the beat it lands in);
   drag the right edge of a beat = its pause before the next line (or an action beat's length). Ctrl/⌘ + wheel = zoom. */
(function () {
  'use strict';
  var VT = window.VT = window.VT || {};
  var COLS = ['#ff5a6e', '#ffd166', '#7ff9ff', '#9be564', '#ff9f1a', '#c792ea', '#f4efe6', '#5ab0ff'];
  VT.ACTOR_COLS = COLS;
  var ROW = 30, HEAD = 22, LABEL = 92;

  function Timeline(el, o) {
    var self = this;
    this.el = el; this.o = o; this.doc = o.doc;
    this.pps = 60; this.scroll = 0; this.time = 0; this.sel = null; this.hits = [];
    el.classList.add('vt-tl');
    this.cv = document.createElement('canvas'); el.appendChild(this.cv);
    this.cv.style.touchAction = 'pan-y';
    this._bind();
    this._ro = window.ResizeObserver ? new ResizeObserver(function () { self.draw(); }) : null;
    if (this._ro) this._ro.observe(el);
    this.draw();
  }
  VT.Timeline = Timeline;
  Timeline.prototype.film = function () { return this.o.film(); };
  Timeline.prototype.rows = function () {
    var d = this.doc.d, rows = [{ kind: 'script', label: 'SCRIPT' }];
    d.cast.forEach(function (c, i) { rows.push({ kind: 'actor', id: c.id, label: c.name, col: COLS[i % COLS.length] }); });
    rows.push({ kind: 'camera', label: 'CAMERA' }); rows.push({ kind: 'sound', label: 'SOUND' });
    return rows;
  };
  Timeline.prototype.height = function () { return HEAD + this.rows().length * ROW + 6; };
  Timeline.prototype.x = function (t) { return LABEL + t * this.pps - this.scroll; };
  Timeline.prototype.t = function (x) { return (x - LABEL + this.scroll) / this.pps; };
  Timeline.prototype.setTime = function (t) {
    this.time = t;
    var w = this.el.clientWidth, x = this.x(t);
    if (this._follow && (x > w - 40 || x < LABEL)) this.scroll = Math.max(0, t * this.pps - (w - LABEL) * 0.3);
    this.draw();
  };
  Timeline.prototype.select = function (s) { this.sel = s; this.draw(); };
  Timeline.prototype.zoom = function (k) { this.pps = VT.clamp(this.pps * k, 12, 260); this.draw(); };
  Timeline.prototype.fit = function () { var f = this.film(); this.pps = VT.clamp((this.el.clientWidth - LABEL - 20) / Math.max(4, f.total), 12, 260); this.scroll = 0; this.draw(); };

  Timeline.prototype.draw = function () {
    var el = this.el, dpr = window.devicePixelRatio || 1, W = Math.max(200, el.clientWidth), H = this.height();
    if (this.cv.width !== Math.round(W * dpr) || this.cv.height !== Math.round(H * dpr)) { this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr); this.cv.style.width = W + 'px'; this.cv.style.height = H + 'px'; }
    var c = this.cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    var dark = document.documentElement.classList.contains('ui-dark');
    var C = dark ? { bg: '#140e10', row: '#1d1518', row2: '#181113', line: '#33262b', ink: '#f4ebdd', muted: '#a8999e', label: '#231a1d' }
      : { bg: '#fbf6ee', row: '#f3ebdf', row2: '#efe5d6', line: '#e2d5c3', ink: '#1b1416', muted: '#6b5d61', label: '#eadfcf' };
    c.fillStyle = C.bg; c.fillRect(0, 0, W, H);
    var film = this.film(), L = film.L, d = this.doc.d, rows = this.rows(), self = this;
    var hits = this.hits = [];
    var total = film.total;
    this.maxScroll = Math.max(0, total * this.pps - (W - LABEL) + 60);
    this.scroll = VT.clamp(this.scroll, 0, this.maxScroll);
    // rows
    rows.forEach(function (r, i) { c.fillStyle = i % 2 ? C.row2 : C.row; c.fillRect(0, HEAD + i * ROW, W, ROW); });
    // ruler
    c.fillStyle = C.bg; c.fillRect(0, 0, W, HEAD);
    var step = this.pps > 90 ? 0.5 : this.pps > 35 ? 1 : this.pps > 18 ? 2 : 5;
    c.font = '600 10px "DM Sans", sans-serif'; c.textAlign = 'left';
    for (var s = 0; s <= total + step; s += step) {
      var x = this.x(s); if (x < LABEL - 1 || x > W) continue;
      c.fillStyle = C.line; c.fillRect(x, HEAD - 6, 1, 6);
      if (Math.abs(s - Math.round(s)) < 1e-6 && (Math.round(s) % (step >= 2 ? step : 1) === 0)) { c.fillStyle = C.muted; c.fillText(fmt(s), x + 3, 13); }
    }
    c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(this.x(total), HEAD, W, H);
    c.save(); c.beginPath(); c.rect(LABEL, 0, W - LABEL, H); c.clip();
    var rowY = function (kind, id) { for (var i = 0; i < rows.length; i++) if (rows[i].kind === kind && (!id || rows[i].id === id)) return HEAD + i * ROW; return -100; };
    var colOf = {}; d.cast.forEach(function (a, i) { colOf[a.id] = COLS[i % COLS.length]; });
    // beats (script row) + recorded clips under each actor
    var sy = rowY('script');
    L.beats.forEach(function (b) {
      var x0 = self.x(b.start), x1 = self.x(b.end), w = Math.max(3, x1 - x0);
      var col = b.kind === 'action' ? '#8a7e82' : (colOf[b.who] || '#888');
      var on = self.sel && self.sel.kind === 'beat' && self.sel.id === b.id;
      c.fillStyle = col; c.globalAlpha = on ? 1 : 0.85; rr(c, x0, sy + 4, w, ROW - 8, 5); c.fill(); c.globalAlpha = 1;
      if (b.src === 'estimate') { c.save(); rr(c, x0, sy + 4, w, ROW - 8, 5); c.clip(); c.strokeStyle = 'rgba(0,0,0,.18)'; c.lineWidth = 3; for (var k = -20; k < w + 20; k += 9) { c.beginPath(); c.moveTo(x0 + k, sy + ROW); c.lineTo(x0 + k + 14, sy); c.stroke(); } c.restore(); }
      if (on) { c.strokeStyle = C.ink; c.lineWidth = 2; rr(c, x0, sy + 4, w, ROW - 8, 5); c.stroke(); }
      c.fillStyle = '#1b1416'; c.font = '700 11px "DM Sans", sans-serif';
      var who = b.kind === 'action' ? 'ACTION' : ((self.doc.actor(b.who) || {}).name || '?');
      var label = (b.src === 'take' ? '● ' : '') + who + ': ' + (b.text || '');
      if (w > 24) { c.save(); c.beginPath(); c.rect(x0 + 4, sy, w - 8, ROW); c.clip(); c.fillText(label, x0 + 6, sy + ROW / 2 + 4); c.restore(); }
      hits.push({ kind: 'beat', id: b.id, x0: x0, x1: x1, y0: sy, y1: sy + ROW });
      hits.push({ kind: 'gap', id: b.id, x0: x1 - 4, x1: x1 + 6, y0: sy, y1: sy + ROW, beat: b });
      // gap marker
      if (b.gap > 0.05) { c.fillStyle = C.line; c.fillRect(x1 + 1, sy + ROW / 2 - 1, Math.max(0, b.gap * self.pps - 2), 2); }
      d.cast.forEach(function (a) {
        var src = film.source(a.id, b); if (!src) return;
        var y = rowY('actor', a.id);
        c.fillStyle = colOf[a.id]; c.globalAlpha = src.clip.line ? 0.95 : 0.45;
        c.fillRect(x0, y + ROW - 7, w, 4); c.globalAlpha = 1;
      });
    });
    // keys per actor
    var kinds = [['move', '◆'], ['emo', null], ['act', null], ['look', '👁']];
    kinds.forEach(function (kd) {
      d.keys[kd[0]].forEach(function (k) {
        var t = L.abs(k.beat, k.at); if (t == null) return;
        var x = self.x(t), y = rowY('actor', k.actor) + ROW / 2 - 2;
        var on = self.sel && self.sel.id === k.id;
        var glyph = kd[1] || (kd[0] === 'emo' ? (VT.EMO[k.emo] || {}).emoji : (VT.GEST[k.act] || {}).emoji) || '?';
        if (kd[0] === 'move') {
          c.fillStyle = colOf[k.actor] || '#ccc'; c.save(); c.translate(x, y); c.rotate(Math.PI / 4); c.fillRect(-5, -5, 10, 10); if (on) { c.strokeStyle = C.ink; c.lineWidth = 2; c.strokeRect(-6, -6, 12, 12); } c.restore();
          var seg = (film.paths[k.actor] || { segs: [] }).segs.filter(function (s) { return s.key === k.id; })[0];
          if (seg && seg.t1 > seg.t0) { c.strokeStyle = colOf[k.actor]; c.globalAlpha = 0.5; c.lineWidth = 2; c.beginPath(); c.moveTo(x + 6, y); c.lineTo(self.x(seg.t1), y); c.stroke(); c.globalAlpha = 1; }
        } else {
          var off = kd[0] === 'emo' ? -9 : kd[0] === 'act' ? 9 : 0;
          if (on) { c.fillStyle = C.ink; c.beginPath(); c.arc(x + off, y, 11, 0, Math.PI * 2); c.fill(); }
          c.font = '14px "Segoe UI Emoji", "Apple Color Emoji", sans-serif'; c.textAlign = 'center'; c.fillText(glyph, x + off, y + 5); c.textAlign = 'left';
        }
        hits.push({ kind: kd[0], id: k.id, x0: x - 8, x1: x + 8, y0: y - 12, y1: y + 12, drag: true });
      });
    });
    // shots
    var cy = rowY('camera');
    film.shots.forEach(function (s, i) {
      var x0 = self.x(s.t), x1 = self.x(s.end), on = self.sel && self.sel.id === s.id;
      c.fillStyle = i % 2 ? '#e8b54a' : '#c99a35'; c.globalAlpha = on ? 1 : 0.8; rr(c, x0, cy + 5, Math.max(3, x1 - x0 - 1), ROW - 10, 4); c.fill(); c.globalAlpha = 1;
      if (on) { c.strokeStyle = C.ink; c.lineWidth = 2; rr(c, x0, cy + 5, Math.max(3, x1 - x0 - 1), ROW - 10, 4); c.stroke(); }
      c.fillStyle = '#1b1416'; c.font = '700 10px "DM Sans", sans-serif';
      var a = self.doc.actor(s.a);
      var lbl = ((VT.SHOT_BY[s.type] || {}).label || s.type) + (a ? ' · ' + a.name : '');
      if (x1 - x0 > 20) { c.save(); c.beginPath(); c.rect(x0 + 3, cy, x1 - x0 - 6, ROW); c.clip(); c.fillText('🎥 ' + lbl, x0 + 5, cy + ROW / 2 + 4); c.restore(); }
      hits.push({ kind: 'shot', id: s.id, x0: x0, x1: Math.max(x0 + 10, x1), y0: cy, y1: cy + ROW, drag: true, edge: true });
    });
    var sdy = rowY('sound');
    film.sfx.forEach(function (s) {
      var x = self.x(s.t), on = self.sel && self.sel.id === s.id;
      c.fillStyle = on ? C.ink : '#7ff9ff'; c.beginPath(); c.arc(x, sdy + ROW / 2, 6, 0, Math.PI * 2); c.fill();
      c.fillStyle = C.muted; c.font = '600 10px "DM Sans", sans-serif'; c.fillText((VT.SFX_BY[s.sfx] || {}).label || s.sfx, x + 9, sdy + ROW / 2 + 4);
      hits.push({ kind: 'sfx', id: s.id, x0: x - 8, x1: x + 8, y0: sdy, y1: sdy + ROW, drag: true });
    });
    // playhead
    var px = this.x(this.time);
    c.fillStyle = '#ff3b4f'; c.fillRect(px - 1, 0, 2, H);
    c.beginPath(); c.moveTo(px - 6, 0); c.lineTo(px + 6, 0); c.lineTo(px, 8); c.fill();
    c.restore();
    // labels
    c.fillStyle = C.label; c.fillRect(0, 0, LABEL, H);
    c.fillStyle = C.muted; c.font = '700 10px "DM Sans", sans-serif'; c.fillText(fmt(this.time) + ' / ' + fmt(total), 8, 14);
    rows.forEach(function (r, i) {
      var y = HEAD + i * ROW;
      if (r.col) { c.fillStyle = r.col; c.fillRect(6, y + 9, 6, 12); }
      c.fillStyle = C.ink; c.font = '700 11px "DM Sans", sans-serif';
      c.save(); c.beginPath(); c.rect(0, y, LABEL - 4, ROW); c.clip(); c.fillText(r.label, r.col ? 17 : 8, y + ROW / 2 + 4); c.restore();
    });
    c.fillStyle = C.line; c.fillRect(LABEL - 1, 0, 1, H);
  };
  function fmt(t) { var m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); }
  VT.fmtTime = fmt;
  function rr(c, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  Timeline.prototype._hit = function (x, y) {
    for (var i = this.hits.length - 1; i >= 0; i--) { var h = this.hits[i]; if (x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1) return h; }
    return null;
  };
  Timeline.prototype._bind = function () {
    var self = this, cv = this.cv, drag = null;
    function pos(ev) { var r = cv.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
    cv.addEventListener('pointerdown', function (ev) {
      var p = pos(ev);
      if (p.x < LABEL) return;
      var h = self._hit(p.x, p.y);
      // the gap handle wins over the beat itself
      var gap = self.hits.filter(function (g) { return g.kind === 'gap' && p.x >= g.x0 && p.x <= g.x1 && p.y >= g.y0 && p.y <= g.y1; })[0];
      if (gap) h = gap;
      if (h && h.kind === 'gap') { drag = { kind: 'gap', h: h, x: p.x, start: h.beat.gap, dur: h.beat.dur }; cv.setPointerCapture(ev.pointerId); return; }
      if (h) {
        var kind = h.kind === 'beat' ? 'beat' : h.kind;
        self.sel = { kind: kind, id: h.id };
        if (self.o.onSelect) self.o.onSelect(self.sel);
        if (h.drag) drag = { kind: 'key', h: h, x: p.x, moved: false };
        if (h.kind === 'beat') { var t = self.t(p.x); if (self.o.onSeek) self.o.onSeek(t); }
        self.draw(); cv.setPointerCapture(ev.pointerId); return;
      }
      drag = { kind: 'seek' };
      if (self.o.onSeek) self.o.onSeek(Math.max(0, self.t(p.x)));
      cv.setPointerCapture(ev.pointerId);
    });
    cv.addEventListener('pointermove', function (ev) {
      var p = pos(ev);
      if (!drag) { var g = self.hits.filter(function (x) { return x.kind === 'gap' && p.x >= x.x0 && p.x <= x.x1 && p.y >= x.y0 && p.y <= x.y1; })[0]; cv.style.cursor = g ? 'ew-resize' : (self._hit(p.x, p.y) || {}).drag ? 'grab' : 'default'; return; }
      if (drag.kind === 'seek') { if (self.o.onSeek) self.o.onSeek(Math.max(0, self.t(p.x))); return; }
      var dx = p.x - drag.x;
      if (drag.kind === 'gap') { drag.dx = dx; drag.live = true; self._ghost = { x: p.x }; self.draw(); var c = self.cv.getContext('2d'); c.fillStyle = '#ff3b4f'; c.fillRect(p.x - 1, HEAD, 2, ROW); return; }
      if (drag.kind === 'key' && Math.abs(dx) > 3) { drag.moved = true; drag.dx = dx; self.draw(); var c2 = self.cv.getContext('2d'); c2.fillStyle = 'rgba(255,59,79,.6)'; c2.fillRect(p.x - 1, drag.h.y0, 2, drag.h.y1 - drag.h.y0); }
    });
    function up(ev) {
      if (!drag) return;
      var doc = self.doc;
      if (drag.kind === 'gap' && drag.dx) {
        var b = doc.beat(drag.h.id), lb = drag.h.beat, delta = drag.dx / self.pps;
        if (b.kind === 'action' && !ev.altKey) doc.updateBeat(b.id, { dur: Math.round(VT.clamp(lb.dur + delta, 0.5, 30) * 100) / 100 });
        else doc.updateBeat(b.id, { gap: Math.round(VT.clamp(lb.gap + delta, -lb.dur * 0.8, 10) * 100) / 100 });
      }
      if (drag.kind === 'key' && drag.moved) {
        var f = doc.findKey(drag.h.id);
        if (f) {
          var t0 = self.film().L.abs(f.key.beat, f.key.at), t1 = Math.max(0, t0 + drag.dx / self.pps);
          var an = doc.anchor(t1, self.film().L);
          doc.updateKey(f.key.id, { beat: an.beat, at: an.at });
        }
      }
      drag = null; self.draw();
    }
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', function () { drag = null; self.draw(); });
    cv.addEventListener('wheel', function (ev) {
      if (ev.ctrlKey || ev.metaKey) { ev.preventDefault(); self.zoom(ev.deltaY < 0 ? 1.15 : 1 / 1.15); return; }
      if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) || ev.shiftKey) { ev.preventDefault(); self.scroll = VT.clamp(self.scroll + (ev.deltaX || ev.deltaY), 0, self.maxScroll || 0); self.draw(); }
    }, { passive: false });
  };
  Timeline.prototype.destroy = function () { if (this._ro) this._ro.disconnect(); this.el.innerHTML = ''; };
})();
