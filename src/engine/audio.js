import { settings } from '../state/settings.js';

// Synthesised audio: layered gunshots, mechanical foley, surfaces, abilities,
// UI, ambience beds and an adaptive score — all built from oscillators and noise,
// routed through buses with a generated convolution reverb.

const SHOT = {
  rifle: { crack: 0.9, body: 2600, decay: 0.16, thump: 70, thumpGain: 0.9, tail: 0.5, gain: 0.85 },
  smg: { crack: 0.7, body: 3200, decay: 0.09, thump: 90, thumpGain: 0.5, tail: 0.35, gain: 0.7 },
  shotgun: { crack: 1, body: 1500, decay: 0.32, thump: 55, thumpGain: 1.3, tail: 0.8, gain: 1 },
  dmr: { crack: 1, body: 3000, decay: 0.22, thump: 65, thumpGain: 1, tail: 0.7, gain: 0.95 },
  sniper: { crack: 1.2, body: 2200, decay: 0.38, thump: 48, thumpGain: 1.4, tail: 1.2, gain: 1.05 },
  pistol: { crack: 0.8, body: 3400, decay: 0.1, thump: 95, thumpGain: 0.5, tail: 0.4, gain: 0.7 },
  magnum: { crack: 1.1, body: 2000, decay: 0.26, thump: 60, thumpGain: 1.2, tail: 0.9, gain: 1 },
};

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.ambience = null;
    this.music = null;
    this.musicMode = null;
    this._lastHover = 0;
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    // Browsers only allow audio after a user gesture; until then calls queue up.
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.ui = ctx.createGain(); this.ui.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.connect(this.master);
    this.ambBus = ctx.createGain(); this.ambBus.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.4, 2.8);
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb).connect(this.master);
    this.noise = this.noiseBuffer(2, 'white');
    this.pink = this.noiseBuffer(4, 'pink');
    this.brown = this.noiseBuffer(4, 'brown');
    this.applyVolumes();
    settings.on('change', () => this.applyVolumes());
    this.ready = true;
    if (this._pendingMusic) { this.setMusic(this._pendingMusic); this._pendingMusic = null; }
    if (this._pendingAmb) { this.setAmbience(this._pendingAmb); this._pendingAmb = null; }
  }

  applyVolumes() {
    if (!this.ctx) return;
    const v = settings.values, t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(v.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(v.sfx, t, 0.05);
    this.ui.gain.setTargetAtTime(v.sfx * 0.6, t, 0.05);
    this.musicBus.gain.setTargetAtTime(v.music * 0.55, t, 0.3);
    this.ambBus.gain.setTargetAtTime(v.ambience * 0.8, t, 0.3);
  }

  noiseBuffer(sec, kind) {
    const ctx = this.ctx, len = ctx.sampleRate * sec;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else d[i] = w;
    }
    return buf;
  }

  impulse(sec, decay) {
    const ctx = this.ctx, len = ctx.sampleRate * sec;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const early = i < ctx.sampleRate * 0.08 && Math.random() < 0.004 ? 1.5 : 0;
        d[i] = ((Math.random() * 2 - 1) + early) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  // ---------- helpers ----------
  src(buffer, loop = false) { const s = this.ctx.createBufferSource(); s.buffer = buffer; s.loop = loop; return s; }
  env(gainNode, t, a, peak, d, end = 0.0001) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.exponentialRampToValueAtTime(end, t + a + d);
  }
  /** Spatial output node for a world position relative to the listener. */
  spatial(pos, out = this.sfx) {
    if (!pos) return out;
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 4; p.rolloffFactor = 0.9; p.maxDistance = 200;
    p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2];
    p.connect(out);
    return p;
  }
  setListener(pos, fwd, up = [0, 1, 0]) {
    if (!this.ctx) return;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setValueAtTime(pos[0], t); L.positionY.setValueAtTime(pos[1], t); L.positionZ.setValueAtTime(pos[2], t);
      L.forwardX.setValueAtTime(fwd[0], t); L.forwardY.setValueAtTime(fwd[1], t); L.forwardZ.setValueAtTime(fwd[2], t);
      L.upX.setValueAtTime(up[0], t); L.upY.setValueAtTime(up[1], t); L.upZ.setValueAtTime(up[2], t);
    } else { L.setPosition(...pos); L.setOrientation(...fwd, ...up); }
  }

  noiseHit(t, { dest, filter = 'bandpass', freq = 1000, q = 1, a = 0.002, d = 0.1, gain = 0.5, buffer, rate = 1 }) {
    const s = this.src(buffer || this.noise);
    s.playbackRate.value = rate;
    const f = this.ctx.createBiquadFilter(); f.type = filter; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    this.env(g, t, a, gain, d);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 1.5); s.stop(t + a + d + 0.05);
    return { s, f, g };
  }
  tone(t, { dest, type = 'sine', freq = 440, to, a = 0.005, d = 0.2, gain = 0.3 }) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + a + d);
    const g = this.ctx.createGain(); this.env(g, t, a, gain, d);
    o.connect(g).connect(dest); o.start(t); o.stop(t + a + d + 0.05);
    return o;
  }

  // ---------- weapons ----------
  shot(kind, { pos = null, distant = false, suppressed = false } = {}) {
    if (!this.ready) return;
    const p = SHOT[kind] || SHOT.rifle;
    const t = this.ctx.currentTime;
    const out = this.spatial(pos);
    const bus = this.ctx.createGain(); bus.gain.value = p.gain * (pos ? 1.4 : 1);
    let chain = bus;
    if (distant) { const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800; bus.connect(lp); chain = lp; }
    chain.connect(out);
    const send = this.ctx.createGain(); send.gain.value = p.tail * (pos ? 0.8 : 0.5); bus.connect(send).connect(this.reverbSend);
    // transient crack
    this.noiseHit(t, { dest: bus, filter: 'highpass', freq: 2500, q: 0.7, a: 0.0008, d: 0.03, gain: 0.9 * p.crack });
    // body
    this.noiseHit(t, { dest: bus, filter: 'lowpass', freq: p.body * (0.9 + Math.random() * 0.2), q: 1.2, a: 0.001, d: p.decay, gain: 1.1 });
    this.noiseHit(t + 0.004, { dest: bus, filter: 'bandpass', freq: 700 + Math.random() * 200, q: 1.5, a: 0.002, d: p.decay * 1.3, gain: 0.6 });
    // low thump
    this.tone(t, { dest: bus, type: 'sine', freq: p.thump * 2.2, to: p.thump * 0.6, a: 0.002, d: 0.14 + p.decay * 0.4, gain: 0.8 * p.thumpGain });
    // mechanical clack
    if (!pos) this.noiseHit(t + 0.03, { dest: bus, filter: 'bandpass', freq: 3800, q: 8, a: 0.001, d: 0.025, gain: 0.25 });
  }

  dryFire() { if (!this.ready) return; const t = this.ctx.currentTime; this.noiseHit(t, { dest: this.sfx, filter: 'bandpass', freq: 3000, q: 10, d: 0.03, gain: 0.4 }); }

  /** Mechanical foley: 'magOut','magIn','boltBack','boltFwd','shell','pump','draw','cylinder' */
  mech(kind, pos = null) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, out = this.spatial(pos);
    const M = {
      magOut: [[0, 2200, 6, 0.04, 0.35], [0.03, 900, 3, 0.06, 0.25]],
      magIn: [[0, 1600, 5, 0.03, 0.4], [0.05, 3200, 12, 0.03, 0.5], [0.06, 600, 2, 0.08, 0.3]],
      boltBack: [[0, 2800, 9, 0.04, 0.4], [0.05, 1400, 4, 0.05, 0.25]],
      boltFwd: [[0, 3400, 10, 0.03, 0.55], [0.02, 900, 3, 0.06, 0.35]],
      shell: [[0, 2600, 8, 0.03, 0.3], [0.04, 1200, 4, 0.05, 0.3]],
      pump: [[0, 1200, 4, 0.06, 0.4], [0.12, 2400, 7, 0.05, 0.5], [0.15, 700, 2, 0.06, 0.3]],
      draw: [[0, 4000, 2, 0.12, 0.12], [0.1, 2600, 9, 0.03, 0.3]],
      cylinder: [[0, 3000, 14, 0.02, 0.35], [0.05, 3600, 14, 0.02, 0.3], [0.1, 2800, 14, 0.02, 0.35]],
    }[kind] || [];
    for (const [dt, f, q, d, g] of M) this.noiseHit(t + dt, { dest: out, filter: 'bandpass', freq: f, q, d, gain: g });
  }

  casing(pos) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + 0.25 + Math.random() * 0.15, out = this.spatial(pos);
    for (let i = 0; i < 3; i++) this.tone(t + i * 0.07 * (1 + Math.random()), { dest: out, type: 'triangle', freq: 4200 + Math.random() * 1500, a: 0.001, d: 0.05, gain: 0.05 / (i + 1) });
  }

  impact(surface = 'concrete', pos = null) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, out = this.spatial(pos);
    if (surface === 'metal') {
      this.tone(t, { dest: out, type: 'triangle', freq: 2200 + Math.random() * 1500, to: 1800, a: 0.001, d: 0.25, gain: 0.18 });
      this.noiseHit(t, { dest: out, filter: 'highpass', freq: 3000, d: 0.04, gain: 0.3 });
    } else if (surface === 'flesh') {
      this.noiseHit(t, { dest: out, filter: 'lowpass', freq: 900, d: 0.08, gain: 0.5 });
    } else {
      this.noiseHit(t, { dest: out, filter: 'bandpass', freq: surface === 'snow' || surface === 'sand' ? 800 : 1800, q: 1, d: 0.06, gain: 0.35 });
      if (Math.random() < 0.18) this.tone(t + 0.02, { dest: out, type: 'sine', freq: 3200, to: 900, a: 0.01, d: 0.35, gain: 0.05 });
    }
  }

  footstep(surface = 'concrete', pos = null, heavy = 1) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, out = this.spatial(pos);
    const g = 0.22 * heavy;
    if (surface === 'snow') { for (let i = 0; i < 4; i++) this.noiseHit(t + i * 0.012, { dest: out, filter: 'bandpass', freq: 2500 + Math.random() * 2000, q: 2, d: 0.03, gain: g * 0.5 }); }
    else if (surface === 'sand') { this.noiseHit(t, { dest: out, filter: 'bandpass', freq: 1500, q: 0.8, a: 0.01, d: 0.09, gain: g * 0.6 }); }
    else if (surface === 'metal') { this.noiseHit(t, { dest: out, filter: 'lowpass', freq: 400, d: 0.06, gain: g }); this.tone(t, { dest: out, type: 'triangle', freq: 340 + Math.random() * 60, a: 0.002, d: 0.18, gain: g * 0.25 }); }
    else if (surface === 'wet') { this.noiseHit(t, { dest: out, filter: 'lowpass', freq: 500, d: 0.05, gain: g }); this.noiseHit(t + 0.01, { dest: out, filter: 'highpass', freq: 3500, d: 0.07, gain: g * 0.35 }); }
    else { this.noiseHit(t, { dest: out, filter: 'lowpass', freq: 600, d: 0.05, gain: g }); this.noiseHit(t + 0.005, { dest: out, filter: 'bandpass', freq: 2200, q: 2, d: 0.02, gain: g * 0.3 }); }
  }

  land() { if (!this.ready) return; const t = this.ctx.currentTime; this.noiseHit(t, { dest: this.sfx, filter: 'lowpass', freq: 300, d: 0.12, gain: 0.5 }); }

  // ---------- feedback ----------
  hitmarker(head) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.tone(t, { dest: this.ui, type: 'square', freq: head ? 2400 : 1700, a: 0.001, d: 0.04, gain: 0.08 });
    if (head) this.tone(t + 0.035, { dest: this.ui, type: 'sine', freq: 3200, a: 0.001, d: 0.06, gain: 0.08 });
  }
  kill() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.tone(t, { dest: this.ui, type: 'sine', freq: 520, to: 260, a: 0.002, d: 0.3, gain: 0.25 });
    this.tone(t + 0.05, { dest: this.ui, type: 'triangle', freq: 1560, a: 0.002, d: 0.25, gain: 0.1 });
  }
  hurt() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.noiseHit(t, { dest: this.sfx, filter: 'lowpass', freq: 300, d: 0.2, gain: 0.6 });
    this.tone(t, { dest: this.sfx, type: 'sine', freq: 90, to: 50, d: 0.2, gain: 0.35 });
  }
  heartbeat() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.tone(t, { dest: this.sfx, type: 'sine', freq: 60, to: 40, d: 0.12, gain: 0.35 });
    this.tone(t + 0.22, { dest: this.sfx, type: 'sine', freq: 55, to: 38, d: 0.14, gain: 0.25 });
  }

  ability(id, pos = null) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, out = this.spatial(pos);
    if (id === 'recon') {
      for (let i = 0; i < 3; i++) this.tone(t + i * 0.32, { dest: out, type: 'sine', freq: 1320, to: 1250, a: 0.003, d: 0.7, gain: 0.22 / (i + 1) });
      this.noiseHit(t, { dest: out, filter: 'bandpass', freq: 400, q: 2, a: 0.05, d: 0.6, gain: 0.25 });
    } else if (id === 'barrier') {
      this.noiseHit(t, { dest: out, filter: 'bandpass', freq: 600, q: 0.8, a: 0.1, d: 0.25, gain: 0.5 });
      this.tone(t + 0.3, { dest: out, type: 'triangle', freq: 180, to: 120, a: 0.002, d: 0.6, gain: 0.4 });
      this.noiseHit(t + 0.3, { dest: out, filter: 'bandpass', freq: 2500, q: 6, d: 0.3, gain: 0.3 });
    } else if (id === 'overdrive') {
      this.noiseHit(t, { dest: out, filter: 'bandpass', freq: 600, q: 1.5, a: 0.3, d: 0.3, gain: 0.35 });
      this.tone(t, { dest: out, type: 'sawtooth', freq: 120, to: 480, a: 0.3, d: 0.2, gain: 0.08 });
    } else if (id === 'stim') {
      this.noiseHit(t, { dest: out, filter: 'highpass', freq: 4000, a: 0.02, d: 0.35, gain: 0.25 });
      [880, 1320, 1760].forEach((f, i) => this.tone(t + 0.3 + i * 0.08, { dest: out, type: 'sine', freq: f, d: 0.4, gain: 0.08 }));
    }
  }
  barrierHit(pos) { if (!this.ready) return; const t = this.ctx.currentTime; this.tone(t, { dest: this.spatial(pos), type: 'triangle', freq: 900, to: 700, d: 0.2, gain: 0.15 }); }

  // ---------- UI ----------
  hover() {
    if (!this.ready) return;
    const now = performance.now(); if (now - this._lastHover < 40) return; this._lastHover = now;
    this.tone(this.ctx.currentTime, { dest: this.ui, type: 'sine', freq: 2400, a: 0.001, d: 0.025, gain: 0.025 });
  }
  click() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.tone(t, { dest: this.ui, type: 'triangle', freq: 1200, a: 0.001, d: 0.05, gain: 0.08 });
    this.noiseHit(t, { dest: this.ui, filter: 'bandpass', freq: 5000, q: 4, d: 0.02, gain: 0.08 });
  }
  back() { if (!this.ready) return; this.tone(this.ctx.currentTime, { dest: this.ui, type: 'triangle', freq: 800, to: 600, d: 0.06, gain: 0.07 }); }
  error() { if (!this.ready) return; const t = this.ctx.currentTime; this.tone(t, { dest: this.ui, type: 'square', freq: 180, d: 0.12, gain: 0.06 }); this.tone(t + 0.13, { dest: this.ui, type: 'square', freq: 150, d: 0.15, gain: 0.06 }); }
  unlockSfx() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(t + i * 0.07, { dest: this.ui, type: 'sine', freq: f, d: 0.6, gain: 0.08 }));
    this.noiseHit(t, { dest: this.ui, filter: 'highpass', freq: 6000, a: 0.2, d: 0.6, gain: 0.08 });
    this.tone(t, { dest: this.ui, type: 'sine', freq: 65, to: 40, d: 0.5, gain: 0.3 });
  }
  coin() { if (!this.ready) return; const t = this.ctx.currentTime; this.tone(t, { dest: this.ui, type: 'sine', freq: 1900 + Math.random() * 300, d: 0.08, gain: 0.03 }); }
  beep(high = false) { if (!this.ready) return; this.tone(this.ctx.currentTime, { dest: this.ui, type: 'sine', freq: high ? 1320 : 880, a: 0.003, d: high ? 0.45 : 0.15, gain: 0.12 }); }
  whoosh() { if (!this.ready) return; const t = this.ctx.currentTime; const n = this.noiseHit(t, { dest: this.ui, filter: 'bandpass', freq: 300, q: 1, a: 0.25, d: 0.35, gain: 0.18 }); n.f.frequency.exponentialRampToValueAtTime(2400, t + 0.5); }
  impactBoom() { if (!this.ready) return; const t = this.ctx.currentTime; this.tone(t, { dest: this.sfx, type: 'sine', freq: 70, to: 30, d: 1.4, gain: 0.5 }); this.noiseHit(t, { dest: this.reverbSend, filter: 'lowpass', freq: 800, d: 1.2, gain: 0.5, buffer: this.brown }); }
  stinger(win) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const notes = win ? [220, 277, 330, 440] : [220, 208, 175, 147];
    notes.forEach((f, i) => { this.tone(t + i * 0.12, { dest: this.musicBus, type: 'sawtooth', freq: f, a: 0.05, d: 1.6, gain: 0.05 }); this.tone(t + i * 0.12, { dest: this.musicBus, type: 'sine', freq: f / 2, a: 0.05, d: 1.8, gain: 0.12 }); });
    this.impactBoom();
  }

  // ---------- ambience ----------
  setAmbience(kind) {
    if (!this.ready) { this._pendingAmb = kind; return; }
    if (this.ambience?.kind === kind) return;
    this.stopAmbience();
    if (!kind) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain(); out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(1, t + 2); out.connect(this.ambBus);
    const nodes = [];
    const loop = (buffer, type, freq, q, gain) => {
      const s = this.src(buffer, true); const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain; s.connect(f).connect(g).connect(out); s.start(t, Math.random() * 2); nodes.push(s);
      return { s, f, g };
    };
    const lfo = (param, rate, depth, base) => { const o = ctx.createOscillator(); o.frequency.value = rate; const g = ctx.createGain(); g.gain.value = depth; o.connect(g).connect(param); param.value = base; o.start(); nodes.push(o); };
    let timer = null;
    if (kind === 'rain' || kind === 'menu') {
      loop(this.pink, 'bandpass', 2400, 0.4, kind === 'menu' ? 0.18 : 0.35);
      loop(this.pink, 'highpass', 6000, 0.5, 0.12);
      const rumble = loop(this.brown, 'lowpass', 140, 0.7, 0.35);
      lfo(rumble.g.gain, 0.05, 0.12, 0.3);
      timer = setInterval(() => { // droplets on metal
        const tt = ctx.currentTime;
        if (Math.random() < 0.6) this.tone(tt, { dest: out, type: 'sine', freq: 1800 + Math.random() * 2500, a: 0.001, d: 0.03, gain: 0.015 });
        if (kind === 'menu' && Math.random() < 0.02) this.tone(tt, { dest: out, type: 'sine', freq: 70, to: 50, a: 0.4, d: 2.5, gain: 0.05 });
      }, 90);
    } else if (kind === 'desert') {
      const w = loop(this.pink, 'bandpass', 500, 0.8, 0.3); lfo(w.f.frequency, 0.07, 250, 500); lfo(w.g.gain, 0.11, 0.15, 0.25);
      loop(this.brown, 'lowpass', 90, 0.5, 0.2);
      timer = setInterval(() => { if (Math.random() < 0.05) this.noiseHit(ctx.currentTime, { dest: out, filter: 'bandpass', freq: 5000, q: 3, a: 0.2, d: 0.5, gain: 0.03 }); }, 300);
    } else if (kind === 'arctic') {
      const w = loop(this.pink, 'bandpass', 700, 2.5, 0.35); lfo(w.f.frequency, 0.09, 400, 700); lfo(w.g.gain, 0.06, 0.2, 0.3);
      const w2 = loop(this.pink, 'bandpass', 1400, 4, 0.12); lfo(w2.f.frequency, 0.13, 500, 1400);
      loop(this.brown, 'lowpass', 120, 0.5, 0.25);
    } else if (kind === 'industrial') {
      const hum = ctx.createOscillator(); hum.frequency.value = 50; const hg = ctx.createGain(); hg.gain.value = 0.04; hum.connect(hg).connect(out); hum.start(); nodes.push(hum);
      const hum2 = ctx.createOscillator(); hum2.type = 'triangle'; hum2.frequency.value = 100.5; const hg2 = ctx.createGain(); hg2.gain.value = 0.015; hum2.connect(hg2).connect(out); hum2.start(); nodes.push(hum2);
      loop(this.brown, 'lowpass', 200, 0.5, 0.3);
      const w = loop(this.pink, 'bandpass', 900, 1.2, 0.08); lfo(w.g.gain, 0.08, 0.05, 0.08);
      timer = setInterval(() => {
        const tt = ctx.currentTime;
        if (Math.random() < 0.08) this.tone(tt, { dest: this.reverbSend, type: 'triangle', freq: 180 + Math.random() * 200, to: 140, a: 0.3, d: 1.2, gain: 0.04 }); // creak
        if (Math.random() < 0.15) this.tone(tt, { dest: out, type: 'sine', freq: 2400 + Math.random() * 800, a: 0.001, d: 0.06, gain: 0.03 }); // drip
      }, 400);
    }
    this.ambience = { kind, out, nodes, timer };
  }
  stopAmbience() {
    const a = this.ambience; if (!a) return;
    const t = this.ctx.currentTime;
    a.out.gain.cancelScheduledValues(t); a.out.gain.setValueAtTime(a.out.gain.value, t); a.out.gain.linearRampToValueAtTime(0, t + 1.2);
    clearInterval(a.timer);
    setTimeout(() => { a.nodes.forEach((n) => { try { n.stop(); } catch { /* */ } }); a.out.disconnect(); }, 1400);
    this.ambience = null;
  }

  // ---------- music ----------
  setMusic(mode) {
    if (!this.ready) { this._pendingMusic = mode; return; }
    if (this.musicMode === mode) return;
    this.musicMode = mode;
    this.stopMusic();
    if (!mode) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const out = ctx.createGain(); out.gain.setValueAtTime(0, t0); out.gain.linearRampToValueAtTime(mode === 'combat' ? 0.5 : 1, t0 + 3); out.connect(this.musicBus);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = mode === 'combat' ? 700 : 1100; lp.Q.value = 0.6; lp.connect(out);
    const send = ctx.createGain(); send.gain.value = 0.5; lp.connect(send).connect(this.reverbSend);
    // D minor progression: Dm9 · Bbmaj7 · Gm9 · Asus4→A
    const chords = [[146.8, 174.6, 220, 261.6, 329.6], [116.5, 146.8, 174.6, 220, 293.7], [98, 146.8, 174.6, 233.1, 293.7], [110, 146.8, 164.8, 220, 277.2]];
    const bar = mode === 'combat' ? 6 : 8;
    let step = 0;
    const play = () => {
      const t = ctx.currentTime + 0.05;
      const ch = chords[step % chords.length];
      ch.forEach((f, i) => {
        for (const det of [-6, 6]) {
          const o = ctx.createOscillator(); o.type = i === 0 ? 'triangle' : 'sawtooth'; o.frequency.value = f; o.detune.value = det;
          const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime((i === 0 ? 0.05 : 0.016), t + bar * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + bar + 1.5);
          o.connect(g).connect(lp); o.start(t); o.stop(t + bar + 1.6);
        }
      });
      const sub = ctx.createOscillator(); sub.frequency.value = ch[0] / 2; const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t); sg.gain.exponentialRampToValueAtTime(0.08, t + 1); sg.gain.exponentialRampToValueAtTime(0.0001, t + bar + 1);
      sub.connect(sg).connect(out); sub.start(t); sub.stop(t + bar + 1.1);
      // pulse
      const pulses = mode === 'combat' ? 12 : 4;
      for (let i = 0; i < pulses; i++) {
        const tt = t + (i * bar) / pulses;
        this.tone(tt, { dest: out, type: 'sine', freq: 55, to: 40, a: 0.005, d: 0.25, gain: mode === 'combat' ? 0.07 : 0.05 });
      }
      // sparse high bell
      if (Math.random() < 0.6) this.tone(t + bar * 0.5, { dest: send, type: 'sine', freq: ch[3] * 4, a: 0.005, d: 2.5, gain: 0.012 });
      step++;
    };
    play();
    const iv = setInterval(play, bar * 1000);
    this.music = { out, iv, lp };
  }
  stopMusic() {
    const m = this.music; if (!m) return;
    clearInterval(m.iv);
    const t = this.ctx.currentTime;
    m.out.gain.cancelScheduledValues(t); m.out.gain.setValueAtTime(m.out.gain.value, t); m.out.gain.linearRampToValueAtTime(0, t + 1.5);
    setTimeout(() => m.out.disconnect(), 3000);
    this.music = null;
  }
  duckMusic(v) { if (this.music) this.music.lp.frequency.setTargetAtTime(v ? 500 : 1100, this.ctx.currentTime, 0.4); }
}

export const audio = new AudioEngine();
