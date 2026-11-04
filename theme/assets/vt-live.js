/* vt-live.js: the director watches the headset live (WebRTC, peer to peer).

   The Anvil server only carries the two messages that set a call up (an offer from the computer, an answer from the
   headset, through stage_links.rtc); the picture and the sound go straight from the headset to the computer. There is no
   trickle ICE: each side gathers its network candidates first, so exactly those two messages are needed (the same pattern
   as Robo Presence). A data channel carries the view choice one way and the performer's status the other.
     Computer: var v = new VT.LiveViewer(videoEl, {onState(state), onInfo(info)});
               v.offer() -> Promise<sdp>   (then the server)   v.accept(answerSdp);  v.view('eyes' | 'film'); v.mute(bool); v.close()
               states: calling, connecting, live, ended, failed, idle
     Headset:  VT.liveAnswer(perform, offerSdp, {onState}) -> Promise<answer sdp>   (a new offer replaces the old call)
               VT.liveHangUp();  VT.liveActive() -> true while a computer watches
   The picture is VT.Perform.startPreview(): what the performer sees (or the film camera), 640 x 360, ~12 frames a
   second. The headset's microphone joins once it is on (the first Action), so the director hears the performance. */
(function () {
  'use strict';
  var VT = window.VT = window.VT || {};
  var ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
  VT.LIVE_ICE = ICE;

  function gathered(pc, ms) {
    return new Promise(function (res) {
      if (pc.iceGatheringState === 'complete') { res(); return; }
      var done = false, fin = function () { if (!done) { done = true; res(); } };
      pc.addEventListener('icegatheringstatechange', function () { if (pc.iceGatheringState === 'complete') fin(); });
      setTimeout(fin, ms || 3000);
    });
  }
  function play(video) { var p = video.play(); if (p && p.catch) p.catch(function () {}); }

  /* ------------------------------------------------------------------ the computer (viewer) */
  function LiveViewer(video, o) {
    this.video = video; this.o = o || {}; this.pc = null; this.ch = null; this.state = 'idle'; this.info = {};
    this._view = 'eyes'; this._muted = true;
    video.muted = true; video.playsInline = true; video.autoplay = true;
  }
  VT.LiveViewer = LiveViewer;
  LiveViewer.prototype._set = function (s) {
    if (this.state === s) return;
    this.state = s;
    if (this.o.onState) this.o.onState(s);
  };
  LiveViewer.prototype.offer = function () {
    var self = this;
    this.close(true);
    if (!window.RTCPeerConnection) return Promise.reject(new Error('This browser can\'t show a live view (no WebRTC).'));
    var pc = this.pc = new RTCPeerConnection({ iceServers: ICE });
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    var ch = this.ch = pc.createDataChannel('vt', { ordered: true });
    ch.onopen = function () { ch.send(JSON.stringify({ view: self._view })); };
    ch.onmessage = function (e) {
      try { self.info = JSON.parse(e.data); } catch (x) { return; }
      if (self.o.onInfo) self.o.onInfo(self.info);
    };
    var ms = new MediaStream();
    pc.ontrack = function (e) {
      ms.addTrack(e.track);
      self.video.srcObject = ms;
      self.video.muted = self._muted;
      play(self.video);
    };
    pc.onconnectionstatechange = function () {
      if (pc !== self.pc) return;
      var s = pc.connectionState;
      if (s === 'connected') self._set('live');
      else if (s === 'failed') self._set('failed');
      else if (s === 'disconnected' || s === 'closed') self._set('ended');
    };
    this._set('calling');
    return pc.createOffer().then(function (d) { return pc.setLocalDescription(d); })
      .then(function () { return gathered(pc, 3000); })
      .then(function () { return pc.localDescription.sdp; });
  };
  LiveViewer.prototype.accept = function (sdp) {
    var self = this, pc = this.pc;
    if (!pc || !sdp) return Promise.resolve(false);
    this._set('connecting');
    return pc.setRemoteDescription({ type: 'answer', sdp: sdp }).then(function () { return true; })
      .catch(function (e) { console.warn('live view', e); self._set('failed'); return false; });
  };
  LiveViewer.prototype.view = function (v) {
    this._view = v === 'film' ? 'film' : 'eyes';
    if (this.ch && this.ch.readyState === 'open') this.ch.send(JSON.stringify({ view: this._view }));
  };
  LiveViewer.prototype.mute = function (m) {
    this._muted = !!m; this.video.muted = this._muted;
    if (!this._muted) play(this.video);
  };
  // for the tests and the status line: is a real picture arriving?
  LiveViewer.prototype.stats = function () {
    var v = this.video;
    return { state: this.state, w: v.videoWidth || 0, h: v.videoHeight || 0, t: v.currentTime || 0,
      audio: !!(v.srcObject && v.srcObject.getAudioTracks && v.srcObject.getAudioTracks().length) };
  };
  LiveViewer.prototype.close = function (quiet) {
    if (this.pc) { try { this.pc.close(); } catch (e) {} }
    this.pc = null; this.ch = null; this.info = {};
    try { this.video.srcObject = null; } catch (e) {}
    if (!quiet) this._set('idle');
  };

  /* ------------------------------------------------------------------ the headset (sender) */
  var _call = null;
  VT.liveAnswer = function (perform, sdp, o) {
    o = o || {};
    VT.liveHangUp();
    if (!window.RTCPeerConnection || !perform || !perform.startPreview) return Promise.reject(new Error('No WebRTC here.'));
    var pc = new RTCPeerConnection({ iceServers: ICE });
    var stream = perform.startPreview({ w: 640, h: 360, fps: 12, view: 'eyes' });
    var call = _call = { pc: pc, perform: perform, timer: null, ch: null, a: null, mic: null };
    pc.ondatachannel = function (e) {
      call.ch = e.channel;
      e.channel.onmessage = function (m) {
        try { var d = JSON.parse(m.data); if (d.view) perform.setPreviewView(d.view); } catch (x) {}
      };
    };
    pc.onconnectionstatechange = function () {
      var s = pc.connectionState;
      if (o.onState) o.onState(s);
      if ((s === 'failed' || s === 'closed' || s === 'disconnected') && _call === call) {
        // a dropped computer: stop drawing the preview (a new offer starts it again)
        setTimeout(function () { if (_call === call && pc.connectionState !== 'connected') VT.liveHangUp(); }, s === 'disconnected' ? 6000 : 0);
      }
    };
    return pc.setRemoteDescription({ type: 'offer', sdp: sdp }).then(function () {
      var video = stream.getVideoTracks()[0];
      pc.getTransceivers().forEach(function (t) {
        var kind = t.receiver && t.receiver.track && t.receiver.track.kind;
        t.direction = 'sendonly';
        if (kind === 'video') t.sender.replaceTrack(video);
        else if (kind === 'audio') call.a = t;
      });
      return pc.createAnswer();
    }).then(function (d) { return pc.setLocalDescription(d); })
      .then(function () { return gathered(pc, 3000); })
      .then(function () {
        call.timer = setInterval(function () {
          // the microphone starts with the first Action: add it to the call without a new offer
          var mic = perform._stream && perform._stream.getAudioTracks()[0];
          if (mic && call.a && call.mic !== mic) { call.a.sender.replaceTrack(mic); call.mic = mic; }
          if (call.ch && call.ch.readyState === 'open') {
            var v = perform.view(), me = perform.doc.actor(perform.actor);
            call.ch.send(JSON.stringify({ state: perform.state, mode: perform.mode, role: me ? me.name : '', head: v.head || '', line: v.line || '' }));
          }
        }, 500);
        return pc.localDescription.sdp;
      });
  };
  VT.liveHangUp = function () {
    var call = _call;
    if (!call) return;
    _call = null;
    clearInterval(call.timer);
    try { call.pc.close(); } catch (e) {}
    call.perform.stopPreview();
  };
  VT.liveActive = function () { return !!(_call && _call.pc.connectionState === 'connected'); };
})();
