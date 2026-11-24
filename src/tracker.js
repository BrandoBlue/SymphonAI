// Hand tracking with MediaPipe Hand Landmarker (files served from vendor/mediapipe, no CDN).
// Two copies of the model work together:
//  - follow: VIDEO mode. Once it has found a hand it just follows it, skipping the slow "find a hand" step.
//  - finder: IMAGE mode, pointed at zoomed-in crops, so a small hand across the room is still found.
// Runs on the CPU by default (fast on modern phones; the GPU path finds no hands on some Android GPUs).
// Add ?gpu=1 to the URL to try the GPU instead.

export async function createTracker(video, onStatus = () => {}) {
  const base = new URL('vendor/mediapipe/', location.href).href;
  const V = await import(base + 'vision_bundle.mjs');
  const fs = await V.FilesetResolver.forVisionTasks(base + 'wasm');
  const delegate = /[?&]gpu=1/.test(location.search) ? 'GPU' : 'CPU';
  const opts = (mode) => ({
    baseOptions: { modelAssetPath: base + 'hand_landmarker.task', delegate }, runningMode: mode, numHands: 1,
    minHandDetectionConfidence: 0.25, minHandPresenceConfidence: 0.25, minTrackingConfidence: 0.25,
  });
  const timeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('the hand tracker took too long to start')), ms))]);
  onStatus('Loading hand tracker…');
  const finder = await timeout(V.HandLandmarker.createFromOptions(fs, opts('IMAGE')), 30000);
  const follow = await timeout(V.HandLandmarker.createFromOptions(fs, opts('VIDEO')), 30000);

  const crop = document.createElement('canvas'), ccx = crop.getContext('2d');
  const T = { pos: null, span: 0, misses: 0, scan: 0, skip: false, far: false };

  // run the finder on a crop of the camera image; map landmarks back to full-frame coordinates
  function tryCrop(x, y, w, h) {
    const vw = video.videoWidth, vh = video.videoHeight;
    w = Math.min(w, vw); h = Math.min(h, vh);
    x = Math.max(0, Math.min(vw - w, x)); y = Math.max(0, Math.min(vh - h, y));
    const k = 320 / Math.max(w, h); crop.width = Math.round(w * k); crop.height = Math.round(h * k);
    ccx.drawImage(video, x, y, w, h, 0, 0, crop.width, crop.height);
    const lm = finder.detect(crop).landmarks?.[0];
    return lm ? lm.map((p) => ({ x: (x + p.x * w) / vw, y: (y + p.y * h) / vh })) : null;
  }

  // returns 21 hand landmarks in camera coordinates (0..1, not mirrored), or null
  function detect(t) {
    const vw = video.videoWidth, vh = video.videoHeight;
    let lm = follow.detectForVideo(video, t).landmarks?.[0] || null;
    if (lm) T.far = false;
    else if (T.pos && T.far) { // far-away hand: keep following it with a zoomed crop
      const side = Math.max(0.45 * vh, Math.min(vh, T.span * 5));
      lm = tryCrop(T.pos.x * vw - side / 2, T.pos.y * vh - side / 2, side, side);
    } else if ((T.skip = !T.skip)) { // lost: check one zoomed window every other frame
      const side = 0.5 * vh, i = T.scan++ % 6;
      lm = tryCrop([0.25, 0.5, 0.75][i % 3] * vw - side / 2, [0.35, 0.65][(i / 3) | 0] * vh - side / 2, side, side);
      if (lm) T.far = true;
    }
    if (!lm) { if (++T.misses > 3) { T.pos = null; T.far = false; } return null; }
    T.misses = 0;
    T.span = Math.hypot((lm[9].x - lm[0].x) * vw, (lm[9].y - lm[0].y) * vh);
    T.pos = { x: (lm[0].x + lm[9].x) / 2, y: (lm[0].y + lm[9].y) / 2 };
    return lm;
  }
  return { detect, delegate, crop, get far() { return T.far; } };
}
