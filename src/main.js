import { GENRES, MODES } from './audio.js';
import { createEngine } from './engines.js';
import { Tracker, Conductor } from './tracker.js';
import { HandTracker, MotionTracker, PointTracker, ObjectSegmenter } from './tracking.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#stage'), g = canvas.getContext('2d'), cam = $('#cam');
const band = createEngine(new URLSearchParams(location.search).get('engine') || 'procedural'), tracker = new Tracker(), conductor = new Conductor(), hand = new HandTracker(), motion = new MotionTracker(), point = new PointTracker(), seg = new ObjectSegmenter();
const S = { screen: 'intro', mode: 'camera', method: 'hand', found: false, lastFound: 0, hand: null, genre: 'classical', mood: 'epic', wand: 'Baton', voice: true, guide: true, camOn: false,
  pointer: { x: 0.5, y: 0.5, down: false, last: 0 }, trail: [], parts: [], rings: [], qBeat: 0, qTime: 0, tipHint: 0, coached: {}, lastMove: 0 };
let cw = 0, ch = 0, dpr = 1;

// ---------- layout ----------
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  cw = innerWidth; ch = innerHeight;
  canvas.width = cw * dpr; canvas.height = ch * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resize); resize();
function view() { // rect (in CSS px) that normalised wand coords map onto
  if (S.mode === 'camera' && cam.videoWidth) {
    const s = Math.max(cw / cam.videoWidth, ch / cam.videoHeight), w = cam.videoWidth * s, h = cam.videoHeight * s;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  }
  return { x: 0, y: 0, w: cw, h: ch };
}
const toScreen = (p) => { const v = view(); return { x: v.x + p.x * v.w, y: v.y + p.y * v.h }; };
const toNorm = (px, py) => { const v = view(); return { x: (px - v.x) / v.w, y: (py - v.y) / v.h }; };

// ---------- screens ----------
function show(id) {
  S.screen = id;
  document.querySelectorAll('.screen').forEach((e) => e.classList.toggle('active', e.id === id));
  $('#back').hidden = !['train', 'calib', 'pick'].includes(id);
}
// Back button: always step back one stage
$('#back').onclick = () => {
  speechSynthesis?.cancel();
  if (S.screen === 'pick') { if (stepNo > 1) stepTo(stepNo - 1); else if (S.mode === 'camera') startCalib(); else show('intro'); }
  else if (S.screen === 'calib') { S.arming = false; show('train'); $('#trainBox').hidden = false; $('#trainMsg').textContent = 'Camera ready. Hold your tool up and name it below.'; }
  else if (S.screen === 'train') show('intro');
};

// ---------- voice guide ----------
let recog = null;
function say(text, { force = false } = {}) {
  $('#said').textContent = text;
  if (!S.voice && !force) return Promise.resolve();
  return new Promise((res) => {
    const ss = window.speechSynthesis; if (!ss) return res();
    try {
      ss.cancel();
      const u = new SpeechSynthesisUtterance(text); u.rate = 1.02; u.pitch = 1.0;
      const v = ss.getVoices().find((x) => /en/i.test(x.lang) && /(Samantha|Google UK English Female|Google US English|Natural|Aria)/i.test(x.name));
      if (v) u.voice = v;
      u.onend = u.onerror = () => res(); ss.speak(u); setTimeout(res, 9000);
    } catch { res(); }
  });
}
function listen(options, cb) {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!R) { say('Voice answers are not supported in this browser. Tap an option instead.', { force: true }); return; }
  try { recog && recog.abort(); } catch {}
  recog = new R(); recog.lang = 'en-US'; recog.interimResults = false;
  recog.onresult = (e) => {
    const heard = e.results[0][0].transcript.toLowerCase();
    const hit = options.find((o) => heard.includes(o.toLowerCase()) || heard.includes(o.toLowerCase().replace('-', '')));
    if (hit) cb(hit); else say(`I heard "${heard}". Try tapping one.`, { force: true });
  };
  recog.start();
}

