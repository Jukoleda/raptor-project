// Sprites: textures, atlas frames, animation, tint and draw order.
//
// The page is a single self-contained file, so there are no .png files next to
// it to load. The sheet is therefore **drawn at runtime** with a 2D canvas and
// uploaded as a texture — the same trick as the synthesised engine sound, and a
// fair demonstration in its own right: `Texture.fromCanvas` is how you'd feed
// Raptor anything you generate rather than author.
//
// Swapping it for real art is one line:
//
//     const texture = Texture.fromImage(gl, "hoja.png");
//
// Everything below it stays exactly the same, because a Texture is a Texture.
//
// Controls: WASD/flechas mueven · 1-4 tiñen · L filtrado · C capa superior.

import App from "../components/app.js";
import { el, kv, slider, card, button, hint } from "../components/ui/index.js";
import { Sprite, Circle } from "../components/shapes/index.js";
import { Texture, SpriteSheet, Animator } from "../components/render/index.js";

const CELL = 32;              // pixels per sheet cell
const PPU = 32;               // pixels per world unit → one tile is one unit
const MAP = { width: 17, height: 13 };
const SPEED = 3.4;            // world units per second

// Tiles are drawn a hair larger than the grid they sit on. Two quads that share
// an edge land on a sub-pixel boundary after the perspective divide, and the
// rasteriser gives that pixel to neither — which shows up as a thin dark seam
// running through the whole map. Overlapping them slightly is the standard fix;
// the alternative is padding every cell in the sheet.
const TILE_BLEED = 1.04;

// Draw order. Named, because "layer 3" tells you nothing six months later.
const LAYER = { GROUND: -20, DECAL: -10, PROP: 0, ACTOR: 10, CANOPY: 20 };

const TINTS = {
    Normal: { red: 1, green: 1, blue: 1 },
    Herido: { red: 1, green: 0.35, blue: 0.3 },
    Veneno: { red: 0.55, green: 1, blue: 0.5 },
    Fantasma: { red: 0.7, green: 0.85, blue: 1, alpha: 0.45 },
};

const STYLES = `
    .swatches { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .swatches button.active { border-color: #4a7fb5; background: #2b3a4a; box-shadow: inset 0 0 0 1px #4a7fb5; }
    .sheet { display: block; width: 100%; height: auto; image-rendering: pixelated;
             border-radius: 6px; border: 1px solid #3a3f45; background: #14171b; }
    .frames { display: flex; gap: 4px; margin-top: 8px; }
    .frames > i { flex: 1; height: 6px; border-radius: 3px; background: #2f343a; }
    .frames > i.on { background: #6aa9e0; }
`;

// --- The sheet, drawn rather than loaded --------------------------------
// Six columns by three rows of 32×32 cells: a walk cycle, ground tiles and
// props. Deliberately blocky — it is drawn with rectangles so the code stays
// short enough to read, and NEAREST filtering keeps the edges crisp.

