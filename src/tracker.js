// Trainable object tracker: tap your pen/pencil/wand and it learns its colour,
// then follows it frame by frame. Coordinates are normalised and mirrored (selfie view).
export class Tracker {
  constructor() {
    this.W = 256; this.H = 192;
    this.cv = document.createElement('canvas'); this.cv.width = this.W; this.cv.height = this.H;
    this.cx = this.cv.getContext('2d', { willReadFrequently: true });
    this.target = null; this.tol = 52; this.pos = null; this.found = false; this.lost = 0; this.count = 0; this.minPix = 5;
  }
  grab(video) {
    const { cx, W, H } = this;
    cx.save(); cx.translate(W, 0); cx.scale(-1, 1); cx.drawImage(video, 0, 0, W, H); cx.restore();
  }
  // Learn the object under the tap. Thin objects (pencil, chopstick) are only a few pixels wide, so rather than
  // averaging the patch (which mostly averages the background) we find the pixel that differs most from its surroundings.
  train(nx, ny) {
    const { cx, W, H } = this;
    const R = 10, x0 = Math.max(0, Math.round(nx * W) - R), y0 = Math.max(0, Math.round(ny * H) - R);
    const w = Math.min(W - x0, R * 2 + 1), h = Math.min(H - y0, R * 2 + 1);
    const d = cx.getImageData(x0, y0, w, h).data;
    const px = (x, y) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    let bg = [0, 0, 0], nb = 0;
    for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const p = px(x, y); bg[0] += p[0]; bg[1] += p[1]; bg[2] += p[2]; nb++; }
    for (let y = 1; y < h - 1; y++) for (const x of [0, w - 1]) { const p = px(x, y); bg[0] += p[0]; bg[1] += p[1]; bg[2] += p[2]; nb++; }
    bg = bg.map((v) => v / nb);
    const dist = (p) => Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]);
    let best = -1, bx = w >> 1, by = h >> 1;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const dd = dist(px(x, y)) - Math.hypot(x - R, y - R) * 1.5; // prefer pixels near the tap
      if (dd > best) { best = dd; bx = x; by = y; }
    }
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = Math.max(0, by - 1); y <= Math.min(h - 1, by + 1); y++) for (let x = Math.max(0, bx - 1); x <= Math.min(w - 1, bx + 1); x++) {
      const p = px(x, y); if (dist(p) > dist(px(bx, by)) * 0.6) { r += p[0]; g += p[1]; b += p[2]; n++; }
    }
    if (!n) { const p = px(bx, by); r = p[0]; g = p[1]; b = p[2]; n = 1; }
    this.target = [r / n, g / n, b / n]; this.bgContrast = dist(this.target);
    this.pos = { x: (x0 + bx) / W, y: (y0 + by) / H }; this.found = true; this.lost = 0;
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
    const maxPix = W * H * 0.1;
    if (n > maxPix) { this.tol = Math.max(18, this.tol * 0.88); n = 0; } // matched a big chunk of background: tighten
    else if (n < this.minPix && this.lost > 3) this.tol = Math.min(95, this.tol * 1.04);
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
