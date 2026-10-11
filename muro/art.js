// El Muro — the sounds, synthesised.
//
// Six short notes, built as real WAV files by the audio layer's `wavUrl` and
// loaded through `Assets` like any other asset. Nothing here is a file on disk,
// which is what keeps the built page a single self-contained .html.
//
// They are deliberately plain shapes — sine, square, a little noise — because
// what makes a brick breaker feel right is not timbre but *timing*: the hit has
// to land on the frame the ball turns around.

import { wavUrl } from "../components/audio/wav.js";

// A short exponential decay, the envelope behind almost every sound here.
const decay = (t, rate) => Math.exp(-t * rate);

// Square wave, which cuts through a phone speaker better than a sine at the
// volumes a game actually plays at.
const square = (t, hz) => (Math.sin(2 * Math.PI * hz * t) >= 0 ? 1 : -1);

// The paddle: a low, blunt thunk. Something solid, not something musical.
export const golpeUrl = () => wavUrl(0.09, (t) =>
    square(t, 210 - t * 400) * decay(t, 34) * 0.5);

// A brick: a bright blip. The scene varies its pitch with the brick's strength
// through the mixer's `rate`, so one file covers all three.
export const ladrilloUrl = () => wavUrl(0.08, (t) =>
    Math.sin(2 * Math.PI * 740 * t) * decay(t, 30) * 0.55);

// The wall: the same event, but nothing happened. Quieter and duller, so the
// ear learns to ignore it.
export const paredUrl = () => wavUrl(0.05, (t) =>
    Math.sin(2 * Math.PI * 320 * t) * decay(t, 44) * 0.3);

// A life lost: two falling notes. Down, because every player on earth already
// knows what down means.
export const falloUrl = () => wavUrl(0.45, (t) => {
    const hz = t < 0.14 ? 300 : t < 0.28 ? 230 : 170;
    return square(t, hz) * decay(t, 6) * 0.32;
});

// The wall cleared: a rising arpeggio.
export const nivelUrl = () => wavUrl(0.55, (t) => {
    const hz = t < 0.1 ? 523 : t < 0.2 ? 659 : t < 0.3 ? 784 : 1046;
    return Math.sin(2 * Math.PI * hz * t) * decay(t, 4.5) * 0.4;
});

// Out of lives. The same arpeggio upside down, which is the joke and also the
// clearest possible way to say "that was the other outcome".
export const finUrl = () => wavUrl(0.7, (t) => {
    const hz = t < 0.14 ? 523 : t < 0.28 ? 415 : t < 0.42 ? 349 : 262;
    return square(t, hz) * decay(t, 3.4) * 0.3;
});
