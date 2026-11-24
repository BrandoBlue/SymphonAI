# SymphonAI
Conduct music with a wave. Point your phone at yourself, lock in a pencil / pen / chopstick / wand, choose a style, and conduct an orchestra (or a band) in any genre. Audio plays through your phone, so pair a Bluetooth speaker first.

## Run
```
python3 -m http.server 8000   # then open http://localhost:8000 (camera needs https or localhost)
```
Deploy the folder to any static host (GitHub Pages works) and use "Add to home screen" on your phone.

## Layout
- `src/audio.js` procedural band (6 genres, 4 moods)
- `src/tracker.js` trainable object tracker + conducting detector
- `src/engines.js` pluggable music-engine slot (contract documented inside; `?engine=<id>`)
- `src/main.js` UI flow, voice guide, rendering
- `docs/RECOMMENDATION.md` tool survey, AI music options, own-model feasibility