// ---------- picking flow ----------
function fillGrid(el, items, onPick) {
  el.innerHTML = '';
  items.forEach(([key, icon, label]) => {
    const b = document.createElement('button'); b.className = 'opt'; b.innerHTML = `<span>${icon}</span>${label}`;
    b.onclick = () => { el.querySelectorAll('.opt').forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); setTimeout(() => onPick(key, label), 180); };
    el.appendChild(b);
  });
}
let stepNo = 1;
function stepTo(n) {
  stepNo = n;
  [1, 2, 3].forEach((i) => ($('#step' + i).hidden = i !== n));
}
function startPick() {
  show('pick'); stepTo(1);
  fillGrid($('#genres'), Object.entries(GENRES).map(([k, v]) => [k, v.icon, v.name]), (k) => { S.genre = k; stepTo(2); askMood(); });
  say('Locked in. What kind of music shall we make tonight?');
  $('#mic').onclick = () => {
    if (stepNo === 1) listen(Object.values(GENRES).map((x) => x.name), (n) => document.querySelectorAll('#genres .opt')[Object.values(GENRES).findIndex((x) => x.name === n)].click());
    else if (stepNo === 2) listen(Object.values(MODES).map((x) => x.name), (n) => document.querySelectorAll('#moods .opt')[Object.values(MODES).findIndex((x) => x.name === n)].click());
    else listen(['baton', 'pencil', 'pen', 'wand', 'spoon'], (n) => [...document.querySelectorAll('#wands .opt')].find((b) => b.textContent.toLowerCase().includes(n))?.click());
  };
}
function askMood() {
  const icons = { epic: '🔥', joyful: '☀️', dreamy: '🌌', dark: '🌑' };
  fillGrid($('#moods'), Object.entries(MODES).map(([k, v]) => [k, icons[k], v.name]), (k) => { S.mood = k; stepTo(3); askWand(); });
  say('Lovely. And what mood should the orchestra feel?');
}
function askWand() {
  S.lyrics = 'none';
  fillGrid($('#lyricMode'), [['none', '🎼', 'Instrumental'], ['mine', '✍️', 'My lyrics'], ['ai', '✨', 'AI writes them']], (k) => { S.lyrics = k; $('#lyricText').hidden = k === 'none'; });
  $('#goPlay').onclick = async () => {
    S.styleText = $('#styleText').value.trim(); S.lyricText = $('#lyricText').value.trim();
    const t = S.styleText.toLowerCase();  // let the typed style steer the offline band
    for (const [k, v] of Object.entries(GENRES)) if (t.includes(k) || t.includes(v.name.toLowerCase())) S.genre = k;
    if (/synth|electro|edm|techno|house|dance/.test(t)) S.genre = 'edm'; else if (/chill|lofi|lo-fi/.test(t)) S.genre = 'lofi'; else if (/film|epic|movie|trailer/.test(t)) S.genre = 'cinematic'; else if (/rock|guitar|metal/.test(t)) S.genre = 'rock'; else if (/jazz|swing|blues/.test(t)) S.genre = 'jazz'; else if (/orchestra|symphon|baroque/.test(t)) S.genre = 'classical';
    if (/dream|ambient|float/.test(t)) S.mood = 'dreamy'; else if (/dark|moody|sad|haunt/.test(t)) S.mood = 'dark'; else if (/happy|fun|upbeat|joy|sunny/.test(t)) S.mood = 'joyful'; else if (/epic|heroic|powerful/.test(t)) S.mood = 'epic';
    band.setStyle(S.genre, S.mood, { styleText: S.styleText, lyrics: S.lyrics, lyricText: S.lyricText }); await band.start(); startPlay();
  };
  say('Last step. Describe the style in your own words if you like, and choose lyrics, or none. Then raise your baton.');
}

