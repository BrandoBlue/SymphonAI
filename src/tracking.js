// Tracking back-ends. Each returns a normalised, mirrored (selfie-view) point {x,y} or null.
//  - HandTracker : MediaPipe hand landmarks (most robust; follows the hand holding the tool)
//  - MotionTracker: follows whatever is moving (works with any object, no training)
// The colour tracker lives in tracker.js.
export class HandTracker {
  // Detects on a crop that follows the hand (so it keeps working when you step back), and re-acquires by scanning zoomed crops.
  constructor() {
    this.ready = false; this.loading = null; this.error = null; this.last = null; this.lastVT = -1;
    this.pos = null; this.spanPx = 0; this.misses = 0; this.scan = 0;
    this.cv = document.createElement('canvas'); this.cx = this.cv.getContext('2d');
  }
  init() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const { FilesetResolver, HandLandmarker } = await import('../vendor/mediapipe/vision_bundle.mjs');
        const fs = await FilesetResolver.forVisionTasks('vendor/mediapipe/wasm');
        const make = (delegate) => HandLandmarker.createFromOptions(fs, {
          baseOptions: { modelAssetPath: 'vendor/mediapipe/hand_landmarker.task', delegate }, runningMode: 'IMAGE', numHands: 1,
          minHandDetectionConfidence: 0.25, minHandPresenceConfidence: 0.25, minTrackingConfidence: 0.25 });
        try { this.lmk = await make('GPU'); this.delegate = 'GPU'; } catch { this.lmk = await make('CPU'); this.delegate = 'CPU'; }
        this.ready = true;
      } catch (e) { this.error = e; this.ready = false; throw e; }
    })();
    return this.loading;
  }
  _try(video, x, y, w, h) { // crop in source pixels -> landmarks mapped back to the full frame (unmirrored, normalised)
    const vw = video.videoWidth, vh = video.videoHeight;
    x = Math.max(0, Math.min(vw - w, x)); y = Math.max(0, Math.min(vh - h, y));
    const k = 320 / Math.max(w, h); this.cv.width = Math.round(w * k); this.cv.height = Math.round(h * k);
    this.cx.drawImage(video, x, y, w, h, 0, 0, this.cv.width, this.cv.height);
    let r; try { r = this.lmk.detect(this.cv); } catch { return null; }
    const lm = r.landmarks && r.landmarks[0]; if (!lm) return null;
    return lm.map((p) => ({ x: (x + p.x * w) / vw, y: (y + p.y * h) / vh }));
  }
  detect(video) {
    if (!this.ready || video.readyState < 2 || !video.videoWidth) return this.last;
    if (video.currentTime === this.lastVT) return this.last;
    this.lastVT = video.currentTime;
    const vw = video.videoWidth, vh = video.videoHeight; let lm = null;
    if (this.pos) { // follow the hand: crop sized to keep it ~1/4 of the window
      const side = Math.max(0.45 * vh, Math.min(vh, this.spanPx * 5));
      lm = this._try(video, (1 - this.pos.x) * vw - side / 2, this.pos.y * vh - side / 2, side, side);
    }
    if (!lm) lm = this._try(video, 0, 0, vw, vh);
    if (!lm) { // scan zoomed windows so a far-away hand is still found
      const side = 0.5 * vh, cxs = [0.25, 0.5, 0.75], cys = [0.35, 0.65], n = this.scan++ % 6;
      lm = this._try(video, cxs[n % 3] * vw - side / 2, cys[(n / 3) | 0] * vh - side / 2, side, side);
    }
    if (!lm) { if (++this.misses > 3) { this.last = null; this.pos = null; } return this.last; }
    this.misses = 0;
    const m = lm.map((p) => ({ x: 1 - p.x, y: p.y }));
    this.spanPx = Math.hypot((lm[9].x - lm[0].x) * vw, (lm[9].y - lm[0].y) * vh);
    let x = 0, y = 0; const idx = [0, 5, 9, 13, 17];
    for (const i of idx) { x += m[i].x; y += m[i].y; } x /= 5; y /= 5;
    x += (m[9].x - m[0].x) * 0.9; y += (m[9].y - m[0].y) * 0.9;
    this.pos = { x, y };
    const a = this.last ? 0.65 : 1, px = this.last ? this.last.x : x, py = this.last ? this.last.y : y;
    this.last = { x: px + (x - px) * a, y: py + (y - py) * a, lm: m };
    return this.last;
  }
}

