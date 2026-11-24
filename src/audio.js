// SymphonAI audio engine: procedural multi-genre band driven by a conductor.
const MODES = {
  epic:   { name: 'Epic',   scale: [0, 2, 3, 5, 7, 8, 10], prog: [0, 5, 2, 6], tempoMul: 1.0 },
  joyful: { name: 'Joyful', scale: [0, 2, 4, 5, 7, 9, 11], prog: [0, 4, 5, 3], tempoMul: 1.1 },
  dreamy: { name: 'Dreamy', scale: [0, 2, 4, 6, 7, 9, 11], prog: [0, 1, 4, 0], tempoMul: 0.85 },
  dark:   { name: 'Dark',   scale: [0, 1, 3, 5, 7, 8, 11], prog: [0, 1, 0, 6], tempoMul: 0.95 },
};

// kick/snare/hat/perc: 16-step patterns (1 = hit, 2 = soft)
const GENRES = {
  classical: { name: 'Classical', icon: '🎻', bpm: 84, swing: 0, seventh: false,
    harm: { inst: 'string', style: 'sustain' }, melody: { inst: 'flute', density: 0.34 }, bass: { inst: 'cello', style: 'root' },
    drums: { timp: [2,0,0,0, 0,0,0,0, 2,0,0,0, 0,0,0,0] } },
  cinematic: { name: 'Cinematic', icon: '🎬', bpm: 96, swing: 0, seventh: false,
    harm: { inst: 'brass', style: 'sustain' }, melody: { inst: 'string', density: 0.3 }, bass: { inst: 'cello', style: 'root' },
    drums: { timp: [1,0,0,0, 0,0,2,0, 1,0,0,0, 0,0,2,2], kick: [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0] } },
  jazz: { name: 'Jazz', icon: '🎷', bpm: 118, swing: 0.28, seventh: true,
    harm: { inst: 'keys', style: 'comp' }, melody: { inst: 'lead', density: 0.42 }, bass: { inst: 'pluck', style: 'walk' },
    drums: { hat: [2,0,0,2, 0,0,2,0, 0,2,0,0, 2,0,0,2], kick: [2,0,0,0, 0,0,0,0, 2,0,0,0, 0,0,0,0], snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0] } },
  edm: { name: 'Electronic', icon: '🎛️', bpm: 126, swing: 0, seventh: false,
    harm: { inst: 'saw', style: 'stab' }, melody: { inst: 'pluck', density: 0.62 }, bass: { inst: 'sub', style: 'offbeat' },
    drums: { kick: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0], snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0], hat: [0,0,2,0, 0,0,2,0, 0,0,2,0, 0,0,2,2] } },
  lofi: { name: 'Lo-fi', icon: '🌙', bpm: 76, swing: 0.2, seventh: true,
    harm: { inst: 'keys', style: 'comp' }, melody: { inst: 'bell', density: 0.26 }, bass: { inst: 'sub', style: 'root' },
    drums: { kick: [1,0,0,0, 0,0,0,1, 0,0,1,0, 0,0,0,0], snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0], hat: [2,0,2,0, 2,0,2,0, 2,0,2,0, 2,0,2,2] } },
  rock: { name: 'Rock', icon: '🎸', bpm: 112, swing: 0, seventh: false,
    harm: { inst: 'power', style: 'stab' }, melody: { inst: 'lead', density: 0.4 }, bass: { inst: 'pluck', style: 'eighths' },
    drums: { kick: [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,1,0], snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0], hat: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0] } },
};

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Band {
  constructor() {
    this.genre = 'classical'; this.mode = 'epic'; this.root = 57;
    this.bpm = 90; this.targetBpm = 90;
    this.dynamics = 0; // 0..1 set by conductor
    this.zone = 0.5;   // 0..1 x-position emphasis
    this.height = 0.5; // 0..1 (1 = high)
    this.pan = 0;
    this.layerLevels = { harmony: 1, melody: 1, rhythm: 1 };
    this.onStep = null;
    this.running = false;
    this.step = 0; this.bar = 0; this.quarterTimes = [];
    this.lastMelody = 4;
  }
  async start() {
    if (!this.ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C({ latencyHint: 'interactive' });
      const ctx = this.ctx;
      this.master = ctx.createGain(); this.master.gain.value = 0;
      this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = 9000;
      this.panner = ctx.createStereoPanner();
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -16; this.comp.ratio.value = 4;
      this.reverb = ctx.createConvolver(); this.reverb.buffer = this._impulse(2.4, 2.4);
      this.wet = ctx.createGain(); this.wet.gain.value = 0.28;
      this.bus = ctx.createGain();
      this.bus.connect(this.tone); this.bus.connect(this.reverb); this.reverb.connect(this.wet); this.wet.connect(this.tone);
      this.tone.connect(this.panner); this.panner.connect(this.master); this.master.connect(this.comp); this.comp.connect(ctx.destination);
      this.noiseBuf = this._noise();
      this.shaper = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 4); }
      this.shaper.curve = curve; this.shaper.connect(this.bus);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    if (!this.running) {
      this.running = true; this.step = 0; this.bar = 0;
      this.nextTime = this.ctx.currentTime + 0.08;
      this.timer = setInterval(() => this._schedule(), 25);
    }
  }
  audioStream() { // for recording: tap the final mix
    if (!this.recDest) { this.recDest = this.ctx.createMediaStreamDestination(); this.comp.connect(this.recDest); }
    return this.recDest.stream;
  }
  stop() { this.running = false; clearInterval(this.timer); if (this.master) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); }
  setStyle(genre, mode) {
    this.genre = genre; this.mode = mode;
    this.root = 48 + Math.floor(Math.random() * 12);
    this.targetBpm = GENRES[genre].bpm * MODES[mode].tempoMul; this.bpm = this.targetBpm;
    this.step = 0; this.bar = 0;
  }
  setTempoFromConductor(bpm) {
    const g = GENRES[this.genre];
    // keep feel: user beat = quarter note, clamp to a sensible range
    this.targetBpm = Math.max(g.bpm * 0.45, Math.min(g.bpm * 1.9, bpm));
  }
  nudgePhase(t) {
    if (!this.quarterTimes.length) return;
    let best = null;
    for (const q of this.quarterTimes) if (best === null || Math.abs(q - t) < Math.abs(best - t)) best = q;
    const spb = 60 / this.bpm, err = t - best;
    if (Math.abs(err) < spb * 0.3) this.nextTime += err * 0.5;
  }
  accent(vel = 0.8) { // downbeat swell
    if (!this.ctx || !this.running) return;
    this._drum('timp', this.ctx.currentTime + 0.01, vel * 0.6 * (0.3 + this.dynamics));
  }
  update(dt) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.bpm += (this.targetBpm - this.bpm) * Math.min(1, dt * 3);
    const d = Math.pow(this.dynamics, 1.3);
    this.master.gain.setTargetAtTime(d * 0.95, t, 0.06);
    this.tone.frequency.setTargetAtTime(700 + this.height * 9500 * (0.4 + d * 0.6), t, 0.1);
    this.panner.pan.setTargetAtTime(this.pan, t, 0.1);
    // zone emphasis: left = strings/harmony, centre = melody, right = rhythm
    const centres = { harmony: 0.15, melody: 0.5, rhythm: 0.85 };
    for (const k in centres) {
      const dist = this.zone - centres[k];
      this.layerLevels[k] = 0.28 + 0.72 * Math.exp(-(dist * dist) / 0.05);
    }
  }
  _chord(bar) {
    const m = MODES[this.mode], g = GENRES[this.genre];
    const deg = m.prog[bar % m.prog.length];
    const s = m.scale, at = (i) => s[i % 7] + 12 * Math.floor(i / 7);
    const tones = [at(deg), at(deg + 2), at(deg + 4)];
    if (g.seventh) tones.push(at(deg + 6));
    return { deg, tones: tones.map((x) => this.root + x), rootNote: this.root + at(deg) };
  }
  _schedule() {
    const ctx = this.ctx; if (!ctx || !this.running) return;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this._playStep(this.step, this.nextTime);
      const g = GENRES[this.genre];
      const base = 60 / this.bpm / 4;
      const swing = this.step % 2 === 1 ? -g.swing * base * 0.5 : g.swing * base * 0.5;
      if (this.step % 4 === 0) { this.quarterTimes.push(this.nextTime); if (this.quarterTimes.length > 8) this.quarterTimes.shift(); }
      this.nextTime += base + swing;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar++;
    }
  }
  _playStep(step, t) {
    const g = GENRES[this.genre], d = this.dynamics, L = this.layerLevels;
    if (this.onStep) this.onStep(step, this.bar);
    if (d < 0.025) return;
    const c = this._chord(this.bar), spb = 60 / this.bpm, sd = spb / 4;
    const vel = 0.25 + d * 0.75;
    // harmony
    const hv = vel * L.harmony;
    if (g.harm.style === 'sustain') {
      if (step === 0) c.tones.forEach((n, i) => this._note(g.harm.inst, mtof(n + (i ? 0 : 0) + 12), t, spb * 4 * 0.98, hv * 0.55));
    } else if (g.harm.style === 'comp') {
      if ([0, 6, 10].includes(step)) c.tones.forEach((n) => this._note(g.harm.inst, mtof(n + 12), t, sd * 3, hv * 0.4));
    } else if (g.harm.style === 'stab') {
      if ([0, 3, 6, 8, 10, 14].includes(step)) c.tones.forEach((n, i) => this._note(g.harm.inst, mtof(n + (g.harm.inst === 'power' ? (i === 2 ? 12 : 0) : 12)), t, sd * 1.6, hv * 0.4));
    }
    // bass
    const bv = vel * L.rhythm, br = c.rootNote - 12;
    const bs = g.bass.style;
    if (bs === 'root' && step % 8 === 0) this._note(g.bass.inst, mtof(br), t, sd * 7, bv * 0.7);
    else if (bs === 'walk' && step % 4 === 0) { const w = [0, 2, 4, 5][(step / 4) | 0]; this._note(g.bass.inst, mtof(br + [0, c.tones[1] - c.tones[0], c.tones[2] - c.tones[0], 7][(step / 4) | 0] + 0 * w), t, sd * 3.5, bv * 0.8); }
    else if (bs === 'offbeat' && step % 4 === 2) this._note(g.bass.inst, mtof(br), t, sd * 2, bv * 0.8);
    else if (bs === 'eighths' && step % 2 === 0) this._note(g.bass.inst, mtof(br), t, sd * 1.7, bv * 0.7);
    // drums
    for (const k in g.drums) {
      const v = g.drums[k][step];
      if (v) this._drum(k, t, (v === 1 ? 1 : 0.5) * vel * L.rhythm);
    }
    // melody
    if (Math.random() < g.melody.density * (0.5 + d * 0.8) && (step % 2 === 0 || g.melody.density > 0.5)) {
      const m = MODES[this.mode].scale;
      const reg = Math.round(this.height * 6) - 3;
      this.lastMelody += [-2, -1, -1, 0, 1, 1, 2][(Math.random() * 7) | 0];
      this.lastMelody = Math.max(0, Math.min(13, this.lastMelody));
      if (step === 0 && Math.random() < 0.5) this.lastMelody = c.deg + 7 * (Math.random() < 0.5 ? 0 : 1);
      const i = this.lastMelody, note = this.root + 12 + m[i % 7] + 12 * Math.floor(i / 7) + reg * 0;
      const len = [1, 2, 2, 4][(Math.random() * 4) | 0] * sd;
      this._note(g.melody.inst, mtof(note + (reg > 0 ? 12 : 0)), t, len, vel * L.melody * 0.7);
    }
  }
  // ---------- synthesis ----------
  _env(g, t, a, d, s, r, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(peak * s, 0.0002), t + a + d);
    g.gain.setValueAtTime(Math.max(peak * s, 0.0002), t + Math.max(dur, a + d));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, a + d) + r);
  }
  _osc(type, f, t, end, detune = 0) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune;
    o.start(t); o.stop(end); return o;
  }
  _note(inst, f, t, dur, vel) {
    const ctx = this.ctx; if (vel < 0.01) return;
    const out = ctx.createGain(), filt = ctx.createBiquadFilter(); filt.type = 'lowpass';
    let dest = this.bus, a = 0.01, d = 0.1, s = 0.6, r = 0.2, peak = vel * 0.3;
    const oscs = [];
    switch (inst) {
      case 'string': case 'cello':
        a = inst === 'cello' ? 0.12 : 0.3; r = 0.5; filt.frequency.value = inst === 'cello' ? 900 : 2600; peak = vel * 0.16;
        [-9, 0, 9].forEach((dt) => oscs.push(this._osc('sawtooth', f, t, t + dur + r + 0.1, dt))); break;
      case 'brass':
        a = 0.14; d = 0.2; s = 0.7; r = 0.3; peak = vel * 0.17;
        filt.frequency.setValueAtTime(500, t); filt.frequency.linearRampToValueAtTime(2800, t + 0.25);
        [-6, 6].forEach((dt) => oscs.push(this._osc('sawtooth', f, t, t + dur + r + 0.1, dt))); break;
      case 'flute':
        a = 0.06; r = 0.25; filt.frequency.value = 3500; peak = vel * 0.3;
        oscs.push(this._osc('sine', f, t, t + dur + r + 0.1)); oscs.push(this._osc('triangle', f * 2, t, t + dur + r + 0.1)); break;
      case 'keys':
        a = 0.008; d = 0.4; s = 0.25; r = 0.3; filt.frequency.value = 2200; peak = vel * 0.28;
        oscs.push(this._osc('triangle', f, t, t + dur + r + 0.1)); oscs.push(this._osc('sine', f * 2, t, t + dur + r + 0.1)); break;
      case 'lead':
        a = 0.02; d = 0.15; s = 0.55; r = 0.2; filt.frequency.value = 3200; peak = vel * 0.2;
        oscs.push(this._osc('square', f, t, t + dur + r + 0.1, 4)); oscs.push(this._osc('sawtooth', f, t, t + dur + r + 0.1, -4)); break;
      case 'pluck':
        a = 0.004; d = 0.25; s = 0.05; r = 0.1; peak = vel * 0.34;
        filt.frequency.setValueAtTime(4000, t); filt.frequency.exponentialRampToValueAtTime(600, t + 0.25);
        oscs.push(this._osc('sawtooth', f, t, t + dur + r + 0.1)); break;
      case 'saw':
        a = 0.01; d = 0.2; s = 0.3; r = 0.15; filt.frequency.value = 3800; peak = vel * 0.13;
        [-14, -5, 5, 14].forEach((dt) => oscs.push(this._osc('sawtooth', f, t, t + dur + r + 0.1, dt))); break;
      case 'power':
        a = 0.005; d = 0.12; s = 0.6; r = 0.1; filt.frequency.value = 2800; dest = this.shaper; peak = vel * 0.12;
        oscs.push(this._osc('sawtooth', f, t, t + dur + r + 0.1, -6)); oscs.push(this._osc('sawtooth', f, t, t + dur + r + 0.1, 6)); break;
      case 'sub':
        a = 0.01; d = 0.2; s = 0.7; r = 0.1; filt.frequency.value = 600; peak = vel * 0.5;
        oscs.push(this._osc('sine', f, t, t + dur + r + 0.1)); oscs.push(this._osc('triangle', f, t, t + dur + r + 0.1)); break;
      case 'bell':
        a = 0.004; d = 0.9; s = 0.05; r = 0.5; filt.frequency.value = 6000; peak = vel * 0.24;
        oscs.push(this._osc('sine', f, t, t + 1.8)); oscs.push(this._osc('sine', f * 2.76, t, t + 1.8)); break;
      default: oscs.push(this._osc('sine', f, t, t + dur + r + 0.1));
    }
    this._env(out, t, a, d, s, r, peak, dur);
    oscs.forEach((o) => o.connect(filt)); filt.connect(out); out.connect(dest);
  }
  _drum(kind, t, v) {
    const ctx = this.ctx; if (v < 0.02) return;
    const g = ctx.createGain(); g.connect(this.bus);
    if (kind === 'kick' || kind === 'timp') {
      const o = ctx.createOscillator(); o.type = 'sine';
      const hi = kind === 'kick' ? 150 : 110, lo = kind === 'kick' ? 45 : 60;
      o.frequency.setValueAtTime(hi, t); o.frequency.exponentialRampToValueAtTime(lo, t + (kind === 'kick' ? 0.12 : 0.35));
      const len = kind === 'kick' ? 0.3 : 0.9;
      g.gain.setValueAtTime(v * 0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g); o.start(t); o.stop(t + len + 0.05);
    } else {
      const n = ctx.createBufferSource(); n.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter();
      if (kind === 'snare') { f.type = 'bandpass'; f.frequency.value = 1800; g.gain.setValueAtTime(v * 0.6, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18); }
      else { f.type = 'highpass'; f.frequency.value = 7000; g.gain.setValueAtTime(v * 0.25, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05); }
      n.connect(f); f.connect(g); n.start(t); n.stop(t + 0.25);
    }
  }
  _noise() {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b;
  }
  _impulse(sec, decay) {
    const n = this.ctx.sampleRate * sec, b = this.ctx.createBuffer(2, n, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
    return b;
  }
}
export { GENRES, MODES };
