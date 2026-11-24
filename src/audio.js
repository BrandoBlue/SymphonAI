// Sound engine: one lead voice you play by pinching, plus a backing band per theme.
// Everything is synthesized live with the Web Audio API, no samples.

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const acc = (a) => (a === '#' ? 1 : a === 'b' ? -1 : 0);
export const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

// "C#4" -> MIDI note number (middle C = C4 = 60)
export function noteToMidi(s) {
  const m = /^([A-G])([#b]?)(\d)$/.exec(s);
  if (!m) throw new Error('Bad note: ' + s);
  return 12 * (+m[3] + 1) + PC[m[1]] + acc(m[2]);
}
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const noteName = (m) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

// "Am", "G7", "Bb" -> { pc: pitch class, tones: semitones above the root }
export function parseChord(n) {
  const m = /^([A-G])([#b]?)(m?)(7?)$/.exec(n);
  if (!m) throw new Error('Bad chord: ' + n);
  const tones = m[3] ? [0, 3, 7] : [0, 4, 7];
  if (m[4]) tones.push(10);
  return { pc: (PC[m[1]] + acc(m[2]) + 12) % 12, tones, name: n };
}

// oscs: [waveform, level, detune in cents]. vib: [rate Hz, depth cents].
// att/dec/sus/rel: envelope. glide: seconds to slide between notes. retrig: re-pluck on every new note.
export const THEMES = {
  theremin: { name: 'Theremin', color: '#2fe6c8', bpm: 84, scale: 'maj', oct: 0, back: 'soft',
    lead: { oscs: [['sine', 1, 0], ['triangle', 0.35, 0]], vib: [5.5, 22], cut: 2600, q: 0.5,
      att: 0.06, dec: 0, sus: 1, rel: 0.3, glide: 0.08, retrig: false, vol: 0.34 } },
  metal: { name: 'Metal', color: '#ff4a3d', bpm: 150, scale: 'min', oct: -12, back: 'metal',
    lead: { oscs: [['sawtooth', 1, -8], ['sawtooth', 1, 8], ['sawtooth', 0.8, 702], ['square', 0.5, -1200]],
      drive: 60, hp: 110, cut: 3200, q: 1, att: 0.004, dec: 0.5, sus: 0.75, rel: 0.12, glide: 0.02, retrig: true, vol: 0.16 } },
  guitar: { name: 'Guitar', color: '#ffb347', bpm: 96, scale: 'maj', oct: 0, back: 'strum',
    lead: { oscs: [['sawtooth', 0.6, 0], ['triangle', 1, 0]], cut: 3800, cutEnv: [5000, 900, 0.35], q: 2,
      att: 0.003, dec: 1.3, sus: 0.12, rel: 0.25, glide: 0.02, retrig: true, vol: 0.36 } },
  synthwave: { name: 'Synthwave', color: '#ff4fd8', bpm: 108, scale: 'min', oct: 0, back: 'synth',
    lead: { oscs: [['sawtooth', 1, -12], ['sawtooth', 1, 12], ['square', 0.4, -1200]], vib: [5, 12], cut: 2000, q: 5,
      att: 0.03, dec: 0.3, sus: 0.8, rel: 0.45, glide: 0.09, retrig: false, vol: 0.2 } },
  chip: { name: 'Chiptune', color: '#ffe14d', bpm: 140, scale: 'maj', oct: 0, back: 'chip',
    lead: { oscs: [['square', 1, 0]], cut: 9000, q: 0.1, att: 0.002, dec: 0.1, sus: 0.7, rel: 0.06, glide: 0, retrig: true, vol: 0.15 } },
};

function curve(k) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
  return c;
}

class Lead {
  constructor(E, p) {
    const A = E.ac; this.A = A; this.p = p;
    this.out = A.createGain(); this.out.gain.value = 0; this.out.connect(E.leadBus);
    this.filt = A.createBiquadFilter(); this.filt.type = 'lowpass';
    this.filt.frequency.value = p.cut; this.filt.Q.value = p.q; this.filt.connect(this.out);
    let into = this.filt;
    if (p.hp) { const h = A.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = p.hp; h.connect(into); into = h; }
    if (p.drive) { const s = A.createWaveShaper(); s.curve = curve(p.drive); s.oversample = '2x'; s.connect(into); into = s; }
    let lg = null;
    if (p.vib) {
      this.lfo = A.createOscillator(); this.lfo.frequency.value = p.vib[0];
      lg = A.createGain(); lg.gain.value = p.vib[1]; this.lfo.connect(lg); this.lfo.start();
    }
    const sum = p.oscs.reduce((a, o) => a + o[1], 0);
    this.oscs = p.oscs.map(([type, g, det]) => {
      const o = A.createOscillator(), v = A.createGain();
      o.type = type; o.detune.value = det; v.gain.value = g / sum;
      o.connect(v); v.connect(into); if (lg) lg.connect(o.detune); o.start();
      return o;
    });
  }
  freq(f, t, instant) {
    for (const o of this.oscs) {
      const fr = o.frequency; fr.cancelScheduledValues(t);
      if (instant || !this.p.glide) fr.setValueAtTime(f, t);
      else { fr.setValueAtTime(fr.value, t); fr.setTargetAtTime(f, t, this.p.glide / 3); }
    }
  }
  on(t) {
    const p = this.p, g = this.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(p.retrig ? 0 : g.value, t);
    g.linearRampToValueAtTime(p.vol, t + p.att);
    if (p.dec) g.setTargetAtTime(p.vol * p.sus, t + p.att, p.dec / 3);
    if (p.cutEnv) {
      const f = this.filt.frequency; f.cancelScheduledValues(t);
      f.setValueAtTime(p.cutEnv[0], t); f.setTargetAtTime(p.cutEnv[1], t + 0.005, p.cutEnv[2] / 3);
    }
  }
  off(t) { const g = this.out.gain; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.setTargetAtTime(0, t, this.p.rel / 3); }
  dispose() {
    this.off(this.A.currentTime);
    setTimeout(() => { this.oscs.forEach((o) => o.stop()); this.lfo?.stop(); this.out.disconnect(); }, 1500);
  }
}

export class Engine {
  constructor() {
    const A = (this.ac = new (window.AudioContext || window.webkitAudioContext)());
    this.comp = A.createDynamicsCompressor(); this.comp.threshold.value = -12; this.comp.ratio.value = 4;
    this.master = A.createGain(); this.master.gain.value = 0.9;
    this.comp.connect(this.master); this.master.connect(A.destination);
    this.meter = A.createAnalyser(); this.meter.fftSize = 1024; this.master.connect(this.meter);
    this.leadBus = A.createGain(); this.leadBus.connect(this.comp);
    this.backBus = A.createGain(); this.backBus.gain.value = 0.55;
    const bl = A.createBiquadFilter(); bl.type = 'lowpass'; bl.frequency.value = 7000;
    this.backBus.connect(bl); bl.connect(this.comp);
    this.guideBus = A.createGain(); this.guideBus.gain.value = 0.45; this.guideBus.connect(this.comp);
    // distorted rhythm guitar for the metal band
    this.distIn = A.createGain(); this.distIn.gain.value = 0.6;
    const sh = A.createWaveShaper(); sh.curve = curve(40); sh.oversample = '2x';
    const dh = A.createBiquadFilter(); dh.type = 'highpass'; dh.frequency.value = 90;
    const dl = A.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2600;
    const dg = A.createGain(); dg.gain.value = 0.32;
    this.distIn.connect(sh); sh.connect(dh); dh.connect(dl); dl.connect(dg); dg.connect(this.backBus);
    this.nb = A.createBuffer(1, A.sampleRate, A.sampleRate);
    const d = this.nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  setTheme(id) { this.themeId = id; this.theme = THEMES[id]; if (this.lead) this.lead.dispose(); this.lead = new Lead(this, this.theme.lead); }
  level() { const a = new Float32Array(this.meter.fftSize); this.meter.getFloatTimeDomainData(a); return Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length); }

  tone(f, t, dur, o = {}) {
    const A = this.ac, { type = 'triangle', g = 0.2, att = 0.005, rel = 0.1, dec = 0, dest = this.backBus, cut = 0, det = 0 } = o;
    const os = A.createOscillator(), v = A.createGain();
    os.type = type; os.frequency.value = f; os.detune.value = det;
    const end = t + Math.max(dur, att + 0.02);
    v.gain.setValueAtTime(0, t); v.gain.linearRampToValueAtTime(g, t + att);
    if (dec) v.gain.setTargetAtTime(0, t + att, dec / 3);
    else { v.gain.setValueAtTime(g, Math.max(t + att, end - rel)); v.gain.linearRampToValueAtTime(0, end); }
    let n = os;
    if (cut) { const fl = A.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = cut; os.connect(fl); n = fl; }
    n.connect(v); v.connect(dest); os.start(t); os.stop(end + 0.05);
  }
  noiseHit(t, hp, len, v) {
    const A = this.ac, s = A.createBufferSource(), f = A.createBiquadFilter(), g = A.createGain();
    s.buffer = this.nb; f.type = 'highpass'; f.frequency.value = hp;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    s.connect(f); f.connect(g); g.connect(this.backBus); s.start(t, Math.random() * 0.5); s.stop(t + len + 0.02);
  }
  kick(t, v = 1) {
    const A = this.ac, o = A.createOscillator(), g = A.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.22);
    g.gain.setValueAtTime(0.9 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(this.backBus); o.start(t); o.stop(t + 0.32);
  }
  snare(t, v = 1, len = 0.16) { this.noiseHit(t, 1400, len, 0.45 * v); this.tone(190, t, 0.08, { type: 'triangle', g: 0.25 * v, att: 0.001, rel: 0.06 }); }
  hat(t, v = 1, len = 0.04) { this.noiseHit(t, 7000, len, 0.14 * v); }
  guideNote(m, t, dur) { this.tone(mtof(m), t, dur * 0.95, { type: 'sine', g: 0.25, att: 0.01, rel: 0.08, dest: this.guideBus }); }

  // One 8th-note step of the backing band. s = step count, iv = seconds per 8th, ch = chord, bpb = beats per bar.
  backStep(s, t, iv, ch, bpb) {
    const style = this.theme.back, pos = s % (bpb * 2), on = pos % 2 === 0, b = pos >> 1;
    const back = bpb === 3 ? b > 0 : b % 2 === 1; // backbeat
    const bass = 36 + ch.pc - (ch.pc > 7 ? 12 : 0);
    const mid = ch.tones.map((x) => 52 + ((ch.pc + x) % 12));
    const bar = iv * bpb * 2;
    if (style === 'soft') {
      if (pos === 0) {
        mid.forEach((m) => this.tone(mtof(m + 12), t, bar, { type: 'sine', g: 0.06, att: 0.3, rel: 0.5 }));
        this.tone(mtof(bass + 12), t, bar * 0.9, { type: 'sine', g: 0.2, att: 0.05, rel: 0.4 });
      }
      if (on && back) this.hat(t, 0.4, 0.14);
    } else if (style === 'metal') {
      const len = iv * (pos === 0 ? 1.6 : 0.7);
      this.tone(mtof(bass + 12), t, len, { type: 'sawtooth', g: 0.5, att: 0.002, rel: 0.05, dest: this.distIn });
      this.tone(mtof(bass + 19), t, len, { type: 'sawtooth', g: 0.4, att: 0.002, rel: 0.05, dest: this.distIn });
      this.tone(mtof(bass), t, iv * 0.8, { type: 'triangle', g: 0.3, rel: 0.05 });
      this.kick(t, 0.8);
      if (on && back) this.snare(t, 1);
      if (pos === 0) this.hat(t, 0.6, 0.6);
    } else if (style === 'strum') {
      if (on) {
        mid.forEach((m, i) => this.tone(mtof(m + 12), t + i * 0.018, iv * 2, { type: 'triangle', g: 0.08, att: 0.003, dec: 0.5 }));
        if (b % 2 === 0) { this.tone(mtof(bass), t, iv * 1.8, { type: 'triangle', g: 0.3, rel: 0.2 }); this.kick(t, 0.5); }
        if (back) this.snare(t, 0.35, 0.1);
      }
      this.hat(t, on ? 0.2 : 0.12);
    } else if (style === 'synth') {
      this.tone(mtof(bass + (pos % 2 ? 12 : 0)), t, iv * 0.8, { type: 'sawtooth', g: 0.16, att: 0.005, rel: 0.06, cut: 900 });
      if (pos === 0) mid.forEach((m, i) => this.tone(mtof(m + 12), t, bar, { type: 'sawtooth', g: 0.035, att: 0.4, rel: 0.6, cut: 1400, det: i % 2 ? 10 : -10 }));
      if (on) this.kick(t, 0.9);
      if (on && back) this.snare(t, 0.8, 0.3);
      if (!on) this.hat(t, 0.35);
    } else if (style === 'chip') {
      const arp = [...mid, mid[0] + 12];
      this.tone(mtof(arp[(s * 2) % arp.length] + 12), t, iv * 0.45, { type: 'square', g: 0.04, att: 0.001, rel: 0.02 });
      this.tone(mtof(arp[(s * 2 + 1) % arp.length] + 12), t + iv / 2, iv * 0.45, { type: 'square', g: 0.04, att: 0.001, rel: 0.02 });
      if (on) this.tone(mtof(bass + 12), t, iv * 0.9, { type: 'triangle', g: 0.3, att: 0.001, rel: 0.03 });
      if (on && !back) this.kick(t, 0.6);
      if (on && back) this.snare(t, 0.5, 0.08);
    }
  }
}