const BIG_VARIANTS = [[1, 0.35], [1, -0.35], [0.8, 0], [1.25, 0], [0.8, 0.35], [0.8, -0.35], [1.25, 0.35], [1.25, -0.35], [1, 0.7], [1, -0.7], [0.65, 0], [1.6, 0]];
const SMALL_VARIANTS = [[1, 0.04], [1, -0.04], [1.035, 0], [0.965, 0], [1.035, 0.04], [0.965, -0.04]];

// Tap-to-segment: MediaPipe Interactive Segmenter finds the whole object under your tap (the full pencil / eraser).
export class ObjectSegmenter {
  constructor() { this.ready = false; this.loading = null; this.error = null; this.cv = document.createElement('canvas'); this.cv.width = this.cv.height = 256; this.cx = this.cv.getContext('2d'); }
  init() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const { FilesetResolver, InteractiveSegmenter } = await import('../vendor/mediapipe/vision_bundle.mjs');
        const fs = await FilesetResolver.forVisionTasks('vendor/mediapipe/wasm');
        const make = (delegate) => InteractiveSegmenter.createFromOptions(fs, { baseOptions: { modelAssetPath: 'vendor/mediapipe/magic_touch.tflite', delegate }, outputCategoryMask: true, outputConfidenceMasks: false });
        try { this.seg = await make('GPU'); } catch { this.seg = await make('CPU'); }
        this.ready = true;
      } catch (e) { this.error = e; this.ready = false; throw e; }
    })();
    return this.loading;
  }
  // nx,ny: tap in mirrored normalised coords. Returns the object in tracker-pixel space (W x H) or null.
  segment(video, nx, ny, W, H) {
    if (!this.ready || !video.videoWidth) return null;
    const vw = video.videoWidth, vh = video.videoHeight;
    const mh = 0.55, mw = Math.min(1, mh * vh / vw);
    const mx0 = Math.max(0, Math.min(1 - mw, nx - mw / 2)), my0 = Math.max(0, Math.min(1 - mh, ny - mh / 2));
    const c = this.cx; c.save(); c.translate(256, 0); c.scale(-1, 1);
    c.drawImage(video, vw - (mx0 + mw) * vw, my0 * vh, mw * vw, mh * vh, 0, 0, 256, 256); c.restore();
    let res = null;
    try {
      this.seg.segment(this.cv, { keypoint: { x: (nx - mx0) / mw, y: (ny - my0) / mh } }, (r) => {
        const m = r.categoryMask; if (!m) return;
        res = { data: Uint8Array.from(m.getAsUint8Array()), w: m.width, h: m.height };
      });
    } catch (e) { return null; }
    if (!res) return null;
    const { data, w, h } = res;
    const cnt = {}; for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [w >> 1, 0], [w >> 1, h - 1], [0, h >> 1], [w - 1, h >> 1]]) { const v = data[y * w + x]; cnt[v] = (cnt[v] || 0) + 1; }
    const bgv = +Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
    let n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[y * w + x] !== bgv) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (n < 20 || n > w * h * 0.45) return null;
    // to tracker pixels
    const sx = (mw * W) / w, sy = (mh * H) / h, ox = mx0 * W, oy = my0 * H;
    const bx0 = Math.floor(ox + x0 * sx) - 2, by0 = Math.floor(oy + y0 * sy) - 2, bx1 = Math.ceil(ox + (x1 + 1) * sx) + 2, by1 = Math.ceil(oy + (y1 + 1) * sy) + 2;
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    if (bw > 90 || bh > 90 || bw < 5 || bh < 5) return null;
    const mask = new Uint8Array(bw * bh); let area = 0;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = Math.min(w - 1, Math.max(0, Math.floor((bx0 + x - ox) / sx))), j = Math.min(h - 1, Math.max(0, Math.floor((by0 + y - oy) / sy)));
      if (data[j * w + i] !== bgv) { mask[y * bw + x] = 1; area++; }
    }
    return { x0: bx0, y0: by0, bw, bh, mask, area };
  }
}

