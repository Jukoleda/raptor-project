// A seeded random number generator.
//
// `Math.random()` cannot be seeded, and a game that cannot be seeded cannot be
// replayed, cannot be tested and cannot hand a friend the same level. So this
// is a plain linear congruential generator — the same constants as Numerical
// Recipes — which had been copied by hand into five different files before it
// lived here.
//
//     const random = createRandom(20260806);
//     random();                 // 0 ≤ n < 1
//     randomInt(random, 1, 6);  // un dado
//
// It is not cryptographically anything. It is fast, deterministic and short,
// which is what a level generator wants.

const MULTIPLIER = 1664525;
const INCREMENT = 1013904223;
const MODULUS = 4294967296; // 2³²

// Returns a function that yields the next number in [0, 1) each time it is
// called. Two generators built from the same seed produce the same sequence.
export function createRandom(seed = 1) {
    let state = seed >>> 0;
    return () => ((state = (state * MULTIPLIER + INCREMENT) >>> 0) / MODULUS);
}

// An integer in [min, max], both ends included — which is what people mean by
// "a number between 1 and 6", and not what a naive floor() gives you.
export function randomInt(random, min, max) {
    return min + Math.floor(random() * (max - min + 1));
}

export function randomRange(random, min, max) {
    return min + random() * (max - min);
}

