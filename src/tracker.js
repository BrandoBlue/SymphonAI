// Trainable object tracker: tap your pen/pencil/wand and it learns its colour,
// then follows it frame by frame. Coordinates are normalised and mirrored (selfie view).
export class Tracker {
  constructor() {
    this.W = 192; this.H = 144;
    this.cv = document.createElement('canvas'); this.cv.width = this.W; this.cv.height = this.H;
    this.cx = this.cv.getContext('2d', { willReadFrequently: true });
    this.target = null; this.tol = 52; this.pos = null; this.found = false; this.lost = 0; this.count = 0; this.minPix = 5;
  }
  grab(video) {
    const { cx, W, H } = this;
    cx.save(); cx.translate(W, 0); cx.scale(-1, 1); cx.drawImage(video, 0, 0, W, H); cx.restore();
  }
  train(nx, ny) {
    const { cx, W, H } = this;
    const x = Math.round(nx * W), y = Math.round(ny * H), r = 3;
    const d = cx.getImageData(Math.max(0, x - r), Math.max(0, y - r), r * 2 + 1, r * 2 + 1).data;
    let R = 0, G = 0, B = 0, n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
    this.target = [R / n, G / n, B / n]; this.pos = { x: nx, y: ny }; this.found = true; this.lost = 0;
    return this.target;
  }
  setSensitivity(v) { this.tol = 25 + v * 70; } // v 0..1
  step() {
    if (!this.target) return null;
    const { cx, W, H, target: t, tol } = this;
    let x0 = 0, y0 = 0, x1 = W, y1 = H;
    if (this.pos && this.lost < 12) { // local search window around last position
      const cxp = this.pos.x * W, cyp = this.pos.y * H, r = 48 + this.lost * 6;
      x0 = Math.max(0, cxp - r | 0); x1 = Math.min(W, cxp + r | 0); y0 = Math.max(0, cyp - r | 0); y1 = Math.min(H, cyp + r | 0);
    }
    const w = x1 - x0, h = y1 - y0; if (w < 2 || h < 2) return null;
    const d = cx.getImageData(x0, y0, w, h).data, t2 = tol * tol;
    let sx = 0, sy = 0, n = 0, mr = 0, mg = 0, mb = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, dr = d[i] - t[0], dg = d[i + 1] - t[1], db = d[i + 2] - t[2];
      if (dr * dr + dg * dg + db * db < t2) { sx += x; sy += y; n++; mr += d[i]; mg += d[i + 1]; mb += d[i + 2]; }
    }
    this.count = n;
    if (n >= this.minPix) {
      const nx = (x0 + sx / n) / W, ny = (y0 + sy / n) / H;
      const a = this.pos && this.lost === 0 ? 0.55 : 1; // light smoothing
      this.pos = this.pos ? { x: this.pos.x + (nx - this.pos.x) * a, y: this.pos.y + (ny - this.pos.y) * a } : { x: nx, y: ny };
      // drift-adapt to lighting
      t[0] += (mr / n - t[0]) * 0.015; t[1] += (mg / n - t[1]) * 0.015; t[2] += (mb / n - t[2]) * 0.015;
      this.lost = 0; this.found = true;
    } else { this.lost++; if (this.lost > 20) this.found = false; }
    return this.found ? this.pos : null;
  }
}

// Turns a stream of wand positions into conducting signals.
export class Conductor {
  constructor() { this.reset(); }
  reset() {
    this.t = 0; this.x = 0.5; this.y = 0.5; this.vx = 0; this.vy = 0; this.speed = 0;
    this.dyn = 0; this.beats = []; this.bpm = 0; this.beatNo = 0; this.lastBeat = -9;
    this.minY = 1; this.maxY = 0; this.down = false; this.travel = 0; this.lastPos = null; this.lastT = 0;
    this.idle = 0; this.lastBeatStrength = 0;
  }
  // returns {beat:boolean}
  push(p, now) {
    const out = { beat: false };
    if (!this.lastPos) { this.lastPos = { ...p }; this.lastT = now; this.x = p.x; this.y = p.y; return out; }
    const dt = Math.max(0.001, now - this.lastT); this.lastT = now;
    const vx = (p.x - this.lastPos.x) / dt, vy = (p.y - this.lastPos.y) / dt;
    this.vx += (vx - this.vx) * 0.45; this.vy += (vy - this.vy) * 0.45;
    this.lastPos = { ...p }; this.x = p.x; this.y = p.y;
    const sp = Math.hypot(this.vx, this.vy);
    this.speed += (sp - this.speed) * 0.12;
    this.dyn = Math.min(1, this.speed * 0.55);
    // beat = bottom of the downstroke (ictus)
    if (this.vy > 0.25) { this.down = true; this.travel += this.vy * dt; }
    else if (this.down && this.vy < 0.05) {
      if (this.travel > 0.035 && now - this.lastBeat > 0.22) {
        out.beat = true; this.lastBeatStrength = Math.min(1, this.travel * 3.5);
        if (this.lastBeat > 0) {
          const iv = now - this.lastBeat;
          if (iv < 1.6) { this.beats.push(iv); if (this.beats.length > 4) this.beats.shift();
            const s = [...this.beats].sort((a, b) => a - b); const med = s[(s.length - 1) >> 1]; this.bpm = 60 / med; }
          else this.beats = [];
        }
        this.lastBeat = now; this.beatNo++;
      }
      this.down = false; this.travel = 0;
    } else if (this.vy < -0.1) { this.down = false; this.travel = 0; }
    return out;
  }
  decay(dt) { this.speed *= Math.pow(0.4, dt); this.dyn = Math.min(1, this.speed * 0.55); this.lastPos = null; }
}
