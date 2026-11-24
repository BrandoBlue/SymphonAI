# SymphonAI
Orchestrate from vision.

Play music with your hand using your phone's camera. Pinch your thumb and index finger to play, and move your hand up and down to pick the note. Hand tracking runs in the browser with [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker), and every sound is synthesized live with the Web Audio API. No install, no server, no samples.

## Play it
Open `https://brandoblue.github.io/SymphonAI/` on your phone, tap **Start**, and allow the camera. Prop the phone up and stand 2–6 ft back with your palm facing the camera. No camera? Touch and drag on the screen to play.

> The camera only works over `https://` (or `localhost`), so opening `index.html` straight from your files won't work.

## Modes
- **Songs (rhythm game):** notes scroll toward the line on the left. Put your hand on the note's row and pinch as it arrives; hold the long ones for bonus points. You get Perfect / Good / Miss, combos (×2, ×3, ×4), a star rating and a saved best score.
  - **Guide melody** plays the tune softly so you can follow along.
  - **Demo** plays the song perfectly so you can watch and learn it.
- **Free play:** an open theremin. Every row is a note of a pentatonic scale in your chosen key, so nothing sounds wrong. Turn on the backing band to jam.

## Sounds
| Theme | Your instrument | Band |
|---|---|---|
| Theremin | sine with vibrato, glides between notes | soft pad and brushes |
| Metal | distorted power-chord guitar | chugging rhythm guitar, double kick |
| Guitar | plucked strings | strummed chords |
| Synthwave | detuned saw lead | pulsing bass, 4-on-the-floor |
| Chiptune | square-wave lead | 8-bit arpeggios and noise drums |

## Songs
All public domain: Twinkle Twinkle, Ode to Joy, When the Saints, Greensleeves, Für Elise, and In the Hall of the Mountain King (speeds up as it goes, try it on Metal).

Adding a song is a few lines in `src/songs.js`:
```js
{ id: 'mysong', title: 'My Song', by: 'Me', level: 1, bpm: 100, bpb: 4,
  notes: 'C4:1 E4:1 G4:2 r:1 ...',   // note:beats, r = rest
  chords: 'C:4 G:4 ...' }            // chord:beats, must add up to the same length
```

## Code map
| File | What it does |
|---|---|
| `src/tracker.js` | Hand tracking. A fast VIDEO-mode model follows your hand; an IMAGE-mode model scans zoomed crops to find far-away hands. CPU by default (`?gpu=1` to try the GPU). |
| `src/audio.js` | Sound engine: lead voice, 5 themes, drums, backing band styles. |
| `src/songs.js` | Song charts and parsers. |
| `src/main.js` | Game loop, lanes, scoring, demo, free play, menus. |

Debug view of what the tracker sees: add `?debug=1` to the URL.

## Running locally
```bash
python3 -m http.server 8000
# then open http://localhost:8000
```