// ---------- camera + training ----------
const TIPS = { thin: 'Thin object: add a bright strip of tape or a sticker on the tip, wear plain clothes, and stand in front of a plain wall.', default: 'Choose something that contrasts with your background. A bright-coloured tip tracks best.' };
async function startLock() {
  show('train'); S.trained = 0; tracker.target = null; $('#trainBox').hidden = false;
  $('#trainMsg').textContent = 'Starting camera…';
  try {
    if (!cam.srcObject) { const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); cam.srcObject = stream; }
    await cam.play(); S.camOn = true; hand.init().catch(() => {}); seg.init().catch(() => {});
    $('#trainMsg').textContent = 'Camera ready. Hold your tool up and name it below.';
    say('Step in front of the camera. Tell me what you are conducting with, then press start tracking.');
  } catch (e) {
    S.mode = 'pointer'; say('I could not open the camera, so you can conduct with your finger or mouse instead.', { force: true }); startPick();
  }
}
$('#objName').addEventListener('input', (e) => {
  const v = e.target.value.toLowerCase(); S.objName = v;
  $('#objTips').textContent = /pencil|pen|chopstick|stick|wand|baton|brush|drumstick/.test(v) ? TIPS.thin : TIPS.default;
});
$('#startTrack').onclick = () => startCalib();
canvas.addEventListener('pointerdown', (e) => {
  S.pointer.down = true; setPointer(e);
  if (S.screen === 'calib' && S.method === 'color' && S.arming) { lockTip(e); S.arming = false; CAL.reset(); say('Learned it. Now wave it up and down.'); }
  else if (S.screen === 'play' && S.mode === 'camera' && S.method === 'color') { lockTip(e); say('Locked on again.'); } // tap the tip any time to re-lock
});
// direction of the hand (wrist -> middle knuckle) in tracker pixels; a held tool turns with it
function handAngle(lm) { return Math.atan2((lm[9].y - lm[0].y) * point.H, (lm[9].x - lm[0].x) * point.W); }
function lockTip(e) {
  const n = toNorm(e.clientX, e.clientY), tx = Math.min(1, Math.max(0, n.x)), ty = Math.min(1, Math.max(0, n.y));
  point.grab(cam); const o = seg.ready ? seg.segment(cam, tx, ty, point.W, point.H) : null;
  const hr = hand.ready ? hand.detect(cam) : null; point.lastHint = hr ? { span: hand.spanPx * (point.W / (cam.videoWidth || 1280)), ang: handAngle(hr.lm) } : null;
  point.train(tx, ty, o);
  point.setSensitivity(+$('#sens').value); S.segOk = !!o;
  toast(o ? 'Smart Tool Detection found your whole ' + obj_() + ' (green). Now wave it.' : 'Locked on the tapped spot. Wave it.', 3500);
}
addEventListener('pointerup', () => (S.pointer.down = false));
canvas.addEventListener('pointermove', setPointer);
function setPointer(e) { S.pointer.x = e.clientX / cw; S.pointer.y = e.clientY / ch; S.pointer.last = performance.now(); }
$('#skipTrain').onclick = () => { S.mode = 'pointer'; startPick(); };
$('#calSkip').onclick = () => { S.mode = 'pointer'; startPick(); };

// ---------- calibration: prove tracking works before conducting ----------
const CAL = { cond: new Conductor(), beats: 0, seen: 0, frames: 0, confirmed: false, t0: 0, warned: false,
  reset() { this.cond.reset(); this.beats = 0; this.seen = 0; this.frames = 0; this.confirmed = false; this.t0 = performance.now(); this.warned = false; ui(); } };
