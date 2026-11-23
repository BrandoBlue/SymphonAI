// Tracking back-ends. Each returns a normalised, mirrored (selfie-view) point {x,y} or null.
//  - HandTracker : MediaPipe hand landmarks (most robust; follows the hand holding the tool)
//  - MotionTracker: follows whatever is moving (works with any object, no training)
// The colour tracker lives in tracker.js.
export class HandTracker {
  constructor() { this.ready = false; this.loading = null; this.error = null; this.last = null; this.lastVT = -1; this.lastTs = 0; this.misses = 0; }
  init() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const { FilesetResolver, HandLandmarker } = await import('../vendor/mediapipe/vision_bundle.mjs');
        const fs = await FilesetResolver.forVisionTasks('vendor/mediapipe/wasm');
        const make = (delegate) => HandLandmarker.createFromOptions(fs, {
          baseOptions: { modelAssetPath: 'vendor/mediapipe/hand_landmarker.task', delegate }, runningMode: 'VIDEO', numHands: 1,
          minHandDetectionConfidence: 0.35, minHandPresenceConfidence: 0.35, minTrackingConfidence: 0.35 });
        try { this.lmk = await make('GPU'); this.delegate = 'GPU'; } catch { this.lmk = await make('CPU'); this.delegate = 'CPU'; }
        this.ready = true;
      } catch (e) { this.error = e; this.ready = false; throw e; }
    })();
    return this.loading;
  }
  detect(video) {
    if (!this.ready || video.readyState < 2) return this.last;
    if (video.currentTime === this.lastVT) return this.last;
    this.lastVT = video.currentTime;
    const ts = Math.max(this.lastTs + 1, performance.now()); this.lastTs = ts;
    let r; try { r = this.lmk.detectForVideo(video, ts); } catch { return this.last; }
    const lm = r.landmarks && r.landmarks[0];
    if (!lm) { if (++this.misses > 4) this.last = null; return this.last; }
    this.misses = 0;
    const m = lm.map((p) => ({ x: 1 - p.x, y: p.y }));
    const idx = [0, 5, 9, 13, 17]; let x = 0, y = 0;
    for (const i of idx) { x += m[i].x; y += m[i].y; }
    x /= idx.length; y /= idx.length;
    // push the point out along wrist -> middle-knuckle so it sits near where a held baton's tip would be
    x += (m[9].x - m[0].x) * 0.9; y += (m[9].y - m[0].y) * 0.9;
    this.last = { x, y, lm: m };
    return this.last;
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
