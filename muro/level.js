// El Muro — the rules, with nothing on screen.
//
// Everything here is a pure function of the level number: the same level 3 is
// the same wall every time anyone plays it, which is what makes a level
// learnable rather than a lottery. It is also what makes it testable without a
// browser — these functions know nothing about shapes, GL or the engine.
//
// The playfield is sized in world units to sit comfortably inside the default
// camera view (±3.31 × ±2.49 at a 4:3 canvas). The scene zooms the camera to
// fit whatever aspect the window actually has, so these numbers never change.

import { createRandom } from "../components/math/random.js";

export const FIELD = {
    halfW: 3.0,      // the side walls live at ±halfW
    top: 2.3,        // the ceiling
    bottom: -2.4,    // below this the ball is lost
};

export const COLS = 10;
export const MAX_ROWS = 6;

export const BRICK = {
    width: 0.52,
    height: 0.2,
    gapX: 0.05,
    gapY: 0.07,
    top: 1.95,       // centre of the first row
};

// How many hits each strength takes, and what it is worth. Index 0 is "empty",
// so a strength reads directly as "hits left".
export const BRICK_COLORS = [
    null,
    { red: 0.38, green: 0.66, blue: 0.86 },   // 1 hit
    { red: 0.95, green: 0.72, blue: 0.30 },   // 2 hits
    { red: 0.88, green: 0.37, blue: 0.40 },   // 3 hits
];

export const MAX_STRENGTH = BRICK_COLORS.length - 1;

// Worth more the tougher it was. Not a balance decision so much as an honesty
// one: the player should be paid for the thing that took longer.
export const brickScore = (strength) => 10 * strength;

// Where a brick sits in the world. Columns are centred on the field, rows go
// down from BRICK.top.
export function brickPosition(row, col) {
    const pitch = BRICK.width + BRICK.gapX;
    const span = COLS * pitch - BRICK.gapX;
    return {
        x: -span / 2 + BRICK.width / 2 + col * pitch,
        y: BRICK.top - row * (BRICK.height + BRICK.gapY),
    };
}

// The wall for a level, as a grid of strengths (0 = no brick). Row 0 is the top.
//
// The shape of the difficulty curve: the wall gets *deeper* first and *tougher*
// second, because a deeper wall is more to clear while a tougher one is more to
// clear per brick, and the first is the gentler lesson. Holes only start at
// level two — the opening level should teach the bounce, not the aiming.
export function generateLevel(index) {
    const level = Math.max(1, Math.floor(index));
    const random = createRandom(7919 + level * 131);
    const rows = Math.min(MAX_ROWS, 2 + level);

    // How far down the tough band reaches, in rows from the top.
    const toughRows = Math.min(rows, Math.floor(level / 2));

    const grid = [];
    for (let row = 0; row < rows; row++) {
        const line = [];
        for (let col = 0; col < COLS; col++) {
            if (level > 1 && random() < Math.min(0.22, 0.04 * level)) {
                line.push(0);
                continue;
            }
            let strength = 1;
            if (row < toughRows) strength = 2;
            if (row === 0 && level >= 5) strength = MAX_STRENGTH;
            line.push(strength);
        }
        grid.push(line);
    }

    // A wall with no bricks at all would be won before it started. The holes are
    // random, so however unlikely that is, it has to be impossible rather than
    // improbable.
    if (countBricks(grid) === 0) grid[rows - 1][Math.floor(COLS / 2)] = 1;
    return grid;
}

export function countBricks(grid) {
    let total = 0;
    for (const row of grid) for (const strength of row) if (strength > 0) total++;
    return total;
}

// Ball speed for a level. It climbs, but towards a ceiling rather than through
// it: past a point a faster ball is not harder, it is just unreadable.
export function ballSpeed(level) {
    return Math.min(4.8, 3.2 + 0.18 * (level - 1));
}
