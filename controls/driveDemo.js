// Drive-a-tank demo: steer a hull around an arena with tank-style controls.
// W/↑ and S/↓ drive forward/back along the way it points; A/← and D/→ pivot the
// hull in place. Movement comes from components/controls/TankController; the
// barrel and turret are cosmetic parts that follow the hull each frame.

import RaptorEngine from "../components/raptorEngine.js";
import { Rectangle, Square, Circle } from "../components/shapes/index.js";
import { TankController } from "../components/controls/index.js";

// The map is much larger than the view, so the camera has to follow the tank.
// Visible half-extents come from the engine's projection (perspective FOV 45°
// at depth 6) and the 4:3 canvas — used to keep the camera inside the walls.
const FOV = (45 * Math.PI) / 180;
const VIEW_H = 6 * Math.tan(FOV / 2);   // ≈ 2.49 world units (half height)
const VIEW_W = VIEW_H * (800 / 600);    // ≈ 3.31 world units (half width)

const MAP = { minX: -9, maxX: 9, minY: -6.5, maxY: 6.5 }; // ~18 × 13 arena
const WALL = 0.4;

// Keep the tank inside the walls, and the camera inside the map edges.
const TANK_BOUNDS = { minX: MAP.minX + 0.6, maxX: MAP.maxX - 0.6, minY: MAP.minY + 0.6, maxY: MAP.maxY - 0.6 };
const CAM_BOUNDS = { minX: MAP.minX + VIEW_W, maxX: MAP.maxX - VIEW_W, minY: MAP.minY + VIEW_H, maxY: MAP.maxY - VIEW_H };

const STYLES = `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #e6e6e6; background: #1b1d21; }
    #app { display: flex; gap: 16px; padding: 16px; align-items: flex-start; flex-wrap: wrap; }
    #stage { position: relative; background: #0a0d12; border-radius: 8px; overflow: hidden; box-shadow: 0 6px 24px rgba(0,0,0,.4); }
    #stage canvas { display: block; max-width: 100%; height: auto; }
    #panel { width: 280px; display: flex; flex-direction: column; gap: 16px; }

    /* On-screen controls overlaid on the canvas (touch + mouse). */
    .pad { position: absolute; bottom: 16px; display: flex; gap: 12px; }
    .pad.left { left: 16px; }
    .pad.right { right: 16px; }
    .pad .col { display: flex; flex-direction: column; gap: 12px; }
    .tbtn {
        width: 60px; height: 60px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 22px; line-height: 1; color: #e6e6e6;
        background: rgba(38, 43, 51, .55); border: 1px solid rgba(255, 255, 255, .28);
        -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
        touch-action: none; user-select: none; -webkit-user-select: none;
        -webkit-tap-highlight-color: transparent; cursor: pointer;
    }
    .tbtn.on, .tbtn:active { background: rgba(74, 127, 181, .7); border-color: #7fb2e6; }
    h1 { font-size: 17px; margin: 0 0 4px; }
    h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #9aa0a6; margin: 0 0 10px; }
    .card { background: #26292e; border: 1px solid #33373d; border-radius: 8px; padding: 12px; }
    .keys { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; justify-items: center; }
    .keys kbd {
        display: inline-flex; align-items: center; justify-content: center;
        min-width: 34px; padding: 7px 0; font-family: inherit; font-size: 13px;
        background: #2f343a; border: 1px solid #3a3f45; border-bottom-width: 2px; border-radius: 6px; color: #e6e6e6;
    }
    .keys kbd.on { background: #2b3a4a; border-color: #4a7fb5; color: #cfe4fb; }
    .keys .sp { visibility: hidden; }
    .hint { font-size: 12px; color: #7d838a; margin-top: 10px; text-align: center; }
    .kv { display: flex; justify-content: space-between; font-size: 13px; margin: 5px 0; }
    .kv .k { color: #9aa0a6; }
    .kv .v { font-variant-numeric: tabular-nums; }
    .bar { height: 12px; background: #1b1d21; border-radius: 6px; overflow: hidden; border: 1px solid #3a3f45; margin-top: 4px; }
    .bar > i { display: block; height: 100%; width: 0; background: #43c06a; transition: width .08s linear; }
    button { cursor: pointer; border: 1px solid #3a3f45; background: #2f343a; color: #e6e6e6; border-radius: 6px; padding: 9px 10px; font-size: 13px; width: 100%; }
    button:hover { background: #3a4047; }

    /* Stack the panel under the canvas and grow the touch buttons on phones. */
    @media (max-width: 720px) {
        #app { flex-direction: column; padding: 10px; gap: 10px; }
        #panel { width: 100%; }
        .tbtn { width: 68px; height: 68px; font-size: 24px; }
    }
`;