function drawSheet() {
    const canvas = document.createElement("canvas");
    canvas.width = CELL * 6;
    canvas.height = CELL * 3;
    const ctx = canvas.getContext("2d");
    const px = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };

    // Row 0 — the walker: 4 frames of walk, then 2 of idle. Only the legs and a
    // one-pixel bob change between frames, which is enough to read as walking.
    const walker = (col, legOffset, bob) => {
        const x = col * CELL;
        const y = bob;
        px(x + 10, y + 8, 12, 12, "#e0533d");            // body
        px(x + 12, y + 4, 8, 6, "#f2a58c");              // head
        px(x + 13, y + 6, 2, 2, "#1b1d21");              // eyes
        px(x + 17, y + 6, 2, 2, "#1b1d21");
        px(x + 9, y + 11, 3, 7, "#c4402c");              // arms
        px(x + 20, y + 11, 3, 7, "#c4402c");
        px(x + 11 + legOffset, y + 20, 4, 8, "#35507f"); // legs
        px(x + 17 - legOffset, y + 20, 4, 8, "#35507f");
        px(x + 10 + legOffset, y + 27, 5, 3, "#26292e"); // feet
        px(x + 17 - legOffset, y + 27, 5, 3, "#26292e");
    };
    walker(0, 0, 0); walker(1, 3, 1); walker(2, 0, 0); walker(3, -3, 1);
    walker(4, 0, 0); walker(5, 0, 1);

    // Row 1 — ground tiles. A little deterministic speckle stops a field of
    // them from looking like flat wallpaper.
    const speckle = (col, base, fleck, seed) => {
        const x = col * CELL;
        px(x, CELL, CELL, CELL, base);
        let s = seed;
        for (let i = 0; i < 26; i++) {
            s = (s * 1664525 + 1013904223) >>> 0;
            const dx = s % CELL;
            const dy = (s >>> 8) % CELL;
            px(x + dx, CELL + dy, 2, 2, fleck);
        }
    };
    speckle(0, "#2f6b3a", "#387d45", 7);      // grass
    speckle(1, "#6b5a3a", "#7d6a45", 13);     // dirt
    speckle(2, "#4a4f57", "#585e68", 29);     // stone
    speckle(3, "#1f4f6b", "#2a627f", 41);     // water
    // Grass with a path crossing it, and a flowered variant.
    speckle(4, "#2f6b3a", "#387d45", 53);
    px(CELL * 4, CELL + 11, CELL, 10, "#6b5a3a");
    speckle(5, "#2f6b3a", "#387d45", 67);
    for (const [fx, fy] of [[6, 8], [20, 14], [12, 22]]) px(CELL * 5 + fx, CELL + fy, 3, 3, "#f2c518");

    // Row 2 — props, drawn on transparent cells so they layer over the ground.
    const y2 = CELL * 2;
    // Tree trunk (cell 0) and canopy (cell 1) are separate frames on purpose:
    // the trunk sits behind the player and the canopy in front, which is the
    // whole point of having layers. The trunk fills its cell top to bottom and
    // the canopy sits low in its own, so stacking them exactly one cell apart
    // makes them meet — no hand-tuned offset to drift out of alignment.
    px(CELL * 0 + 13, y2 + 2, 6, 30, "#5a3f28");
    px(CELL * 0 + 13, y2 + 2, 2, 30, "#6d4e33");
    ctx.fillStyle = "#1f5c31";
    ctx.beginPath(); ctx.arc(CELL * 1 + 16, y2 + 20, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#2a7a41";
    ctx.beginPath(); ctx.arc(CELL * 1 + 11, y2 + 16, 8, 0, Math.PI * 2); ctx.fill();
    // Rock, bush, and two frames of a spinning coin.
    px(CELL * 2 + 8, y2 + 16, 16, 11, "#6e747d");
    px(CELL * 2 + 11, y2 + 12, 10, 6, "#878e98");
    ctx.fillStyle = "#2a7a41";
    ctx.beginPath(); ctx.arc(CELL * 3 + 16, y2 + 20, 9, 0, Math.PI * 2); ctx.fill();
    px(CELL * 4 + 11, y2 + 8, 10, 16, "#f2c518");
    px(CELL * 4 + 14, y2 + 11, 4, 10, "#c9a10f");
    px(CELL * 5 + 14, y2 + 8, 4, 16, "#f2c518");

    return canvas;
}

