// The game's art and sound, generated at startup and served as `data:` URIs.
//
// A real game points its manifest at .png and .wav files. This one builds them
// so the page stays a single file you can open from `file://` — but it builds
// them into the *same* formats and loads them through the *same* loader, so
// swapping in real art is a change of URL and nothing else:
//
//     assets.texture("bosque", "bosque.png");   // en vez de sheetUrl()

export const CELL = 32;                 // pixels per sheet cell
export const PPU = 32;                  // pixels per world unit → a tile is 1

// Cell indices into the sheet, named so the map code reads like a map.
export const TILE = { GRASS: 0, GRASS_ALT: 1, DIRT: 2, FLOWERS: 3, WATER: 4, PATH: 5 };
export const PROP = { TRUNK: 6, CANOPY: 7, BUSH: 8, ROCK: 9, STUMP: 10, LOG: 11 };
export const ITEM = { ACORN_A: 12, ACORN_B: 13, SPARK: 14, SHADOW: 15 };
export const HERO = { WALK_0: 16, WALK_1: 17, WALK_2: 18, WALK_3: 19, IDLE_0: 20, IDLE_1: 21 };

const COLUMNS = 6;

// A tiny deterministic generator, so the art is identical on every run.
function rng(seed) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Draws the whole sheet: 6 columns × 4 rows of 32×32 cells.
export function sheetUrl() {
    const canvas = document.createElement("canvas");
    canvas.width = CELL * COLUMNS;
    canvas.height = CELL * 4;
    const ctx = canvas.getContext("2d");

    // `cell` gives every drawing routine a local origin, so no routine has to
    // know where in the sheet it landed.
    const cell = (index, draw) => {
        ctx.save();
        ctx.translate((index % COLUMNS) * CELL, Math.floor(index / COLUMNS) * CELL);
        draw((x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }, ctx);
        ctx.restore();
    };

    // --- Ground -----------------------------------------------------------
    const ground = (index, base, fleck, seed, extra = null) => cell(index, (px) => {
        px(0, 0, CELL, CELL, base);
        const random = rng(seed);
        for (let i = 0; i < 30; i++) {
            px(Math.floor(random() * CELL), Math.floor(random() * CELL), 2, 2, fleck);
        }
        if (extra) extra(px);
    });

    ground(TILE.GRASS, "#2c6437", "#347342", 11);
    ground(TILE.GRASS_ALT, "#2a6034", "#326e3f", 23);
    ground(TILE.DIRT, "#6b5a3a", "#7d6a45", 37);
    ground(TILE.FLOWERS, "#2c6437", "#347342", 53, (px) => {
        for (const [x, y, c] of [[7, 9, "#f2c518"], [21, 15, "#e8e8e8"], [13, 24, "#d87ac0"]]) px(x, y, 3, 3, c);
    });
    ground(TILE.WATER, "#1f4f6b", "#2a627f", 67, (px) => {
        px(4, 10, 12, 2, "#3f7d9c");
        px(17, 21, 10, 2, "#3f7d9c");
    });
    ground(TILE.PATH, "#6b5a3a", "#83704d", 79);

    // --- Props ------------------------------------------------------------
    // Trunk and canopy are two cells stacked one apart, so the player can walk
    // between them: the trunk is behind, the canopy in front.
    cell(PROP.TRUNK, (px) => {
        px(12, 0, 8, CELL, "#4a3320");
        px(12, 0, 3, CELL, "#5e4229");
        px(19, 0, 2, CELL, "#3a2718");
    });
    cell(PROP.CANOPY, (px, c) => {
        c.fillStyle = "#1b5029";
        c.beginPath(); c.arc(16, 19, 15, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#256b36";
        c.beginPath(); c.arc(12, 15, 9, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#2f8442";
        c.beginPath(); c.arc(20, 12, 5, 0, Math.PI * 2); c.fill();
    });
    cell(PROP.BUSH, (px, c) => {
        c.fillStyle = "#235c30";
        c.beginPath(); c.arc(11, 21, 8, 0, Math.PI * 2); c.arc(21, 21, 8, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#2c7038";
        c.beginPath(); c.arc(15, 17, 7, 0, Math.PI * 2); c.fill();
    });
    cell(PROP.ROCK, (px) => {
        px(7, 17, 18, 11, "#61676f");
        px(10, 12, 12, 6, "#767d87");
        px(12, 14, 5, 3, "#8e959f");
    });
    cell(PROP.STUMP, (px) => {
        px(9, 18, 14, 10, "#4a3320");
        px(11, 15, 10, 5, "#6d4e33");
        px(13, 16, 6, 3, "#8a6842");
    });
    cell(PROP.LOG, (px) => {
        px(2, 16, 28, 9, "#4a3320");
        px(2, 16, 28, 3, "#6d4e33");
        px(26, 16, 4, 9, "#8a6842");
    });

    // --- Items ------------------------------------------------------------
    // Two acorn frames: the second is a pixel taller, which is enough of a
    // difference to read as a gentle pulse once it is animating.
    const acorn = (index, lift) => cell(index, (px, c) => {
        const y = 14 - lift;
        c.fillStyle = "#c98a3a";                       // el cuerpo, redondeado
        c.beginPath(); c.ellipse(16, y + 4, 5, 6, 0, 0, Math.PI * 2); c.fill();
        px(14, y + 8, 4, 2, "#c98a3a");                // la punta
        px(15, y + 10, 2, 2, "#a8702c");
        c.fillStyle = "#e0a44f";                       // el brillo
        c.beginPath(); c.ellipse(14, y + 3, 2, 3, 0, 0, Math.PI * 2); c.fill();
        px(11, y - 4, 10, 5, "#5e4229");               // la caperuza
        px(11, y - 4, 10, 2, "#6d4e33");
        px(15, y - 7, 2, 3, "#4a3320");                // el rabito
    });
    acorn(ITEM.ACORN_A, 0);
    acorn(ITEM.ACORN_B, 1);

    cell(ITEM.SPARK, (px) => {
        px(14, 8, 4, 16, "#fff3b0");
        px(8, 14, 16, 4, "#fff3b0");
        px(12, 12, 8, 8, "#ffe066");
    });
    cell(ITEM.SHADOW, (px, c) => {
        c.fillStyle = "rgba(0,0,0,.32)";
        c.beginPath(); c.ellipse(16, 22, 11, 5, 0, 0, Math.PI * 2); c.fill();
    });

    // --- The hero ---------------------------------------------------------
    // Four walk frames and two idle ones. Only the legs and a one-pixel bob
    // change, which is all a walk cycle needs to read at this size.
    const hero = (index, legs, bob, arms = 0) => cell(index, (px) => {
        const y = bob;
        px(11 + legs, y + 21, 4, 8, "#2f4a7a");              // piernas
        px(17 - legs, y + 21, 4, 8, "#35507f");
        px(10 + legs, y + 28, 5, 3, "#26292e");              // pies
        px(17 - legs, y + 28, 5, 3, "#26292e");
        px(9, y + 9, 14, 13, "#3f8f4f");                     // capa/cuerpo
        px(9, y + 9, 14, 3, "#4fa661");
        px(8, y + 12 + arms, 3, 8, "#357a44");               // brazos
        px(21, y + 12 - arms, 3, 8, "#357a44");
        px(12, y + 3, 8, 7, "#f0b48c");                      // cabeza
        px(11, y + 2, 10, 3, "#6d4e33");                     // pelo
        px(13, y + 6, 2, 2, "#1b1d21");                      // ojos
        px(17, y + 6, 2, 2, "#1b1d21");
    });
    hero(HERO.WALK_0, 0, 0, 0);
    hero(HERO.WALK_1, 3, 1, 1);
    hero(HERO.WALK_2, 0, 0, 0);
    hero(HERO.WALK_3, -3, 1, -1);
    hero(HERO.IDLE_0, 0, 0, 0);
    hero(HERO.IDLE_1, 0, 1, 0);

    return canvas.toDataURL("image/png");
}

// --- Sound ---------------------------------------------------------------
// Real WAV files, header and all, so the loader has to fetch bytes and hand
// them to decodeAudioData — the same path a downloaded file would take.

function wavUrl(seconds, sample) {
    const rate = 22050;
    const frames = Math.floor(rate * seconds);
    const bytes = new Uint8Array(44 + frames * 2);
    const view = new DataView(bytes.buffer);
    const ascii = (at, text) => { for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i)); };

    ascii(0, "RIFF");
    view.setUint32(4, 36 + frames * 2, true);
    ascii(8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);          // PCM
    view.setUint16(22, 1, true);          // mono
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, frames * 2, true);

    for (let i = 0; i < frames; i++) {
        const value = Math.max(-1, Math.min(1, sample(i / rate)));
        view.setInt16(44 + i * 2, value * 32767, true);
    }

    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return "data:audio/wav;base64," + btoa(binary);
}

// Two rising notes: the universal "you picked something up".
export const pickupUrl = () => wavUrl(0.24, (t) => {
    const hz = t < 0.07 ? 880 : t < 0.14 ? 1175 : 1568;
    return Math.sin(2 * Math.PI * hz * t) * Math.exp(-t * 9) * 0.45;
});

// A fanfare of three notes for finishing.
export const winUrl = () => wavUrl(0.7, (t) => {
    const hz = t < 0.14 ? 784 : t < 0.28 ? 988 : t < 0.42 ? 1175 : 1568;
    return Math.sin(2 * Math.PI * hz * t) * Math.exp(-(t % 0.14) * 7) * 0.4;
});

// A falling pair for running out of time.
export const loseUrl = () => wavUrl(0.6, (t) => {
    const hz = t < 0.2 ? 392 : t < 0.4 ? 330 : 262;
    return Math.sin(2 * Math.PI * hz * t) * Math.exp(-(t % 0.2) * 5) * 0.4;
});

// A soft tick for the last seconds on the clock.
export const tickUrl = () => wavUrl(0.09, (t) =>
    Math.sin(2 * Math.PI * 1320 * t) * Math.exp(-t * 40) * 0.3);