const obj = () => S.objName || 'baton'; const obj_ = obj;
function ui() {
  $('#ckSee').classList.toggle('ok', CAL.seen > 6); $('#ckSee b').textContent = CAL.seen > 6 ? '✓' : '○';
  $('#ckWave').classList.toggle('ok', CAL.confirmed); $('#ckWave b').textContent = CAL.confirmed ? '✓' : '○';
  $('#ckN').textContent = Math.min(CAL.beats, 3);
  const go = $('#calGo'); go.disabled = !CAL.confirmed; go.textContent = CAL.confirmed ? 'Tracking confirmed. Continue' : 'Waiting for tracking…';
  $('#calMsg').classList.toggle('good', CAL.confirmed);
}
function startCalib() {
  show('calib'); S.arming = false; setMethod(S.method, true); CAL.reset();
}
function setMethod(mth, silent) {
  S.method = mth; document.querySelectorAll('#seg button').forEach((b) => b.classList.toggle('on', b.dataset.m === mth));
  CAL.reset(); motion.reset(); S.wandPos = null; S.hand = null;
  const o = obj();
  if (mth === 'hand') {
    $('#calMsg').textContent = hand.ready ? `Hold your ${o} and wave it up and down.` : 'Loading hand tracking…';
    if (!hand.ready) hand.init().then(() => { if (S.method === 'hand') $('#calMsg').textContent = `Hold your ${o} and wave it up and down.`; })
      .catch(() => { toast('Hand tracking could not load here. Switched to Motion.', 5000); if (S.method === 'hand') setMethod('motion'); });
  } else if (mth === 'motion') $('#calMsg').textContent = `Step back so your arm is in view, then wave your ${o} up and down.`;
  else { S.arming = true; point.ready = false; $('#calMsg').innerHTML = `Smart Tool Detection: tap the <b>tip of your ${o}</b>. I'll find the whole thing.`; }
  if (!silent) say($('#calMsg').textContent);
}
document.querySelectorAll('#seg button').forEach((b) => (b.onclick = () => setMethod(b.dataset.m)));
$('#calGo').onclick = () => { say('Great. Now let us choose what to make.'); startPick(); };
function calibrate(now) {
  const p = trackFrame(now);
  S.wandPos = p; CAL.frames++;
  if (p) { if (S.real) CAL.seen++; const r = CAL.cond.push(p, now / 1000); if (r.beat) CAL.beats++; } else CAL.cond.lastPos = null;
  const seeRate = CAL.seen / Math.max(1, CAL.frames);
  if (!CAL.confirmed && CAL.beats >= 3 && seeRate > 0.4) { CAL.confirmed = true; $('#calMsg').textContent = 'Tracking confirmed. I can follow you.'; say('Tracking confirmed. I can follow you.'); }
  if (!CAL.warned && !CAL.confirmed && now - CAL.t0 > 7000 && CAL.seen < 15 && !(S.method === 'hand' && !hand.ready) && !(S.method === 'color' && S.arming)) {
    CAL.warned = true; const tip = S.method === 'hand' ? 'I cannot see your hand. Step back so your hand is in frame, or try Motion.' : S.method === 'color' ? 'I lost it. Tap the tip again, or try Hand tracking.' : 'I see no movement. Wave bigger, or try Hand tracking.';
    $('#calMsg').textContent = tip; say(tip);
  }
  if (!CAL.confirmed && !CAL.warned) { /* keep instruction */ }
  if (CAL.frames % 6 === 0) ui();
}
function trackFrame(now) {
  if (S.mode !== 'camera' || !S.camOn || cam.readyState < 2) return null;
  let p = null;
  if (S.method === 'hand') { const r = hand.detect(cam); S.hand = r ? r.lm : null; p = r ? { x: r.x, y: r.y } : null; }
  else if (S.method === 'motion') p = motion.step(cam);
  else { // Smart Tool Detection, anchored to the hand the tool is held in
    point.grab(cam);
    const hr = hand.ready ? hand.detect(cam) : null; let hint = null;
    if (hr) { const span = hand.spanPx * (point.W / (cam.videoWidth || 1280)); hint = { x: (hr.x) * point.W, y: hr.y * point.H, r: Math.max(40, span * 3.6), span, ang: handAngle(hr.lm) }; S.hand = hr.lm; } else S.hand = null;
    p = point.ready ? point.step(cam, seg, hint) : null;
    S.tool = !!p; S.handOnly = false;
    if (!p && hr && point.ready) { p = { x: hr.x, y: hr.y }; S.handOnly = true; } // tool not found: keep conducting from the hand
  }
  S.real = !!p;
  if (p) { S.found = true; S.lastFound = now; S.lastP = p; }
  else if (S.lastP && now - S.lastFound < 450) p = { ...S.lastP }; // ride out brief dropouts
  else S.found = false;
  return p;
}

