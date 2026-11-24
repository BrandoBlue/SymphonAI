// Song charts. All melodies are public domain (traditional or composed before 1900).
// Notes: "E4:1" = E in octave 4 held for 1 beat, "r:1" = 1 beat rest, "D#5:.5" = half a beat.
// Chords: "Am:4" = A minor for 4 beats. bpmEnd makes the tempo speed up across the song.
import { noteToMidi, parseChord } from './audio.js';

const furA = 'E5:.5 D#5:.5 E5:.5 B4:.5 D5:.5 C5:.5 A4:1 r:.5 C4:.5 E4:.5 A4:.5 B4:1 r:.5 E4:.5 G#4:.5 B4:.5 C5:1 r:.5 E4:.5 E5:.5 D#5:.5 E5:.5 D#5:.5 E5:.5 B4:.5 D5:.5 C5:.5 A4:1 r:.5 C4:.5 E4:.5 A4:.5 B4:1 r:.5 E4:.5 C5:.5 B4:.5';
const king = 'A3:.5 B3:.5 C4:.5 D4:.5 E4:.5 C4:.5 E4:1 D#4:.5 B3:.5 D#4:1 D4:.5 A#3:.5 D4:1 A3:.5 B3:.5 C4:.5 D4:.5 E4:.5 C4:.5 E4:.5 A4:.5 G4:.5 E4:.5 C4:.5 E4:.5 G4:2';
const ode = 'E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1';

export const SONGS = [
  { id: 'twinkle', title: 'Twinkle Twinkle', by: 'Traditional', level: 1, bpm: 96, bpb: 4,
    notes: 'C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2 G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2',
    chords: 'C:4 F:2 C:2 F:2 C:2 G:2 C:2 C:2 F:2 C:2 G:2 C:2 F:2 C:2 G:2 C:4 F:2 C:2 F:2 C:2 G:2 C:2' },
  { id: 'ode', title: 'Ode to Joy', by: 'Beethoven', level: 1, bpm: 108, bpb: 4,
    notes: `${ode} E4:1.5 D4:.5 D4:2 ${ode} D4:1.5 C4:.5 C4:2 D4:1 D4:1 E4:1 C4:1 D4:1 E4:.5 F4:.5 E4:1 C4:1 D4:1 E4:.5 F4:.5 E4:1 D4:1 C4:1 D4:1 G3:2 ${ode} D4:1.5 C4:.5 C4:2`,
    chords: 'C:4 G:4 C:4 G:4 C:4 G:4 C:4 G:2 C:2 G:4 G:2 C:2 G:2 C:2 C:2 G:2 C:4 G:4 C:4 G:2 C:2' },
  { id: 'saints', title: 'When the Saints', by: 'Traditional', level: 2, bpm: 132, bpb: 4,
    notes: 'r:1 C4:1 E4:1 F4:1 G4:4 r:1 C4:1 E4:1 F4:1 G4:4 r:1 C4:1 E4:1 F4:1 G4:2 E4:2 C4:2 E4:2 D4:4 r:1 E4:1 E4:1 D4:1 C4:3 C4:1 E4:2 G4:2 G4:1 F4:3 r:1 E4:1 F4:1 G4:1 E4:2 C4:2 D4:4 C4:4',
    chords: 'C:28 G:4 C:12 F:4 C:8 G:4 C:4' },
  { id: 'greensleeves', title: 'Greensleeves', by: 'Traditional', level: 2, bpm: 120, bpb: 3,
    notes: 'r:2 A4:1 C5:2 D5:1 E5:1.5 F5:.5 E5:1 D5:2 B4:1 G4:1.5 A4:.5 B4:1 C5:2 A4:1 A4:1.5 G#4:.5 A4:1 B4:2 G#4:1 E4:2 A4:1 C5:2 D5:1 E5:1.5 F5:.5 E5:1 D5:2 B4:1 G4:1.5 A4:.5 B4:1 C5:1.5 B4:.5 A4:1 G#4:1.5 F#4:.5 G#4:1 A4:3',
    chords: 'Am:3 Am:3 C:3 G:3 Em:3 Am:3 E:3 E:3 Am:3 Am:3 C:3 G:3 Em:3 Am:3 E:3 Am:3' },
  { id: 'elise', title: 'Für Elise', by: 'Beethoven', level: 3, bpm: 150, bpb: 3,
    notes: `r:2 E5:.5 D#5:.5 ${furA} A4:2 E5:.5 D#5:.5 ${furA} A4:3`,
    chords: 'Am:3 Am:3 Am:3 E:3 Am:3 Am:3 Am:3 E:3 Am:3 Am:3 Am:3 E:3 Am:3 Am:3 Am:3 E:3 Am:3' },
  { id: 'king', title: 'Hall of the Mountain King', by: 'Grieg · speeds up!', level: 3, bpm: 100, bpmEnd: 180, bpb: 4, suggest: 'metal',
    notes: `${king} ${king} ${king} A3:4`,
    chords: 'Am:4 B:2 Bb:2 Am:4 C:4 Am:4 B:2 Bb:2 Am:4 C:4 Am:4 B:2 Bb:2 Am:4 C:4 Am:4' },
];

export function parseNotes(str) {
  let beat = 0; const notes = [];
  for (const tok of str.trim().split(/\s+/)) {
    const [n, d] = tok.split(':'), dur = +d;
    if (!(dur > 0)) throw new Error('Bad duration: ' + tok);
    if (n !== 'r') notes.push({ midi: noteToMidi(n), beat, dur });
    beat += dur;
  }
  return { notes, total: beat };
}
export function parseChords(str) {
  let beat = 0;
  return str.trim().split(/\s+/).map((tok) => {
    const [n, d] = tok.split(':'); const c = { ...parseChord(n), beat, dur: +d }; beat += +d; return c;
  });
}