// Tracks a tapped object. With a segmentation mask the whole object is the template (object pixels weighted, background ignored);
// without one it falls back to a small patch. Predicts motion, re-scans the frame when lost, and re-segments to follow rotation.
export class PointTracker {
  constructor() {
    this.W = 320; this.H = 240; this.cv = document.createElement('canvas'); this.cv.width = this.W; this.cv.height = this.H;
    this.cx = this.cv.getContext('2d', { willReadFrequently: true });
    this.thr = 34; this.ready = false; this.pos = null; this.vel = { x: 0, y: 0 }; this.lost = 0; this.found = false; this.frameNo = 0; this.score = 99;
    this.maskCanvas = document.createElement('canvas');
  }
  setSensitivity(v) { this.thr = 22 + v * 40; }
  grab(video) { const { cx, W, H } = this; cx.save(); cx.translate(W, 0); cx.scale(-1, 1); cx.drawImage(video, 0, 0, W, H); cx.restore(); this.img = null; }
  _data() { return this.img || (this.img = this.cx.getImageData(0, 0, this.W, this.H).data); }
  _cut(d, x0, y0, pw, ph) { const out = new Float32Array(pw * ph * 3), W = this.W;
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const s = ((y0 + y) * W + x0 + x) * 4, o = (y * pw + x) * 3; out[o] = d[s]; out[o + 1] = d[s + 1]; out[o + 2] = d[s + 2]; }
    return out; }
  _setTemplate(d, x0, y0, pw, ph, wts, tapX, tapY) {
    x0 = Math.max(0, Math.min(this.W - pw, x0)); y0 = Math.max(0, Math.min(this.H - ph, y0));
    this.pw = pw; this.ph = ph; this.tpl = this._cut(d, x0, y0, pw, ph); this.w = wts;
    this.wsum = wts.reduce((a, b) => a + b, 0) * 3;
    this.cx_ = x0 + pw / 2; this.cy_ = y0 + ph / 2; // template centre in tracker px
    this.ox = tapX - this.cx_; this.oy = tapY - this.cy_;
    this._preview();
  }
  _preview() {
    const { pw, ph, w: wts } = this; const mc = this.maskCanvas; mc.width = pw; mc.height = ph; const m = mc.getContext('2d'), im = m.createImageData(pw, ph);
    for (let i = 0; i < wts.length; i++) { const on = wts[i] > 0.5; im.data[i * 4] = 92; im.data[i * 4 + 1] = 242; im.data[i * 4 + 2] = 154; im.data[i * 4 + 3] = on ? 150 : 0; }
    m.putImageData(im, 0, 0);
  }
  // Object pixels count fully, but the area around the tapped tip counts most: a pencil is a uniform strip, so matching on the
  // whole body alone would slide along its length. The tip pins the position; the body keeps the geometry (and rotation) right.
  _objWeights(obj, tx, ty) {
    const w = new Float32Array(obj.bw * obj.bh), lx = tx - obj.x0, ly = ty - obj.y0;
    for (let y = 0; y < obj.bh; y++) for (let x = 0; x < obj.bw; x++) {
      const i = y * obj.bw + x, g = Math.exp(-((x - lx) ** 2 + (y - ly) ** 2) / (2 * 7 * 7));
      w[i] = obj.mask[i] ? 0.3 + 0.7 * g : 0.015;
    }
    return w;
  }
  // obj: result of ObjectSegmenter.segment (or null for the small-patch fallback)
  train(nx, ny, obj) {
    const { W, H } = this, d = this._data(), tx = nx * W, ty = ny * H;
    if (obj) {
      const wts = this._objWeights(obj, tx, ty);
      this._setTemplate(d, obj.x0, obj.y0, obj.bw, obj.bh, wts, tx, ty); this.segmented = true; this.area0 = obj.area;
    } else {
      const n = 19, R = 9, cx0 = Math.min(W - R - 1, Math.max(R, Math.round(tx))), cy0 = Math.min(H - R - 1, Math.max(R, Math.round(ty)));
      const p = this._cut(d, cx0 - R, cy0 - R, n, n); let br = 0, bg = 0, bb = 0, c = 0;
      for (let i = 0; i < n; i++) for (const j of [0, n - 1]) for (const [x, y] of [[i, j], [j, i]]) { const o = (y * n + x) * 3; br += p[o]; bg += p[o + 1]; bb += p[o + 2]; c++; }
      br /= c; bg /= c; bb /= c; const w = new Float32Array(n * n); let mx = 0;
      for (let i = 0; i < w.length; i++) { w[i] = Math.max(0, Math.hypot(p[i * 3] - br, p[i * 3 + 1] - bg, p[i * 3 + 2] - bb) - 25); mx = Math.max(mx, w[i]); }
      for (let i = 0; i < w.length; i++) w[i] = mx > 20 ? 0.1 + 0.9 * Math.min(1, w[i] / (mx * 0.6)) : 1;
      this._setTemplate(d, cx0 - R, cy0 - R, n, n, w, tx, ty); this.segmented = false;
    }
    this.pos = { x: tx / W, y: ty / H }; this.vel = { x: 0, y: 0 }; this.lost = 0; this.found = true; this.ready = true; this.score = 0;
    return true;
  }
  _score(d, ccx, ccy, best, T = this) {
    const { pw, ph, tpl, w } = T, W = this.W; const x0 = ccx - (pw >> 1), y0 = ccy - (ph >> 1); let s = 0, ws = 0;
    for (let y = 0; y < ph; y += 2) { const row = (y0 + y) * W + x0;
      for (let x = 0; x < pw; x += 2) { const k = w[y * pw + x], q = (row + x) * 4, o = (y * pw + x) * 3;
        s += k * (Math.abs(d[q] - tpl[o]) + Math.abs(d[q + 1] - tpl[o + 1]) + Math.abs(d[q + 2] - tpl[o + 2])); ws += k * 3; }
      if (ws > 0 && s > best * ws * 1.3 + 1e-6 && y > 4) return Infinity; }
    return ws ? s / ws : Infinity;
  }
  _search(d, ccx, ccy, rad, stride, T = this, limit = this.thr * 1.6) {
    const { W, H } = this, { pw, ph } = T; let best = limit, bx = -1, by = -1;
    const x0 = Math.max(pw >> 1, ccx - rad), x1 = Math.min(W - (pw >> 1) - 1, ccx + rad), y0 = Math.max(ph >> 1, ccy - rad), y1 = Math.min(H - (ph >> 1) - 1, ccy + rad);
    for (let y = y0; y <= y1; y += stride) for (let x = x0; x <= x1; x += stride) { const s = this._score(d, x, y, best, T); if (s < best) { best = s; bx = x; by = y; } }
    return bx < 0 ? null : { x: bx, y: by, s: best };
  }
  // rotated / scaled copy of the template, so the object is still found when it turns or you step back
  _variant(s, a) {
    const { pw, ph, tpl, w } = this, c = Math.cos(a), sn = Math.sin(a);
    const nw = Math.min(90, Math.max(5, Math.ceil((pw * Math.abs(c) + ph * Math.abs(sn)) * s))), nh = Math.min(90, Math.max(5, Math.ceil((pw * Math.abs(sn) + ph * Math.abs(c)) * s)));
    const nt = new Float32Array(nw * nh * 3), nwts = new Float32Array(nw * nh).fill(0.05);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const dx = (x - nw / 2 + 0.5) / s, dy = (y - nh / 2 + 0.5) / s;
      const sx = Math.floor(dx * c + dy * sn + pw / 2), sy = Math.floor(-dx * sn + dy * c + ph / 2);
      if (sx < 0 || sy < 0 || sx >= pw || sy >= ph) continue;
      const si = sy * pw + sx, di = y * nw + x; nwts[di] = w[si]; nt[di * 3] = tpl[si * 3]; nt[di * 3 + 1] = tpl[si * 3 + 1]; nt[di * 3 + 2] = tpl[si * 3 + 2];
    }
    return { pw: nw, ph: nh, tpl: nt, w: nwts, wsum: nwts.reduce((p, q) => p + q, 0) * 3, ox: s * (this.ox * c - this.oy * sn), oy: s * (this.ox * sn + this.oy * c) };
  }
  _tryVariants(d, px, py, base, list = BIG_VARIANTS, rad = 20 + this.lost * 4, stride = 2) {
    let best = base ? base.s : this.thr * 1.6, win = null;
    for (const [s, a] of list) {
      const v = this._variant(s, a), r = this._search(d, px, py, rad, stride, v, best);
      if (r && r.s < best) { best = r.s; win = { v, r }; }
    }
    return win;
  }
  _adopt(win) { const v = win.v; this.pw = v.pw; this.ph = v.ph; this.tpl = v.tpl; this.w = v.w; this.wsum = v.wsum; this.ox = v.ox; this.oy = v.oy; this.cx_ = win.r.x; this.cy_ = win.r.y; this._preview(); }
  step(video, seg) {
    if (!this.ready) return null;
    const { W, H } = this, d = this._data(); this.frameNo++;
    const px = Math.round(this.cx_ + this.vel.x * W), py = Math.round(this.cy_ + this.vel.y * H);
    let r = this._search(d, px, py, this.lost < 2 ? 22 : Math.min(56, 22 + this.lost * 4), this.lost < 2 ? 1 : 2);
    if (!r && this.lost >= 4 && this.frameNo % 4 === 0) r = this._search(d, W >> 1, H >> 1, W, 3);
    if ((!r || r.s > this.thr * 0.7) && this.lost < 10 && (this.lost < 2 || this.frameNo % 2 === 0)) { // weak match: maybe it rotated or changed size
      const win = this._tryVariants(d, px, py, r);
      if (win && (!r || win.r.s < r.s * 0.85)) { this._adopt(win); r = win.r; }
    } else if (r && r.s > 3) { // good match: keep nudging the template's rotation / size so the tip offset turns with the object
      const win = this._tryVariants(d, r.x, r.y, r, SMALL_VARIANTS, 3, 1);
      if (win && win.r.s < r.s * 0.97) { this._adopt(win); r = win.r; }
    }
    if (r && r.s < this.thr) {
      const vx = (r.x - this.cx_) / W, vy = (r.y - this.cy_) / H;
      this.vel = { x: this.vel.x * 0.6 + vx * 0.4, y: this.vel.y * 0.6 + vy * 0.4 };
      this.cx_ += (r.x - this.cx_) * 0.85; this.cy_ += (r.y - this.cy_) * 0.85; this.score = r.s;
      this.pos = { x: (this.cx_ + this.ox) / W, y: (this.cy_ + this.oy) / H };
      this.lost = 0; this.found = true;
      if (r.s < this.thr * 0.55) { const x0 = Math.round(this.cx_ - this.pw / 2), y0 = Math.round(this.cy_ - this.ph / 2);
        if (x0 >= 0 && y0 >= 0 && x0 + this.pw <= W && y0 + this.ph <= H) { const p = this._cut(d, x0, y0, this.pw, this.ph); for (let i = 0; i < p.length; i++) this.tpl[i] += (p[i] - this.tpl[i]) * 0.05; } }
      // follow rotation / shape change: occasionally re-segment around the tracked point
      if (this.segmented && seg && seg.ready && video && r.s < this.thr * 0.6 && (this.frameNo - (this.lastRefresh || 0) >= 45)) { this.lastRefresh = this.frameNo; this._refresh(video, seg, d); }
      return this.pos;
    }
    if (this.segmented && seg && seg.ready && video && this.lost >= 1 && this.lost <= 8 && this.lost % 2 === 1) { // lost it: re-find the object around where it should be
      const keep = this.pos; this.pos = { x: (this.cx_ + this.vel.x * W + this.ox) / W, y: (this.cy_ + this.vel.y * H + this.oy) / H };
      if (this._refresh(video, seg, d, true)) { this.lost = 0; this.found = true; return this.pos; }
      this.pos = keep;
    }
    this.lost++; this.vel.x *= 0.7; this.vel.y *= 0.7; if (this.lost > 15) this.found = false;
    return this.found ? this.pos : null;
  }
  _refresh(video, seg, d, relaxed) {
    const o = seg.segment(video, this.pos.x, this.pos.y, this.W, this.H);
    if (!o || o.area < this.area0 * (relaxed ? 0.4 : 0.5) || o.area > this.area0 * (relaxed ? 2.5 : 2)) return false;
    let tx = this.pos.x * this.W, ty = this.pos.y * this.H, bd = 1e9;
    for (let y = 0; y < o.bh; y++) for (let x = 0; x < o.bw; x++) if (o.mask[y * o.bw + x]) { const dd = (o.x0 + x - tx) ** 2 + (o.y0 + y - ty) ** 2; if (dd < bd) { bd = dd; var bx = o.x0 + x, by = o.y0 + y; } }
    if (bd < 1e9 && bd > 4) { tx = bx; ty = by; }
    this._setTemplate(d, o.x0, o.y0, o.bw, o.bh, this._objWeights(o, tx, ty), tx, ty);
    this.cx_ = o.x0 + o.bw / 2; this.cy_ = o.y0 + o.bh / 2; this.vel = { x: 0, y: 0 };
    return true;
  }
}

