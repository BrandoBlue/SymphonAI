# SymphonAI
Orchestrate from vision.

Conduct a little band with your hand using your phone's camera. Hand tracking runs fully in the browser with [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker); all sound is synthesized live with the Web Audio API. No install, no server, one file.

## Play it
Open the GitHub Pages link on your phone: `https://brandoblue.github.io/SymphonAI/`, tap **Raise the baton**, and allow the camera. Prop the phone up and stand 4–6 ft back.

> The camera only works over `https://` (or `localhost`), so opening `index.html` straight from your files won't work.

## Controls
| Gesture | What it does |
|---|---|
| Flick down and bounce | One beat. Your beat speed sets the tempo |
| Hand high / low | Louder (*ff*) / softer (*pp*). Louder brings in more instruments |
| Hand left / right | Darker / brighter sound |
| Fist | Cut the band off |
| Second hand | Controls volume while the first one conducts |
| Tap screen | Backup beat |
| **Theremin mode**: pinch | Play a note; hand height picks the pitch (always in key) |

## How it works
- **Tracking:** 21 hand landmarks per hand per frame. The palm center (landmark 9) drives beat detection: a fast downward stroke "arms" a beat, and the bounce at the bottom fires it.
- **Tempo:** median of the last few beat-to-beat gaps (50–180 BPM). A scheduler fills in beats if you pause, so the band keeps going.
- **Music:** I–V–vi–IV progression in the chosen key. Pad chords, bass, an arpeggio, and synth drums are layered by dynamics.

## Running locally
```bash
python3 -m http.server 8000
# then open http://localhost:8000 on the same machine
```