App.boot({ title: "Sprites · texturas y animación", styles: STYLES }, (app) => {
    const { gl, keyboard, touch } = app;

    // --- The texture ------------------------------------------------------
    const sheetCanvas = drawSheet();
    const texture = Texture.fromCanvas(gl, sheetCanvas, { smooth: false });
    const sheet = new SpriteSheet(texture, { frameWidth: CELL, frameHeight: CELL });

    const TILE = { grass: 6, dirt: 7, stone: 8, water: 9, path: 10, flowers: 11 };
    const PROP = { trunk: 12, canopy: 13, rock: 14, bush: 15, coinA: 16, coinB: 17 };

    // --- The map ----------------------------------------------------------
    // Deterministic, so the layout is the same every time (and the tests can
    // rely on it).
    let seed = 20260806;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

    const tileAt = (x, y) => {
        if (y === Math.floor(MAP.height / 2)) return TILE.path;
        if (x === 3 && y > 7) return TILE.water;
        const roll = random();
        if (roll < 0.06) return TILE.flowers;
        if (roll < 0.12) return TILE.dirt;
        if (roll < 0.16) return TILE.stone;
        return TILE.grass;
    };

    const tile = (index, x, y, layer, size = null) =>
        app.add(new Sprite(gl, {
            texture, frame: sheet.frame(index), pixelsPerUnit: PPU,
            width: size, height: size,
        }).setPosition({ x, y }).setLayer(layer).init());

    const half = { x: MAP.width / 2 - 0.5, y: MAP.height / 2 - 0.5 };
    for (let ty = 0; ty < MAP.height; ty++) {
        for (let tx = 0; tx < MAP.width; tx++) {
            tile(tileAt(tx, ty), tx - half.x, half.y - ty, LAYER.GROUND, TILE_BLEED);
        }
    }

    // Props. Trunks go below the player, canopies above — added in the "wrong"
    // order on purpose, to show that the layer decides, not the insertion.
    const canopies = [];
    const trees = [[-6, 3], [4, 4], [-3, -4], [6, -2], [1, 5]];
    for (const [x, y] of trees) {
        // One cell apart, which is exactly how the two halves were drawn.
        canopies.push(tile(PROP.canopy, x, y + 1, LAYER.CANOPY));
        tile(PROP.trunk, x, y, LAYER.PROP);
    }
    for (const [x, y] of [[-5, -1], [3, 1], [-1, -5], [7, 3]]) tile(PROP.rock, x, y, LAYER.PROP);
    for (const [x, y] of [[-7, 0], [5, -4], [0, 2]]) tile(PROP.bush, x, y, LAYER.PROP);

    // A spinning coin, to show a second animation running independently.
    const coin = app.add(new Sprite(gl, { texture, frame: sheet.frame(PROP.coinA), pixelsPerUnit: PPU })
        .setPosition({ x: 2, y: -2 }).setLayer(LAYER.PROP).init());
    const coinAnim = new Animator(coin, {
        girar: sheet.animation(PROP.coinA, PROP.coinB, { fps: 6 }),
    });

    // --- The player -------------------------------------------------------
    // A plain coloured shape under a textured one, in the same scene: the two
    // use different shader programs and the engine switches between them per
    // draw. Sprites do not replace the shapes — they join them.
    const shadow = app.add(new Circle(gl, { radius: 0.3, segments: 20 })
        .setColor({ red: 0, green: 0, blue: 0, alpha: 0.28 })
        .setScale({ x: 1, y: 0.45 }).setLayer(LAYER.DECAL).init());

    const player = app.add(new Sprite(gl, { texture, frame: sheet.frame(0), pixelsPerUnit: PPU })
        .setPosition({ x: 0, y: 0 }).setLayer(LAYER.ACTOR).init());

    // Named animations beat frame indices everywhere except right here.
    const animator = new Animator(player, {
        quieto: sheet.animation(4, 5, { fps: 2 }),
        andar: sheet.animation(0, 3, { fps: 10 }),
    }, { initial: "quieto" });

    app.camera.smoothing = 7;
    app.camera.centerOn(0, 0);
    // Keep the view inside the map: `viewExtents` reports the visible half-size
    // in world units, so the centre can travel exactly up to half a screen from
    // each edge and no further. Without this you drive off into the void.
    const view = app.camera.viewExtents(app.canvas);
    app.camera.bounds = {
        minX: -half.x - 0.5 + view.halfW, maxX: half.x + 0.5 - view.halfW,
        minY: -half.y - 0.5 + view.halfH, maxY: half.y + 0.5 - view.halfH,
    };

    // --- Panel ------------------------------------------------------------
    const sheetView = el("canvas", { className: "sheet", width: sheetCanvas.width, height: sheetCanvas.height });
    sheetView.getContext("2d").drawImage(sheetCanvas, 0, 0);

    const frameDots = [0, 1, 2, 3].map(() => el("i"));
    const kAnim = kv("Animación"), kFrame = kv("Fotograma"), kUv = kv("UV del fotograma"),
          kSprites = kv("Sprites en escena"), kTex = kv("Textura");

    const fpsCtl = slider("Velocidad", {
        min: 1, max: 24, value: 10,
        apply: (v) => { animator.animations.andar.fps = v; },
        format: (v) => `${v} fps`,
    });

    let tintName = "Normal";
    const tintBtns = Object.entries(TINTS).map(([name, color]) =>
        button(name, () => setTint(name)));
    const smoothBtn = button("", () => setSmooth(!texture.smooth));
    const canopyBtn = button("", () => setCanopy(!canopyVisible));
    let canopyVisible = true;

    app.addPanel(
        card("La hoja de sprites", [
            sheetView,
            hint("Dibujada al vuelo con un canvas 2D y subida con Texture.fromCanvas: por eso la página sigue siendo un único archivo."),
        ]),
        card("Personaje", [
            kAnim.row, kFrame.row, kUv.row,
            el("div", { className: "frames" }, frameDots),
            fpsCtl.row,
            hint("WASD o flechas para moverte · el sprite se voltea con setFlip, no girando"),
        ]),
        card("Tinte", [
            el("div", { className: "swatches" }, tintBtns),
            hint("El shader multiplica el téxel por el color: blanco no toca nada, y el alfa lo desvanece. Teclas 1-4."),
        ]),
        card("Textura y capas", [
            smoothBtn,
            el("div", { style: "margin-top:8px" }, [canopyBtn]),
            kTex.row, kSprites.row,
            hint("Las copas de los árboles están en una capa por encima del jugador, y los troncos por debajo — aunque se añadieron al revés. La sombra es una forma de color normal: sprites y formas conviven en la misma escena."),
        ]),
    );

    // --- On-screen controls ----------------------------------------------
    for (const [name, label, key] of [["up", "▲", "w"], ["down", "▼", "s"], ["left", "◀", "a"], ["right", "▶", "d"]]) {
        touch.pedal(touch.button(name, label, "round"), key);
    }
    touch.pad("left", [touch.get("left"), touch.get("right")]);
    touch.pad("right", [[touch.get("up"), touch.get("down")]]);

    keyboard
        .on("l", () => setSmooth(!texture.smooth))
        .on("c", () => setCanopy(!canopyVisible));
    Object.keys(TINTS).forEach((name, i) => keyboard.on(String(i + 1), () => setTint(name)));

    setTint("Normal");
    setSmooth(false);
    setCanopy(true);

    window.raptorSprites = {
        app, texture, sheet, player, shadow, animator, coin, coinAnim, canopies,
        LAYER, TILE, PROP,
        get tint() { return tintName; },
        get smooth() { return texture.smooth; },
        get canopyVisible() { return canopyVisible; },
        setTint, setSmooth, setCanopy,
        get state() {
            return {
                x: player.position.x, y: player.position.y,
                animation: animator.name, frame: animator.current.index,
                flipX: player.flipX, layer: player.layer,
            };
        },
    };

    app.onUpdate(update);

    // --- Behaviour --------------------------------------------------------

    function setTint(name) {
        tintName = name;
        player.setTint(TINTS[name]);
        tintBtns.forEach((b, i) => b.classList.toggle("active", Object.keys(TINTS)[i] === name));
    }

    // NEAREST keeps the blocks crisp; LINEAR blurs them. On a sheet this size
    // the difference is obvious, which is the point of putting it on a button.
    function setSmooth(smooth) {
        texture.setSmooth(smooth);
        smoothBtn.textContent = smooth ? "Filtrado: suave (L)" : "Filtrado: nítido (L)";
    }

    function setCanopy(visible) {
        canopyVisible = visible;
        // Hiding by tint alpha rather than by removing it from the scene, so the
        // draw order is untouched and the shapes come back exactly where they were.
        for (const canopy of canopies) canopy.setTint({ red: 1, green: 1, blue: 1, alpha: visible ? 1 : 0.15 });
        canopyBtn.textContent = visible ? "Copas: delante (C)" : "Copas: transparentes (C)";
    }

    function update(dt) {
        const dx = keyboard.axis(["a", "ArrowLeft"], ["d", "ArrowRight"]);
        const dy = keyboard.axis(["s", "ArrowDown"], ["w", "ArrowUp"]);

        if (dx || dy) {
            // Normalise, or walking diagonally would be 41% faster.
            const length = Math.hypot(dx, dy) || 1;
            player.setPosition({
                x: Math.max(-half.x, Math.min(half.x, player.position.x + (dx / length) * SPEED * dt)),
                y: Math.max(-half.y, Math.min(half.y, player.position.y + (dy / length) * SPEED * dt)),
            });
            animator.play("andar");
            // Only flip on an actual left/right input: walking straight up
            // should not snap the character back to facing right.
            if (dx) player.setFlip({ x: dx < 0 });
        } else {
            animator.play("quieto");
        }

        // The shadow tracks the feet, a little below the sprite's centre.
        shadow.setPosition({ x: player.position.x, y: player.position.y - 0.42 });

        animator.update(dt);
        coinAnim.update(dt);
        app.camera.follow(player.position, dt);

        drawReadout();
    }

    function drawReadout() {
        const frame = player.frame;
        kAnim.set(animator.name);
        kFrame.set(`${animator.current.index + 1} de ${animator.current.frames.length}`);
        kUv.set(`${frame.x},${frame.y} · ${frame.width}×${frame.height} px`);
        kTex.set(`${texture.width}×${texture.height} · ${texture.smooth ? "LINEAR" : "NEAREST"}`);
        kSprites.set(String(app.entities.length));
        frameDots.forEach((dot, i) => {
            dot.classList.toggle("on", animator.name === "andar" && i === animator.current.index);
        });
    }
});