// ---------- play ----------
function startPlay() {
  show('play'); S.playStart = performance.now(); conductor.reset(); S.lastP = null; if (S.mode === 'camera' && S.method === 'color' && point.ready) point.forget();
  $('#genreLabel').textContent = `${GENRES[S.genre].icon} ${GENRES[S.genre].name} · ${MODES[S.mood].name}`;
  $('#hint').classList.remove('hide');
  $('#hint').textContent = S.mode === 'camera' ? 'Raise your ' + (S.objName || 'baton') + ' and give a downbeat…' : 'Drag your finger like a baton — down for each beat…';
  band.onStep = (step) => { if (step % 4 === 0) { S.qBeat = step / 4; S.qTime = band.ctx.currentTime; } };
  $('.sens').style.display = S.mode === 'camera' && S.method === 'color' ? '' : 'none';
}
$('#sens').oninput = (e) => point.setSensitivity(+e.target.value);
// ---------- record & share ----------
let rec = null, chunks = [];
function toast(html, ms = 12000) { const t = $('#toast'); t.innerHTML = html; t.style.display = 'flex'; clearTimeout(toast.h); toast.h = setTimeout(() => (t.style.display = 'none'), ms); return t; }
$('#bRec').onclick = (e) => {
  const btn = e.currentTarget;
  if (rec && rec.state === 'recording') { rec.stop(); return; }
  if (!canvas.captureStream || !window.MediaRecorder || !band.audioStream) { toast('Recording is not supported in this browser.', 4000); return; }
  const ms = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...band.audioStream().getAudioTracks()]);
  const type = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  chunks = []; rec = new MediaRecorder(ms, type ? { mimeType: type, videoBitsPerSecond: 4e6 } : {});
  rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
  rec.onstop = () => {
    btn.classList.remove('rec');
    const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' }), url = URL.createObjectURL(blob), ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const file = new File([blob], `symphonai-${Date.now()}.${ext}`, { type: blob.type });
    const t = toast(`Saved your performance. <a href="${url}" download="${file.name}">Download</a> <button id="shareBtn">Share</button>`, 30000);
    const sb = t.querySelector('#shareBtn');
    if (navigator.canShare && navigator.canShare({ files: [file] })) sb.onclick = () => navigator.share({ files: [file], title: 'My SymphonAI performance' }).catch(() => {}); else sb.remove();
  };
  rec.start(1000); btn.classList.add('rec'); toast('Recording… tap ⏺ again to stop.', 3000);
};
$('#bGuide').onclick = (e) => { S.guide = !S.guide; e.currentTarget.classList.toggle('off', !S.guide); };
$('#bVoice').onclick = (e) => { S.voice = !S.voice; e.currentTarget.classList.toggle('off', !S.voice); if (!S.voice) speechSynthesis?.cancel(); };
$('#bRetrain').onclick = () => { if (S.mode === 'camera') startCalib(); };
$('#bStyle').onclick = () => { startPick(); };
$('#begin').onclick = async () => { S.mode = 'camera'; await band.start(); startLock(); };
$('#demo').onclick = async () => { S.mode = 'pointer'; await band.start(); startPick(); };
document.addEventListener('visibilitychange', () => { if (document.hidden && band.ctx) band.ctx.suspend(); else if (band.ctx) band.ctx.resume(); });

function coach(key, text, delay = 0) {
  if (S.coached[key] || performance.now() - S.playStart < delay) return;
  S.coached[key] = true; say(text);
}

