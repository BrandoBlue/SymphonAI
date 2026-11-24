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

const BIG_VARIANTS = [[1, 0.18], [1, -0.18], [1, 0.35], [1, -0.35], [0.8, 0], [1.25, 0], [0.8, 0.35], [0.8, -0.35], [1.25, 0.35], [1.25, -0.35], [1, 0.7], [1, -0.7], [0.65, 0], [1.6, 0]];
const TURN_VARIANTS = [[1, 0.05], [1, -0.05], [1, 0.1], [1, -0.1]];
const SIZE_VARIANTS = [[1.07, 0], [1 / 1.07, 0]];

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
    let res = null; const tms = performance.now();
    try {
      this.seg.segment(this.cv, { keypoint: { x: (nx - mx0) / mw, y: (ny - my0) / mh } }, (r) => {
        const m = r.categoryMask; if (!m) return;
        res = { data: Uint8Array.from(m.getAsUint8Array()), w: m.width, h: m.height };
      });
    } catch (e) { return null; }
    this.lastMs = performance.now() - tms;
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
    // pristine copy: every rotated / scaled version is made from this, never from an already-resampled template
    // (resampling a resample blurs and shrinks it until it matches anything; that was the "jumps to something else" bug)
    this.base = { pw, ph, tpl: this.tpl.slice(), w: wts, ox: this.ox, oy: this.oy }; this.sc = 1; this.an = 0;
    this.span0 = this.lastHint && this.lastHint.span ? this.lastHint.span : null;
    this.ang0 = this.lastHint && this.lastHint.ang !== undefined ? this.lastHint.ang : null; this.hs = null; this.ha = null;
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
      w[i] = obj.mask[i] ? 0.6 + 0.4 * g : 0.002;
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
    this.pos = { x: tx / W, y: ty / H }; this.vel = { x: 0, y: 0 }; this.lost = 0; this.found = true; this.ready = true; this.score = 0; this.reacq = false; this.confirm = 0; this.cand = null;
    return true;
  }
  // Weighted colour difference after removing each side's average colour, so auto-exposure / lighting changes don't break the match.
  // Only the object's own pixels are compared (precomputed sample list), which keeps it fast enough for phones.
  _prep(T) {
    const { pw, ph, tpl, w } = T, xs = [], ys = [], ks = [], cs = [];
    for (let y = 0; y < ph; y += 2) for (let x = 0; x < pw; x += 2) { const k = w[y * pw + x]; if (k < 0.05) continue; const o = (y * pw + x) * 3; xs.push(x); ys.push(y); ks.push(k); cs.push(tpl[o], tpl[o + 1], tpl[o + 2]); }
    let q = 0, r = 0, g = 0, b = 0; for (let i = 0; i < ks.length; i++) { q += ks[i]; r += ks[i] * cs[i * 3]; g += ks[i] * cs[i * 3 + 1]; b += ks[i] * cs[i * 3 + 2]; }
    T.P = { xs: Int16Array.from(xs), ys: Int16Array.from(ys), ks: Float32Array.from(ks), cs: Float32Array.from(cs), q, m: q ? [r / q, g / q, b / q] : [0, 0, 0], w, tpl, n: ks.length };
    return T.P;
  }
  _score(d, ccx, ccy, best, T = this) {
    let P = T.P; if (!P || P.w !== T.w || P.tpl !== T.tpl || T.dirty) { P = this._prep(T); T.dirty = false; }
    if (!P.n) return Infinity;
    const W = this.W, x0 = ccx - (T.pw >> 1), y0 = ccy - (T.ph >> 1), { xs, ys, ks, cs, n, q } = P;
    let mr = 0, mg = 0, mb = 0;
    for (let i = 0; i < n; i++) { const o = ((y0 + ys[i]) * W + x0 + xs[i]) * 4, k = ks[i]; mr += k * d[o]; mg += k * d[o + 1]; mb += k * d[o + 2]; }
    mr = mr / q - P.m[0]; mg = mg / q - P.m[1]; mb = mb / q - P.m[2];
    const stop = best * q * 3; let s = 0;
    for (let i = 0; i < n; i++) { const o = ((y0 + ys[i]) * W + x0 + xs[i]) * 4, k = ks[i], c = i * 3;
      s += k * (Math.abs(d[o] - mr - cs[c]) + Math.abs(d[o + 1] - mg - cs[c + 1]) + Math.abs(d[o + 2] - mb - cs[c + 2]));
      if ((i & 15) === 15 && s > stop) return Infinity; }
    return s / (q * 3) + 0.25 * (Math.abs(mr) + Math.abs(mg) + Math.abs(mb)) / 3;
  }
  _search(d, ccx, ccy, rad, stride, T = this, limit = this.thr * 1.6, _fine = false) {
    if (stride === 1 && rad > 5) { const c = this._search(d, ccx, ccy, rad, 2, T, limit); if (!c) return null; const f = this._search(d, c.x, c.y, 2, 1, T, c.s * 1.0001 + 1e-6, true); if (f) { f.second = c.second; return f; } return c; }
    const { W, H } = this, { pw, ph } = T; let best = limit, bx = -1, by = -1; const seen = [];
    const x0 = Math.max(pw >> 1, ccx - rad), x1 = Math.min(W - (pw >> 1) - 1, ccx + rad), y0 = Math.max(ph >> 1, ccy - rad), y1 = Math.min(H - (ph >> 1) - 1, ccy + rad);
    for (let y = y0; y <= y1; y += stride) for (let x = x0; x <= x1; x += stride) { const s = this._score(d, x, y, best * 1.3, T); if (s < Infinity) seen.push(x, y, s); if (s < best) { best = s; bx = x; by = y; } }
    if (bx < 0) return null;
    let second = Infinity; // best match outside the object's own footprint: if it is nearly as good, the match is ambiguous
    const ex = Math.max(12, Math.max(pw, ph) * 0.55), ex2 = ex * ex;
    for (let i = 0; i < seen.length; i += 3) if ((seen[i] - bx) ** 2 + (seen[i + 1] - by) ** 2 > ex2 && seen[i + 2] < second) second = seen[i + 2];
    return { x: bx, y: by, s: best, second };
  }
  // rotated / scaled copy of the template, so the object is still found when it turns or you step back
  _variant(s, a) { // base template rotated by a and scaled by s (absolute, relative to how it looked when learned)
    const { pw, ph, tpl, w, ox, oy } = this.base, c = Math.cos(a), sn = Math.sin(a);
    const nw = Math.min(110, Math.max(5, Math.ceil((pw * Math.abs(c) + ph * Math.abs(sn)) * s))), nh = Math.min(110, Math.max(5, Math.ceil((pw * Math.abs(sn) + ph * Math.abs(c)) * s)));
    const nt = new Float32Array(nw * nh * 3), nwts = new Float32Array(nw * nh).fill(0.002);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const dx = (x - nw / 2 + 0.5) / s, dy = (y - nh / 2 + 0.5) / s;
      // bilinear sampling: nearest-neighbour makes a thin pencil jagged when turned, which looked like a bad match
      const fx = dx * c + dy * sn + pw / 2 - 0.5, fy = -dx * sn + dy * c + ph / 2 - 0.5;
      const ix = Math.floor(fx), iy = Math.floor(fy); if (ix < 0 || iy < 0 || ix >= pw - 1 || iy >= ph - 1) continue;
      const ax = fx - ix, ay = fy - iy, i00 = iy * pw + ix, i10 = i00 + 1, i01 = i00 + pw, i11 = i01 + 1;
      const k00 = (1 - ax) * (1 - ay), k10 = ax * (1 - ay), k01 = (1 - ax) * ay, k11 = ax * ay, di = y * nw + x;
      nwts[di] = w[i00] * k00 + w[i10] * k10 + w[i01] * k01 + w[i11] * k11;
      for (let ch = 0; ch < 3; ch++) nt[di * 3 + ch] = tpl[i00 * 3 + ch] * k00 + tpl[i10 * 3 + ch] * k10 + tpl[i01 * 3 + ch] * k01 + tpl[i11 * 3 + ch] * k11;
    }
    return { s, a, pw: nw, ph: nh, tpl: nt, w: nwts, wsum: nwts.reduce((p, q) => p + q, 0) * 3, ox: s * (ox * c - oy * sn), oy: s * (ox * sn + oy * c) };
  }
  // list entries are [scale factor, angle step] relative to the current pose
  // tx,ty = where the tip is believed to be. Each variant is centred so that ITS tip lands there: the object turns about the tip.
  _tryVariants(d, tx, ty, base, list = BIG_VARIANTS, rad = 20 + this.lost * 4, stride = 2, fixScale = null) {
    let best = base ? base.s : this.thr * 1.6, win = null; const done = new Set();
    for (const [ds, da] of list) {
      const s = fixScale || Math.min(2.8, Math.max(0.35, this.sc * ds)), a = this.an + da, key = s.toFixed(3) + ',' + a.toFixed(3);
      if (done.has(key)) continue; done.add(key);
      const v = this._variant(s, a), r = this._search(d, Math.round(tx - v.ox), Math.round(ty - v.oy), rad, stride, v, best);
      if (r && r.s < best) { best = r.s; win = { v, r }; }
    }
    return win;
  }
  _adopt(win) { const v = win.v; this.sc = v.s; this.an = v.a; this.pw = v.pw; this.ph = v.ph; this.tpl = v.tpl; this.w = v.w; this.wsum = v.wsum; this.ox = v.ox; this.oy = v.oy; this.cx_ = win.r.x; this.cy_ = win.r.y; this._preview(); }
  // hint: {x, y, r} in tracker px = where the hand is. The tool is held in the hand, so a match far from it is not the tool.
  step(video, seg, hint) {
    if (!this.ready) return null;
    this.lastHint = hint;
    const thr0 = this.thr; this.thr = Math.min(55, Math.max(thr0, (this.sAvg || 0) * 2.2)); // noisier camera -> typical scores are higher
    try { return this._step(video, seg, hint); } finally { this.thr = thr0; }
  }
  _step(video, seg, hint) {
    const { W, H } = this, d = this._data(); this.frameNo++;
    const gate = (x, y) => !hint || Math.hypot(x + this.ox - hint.x, y + this.oy - hint.y) <= hint.r;
    const px = Math.round(this.cx_ + this.vel.x * W), py = Math.round(this.cy_ + this.vel.y * H);
    const reacq = this.reacq || this.lost >= 4;
    let r = null;
    if (!reacq) { r = this._search(d, px, py, this.lost < 2 ? 30 : 40, 1);
      if (!r || r.s > this.thr * 0.5) { const r2 = this._search(d, px, py, 44, 2); if (r2 && (!r || r2.s < r.s * 0.9)) { const r3 = this._search(d, r2.x, r2.y, 2, 1); r = r3 && r3.s < r2.s ? r3 : r2; } } } // fast swing: look wider
    else if (hint) r = this._search(d, Math.round(hint.x - this.ox), Math.round(hint.y - this.oy), Math.min(70, Math.round(hint.r)), 2);
    else if (this.frameNo % 3 === 0) r = this._search(d, W >> 1, H >> 1, W, 3);
    // The tool is held rigidly in the hand: the hand's size and turn tell us the tool's size and turn.
    const handPose = hint && hint.span && this.span0 && hint.ang !== undefined && this.ang0 !== null;
    if (handPose && !reacq) {
      let da = hint.ang - this.ang0; da = Math.atan2(Math.sin(da), Math.cos(da));
      this.hs = this.hs ? this.hs + (hint.span / this.span0 - this.hs) * 0.3 : hint.span / this.span0;
      this.ha = this.ha === null ? da : this.ha + Math.atan2(Math.sin(da - this.ha), Math.cos(da - this.ha)) * 0.5;
      const S = Math.min(2.8, Math.max(0.35, this.hs)), tx = (r ? r.x : px) + this.ox, ty = (r ? r.y : py) + this.oy;
      if (Math.abs(S / this.sc - 1) > 0.06 || Math.abs(this.ha - this.an) > 0.04) {
        const v = this._variant(S, this.ha), rr = this._search(d, Math.round(tx - v.ox), Math.round(ty - v.oy), 10, 1, v, r ? r.s * 1.15 : this.thr * 1.6);
        if (rr) { this._adopt({ v, r: rr }); r = rr; }
      }
    }
    if (r && !reacq && !handPose && r.s > this.thr * 0.7 && this.lost < 3) { // weak match: maybe it rotated or changed size
      // when the hand is visible its size tells us the scale, so only search rotations (smaller templates always look "better")
      const fix = hint && hint.span && this.span0 ? Math.min(2.8, Math.max(0.35, this.hs || hint.span / this.span0)) : null;
      const win = this._tryVariants(d, px + this.ox, py + this.oy, r, BIG_VARIANTS, 20 + this.lost * 4, 2, fix);
      if (win && win.r.s < r.s * (fix || win.v.s === this.sc ? 0.85 : 0.75)) { this._adopt(win); r = win.r; }
    } else if (r && !reacq && r.s > 3) { // fine-tune turning so the tip offset turns with the object
      const win = this._tryVariants(d, r.x + this.ox, r.y + this.oy, r, TURN_VARIANTS, r.s > this.thr * 0.4 ? 8 : 4, 1);
      if (win && win.r.s < r.s * 0.94) { this._adopt(win); r = win.r; }
      if (handPose) { /* size and turn already set from the hand */ } else if (hint && hint.span && this.span0) { // size from the hand: stepping back shrinks the hand and the tool equally
        this.hs = this.hs ? this.hs + (hint.span / this.span0 - this.hs) * 0.15 : hint.span / this.span0;
        const target = Math.min(2.8, Math.max(0.35, this.hs));
        if (Math.abs(target / this.sc - 1) > 0.1) { const v = this._variant(target, this.an), rr = this._search(d, Math.round(r.x + this.ox - v.ox), Math.round(r.y + this.oy - v.oy), 4, 1, v, r.s * 1.25); if (rr) { this._adopt({ v, r: rr }); r = rr; } }
      } else if (this.frameNo % 4 === 0) { // no hand: only resize when clearly better
        const w2 = this._tryVariants(d, r.x + this.ox, r.y + this.oy, r, SIZE_VARIANTS, 3, 1);
        if (w2 && w2.r.s < r.s * 0.85) { this._adopt(w2); r = w2.r; }
      }
    }
    this.why = '';
    if (r && r.second < r.s * 1.18 && r.s > this.thr * 0.35) { this.why = 'ambiguous'; r = null; }
    if (r && !gate(r.x, r.y)) { this.why = 'far from hand'; r = null; }
    if (r && !reacq && Math.hypot(r.x - this.cx_, r.y - this.cy_) > 34 + this.lost * 6) { this.why = 'jump'; r = null; }
    if (r && r.s >= this.thr) { this.why = 'weak'; r = null; }
    if (r && reacq) { // re-finding it: only trust it after two consistent, strong matches
      if (r.s < this.thr * 0.65) {
        if (this.cand && Math.hypot(this.cand.x - r.x, this.cand.y - r.y) < 14) this.confirm++; else this.confirm = 1;
        this.cand = { x: r.x, y: r.y };
      } else { this.confirm = 0; this.cand = null; }
      if (this.confirm < 2) { this.why = 'confirming'; r = null; } else { this.reacq = false; this.cx_ = r.x; this.cy_ = r.y; this.vel = { x: 0, y: 0 }; }
    }
    if (r) {
      const vx = (r.x - this.cx_) / W, vy = (r.y - this.cy_) / H;
      this.vel = { x: this.vel.x * 0.6 + vx * 0.4, y: this.vel.y * 0.6 + vy * 0.4 };
      this.cx_ += (r.x - this.cx_) * 0.85; this.cy_ += (r.y - this.cy_) * 0.85; this.score = r.s; this.second = r.second;
      this.sAvg = this.sAvg ? this.sAvg + (r.s - this.sAvg) * 0.05 : r.s;
      this.pos = { x: (this.cx_ + this.ox) / W, y: (this.cy_ + this.oy) / H };
      this.lost = 0; this.found = true;
      if (r.s < this.thr * 0.3) { const x0 = Math.round(this.cx_ - this.pw / 2), y0 = Math.round(this.cy_ - this.ph / 2);
        if (x0 >= 0 && y0 >= 0 && x0 + this.pw <= W && y0 + this.ph <= H) { const p = this._cut(d, x0, y0, this.pw, this.ph); for (let i = 0; i < p.length; i++) this.tpl[i] += (p[i] - this.tpl[i]) * 0.03; this.dirty = true; } }
      // (no periodic re-segmentation: tests showed re-segmenting from a slightly-off point drifts; the learned shape is kept)
      return this.pos;
    }
    this.lost++; this.vel.x *= 0.7; this.vel.y *= 0.7;
    if (this.lost > 6) this.found = false;
    return this.found ? this.pos : null;
  }
  // forget the old position (e.g. after the tool was put down): re-find it from scratch, near the hand when one is visible
  forget() { this.reacq = true; this.lost = 99; this.found = false; this.confirm = 0; this.cand = null; this.vel = { x: 0, y: 0 }; }
  _refresh(video, seg, d, relaxed) {
    const o = seg.segment(video, this.pos.x, this.pos.y, this.W, this.H);
    if (!o || o.area < this.area0 * (relaxed ? 0.4 : 0.5) || o.area > this.area0 * (relaxed ? 2.5 : 2)) return false;
    let tx = this.pos.x * this.W, ty = this.pos.y * this.H;
    // snap the tip to the true end of the object: the end of the mask's long axis that is nearest the current tip
    let mx = 0, my = 0, n = 0;
    for (let y = 0; y < o.bh; y++) for (let x = 0; x < o.bw; x++) if (o.mask[y * o.bw + x]) { mx += o.x0 + x; my += o.y0 + y; n++; }
    mx /= n; my /= n; let sxx = 0, sxy = 0, syy = 0;
    for (let y = 0; y < o.bh; y++) for (let x = 0; x < o.bw; x++) if (o.mask[y * o.bw + x]) { const dx = o.x0 + x - mx, dy = o.y0 + y - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang); let lo = 1e9, hi = -1e9, plo, phi;
    for (let y = 0; y < o.bh; y++) for (let x = 0; x < o.bw; x++) if (o.mask[y * o.bw + x]) { const X = o.x0 + x, Y = o.y0 + y, pr = (X - mx) * ux + (Y - my) * uy; if (pr < lo) { lo = pr; plo = [X, Y]; } if (pr > hi) { hi = pr; phi = [X, Y]; } }
    const dlo = Math.hypot(plo[0] - tx, plo[1] - ty), dhi = Math.hypot(phi[0] - tx, phi[1] - ty), end = dlo < dhi ? plo : phi, dd = Math.min(dlo, dhi);
    if (dd < 14) { tx = end[0]; ty = end[1]; } else { // not at an end: at least stay on the object
      let bd = 1e9; for (let y = 0; y < o.bh; y++) for (let x = 0; x < o.bw; x++) if (o.mask[y * o.bw + x]) { const q = (o.x0 + x - tx) ** 2 + (o.y0 + y - ty) ** 2; if (q < bd) { bd = q; var bx = o.x0 + x, by = o.y0 + y; } }
      if (bd < 1e9 && bd > 4) { tx = bx; ty = by; } }
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
