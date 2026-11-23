// Pluggable music-engine slot.
// An engine is any object with the contract below. main.js only talks to this contract,
// so a generative model (Lyria RealTime, a MusicGen/ACE-Step server, our own fine-tune)
// can replace the procedural band without touching tracking, UI or conducting logic.
//
//   async start()                      unlock audio, begin playing (needs a user gesture)
//   stop()
//   setStyle(genre, mood, {styleText, lyrics, lyricText})
//   setTempoFromConductor(bpm)         user beat tempo (quarter notes / minute)
//   accent(strength 0..1)              a detected downbeat
//   nudgePhase(audioTime)              align the engine's clock to the user's beat
//   update(dt)                         called every frame after the fields below are written
//   fields written each frame by main.js: dynamics 0..1, zone 0..1 (left..right),
//                                         height 0..1, pan -1..1
//   fields read by the UI:  bpm, layerLevels{harmony,melody,rhythm}, ctx (AudioContext), onStep(step)
//
// Register an engine, then select it with  ?engine=<id>  in the URL.
import { Band } from './audio.js';

const registry = new Map([['procedural', () => new Band()]]);
export const registerEngine = (id, factory) => registry.set(id, factory);
export const listEngines = () => [...registry.keys()];
export function createEngine(id) { return (registry.get(id) || registry.get('procedural'))(); }

// Example skeleton for a server-side model (kept as documentation, not registered):
//
// class RemoteModelEngine extends Band {
//   async start() { await super.start(); this.ws = new WebSocket('wss://your-server/stream'); /* pipe PCM into this.bus */ }
//   update(dt) { super.update(dt); this.ws?.send(JSON.stringify({ bpm: this.bpm, dynamics: this.dynamics, zone: this.zone, height: this.height })); }
// }
// registerEngine('remote', () => new RemoteModelEngine());