// ---------- frame loop ----------
let prev = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
  drawBackground(now);
  if (S.screen === 'calib') calibrate(now);
  if (S.screen === 'play') conduct(now, dt);
  drawFx(dt, now);
}
function conduct(now, dt) {
  let p = null;
  if (S.mode === 'camera' && S.camOn) p = trackFrame(now);
  else if (S.mode === 'pointer' && now - S.pointer.last < 350) p = { x: S.pointer.x, y: S.pointer.y };
  let beat = false;
  if (p) { const r = conductor.push(p, now / 1000); beat = r.beat; S.lastMove = now; S.wandPos = p; }
  else { conductor.decay(dt); S.wandPos = null; }
  band.dynamics += (conductor.dyn - band.dynamics) * Math.min(1, dt * 6);
  if (p) { band.zone += (conductor.x - band.zone) * Math.min(1, dt * 5); band.height += ((1 - conductor.y) - band.height) * Math.min(1, dt * 5); band.pan = (conductor.x - 0.5) * 1.4; }
  if (beat) {
    if (conductor.bpm) band.setTempoFromConductor(conductor.bpm);
    band.nudgePhase(band.ctx.currentTime); band.accent(conductor.lastBeatStrength);
    const sp = toScreen(p); S.rings.push({ x: sp.x, y: sp.y, r: 6, a: 0.9 });
    burst(sp.x, sp.y, 26, conductor.lastBeatStrength);
    $('#hint').classList.add('hide');
    coach('first', 'Beautiful downbeat. Keep it flowing.', 0);
  }
  $('#trk').className = 'trk ' + (S.mode === 'pointer' ? 'on' : S.found ? (S.handOnly ? 'hand' : 'on') : '');
  band.update(dt);
  $('#mTempo').textContent = Math.round(band.bpm);
  $('#mDyn').style.width = Math.round(band.dynamics * 100) + '%';
  document.querySelectorAll('.layers span').forEach((el) => (el.style.opacity = 0.35 + 0.65 * band.layerLevels[el.dataset.l]));
  // coaching + idle hint
  const idle = now - S.lastMove > 3500;
  if (idle && S.lastMove) { $('#hint').classList.remove('hide'); $('#hint').textContent = 'Raise your baton — I\'m waiting for you…'; }
  if (S.mode === 'camera' && S.method === 'color' && S.handOnly && S.found && now - S.playStart > 2500 && !S.hintedTap) { S.hintedTap = true; toast('Following your hand. Tap the tip of your ' + obj() + ' any time to re-lock it.', 5000); }
  if (S.found && $('#hint').textContent.startsWith('I lost')) $('#hint').classList.add('hide');
  if (S.mode === 'camera' && !S.found && now - Math.max(S.lastFound, S.playStart) > 2500) { $('#hint').classList.remove('hide'); $('#hint').textContent = 'I lost track of you. Hold your ' + obj() + ' in view, or tap 🎯 to recalibrate.'; }
  coach('big', 'Bigger movements make it louder. Smaller, softer.', 14000);
  coach('sway', 'Sway toward the left for strings, the middle for melody, the right for rhythm.', 26000);
  coach('hi', 'Lift your baton higher for a brighter sound.', 42000);
}
function burst(x, y, n, k) {
  for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, s = 40 + Math.random() * 220 * (0.4 + k);
    S.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, hue: 30 + Math.random() * 320 }); }
}

