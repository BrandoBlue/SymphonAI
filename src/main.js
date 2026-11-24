// SymphonAI: play music with your hand. Pinch to play, hand height picks the note.
// Song mode scrolls notes toward a hit line (Guitar Hero style); free play is an open theremin.
import { Engine, THEMES, mtof, noteName } from './audio.js';
import { SONGS, parseNotes, parseChords } from './songs.js';
import { createTracker } from './tracker.js';

const $ = (id) => document.getElementById(id);
const cv = $('stage'), cx = cv.getContext('2d'), video = $('cam');
const DEBUG = /[?&]debug=1/.test(location.search);
const store = {
  get(k, d) { try { const v = localStorage.getItem('symphonai.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('symphonai.' + k, JSON.stringify(v)); } catch {} },
};
const LAT = 0.06;          // allowance for camera + tracking delay when judging timing (seconds)
const WIN_EARLY = 0.15, WIN_LATE = 0.22, PERFECT = 0.12; // hit windows (seconds)
const PENTA = { maj: [0, 2, 4, 7, 9], min: [0, 3, 5, 7, 10] };
const KEYS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

const savedTheme = store.get('theme', 'theremin');
const S = {
  facing: 'user', theme: THEMES[savedTheme] ? savedTheme : 'theremin',
  guide: store.get('guide', true), jam: store.get('jam', true), key: Number(store.get('key', 0)) % 12 || 0,
  hand: null, handY: 0, handX: 0, handPinch: false, pointer: { down: false, y: 0 },
  cur: { pos: 0, lane: 0, pinch: false, attack: -9, prev: -1 }, fc: 0, lastVT: -1, lastNow: 0, lastSong: null,
};
let E = null, TR = null, G = null, F = null, DPR = 1;
let PF = { top: 0, bottom: 1, hitX: 0, pps: 1 }, view = { sx: 0, sy: 0, sw: 1, sh: 1, mirror: true };
window.SYM = { S, get G() { return G; }, get F() { return F; }, get E() { return E; }, startSong: (id, o) => startSong(SONGS.find((s) => s.id === id), o), startFree: () => startFree() };

// ---------- layout ----------
function resize() { DPR = Math.min(devicePixelRatio || 1, 2); cv.width = innerWidth * DPR; cv.height = innerHeight * DPR; layout(); }
function layout() {
  const tb = $('top').hidden ? 0 : $('top').getBoundingClientRect().bottom;
  const bb = $('bottom').hidden ? innerHeight : $('bottom').getBoundingClientRect().top;
  PF = { top: (tb + 34) * DPR, bottom: (bb - 4) * DPR, hitX: cv.width * (F ? 0.72 : 0.2), pps: cv.width * 0.32 };
}
addEventListener('resize', resize);
const curLanes = () => (G ? G.lanes : F ? F.lanes : null);
const laneH = (L) => (PF.bottom - PF.top) / L;
const laneY = (i, L) => PF.bottom - (i + 0.5) * laneH(L);
const accent = () => THEMES[S.theme].color;

function computeView() {
  if (!video.videoWidth) return;
  const W = cv.width, H = cv.height, vw = video.videoWidth, vh = video.videoHeight, s = Math.max(W / vw, H / vh);
  view = { sw: W / s, sh: H / s, sx: (vw - W / s) / 2, sy: (vh - H / s) / 2, mirror: S.facing === 'user' };
}
function toScreen(p) {
  const x = ((p.x * video.videoWidth - view.sx) / view.sw) * cv.width, y = ((p.y * video.videoHeight - view.sy) / view.sh) * cv.height;
  return { x: view.mirror ? cv.width - x : x, y };
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------- hand input ----------
function onHand(lm) {
  if (!lm) { S.hand = null; S.handPinch = false; return; }
  const r = dist(lm[4], lm[8]) / dist(lm[0], lm[9]);
  S.handPinch = S.handPinch ? r < 0.45 : r < 0.32; // hysteresis so it doesn't flicker
  const p = toScreen({ x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 });
  S.handY = S.hand ? S.handY + (p.y - S.handY) * 0.6 : p.y;
  S.handX = p.x; S.hand = lm;
}

// Decide which lane the player is on and whether they are pinching; drive the lead voice.
function updateCursor(now) {
  const lanes = curLanes(); if (!lanes || !E) return;
  const L = lanes.length, c = S.cur;
  let y = null, pinch = false;
  if (G && G.demo) { // demo: play the chart perfectly
    const st = now - G.t0; const n = G.notes.find((n) => n.te - Math.min(0.12, (n.te - n.t) * 0.3) > st);
    if (n) { y = laneY(n.lane, L); pinch = st >= n.t - 0.01 && st < n.te - Math.min(0.12, (n.te - n.t) * 0.3); } // let go a moment early so repeated notes re-attack
  } else if (S.pointer.down) { y = S.pointer.y; pinch = true; }
  else if (S.hand) { y = S.handY; pinch = S.handPinch; }
  if (y !== null) {
    c.pos = Math.max(0, Math.min(L - 1, (PF.bottom - y) / laneH(L) - 0.5));
    if (Math.abs(c.pos - c.lane) > 0.6) c.lane = Math.round(c.pos);
  }
  c.lane = Math.max(0, Math.min(L - 1, c.lane));
  if (G && G.ended) pinch = false;
  const f = mtof(lanes[c.lane]), lead = E.lead;
  if (pinch && !c.pinch) { c.attack = now; lead.freq(f, now, true); lead.on(now); trailStart(now); }
  else if (pinch && c.lane !== c.prev) { c.attack = now; lead.freq(f, now, false); if (E.theme.lead.retrig) lead.on(now); trailStart(now); }
  else if (!pinch && c.pinch) { lead.off(now); trailEnd(now); }
  c.pinch = pinch; c.prev = c.lane;
}
function trailStart(now) { if (!F) return; trailEnd(now); F.trail.push({ lane: S.cur.lane, t0: now, t1: null }); }
function trailEnd(now) { if (!F) return; const s = F.trail[F.trail.length - 1]; if (s && s.t1 === null) s.t1 = now; }

// ---------- song mode ----------
function startSong(song, { demo = false } = {}) {
  stopAll();
  const { notes, total } = parseNotes(song.notes);
  const lanes = [...new Set(notes.map((n) => n.midi))].sort((a, b) => a - b);
  const b0 = song.bpm, k = song.bpmEnd ? (song.bpmEnd - b0) / total : 0;
  const tOf = (b) => (k ? (60 / k) * Math.log((b0 + k * b) / b0) : (60 * b) / b0); // beat -> seconds (handles speed-ups)
  notes.forEach((n) => { n.lane = lanes.indexOf(n.midi); n.t = tOf(n.beat); n.te = tOf(n.beat + n.dur); n.state = 0; });
  const countIn = (song.bpb * 60) / b0;
  G = { song, notes, lanes, tOf, total, chords: parseChords(song.chords), countIn, t0: E.ac.currentTime + countIn + 0.2,
    step: 0, guideIdx: 0, clicks: 0, score: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, miss: 0, pops: [], demo, ended: false };
  S.lastSong = song; S.cur.lane = 0; S.cur.pos = 0;
  $('title').textContent = song.title + (demo ? ' · demo' : '');
  showPlay();
}
function chordAt(chords, b) { let c = chords[0]; for (const x of chords) { if (x.beat <= b + 1e-6) c = x; else break; } return c; }
const mult = () => 1 + Math.min(3, Math.floor(G.combo / 10));

function judge(st, dt) {
  if (G.ended) return;
  const c = S.cur, att = c.attack - G.t0 - (G.demo ? 0 : LAT);
  for (const n of G.notes) {
    if (n.t - WIN_EARLY > st) break;
    if (n.state === 0) {
      if (st > n.t + WIN_LATE) { n.state = 2; G.miss++; G.combo = 0; pop('Miss', n.lane, '#ff6f59'); }
      else if (c.pinch && c.lane === n.lane) {
        const perfect = Math.abs(att - n.t) < PERFECT;
        n.state = 1; G.combo++; G.maxCombo = Math.max(G.maxCombo, G.combo);
        if (perfect) G.perfect++; else G.good++;
        G.score += (perfect ? 100 : 60) * mult();
        pop(perfect ? 'Perfect' : 'Good', n.lane, perfect ? '#ffffff' : accent());
      }
    } else if (n.state === 1 && st < n.te && n.te - n.t > 0.4 && c.pinch && c.lane === n.lane) {
      G.score += dt * 50 * mult(); // bonus for holding long notes
    }
  }
  if (st > G.notes[G.notes.length - 1].te + 1.2) finishSong();
}
function pop(text, lane, color) { G.pops = G.pops.filter((p) => p.lane !== lane).slice(-8); G.pops.push({ text, lane, color, t: performance.now() }); }

function finishSong() {
  G.ended = true; E.lead.off(E.ac.currentTime);
  const n = G.notes.length, acc = (G.perfect + G.good) / n, score = Math.round(G.score);
  const stars = acc >= 0.97 ? 5 : acc >= 0.88 ? 4 : acc >= 0.72 ? 3 : acc >= 0.5 ? 2 : 1;
  const best = store.get('best', {}), prev = Number(best[G.song.id]) || 0, isBest = !G.demo && score > prev;
  if (isBest) { best[G.song.id] = score; store.set('best', best); }
  const r = { title: G.song.title, demo: G.demo, score, stars, acc, isBest, prev, perfect: G.perfect, good: G.good, miss: G.miss, maxCombo: G.maxCombo };
  setTimeout(() => showResults(r), 700);
}
function showResults(r) {
  $('rTitle').textContent = r.title + (r.demo ? ' (demo)' : '');
  $('rScore').textContent = r.score.toLocaleString();
  $('rStars').textContent = '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars);
  $('rStars').setAttribute('aria-label', r.stars + ' out of 5 stars');
  $('rBest').textContent = r.demo ? 'Demos are not scored. Your turn!' : r.isBest ? (r.prev ? 'New best score!' : 'First score saved!') : 'Best: ' + r.prev.toLocaleString();
  $('rPerfect').textContent = r.perfect; $('rGood').textContent = r.good; $('rMiss').textContent = r.miss;
  $('rCombo').textContent = r.maxCombo; $('rAcc').textContent = Math.round(r.acc * 100) + '%';
  $('results').hidden = false;
}

// ---------- free play ----------
function startFree() {
  stopAll();
  const th = THEMES[S.theme], sc = PENTA[th.scale];
  const root = 57 + ((S.key - 9 + 12) % 12) + th.oct; // root lands between A3 and G#4 (an octave lower for metal)
  const lanes = []; for (let i = 0; i < 11; i++) lanes.push(root + 12 * Math.floor(i / 5) + sc[i % 5]);
  const prog = (th.scale === 'maj' ? [[0, 0], [7, 0], [9, 1], [5, 0]] : [[0, 1], [8, 0], [3, 0], [10, 0]])
    .map(([o, m]) => ({ pc: (S.key + o) % 12, tones: m ? [0, 3, 7] : [0, 4, 7] }));
  F = { lanes, prog, trail: [], t0: E.ac.currentTime + 0.1, step: 0, iv: 30 / th.bpm };
  $('title').textContent = 'Free play · ' + th.name;
  S.cur.lane = 5; S.cur.pos = 5;
  showPlay();
}
function stopAll() {
  if (E) E.lead.off(E.ac.currentTime);
  S.cur.pinch = false; G = null; F = null;
  $('results').hidden = true;
}

// ---------- scheduler: backing band, guide melody, count-in ----------
function schedule() {
  if (!E) return;
  const now = E.ac.currentTime, ahead = now + 0.15;
  if (G && !G.ended) {
    const beat = G.countIn / G.song.bpb;
    while (G.clicks < G.song.bpb) {
      const t = G.t0 - G.countIn + G.clicks * beat; if (t > ahead) break;
      if (t >= now - 0.02) E.hat(Math.max(t, now), G.clicks ? 0.6 : 1.2, 0.05);
      G.clicks++;
    }
    while (G.step / 2 < G.total) {
      const b = G.step / 2, t = G.t0 + G.tOf(b); if (t > ahead) break;
      if (t >= now - 0.02) E.backStep(G.step, Math.max(t, now), G.tOf(b + 0.5) - G.tOf(b), chordAt(G.chords, b), G.song.bpb);
      G.step++;
    }
    while (G.guideIdx < G.notes.length) {
      const n = G.notes[G.guideIdx], t = G.t0 + n.t; if (t > ahead) break;
      if (S.guide && !G.demo && t >= now - 0.02) E.guideNote(n.midi, Math.max(t, now), n.te - n.t);
      G.guideIdx++;
    }
  }
  if (F) {
    while (F.t0 + F.step * F.iv < ahead) {
      const t = F.t0 + F.step * F.iv;
      if (S.jam && t >= now - 0.02) E.backStep(F.step, Math.max(t, now), F.iv, F.prog[Math.floor(F.step / 16) % 4], 4);
      F.step++;
    }
  }
}
setInterval(schedule, 25);

// ---------- drawing ----------
function rr(x, y, w, h, r) { cx.beginPath(); if (cx.roundRect) cx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); else cx.rect(x, y, w, h); }
function draw(now) {
  const W = cv.width, H = cv.height, d = DPR, acc = accent(), lanes = curLanes();
  cx.clearRect(0, 0, W, H);
  if (lanes) {
    const L = lanes.length, lh = laneH(L), c = S.cur;
    for (let i = 0; i < L; i++) {
      const y0 = PF.bottom - (i + 1) * lh;
      cx.fillStyle = i % 2 ? 'rgba(10,4,9,.42)' : 'rgba(10,4,9,.3)'; cx.fillRect(0, y0, W, lh);
      if (i === c.lane) { cx.globalAlpha = c.pinch ? 0.32 : 0.16; cx.fillStyle = acc; cx.fillRect(0, y0, W, lh); cx.globalAlpha = 1; }
    }
    cx.font = `600 ${12 * d}px Inter, sans-serif`; cx.textAlign = 'left'; cx.textBaseline = 'middle';
    for (let i = 0; i < L; i++) { cx.fillStyle = i === c.lane ? '#fff' : 'rgba(246,234,216,.65)'; cx.fillText(noteName(lanes[i]), 8 * d, laneY(i, L)); }
    cx.fillStyle = 'rgba(246,234,216,.7)'; cx.fillRect(PF.hitX - 1.5 * d, PF.top, 3 * d, PF.bottom - PF.top);
    if (G) drawNotes(now - G.t0, L, lh, acc);
    if (F) drawTrail(now, L, lh, acc);
    // the cursor: where your hand is pointing, on the hit line
    const cy = laneY(c.pos, L);
    cx.beginPath(); cx.arc(PF.hitX, cy, 13 * d, 0, 7);
    if (c.pinch) { cx.fillStyle = '#ff6f59'; cx.shadowColor = '#ff6f59'; cx.shadowBlur = 24 * d; cx.fill(); cx.shadowBlur = 0; }
    else { cx.fillStyle = 'rgba(29,11,23,.8)'; cx.fill(); cx.lineWidth = 3 * d; cx.strokeStyle = acc; cx.stroke(); }
    if (G) drawPops(L, now - G.t0);
  }
  if (S.hand && TR) drawHand(acc);
  if (DEBUG && TR && TR.crop.width) {
    const w = W * 0.35, h = (w * TR.crop.height) / TR.crop.width, y = H - h - 110 * d;
    cx.drawImage(TR.crop, 8 * d, y, w, h); cx.strokeStyle = '#ff6f59'; cx.lineWidth = 2 * d; cx.strokeRect(8 * d, y, w, h);
  }
}
function drawNotes(st, L, lh, acc) {
  const d = DPR, h = Math.min(lh * 0.62, 44 * d);
  for (const n of G.notes) {
    let a = PF.hitX + (n.t - st) * PF.pps; const x1 = PF.hitX + (n.te - st) * PF.pps;
    if (x1 < 0) continue; if (a > cv.width) break;
    let b = Math.max(x1 - 4 * d, a + 12 * d);
    if (n.state === 1) { a = Math.max(a, PF.hitX); if (b - a < 2) continue; } // played part disappears into the line
    cx.globalAlpha = n.state === 2 ? 0.28 : 1;
    cx.fillStyle = n.state === 2 ? '#9a8f88' : n.state === 1 ? '#ffffff' : acc;
    rr(a, laneY(n.lane, L) - h / 2, b - a, h, h / 2); cx.fill();
  }
  cx.globalAlpha = 1;
  if (st < 0) { // count-in
    const beat = G.countIn / G.song.bpb, k = Math.ceil(-st / beat);
    if (k <= G.song.bpb) {
      cx.font = `italic 800 ${96 * d}px Fraunces, serif`; cx.textAlign = 'center'; cx.fillStyle = '#f6ead8';
      cx.fillText(String(k), cv.width * 0.6, (PF.top + PF.bottom) / 2);
    }
  }
}
function drawTrail(now, L, lh, acc) {
  const d = DPR, h = Math.min(lh * 0.5, 36 * d);
  F.trail = F.trail.filter((s) => s.t1 === null || PF.hitX - (now - s.t1) * PF.pps > 0);
  cx.globalAlpha = 0.85; cx.fillStyle = acc;
  for (const s of F.trail) {
    const x0 = PF.hitX - (now - s.t0) * PF.pps, x1 = PF.hitX - (now - (s.t1 ?? now)) * PF.pps;
    rr(Math.max(x0, -h), laneY(s.lane, L) - h / 2, Math.max(x1 - x0, 6 * d), h, h / 2); cx.fill();
  }
  cx.globalAlpha = 1;
}
function drawPops(L) {
  const d = DPR, t = performance.now();
  cx.font = `italic 800 ${20 * d}px Fraunces, serif`; cx.textAlign = 'left'; cx.textBaseline = 'middle';
  for (const p of G.pops) {
    const age = t - p.t; if (age > 700) continue;
    cx.globalAlpha = 1 - age / 700; cx.fillStyle = p.color;
    cx.fillText(p.text, PF.hitX + 24 * d, laneY(p.lane, L) - 22 * d - age * 0.04 * d);
  }
  cx.globalAlpha = 1;
}
function drawHand(acc) {
  const d = DPR, P = S.hand.map(toScreen);
  cx.strokeStyle = 'rgba(246,234,216,.4)'; cx.lineWidth = 2 * d; cx.beginPath();
  for (const [a, b] of BONES) { cx.moveTo(P[a].x, P[a].y); cx.lineTo(P[b].x, P[b].y); }
  cx.stroke();
  cx.beginPath(); cx.arc(S.handX, S.handY, 9 * d, 0, 7);
  cx.fillStyle = S.handPinch ? '#ff6f59' : acc; cx.fill();
}

// ---------- HUD ----------
const hud = {};
function setText(id, v) { if (hud[id] !== v) { hud[id] = v; $(id).textContent = v; } }
function updateHud(now) {
  if (G) {
    const st = now - G.t0, end = G.notes[G.notes.length - 1].te;
    setText('score', Math.round(G.score).toLocaleString());
    setText('combo', G.combo > 1 ? `${G.combo} combo · ×${mult()}` : G.demo ? 'Watch and learn' : '');
    $('progBar').style.width = Math.max(0, Math.min(100, (st / end) * 100)) + '%';
  } else if (F) {
    setText('score', S.cur.pinch ? noteName(F.lanes[S.cur.lane]) : '♪');
    setText('combo', S.jam ? 'Band: ' + THEMES[S.theme].name : 'Band off');
    $('progBar').style.width = '0%';
  }
}
setInterval(() => {
  if (!TR) return;
  const ok = !!S.hand, fps = S.fc; S.fc = 0;
  $('chip').className = ok ? 'ok' : '';
  $('chip').textContent = (ok ? (S.handPinch ? 'Pinching' : 'Hand found') : 'Show your hand') + ' · ' + fps + ' fps' + (TR.far ? ' · zoom' : '');
}, 1000);

// ---------- main loop ----------
function frame() {
  const t = performance.now();
  try {
    if (TR && video.readyState >= 2 && video.videoWidth && video.currentTime !== S.lastVT) {
      S.lastVT = video.currentTime; computeView(); onHand(TR.detect(t)); S.fc++;
    }
    const now = E ? E.ac.currentTime : 0, dt = Math.min(0.1, Math.max(0, now - S.lastNow)); S.lastNow = now;
    updateCursor(now);
    if (G) judge(now - G.t0, dt);
    draw(now); updateHud(now);
  } catch (e) { console.error(e); if (!S.err) { S.err = 1; setHint('Something went wrong: ' + (e.message || e)); } }
  requestAnimationFrame(frame);
}

// ---------- menus ----------
function setHint(m) { $('hint').textContent = m; $('hint').hidden = !m; }
function setTheme(id) {
  if (!THEMES[id]) return;
  S.theme = id; store.set('theme', id);
  document.documentElement.style.setProperty('--acc', THEMES[id].color);
  if (E) E.setTheme(id);
  S.cur.pinch = false;
  $('themeSel').value = id;
  for (const b of document.querySelectorAll('.theme')) b.setAttribute('aria-pressed', b.dataset.id === id);
  if (F) startFree(); // free play lanes follow the theme's scale
}
function buildMenu() {
  $('themes').innerHTML = Object.entries(THEMES).map(([id, t]) =>
    `<button class="theme" data-id="${id}" aria-pressed="${id === S.theme}"><i style="background:${t.color}"></i>${t.name}</button>`).join('');
  $('themeSel').innerHTML = Object.entries(THEMES).map(([id, t]) => `<option value="${id}">${t.name}</option>`).join('');
  $('themeSel').value = S.theme;
  $('key').innerHTML = KEYS.map((k, i) => `<option value="${i}">Key of ${k}</option>`).join('');
  $('key').value = S.key; $('guide').checked = S.guide; $('jam').checked = S.jam;
  const best = store.get('best', {});
  $('songs').innerHTML = SONGS.map((s) => {
    const b = Number(best[s.id]) || 0;
    return `<li class="song"><div class="meta"><b>${s.title}</b><span>${s.by} · <span class="lvl" aria-label="difficulty ${s.level} of 3">${'●'.repeat(s.level)}${'○'.repeat(3 - s.level)}</span>${b ? ' · best ' + b.toLocaleString() : ''}${s.suggest ? ' · try ' + THEMES[s.suggest].name : ''}</span></div>
      <button class="btn" data-demo="${s.id}">Demo</button><button class="btn primary" data-play="${s.id}">Play</button></li>`;
  }).join('');
}
function openMenu() { stopAll(); buildMenu(); $('menu').hidden = false; setHint(''); }
function showPlay() {
  $('menu').hidden = true; $('results').hidden = true; layout();
  setHint(TR ? (S.hand ? '' : 'Pinch your thumb and finger to play. Move up and down to change notes.') : 'Touch and drag to play');
  setTimeout(() => setHint(''), 4000);
}
$('menu').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.id) setTheme(b.dataset.id);
  else if (b.dataset.play) startSong(SONGS.find((s) => s.id === b.dataset.play));
  else if (b.dataset.demo) startSong(SONGS.find((s) => s.id === b.dataset.demo), { demo: true });
  else if (b.id === 'freeBtn') startFree();
});
$('guide').onchange = (e) => { S.guide = e.target.checked; store.set('guide', S.guide); };
$('jam').onchange = (e) => { S.jam = e.target.checked; store.set('jam', S.jam); };
$('key').onchange = (e) => { S.key = +e.target.value; store.set('key', S.key); };
$('themeSel').onchange = (e) => setTheme(e.target.value);
$('menuBtn').onclick = openMenu;
$('again').onclick = () => S.lastSong && startSong(S.lastSong);
$('toSongs').onclick = openMenu;
$('flip').onclick = async () => { S.facing = S.facing === 'user' ? 'environment' : 'user'; try { await startCam(); } catch { setHint('Could not switch camera'); } };

