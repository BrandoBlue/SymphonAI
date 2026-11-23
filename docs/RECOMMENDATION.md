# SymphonAI: tools, AI music options, and the "own model" question

## What is built now (prototype v0.1)
A mobile-first PWA, no build step, plain ES modules.

- **Flow:** Lock in tool → camera screen, name your object (pencil, chopstick…), Start tracking, tap the tip → voice guide asks genre, mood, free-text style, lyrics (none / mine / AI) → conduct.
- **Tracking:** a trainable colour tracker that learns the exact object you tap. It is fast on any phone and does not need a model download. Thin objects get extra tips (tape the tip, plain background).
- **Conducting model:** downbeat (bottom of the stroke) gives the beat, beat spacing gives tempo, motion size/speed gives dynamics, left/centre/right sway moves emphasis between strings / melody / rhythm, wand height gives brightness.
- **Sound:** an in-browser band (Web Audio, zero samples) in six genres: classical, cinematic, jazz, electronic, lo-fi, rock. Audio goes to whatever output the phone uses, so a paired Bluetooth speaker just works.
- **Helper view:** a 4/4 conducting guide whose dot follows the band's own clock.

## Quality bar: "Suno level"
Honest gap: the current band is procedural synthesis. It is playable and responsive, but it is not Suno-quality audio. Closing that gap means putting a generative audio model behind the same conducting signals.

| Option | What it gives | Fit for conducting |
|---|---|---|
| **Google Lyria RealTime** (Gemini API, Magenta) | Streams music continuously and can be steered live with weighted text prompts, BPM, density, brightness | Best fit: it is designed to be steered while playing, so tempo / power / sway map straight onto its controls. Needs an API key and network; mostly instrumental. |
| **Suno / Udio style full-song generators** | Finished songs with vocals and lyrics | Poor fit for live control: they render whole tracks in tens of seconds, not continuously. Fine for a "make a song from my lyrics, then conduct it" mode. No official open API that I can rely on. |
| **Open models** (MusicGen, Stable Audio Open, ACE-Step, YuE, Magenta RealTime) | Self-hostable, fine-tunable | Good for an owned pipeline; needs a GPU server and latency work. |
| **Sampled instruments** (SoundFont / Spitfire-style libraries via Tone.js or smplr) | Real orchestral timbres under the current note engine | Cheap quality jump for classical and cinematic, works offline. |

**Recommended path:** (1) keep the procedural band as the always-on offline fallback, (2) add a Lyria RealTime backend where conducting drives its prompts and controls, (3) add sampled instruments, (4) add a "compose from my lyrics" mode with a full-song generator, then conduct the playback by time-stretching and dynamics.

## Building our own model: feasibility
- **A Suno-grade model from scratch:** not realistic here. It needs very large licensed audio datasets, serious GPU budgets, and a team, and the commercial generators have faced copyright litigation over training data. I would not start there.
- **Realistic and actually novel: a conducting model.** A small model that learns how *you* conduct (tempo habits, how big "forte" is for you, what a "cut off" looks like) from your own sessions. It is cheap to train on-device and is the "training AI" part of the vision.
- **Middle path:** fine-tune an open generator (for example on royalty-free or self-made stems) so its controls respond to conducting signals, served from a rented GPU.

## Tracking upgrades
Current tracker is colour-based. Next: MediaPipe Tasks Vision (hand landmarks plus a custom-trained object detector) for robust tracking against busy backgrounds, and the hand pose as a fallback when the tool is lost. Also worth testing in real rooms: front vs back camera, tablet stands.

## MCPs / services worth connecting
Google Drive (reference audio, lyrics), GitHub (this repo). No music-specific MCP is needed for the prototype.