// ---------- drawing ----------
function drawBackground(now) {
  const t = now / 1000, d = band.dynamics;
  g.fillStyle = '#07050c'; g.fillRect(0, 0, cw, ch);
  if (S.camOn && cam.videoWidth && (S.screen === 'train' || S.screen === 'calib' || S.screen === 'play')) {
    const v = view(); g.save(); g.translate(v.x + v.w, v.y); g.scale(-1, 1);
    g.globalAlpha = S.screen === 'play' ? 0.55 : 0.95; g.drawImage(cam, 0, 0, v.w, v.h); g.restore();
    g.fillStyle = `rgba(7,5,12,${S.screen === 'play' ? 0.35 : 0.1})`; g.fillRect(0, 0, cw, ch);
  } else {
    // living stage: aurora ribbons that breathe with the music
    for (let i = 0; i < 3; i++) {
      const gr = g.createRadialGradient(cw * (0.2 + 0.3 * i + 0.05 * Math.sin(t * 0.3 + i)), ch * (0.3 + 0.25 * Math.cos(t * 0.2 + i)), 0, cw * 0.5, ch * 0.5, Math.max(cw, ch) * (0.55 + d * 0.25));
      const hue = [270, 330, 40][i];
      gr.addColorStop(0, `hsla(${hue},80%,${28 + d * 22}%,${0.35 + d * 0.25})`); gr.addColorStop(1, 'rgba(7,5,12,0)');
      g.fillStyle = gr; g.fillRect(0, 0, cw, ch);
    }
  }
  const vg = g.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.3, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.7)'); g.fillStyle = vg; g.fillRect(0, 0, cw, ch);
}
function drawFx(dt, now) {
  // trail
  if (S.wandPos) { const s = toScreen(S.wandPos); S.trail.push({ x: s.x, y: s.y, t: now }); } 
  S.trail = S.trail.filter((p) => now - p.t < 600);
  const d = band.dynamics, hue = 40 + (1 - d) * 240;
  if (S.trail.length > 1) {
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 1; i < S.trail.length; i++) {
      const a = S.trail[i - 1], b = S.trail[i], k = 1 - (now - b.t) / 600;
      g.strokeStyle = `hsla(${hue + i},95%,65%,${k * 0.8})`; g.lineWidth = 3 + k * (8 + d * 14);
      g.shadowColor = `hsl(${hue},100%,60%)`; g.shadowBlur = 20;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    g.shadowBlur = 0;
  }
  if (S.wandPos) {
    const s = toScreen(S.wandPos), r = 12 + d * 22;
    const gr = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 2.6);
    gr.addColorStop(0, `hsla(${hue},100%,85%,.95)`); gr.addColorStop(0.35, `hsla(${hue},100%,60%,.5)`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(s.x, s.y, r * 2.6, 0, 6.283); g.fill();
  }
  // training: show tracked blob + ring
  if (S.hand && (S.screen === 'calib' || S.screen === 'play')) drawHand();
  if (S.screen === 'calib' && S.method === 'color' && point.ready && point.pos) { const s = toScreen(point.pos); g.strokeStyle = point.found ? '#5cf29a' : '#ff5d8f'; g.lineWidth = 4; g.beginPath(); g.arc(s.x, s.y, 26 + 6 * Math.sin(now / 150), 0, 6.283); g.stroke();
    if (point.segmented) { const v = view(), k = v.w / point.W; g.imageSmoothingEnabled = false; g.drawImage(point.maskCanvas, v.x + (point.cx_ - point.pw / 2) * k, v.y + (point.cy_ - point.ph / 2) * (v.h / point.H), point.pw * k, point.ph * (v.h / point.H)); } }
  // rings & particles
  S.rings = S.rings.filter((r) => r.a > 0.02);
  for (const r of S.rings) { r.r += 480 * dt; r.a *= 0.92; g.strokeStyle = `rgba(245,199,107,${r.a})`; g.lineWidth = 3; g.beginPath(); g.arc(r.x, r.y, r.r, 0, 6.283); g.stroke(); }
  S.parts = S.parts.filter((p) => p.life > 0);
  for (const p of S.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.97; p.vy = p.vy * 0.97 + 60 * dt; p.life -= dt * 0.9;
    g.fillStyle = `hsla(${p.hue},95%,65%,${Math.max(0, p.life)})`; g.beginPath(); g.arc(p.x, p.y, 2 + p.life * 3, 0, 6.283); g.fill(); }
  if (DEBUG && (S.screen === 'play' || S.screen === 'calib')) drawDebug();
  if (S.screen === 'play' && S.guide) drawGuide(now);
}
// 4/4 beat-pattern guide that follows the band's own clock so you can conduct in time with it
const PAT = [[0, 0.85], [-0.8, 0.15], [0.8, 0.15], [0.25, -0.9]];
function drawGuide(now) {
  const size = Math.max(130, Math.min(230, Math.min(cw, ch) * 0.32)), cx = cw - size / 2 - 16, cy = ch / 2 - 10, h = size / 2;
  g.save(); g.fillStyle = 'rgba(20,14,34,.5)'; g.strokeStyle = 'rgba(255,255,255,.14)';
  g.beginPath(); g.roundRect(cx - h - 6, cy - h - 24, size + 12, size + 48, 22); g.fill(); g.stroke();
  g.fillStyle = 'rgba(255,255,255,.55)'; g.font = '600 11px system-ui'; g.textAlign = 'center'; g.fillText('CONDUCTING GUIDE · 4/4', cx, cy - h - 8);
  const P = (i) => ({ x: cx + PAT[i][0] * h * 0.9, y: cy + PAT[i][1] * h * 0.85 });
  g.strokeStyle = 'rgba(245,199,107,.35)'; g.lineWidth = 3; g.setLineDash([6, 6]); g.beginPath();
  for (let i = 0; i <= 4; i++) { const p = P(i % 4); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); } g.stroke(); g.setLineDash([]);
  for (let i = 0; i < 4; i++) { const p = P(i), on = i === S.qBeat && band.ctx; g.fillStyle = on ? '#f5c76b' : 'rgba(255,255,255,.25)'; g.beginPath(); g.arc(p.x, p.y, on ? 12 : 8, 0, 6.283); g.fill();
    g.fillStyle = on ? '#1a0d12' : 'rgba(255,255,255,.8)'; g.font = '700 11px system-ui'; g.fillText(String(i + 1), p.x, p.y + 4); }
  if (band.ctx) {
    const spb = 60 / band.bpm, ph = Math.min(1, Math.max(0, (band.ctx.currentTime - S.qTime) / spb));
    const a = P(S.qBeat), b = P((S.qBeat + 1) % 4), e = ph * ph * (3 - 2 * ph);
    const x = a.x + (b.x - a.x) * e, y = a.y + (b.y - a.y) * e;
    g.fillStyle = '#ff5d8f'; g.shadowColor = '#ff5d8f'; g.shadowBlur = 18; g.beginPath(); g.arc(x, y, 7, 0, 6.283); g.fill(); g.shadowBlur = 0;
  }
  g.restore();
}
const DEBUG = new URLSearchParams(location.search).has('debug');
function drawDebug() {
  g.save(); g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(8, 70, 250, 112); g.fillStyle = '#9f9'; g.font = '12px monospace';
  const L = [`method ${S.method} found ${S.found} real ${S.real} handOnly ${S.handOnly}`, `tool ${S.tool} hand ${!!S.hand} ready ${point.ready}`, `score ${point.score?.toFixed?.(1)} 2nd ${point.second?.toFixed?.(1)} thr ${point.thr.toFixed(0)}`, `lost ${point.lost} reacq ${point.reacq} confirm ${point.confirm}`, `why ${point.why || '-'}`, `tpl ${point.pw}x${point.ph} seg ${point.segmented}`];
  L.forEach((s, i) => g.fillText(s, 14, 88 + i * 16)); g.restore();
}
const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
function drawHand() {
  const pts = S.hand.map(toScreen); g.save(); g.strokeStyle = 'rgba(245,199,107,.7)'; g.lineWidth = 2;
  g.beginPath(); for (const [a, b] of BONES) { g.moveTo(pts[a].x, pts[a].y); g.lineTo(pts[b].x, pts[b].y); } g.stroke();
  g.fillStyle = '#fff'; for (const p of pts) { g.beginPath(); g.arc(p.x, p.y, 3, 0, 6.283); g.fill(); } g.restore();
}
requestAnimationFrame(frame);
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
window.__symphonai = { S, band, tracker, point, conductor, hand, motion, seg };