export class MotionTracker {
  constructor() {
    this.W = 96; this.H = 72; this.cv = document.createElement('canvas'); this.cv.width = this.W; this.cv.height = this.H;
    this.cx = this.cv.getContext('2d', { willReadFrequently: true }); this.prev = null; this.pos = null; this.lost = 0; this.thr = 26;
  }
  reset() { this.prev = null; this.pos = null; this.lost = 0; }
  step(video) {
    const { cx, W, H } = this;
    cx.save(); cx.translate(W, 0); cx.scale(-1, 1); cx.drawImage(video, 0, 0, W, H); cx.restore();
    const d = cx.getImageData(0, 0, W, H).data, g = new Uint8Array(W * H);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
    if (!this.prev) { this.prev = g; return null; }
    let sx = 0, sy = 0, n = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const k = y * W + x; if (Math.abs(g[k] - this.prev[k]) > this.thr) { sx += x; sy += y; n++; }
    }
    this.prev = g;
    if (n >= 10 && n < W * H * 0.5) {
      const nx = sx / n / W, ny = sy / n / H;
      this.pos = this.pos ? { x: this.pos.x + (nx - this.pos.x) * 0.55, y: this.pos.y + (ny - this.pos.y) * 0.55 } : { x: nx, y: ny };
      this.lost = 0; return this.pos;
    }
    if (++this.lost > 8) this.pos = null;
    return this.pos;
  }
}