function el(tag, props = {}, children = []) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children) node.append(child);
    return node;
}

function startDemo() {
    document.head.append(el("style", { textContent: STYLES }));

    const game = new RaptorEngine();
    const stage = el("div", { id: "stage" });
    game.createWindow(stage);
    const gl = game.context;

    // --- Reference grid (thin lines every 2 units) so panning reads clearly. ---
    const gridColor = { red: 0.13, green: 0.16, blue: 0.2 };
    const mapW = MAP.maxX - MAP.minX;
    const mapH = MAP.maxY - MAP.minY;
    for (let x = Math.ceil(MAP.minX); x <= MAP.maxX; x += 2) {
        game.add(new Rectangle(gl, { width: 0.03, height: mapH }).setColor(gridColor).setPosition({ x, y: 0 }).init());
    }
    for (let y = Math.ceil(MAP.minY); y <= MAP.maxY; y += 2) {
        game.add(new Rectangle(gl, { width: mapW, height: 0.03 }).setColor(gridColor).setPosition({ x: 0, y }).init());
    }

    // --- Border walls around the map edges. ---
    const wallColor = { red: 0.36, green: 0.33, blue: 0.28 };
    const wall = (w, h, x, y) => game.add(new Rectangle(gl, { width: w, height: h }).setColor(wallColor).setPosition({ x, y }).init());
    wall(mapW + WALL, WALL, 0, MAP.maxY); // top
    wall(mapW + WALL, WALL, 0, MAP.minY); // bottom
    wall(WALL, mapH + WALL, MAP.minX, 0); // left
    wall(WALL, mapH + WALL, MAP.maxX, 0); // right

    // --- Reference obstacles (visual only — no collision) spread over the map. ---
    const blocks = [
        { x: -5.5, y: 3.2, s: 0.7, c: { red: 0.30, green: 0.33, blue: 0.40 } },
        { x: 4.8, y: 2.4, s: 0.9, c: { red: 0.33, green: 0.30, blue: 0.38 } },
        { x: 6.6, y: -3.1, s: 0.7, c: { red: 0.30, green: 0.36, blue: 0.40 } },
        { x: -6.2, y: -2.6, s: 0.8, c: { red: 0.34, green: 0.32, blue: 0.30 } },
        { x: 0.4, y: 4.6, s: 0.6, c: { red: 0.28, green: 0.34, blue: 0.30 } },
        { x: -2.0, y: -4.4, s: 0.8, c: { red: 0.32, green: 0.30, blue: 0.36 } },
        { x: 2.6, y: -0.6, s: 0.5, c: { red: 0.30, green: 0.35, blue: 0.38 } },
        { x: -3.0, y: 0.8, s: 0.6, c: { red: 0.35, green: 0.33, blue: 0.30 } },
    ];
    for (const b of blocks) {
        game.add(new Square(gl, { size: b.s }).setColor(b.c).setPosition({ x: b.x, y: b.y }).init());
    }

    // --- Tank: hull (driven) + barrel + turret (cosmetic, follow the hull). ---
    const HULL = { w: 0.55, h: 0.8 };
    const BARREL_OFFSET = HULL.h / 2 + 0.25; // barrel center sits past the nose

    const hull = new Rectangle(gl, { width: HULL.w, height: HULL.h })
        .setColor({ red: 0.27, green: 0.5, blue: 0.32 }).setPosition({ x: 0, y: 0 }).init();
    const barrel = new Rectangle(gl, { width: 0.1, height: 0.5 })
        .setColor({ red: 0.18, green: 0.32, blue: 0.22 }).init();
    const turret = new Circle(gl, { radius: 0.22 })
        .setColor({ red: 0.22, green: 0.42, blue: 0.28 }).init();

    game.add(hull);
    game.add(barrel);
    game.add(turret);

    const tank = new TankController(hull, { bounds: TANK_BOUNDS });
    tank.bindKeys(window);

    // Camera follows the tank, kept inside the map edges. game.camera is the
    // engine's default Camera; we just configure and steer it.
    const camera = game.camera;
    camera.smoothing = 6;
    camera.bounds = CAM_BOUNDS;
    camera.centerOn(hull.position.x, hull.position.y);

    // On-screen controls overlaid on the canvas: steering on the left (for the
    // left thumb), throttle on the right. Works with touch and mouse; holding
    // two at once (e.g. ▲ + ◀) drives and turns together.
    const tbtn = (label) => el("div", { className: "tbtn", textContent: label });
    const btn = { up: tbtn("▲"), down: tbtn("▼"), left: tbtn("◀"), right: tbtn("▶") };
    stage.append(
        el("div", { className: "pad left" }, [btn.left, btn.right]),
        el("div", { className: "pad right" }, [el("div", { className: "col" }, [btn.up, btn.down])]),
    );
    tank.bindTouch({ forward: btn.up, back: btn.down, left: btn.left, right: btn.right });

    // --- Panel / HUD ---
    const keyEls = {};
    const mkKey = (id, label) => (keyEls[id] = el("kbd", { textContent: label }));
    const spacer = () => el("kbd", { className: "sp", textContent: "·" });
    const keypad = el("div", { className: "keys" }, [
        spacer(), mkKey("up", "W"), spacer(),
        mkKey("left", "A"), mkKey("down", "S"), mkKey("right", "D"),
    ]);

    const kSpeed = kv("Velocidad"), kHeading = kv("Rumbo"), kThrottle = kv("Acelerador"), kPos = kv("Posición");
    const speedFill = el("i");
    const speedBar = el("div", { className: "bar" }, [speedFill]);
    const resetBtn = el("button", { textContent: "Centrar tanque", onclick: reset });

    const panel = el("div", { id: "panel" }, [
        el("h1", { textContent: "Conducción de tanque" }),
        el("div", { className: "card" }, [
            el("h2", { textContent: "Controles" }), keypad,
            el("div", { className: "hint", textContent: "W/S o ↑/↓ avanzan · A/D o ←/→ giran · o usa los botones en pantalla" }),
        ]),
        el("div", { className: "card" }, [
            el("h2", { textContent: "Telemetría" }), kSpeed.row, speedBar, kHeading.row, kThrottle.row, kPos.row,
        ]),
        el("div", { className: "card" }, [
            el("div", { className: "hint", textContent: "La cámara sigue al tanque por un mapa mayor que la pantalla." }),
            resetBtn,
        ]),
    ]);

    document.body.append(el("div", { id: "app" }, [stage, panel]));

    // Debug / test handle.
    window.raptorDrive = { game, tank, hull, reset };

    game.addUpdater(update);
    game.start();
    syncParts();

    // --- Behaviour ---
    function kv(label) {
        const v = el("span", { className: "v", textContent: "—" });
        const row = el("div", { className: "kv" }, [el("span", { className: "k", textContent: label }), v]);
        return { row, v };
    }

    // Places the barrel and turret relative to the hull's current transform.
    function syncParts() {
        const f = tank.forward;
        turret.setPosition({ x: hull.position.x, y: hull.position.y });
        barrel.setPosition({ x: hull.position.x + f.x * BARREL_OFFSET, y: hull.position.y + f.y * BARREL_OFFSET });
        barrel.setRotation(hull.rotation);
    }

    function reset() {
        hull.setPosition({ x: 0, y: 0 }).setRotation(0);
        tank.speed = 0;
        syncParts();
        camera.centerOn(hull.position.x, hull.position.y);
    }

    function update(dt) {
        tank.update(dt);
        syncParts();
        camera.follow(hull.position, dt); // keep the tank on screen as it roams

        // Highlight the active directions on both the panel keypad and the
        // on-screen buttons, whatever the input source (keyboard or touch).
        const fwd = tank.input.forward > 0, back = tank.input.forward < 0;
        const left = tank.input.turn > 0, right = tank.input.turn < 0;
        keyEls.up.classList.toggle("on", fwd);
        keyEls.down.classList.toggle("on", back);
        keyEls.left.classList.toggle("on", left);
        keyEls.right.classList.toggle("on", right);
        btn.up.classList.toggle("on", fwd);
        btn.down.classList.toggle("on", back);
        btn.left.classList.toggle("on", left);
        btn.right.classList.toggle("on", right);

        // Telemetry.
        const speed = tank.speed;
        kSpeed.v.textContent = `${speed.toFixed(2)} u/s`;
        // Heading in compass-ish degrees (0 = arriba), CCW positive.
        const heading = ((hull.rotation % 360) + 360) % 360;
        kHeading.v.textContent = `${heading.toFixed(0)}°`;
        kThrottle.v.textContent = tank.input.forward > 0 ? "Adelante" : tank.input.forward < 0 ? "Atrás" : "—";
        kPos.v.textContent = `${hull.position.x.toFixed(1)}, ${hull.position.y.toFixed(1)}`;

        const pct = Math.min(100, (Math.abs(speed) / tank.maxSpeed) * 100);
        speedFill.style.width = `${pct}%`;
        speedFill.style.background = speed >= 0 ? "#43c06a" : "#d8a13a";
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startDemo);
} else {
    startDemo();
}