// touch / mouse fallback: drag on the screen to play
cv.addEventListener('pointerdown', (e) => { S.pointer = { down: true, y: e.clientY * DPR }; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', (e) => { if (S.pointer.down) S.pointer.y = e.clientY * DPR; });
const up = () => { S.pointer.down = false; };
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
document.addEventListener('visibilitychange', () => { if (document.hidden && (G || F)) openMenu(); });

// ---------- start ----------
async function startCam() {
  if (S.stream) S.stream.getTracks().forEach((t) => t.stop());
  S.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: S.facing, width: { ideal: 1280 }, height: { ideal: 720 } } });
  video.classList.toggle('mirror', S.facing === 'user');
  video.srcObject = S.stream; await video.play();
}
const status = (m, err) => { $('status').textContent = m; $('status').className = err ? 'err' : ''; };
$('go').onclick = async () => {
  $('go').disabled = true;
  E = new Engine(); E.setTheme(S.theme); await E.ac.resume();
  document.documentElement.style.setProperty('--acc', accent());
  let note = '';
  try {
    if (!window.isSecureContext || !navigator.mediaDevices) throw new Error('insecure');
    status('Opening camera…'); await startCam();
    TR = await createTracker(video, status);
  } catch (e) {
    console.warn(e);
    note = e.message === 'insecure' ? 'The camera needs an https link.'
      : e.name === 'NotAllowedError' ? 'Camera permission was blocked.' : 'Hand tracking could not start (' + (e.message || e) + ').';
    $('chip').textContent = note + ' Touch and drag to play.';
  }
  $('intro').hidden = true; $('top').hidden = false; $('bottom').hidden = false; $('chip').hidden = false;
  resize(); openMenu();
  try { await navigator.wakeLock?.request('screen'); } catch {}
  requestAnimationFrame(frame);
};
resize();
document.documentElement.style.setProperty('--acc', accent());
