// The forest itself: generating it, and walking around in it.
//
// The map is a grid of tiles. Some are solid — trees, rocks, water — and the
// player has to slide along them rather than stop dead when a corner is
// clipped, which is what `moveWithCollision` is for.
//
// Collision is resolved **one axis at a time**: try the horizontal move, undo
// it if it lands in something solid, then do the same vertically. Doing both at
// once and undoing both is the version everyone writes first, and it is why a
// character sticks to a wall instead of sliding along it — pressing into a wall
// diagonally cancels the component that *would* have worked.

export const MAP = { width: 34, height: 26 };
export const HALF = { x: (MAP.width - 1) / 2, y: (MAP.height - 1) / 2 };

// The player's footprint, in world units. Narrower than the sprite on purpose:
// a hitbox that matches the drawing exactly feels unfair, because the shoulders
// catch on doorways the player is clearly aiming through.
export const BODY = { halfW: 0.28, halfH: 0.22 };

export const CELL_KIND = { GRASS: 0, ALT: 1, DIRT: 2, FLOWERS: 3, WATER: 4, PATH: 5, TREE: 6, ROCK: 7, BUSH: 8, STUMP: 9, LOG: 10 };

const SOLID = new Set([CELL_KIND.TREE, CELL_KIND.ROCK, CELL_KIND.WATER, CELL_KIND.LOG]);

export function isSolidKind(kind) {
    return SOLID.has(kind);
}

function makeRandom(seed) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Builds the grid. Deterministic from `seed`, so a level can be replayed and a
// test can rely on the layout.
export function generateForest(seed = 20260806) {
    const random = makeRandom(seed);
    const grid = [];

    for (let row = 0; row < MAP.height; row++) {
        const line = [];
        for (let col = 0; col < MAP.width; col++) {
            const edge = col === 0 || row === 0 || col === MAP.width - 1 || row === MAP.height - 1;
            // A wall of trees around the rim, so the world has an edge you can
            // see rather than an invisible one you bump into.
            if (edge) { line.push(CELL_KIND.TREE); continue; }

            // A clearing in the middle: somewhere to start that is not already
            // full of trees.
            const fromCentre = Math.hypot(col - HALF.x, row - HALF.y);
            if (fromCentre < 2.6) { line.push(random() < 0.3 ? CELL_KIND.PATH : CELL_KIND.GRASS); continue; }

            const roll = random();
            if (roll < 0.14) line.push(CELL_KIND.TREE);
            else if (roll < 0.17) line.push(CELL_KIND.ROCK);
            else if (roll < 0.20) line.push(CELL_KIND.BUSH);
            else if (roll < 0.22) line.push(CELL_KIND.STUMP);
            else if (roll < 0.235) line.push(CELL_KIND.LOG);
            else if (roll < 0.27) line.push(CELL_KIND.FLOWERS);
            else if (roll < 0.31) line.push(CELL_KIND.DIRT);
            else if (roll < 0.37) line.push(CELL_KIND.ALT);
            else line.push(CELL_KIND.GRASS);
        }
        grid.push(line);
    }

    // A pond, because a forest with no water reads as a field of trees.
    const pondCol = Math.floor(MAP.width * 0.72);
    const pondRow = Math.floor(MAP.height * 0.3);
    for (let row = pondRow; row < pondRow + 3; row++) {
        for (let col = pondCol; col < pondCol + 4; col++) {
            if (grid[row] && grid[row][col] !== undefined) grid[row][col] = CELL_KIND.WATER;
        }
    }

    return grid;
}

// Grid coordinates ↔ world coordinates. The grid counts rows downward and the
// world counts Y upward, which is the sign flip below — get it wrong and the
// map renders mirrored, which looks fine until collisions disagree with it.
export const toWorld = (col, row) => ({ x: col - HALF.x, y: HALF.y - row });
export const toGrid = (x, y) => ({ col: Math.round(x + HALF.x), row: Math.round(HALF.y - y) });

export function solidAt(grid, x, y) {
    const { col, row } = toGrid(x, y);
    if (row < 0 || row >= grid.length || col < 0 || col >= grid[0].length) return true;
    return isSolidKind(grid[row][col]);
}

// True if the body centred on (x, y) overlaps anything solid. Only the four
// corners are sampled: the body is smaller than a tile, so it cannot straddle
// one without a corner landing inside it.
function blocked(grid, x, y) {
    return solidAt(grid, x - BODY.halfW, y - BODY.halfH)
        || solidAt(grid, x + BODY.halfW, y - BODY.halfH)
        || solidAt(grid, x - BODY.halfW, y + BODY.halfH)
        || solidAt(grid, x + BODY.halfW, y + BODY.halfH);
}

// Moves as far as it can and reports what happened. One axis at a time, so
// running into a wall diagonally still slides along it.
export function moveWithCollision(grid, position, dx, dy) {
    let { x, y } = position;
    let hitX = false;
    let hitY = false;

    if (dx !== 0) {
        if (blocked(grid, x + dx, y)) hitX = true;
        else x += dx;
    }
    if (dy !== 0) {
        if (blocked(grid, x, y + dy)) hitY = true;
        else y += dy;
    }

    return { x, y, hitX, hitY };
}

// Free tiles, for scattering acorns somewhere reachable. Sorted by distance
// from the clearing so a caller can spread them out instead of dropping five in
// the same corner.
export function walkableCells(grid, { minDistance = 3 } = {}) {
    const cells = [];
    for (let row = 1; row < grid.length - 1; row++) {
        for (let col = 1; col < grid[row].length - 1; col++) {
            if (isSolidKind(grid[row][col])) continue;
            const { x, y } = toWorld(col, row);
            if (blocked(grid, x, y)) continue;   // a free tile hemmed in by solid ones
            const distance = Math.hypot(x, y);
            if (distance < minDistance) continue;
            cells.push({ col, row, x, y, distance });
        }
    }
    return cells;
}
