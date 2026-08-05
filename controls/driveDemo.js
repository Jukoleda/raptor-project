// Tank battle demo: drive a tank around a map larger than the screen and fight
// four enemies run by a finite state machine (patrol → chase → attack → retreat).
//
// Player: W/S or ↑/↓ drive, A/D or ←/→ pivot the hull, the mouse or a finger on
// the canvas aims the turret (Q/E traverse by hand), click or Space fires.
// Every tank carries a health bar above it and dies when it runs out.
//
// Pieces: components/controls/TankController (movement), TankAI (behaviour),
// components/vehicles/Tank (hull + movable turret + health), components/weapons
// (gun and shells) and the engine's Camera (follows the player).

import RaptorEngine from "../components/raptorEngine.js";
import { Rectangle, Square, Circle } from "../components/shapes/index.js";
import { TankController, TankAI, AI_STATE_LABEL, Gearbox, GEARBOX_MODE, AutoAim, AIM_MODE } from "../components/controls/index.js";
import { Tank, TANK_DESIGNS } from "../components/vehicles/index.js";
import { Weapon } from "../components/weapons/index.js";

// The map is much larger than the view, so the camera has to follow the tank.
// Visible half-extents come from the engine's projection (perspective FOV 45°
// at depth 6) and the 4:3 canvas — used to keep the camera inside the walls.
const FOV = (45 * Math.PI) / 180;
const VIEW_H = 6 * Math.tan(FOV / 2);   // ≈ 2.49 world units (half height)
const VIEW_W = VIEW_H * (800 / 600);    // ≈ 3.31 world units (half width)

// The arena holds ten times the ground it used to: the old 18 × 13 became
// 57 × 41, i.e. √10 longer on each side, so the *area* is 10×. Everything that
// fills it (walls, cover, enemies) is derived from these bounds.
const MAP = { minX: -28.5, maxX: 28.5, minY: -20.5, maxY: 20.5 }; // 57 × 41 arena
const WALL = 0.4;
const OBSTACLES = 78;   // scattered cover, scaled to the new size
const ENEMY_COUNT = 12; // a bigger map needs more to find

// Deterministic scatter: the same map every time you open the page, which keeps
// the layout learnable (and the tests reproducible).
function makeRng(seed) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Keep tanks inside the walls, and the camera inside the map edges.
const TANK_BOUNDS = { minX: MAP.minX + 0.6, maxX: MAP.maxX - 0.6, minY: MAP.minY + 0.6, maxY: MAP.maxY - 0.6 };
const CAM_BOUNDS = { minX: MAP.minX + VIEW_W, maxX: MAP.maxX - VIEW_W, minY: MAP.minY + VIEW_H, maxY: MAP.maxY - VIEW_H };

// Selectable player tanks, in the order shown in the panel.
const GARAGE = [TANK_DESIGNS.medium, TANK_DESIGNS.light, TANK_DESIGNS.heavy, TANK_DESIGNS.hunter];

// Enemies share one red palette so they read as hostile at a glance; their
// silhouette still tells you which design (and therefore threat) you are facing.
const ENEMY_COLORS = {
    hull: { red: 0.62, green: 0.25, blue: 0.22 },
    turret: { red: 0.5, green: 0.19, blue: 0.18 },
    barrel: { red: 0.33, green: 0.13, blue: 0.12 },
};

// Enemies ringed around the player's start at varying radii, so you meet them
// gradually as you explore instead of all at once.
const SPAWNS = Array.from({ length: ENEMY_COUNT }, (_, i) => {
    const keys = ["light", "medium", "hunter", "heavy"];
    const angle = (i / ENEMY_COUNT) * Math.PI * 2 + 0.35;
    const spread = 0.45 + 0.5 * ((i % 3) / 2);
    return {
        design: keys[i % keys.length],
        x: Math.cos(angle) * (MAP.maxX - 2.5) * spread,
        y: Math.sin(angle) * (MAP.maxY - 2.5) * spread,
        rotation: (-angle * 180) / Math.PI,
    };
});

const WRECK_COLOR = { red: 0.17, green: 0.17, blue: 0.19 };

// Auto-fire holds off until the gun is this close to the locked target, so it
// spends shells on the target instead of spraying while the turret swings.
const AUTO_FIRE_ARC = 4; // degrees

const STYLES = `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #e6e6e6; background: #1b1d21; }
    #app { display: flex; gap: 16px; padding: 16px; align-items: flex-start; flex-wrap: wrap; }
    #stage { position: relative; background: #0a0d12; border-radius: 8px; overflow: hidden; box-shadow: 0 6px 24px rgba(0,0,0,.4); }
    #stage canvas { display: block; max-width: 100%; height: auto; touch-action: none; }
    #panel { width: 290px; display: flex; flex-direction: column; gap: 16px; }

    /* On-screen controls overlaid on the canvas (touch + mouse). */
    .pad { position: absolute; bottom: 16px; display: flex; gap: 12px; align-items: flex-end; }
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
    .tbtn.fire { background: rgba(122, 47, 47, .6); border-color: rgba(230, 140, 140, .45); }
    .tbtn.fire:active { background: rgba(170, 60, 60, .8); }

    /* Banner over the canvas when the battle ends. */
    #banner {
        position: absolute; inset: 0; display: none;
        flex-direction: column; align-items: center; justify-content: center; gap: 14px;
        background: rgba(10, 13, 18, .72); text-align: center; padding: 20px;
    }
    #banner.show { display: flex; }
    #banner b { font-size: 26px; letter-spacing: .02em; }
    #banner button { width: auto; padding: 10px 18px; }

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
    .bar > i { display: block; height: 100%; width: 0; background: #43c06a; transition: width .1s linear; }
    .bar.slim { height: 7px; border-radius: 4px; margin-top: 3px; }
    .mini { display: block; width: 100%; height: auto; border-radius: 6px; background: #0a0d12; border: 1px solid #3a3f45; }
    button { cursor: pointer; border: 1px solid #3a3f45; background: #2f343a; color: #e6e6e6; border-radius: 6px; padding: 9px 10px; font-size: 13px; width: 100%; }
    button:hover { background: #3a4047; }

    /* Tank picker. */
    .garage { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    button.tankbtn { text-align: left; line-height: 1.3; padding: 8px 9px; }
    button.tankbtn.active { border-color: #4a7fb5; background: #2b3a4a; box-shadow: inset 0 0 0 1px #4a7fb5; }
    button.tankbtn b { display: block; font-size: 13px; }
    button.tankbtn small { color: #9aa0a6; font-size: 11px; }

    .tbtn.aim { background: rgba(30, 74, 92, .6); border-color: rgba(120, 210, 240, .45); font-size: 20px; }
    .tbtn.aim.on { background: rgba(60, 150, 190, .8); border-color: #7fe0ff; }

    .tbtn.autofire { background: rgba(92, 48, 30, .6); border-color: rgba(240, 170, 120, .45); font-size: 12px; font-weight: 700; letter-spacing: .04em; }
    .tbtn.autofire.on { background: rgba(190, 95, 45, .85); border-color: #ffbe86; }

    /* Auto-aim card. */
    .aimrow { display: flex; align-items: center; gap: 10px; }
    .aimrow .dot { width: 10px; height: 10px; border-radius: 50%; background: #4a4f57; flex: none; }
    .aimrow .dot.on { background: #73d9ff; box-shadow: 0 0 8px #73d9ff; }
    .aimrow b { font-size: 14px; }
    .target { font-size: 12.5px; color: #9aa0a6; margin-top: 8px; }
    .target b { color: #cfe4fb; }

    /* Gearbox readout: big gear letter, tachometer and mode switch. */
    .gearbox { display: flex; align-items: center; gap: 12px; }
    .gearbox .gear {
        width: 52px; height: 52px; flex: none; border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        font-size: 25px; font-weight: 700; font-variant-numeric: tabular-nums;
        background: #1b1d21; border: 1px solid #3a3f45; color: #e6e6e6;
    }
    .gearbox .gear.shifting { color: #7d838a; border-color: #4a7fb5; }
    .gearbox .right { flex: 1; min-width: 0; }
    .tach { height: 10px; background: #1b1d21; border-radius: 5px; overflow: hidden; border: 1px solid #3a3f45; }
    .tach > i { display: block; height: 100%; width: 0; background: #6aa9e0; }
    .gearbox .lbl { display: flex; justify-content: space-between; font-size: 11.5px; color: #9aa0a6; margin-bottom: 4px; }
    .shiftrow { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
    .shiftrow button:disabled { opacity: .4; cursor: default; }

    /* Enemy roster with live FSM state. */
    .foe { margin: 9px 0; }
    .foe:first-child { margin-top: 0; }
    .foe .top { display: flex; justify-content: space-between; font-size: 12.5px; }
    .foe .st { color: #9aa0a6; font-variant-numeric: tabular-nums; }
    .foe.down .top { opacity: .45; }
    .foe .st.attack { color: #e8776a; }
    .foe .st.chase { color: #e8c24a; }
    .foe .st.retreat { color: #6aa9e0; }

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

// --- Geometry helpers (bullets and bodies against the static map) ---

// Smallest vector that pushes a circle out of an AABB, or null if clear.
function pushOut(cx, cy, r, box) {
    const nearX = Math.max(box.minX, Math.min(cx, box.maxX));
    const nearY = Math.max(box.minY, Math.min(cy, box.maxY));
    const dx = cx - nearX;
    const dy = cy - nearY;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) return null;
    if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        return { x: (dx / d) * (r - d), y: (dy / d) * (r - d) };
    }
    // Center inside the box: eject along the nearest face.
    const left = cx - box.minX, right = box.maxX - cx;
    const bottom = cy - box.minY, top = box.maxY - cy;
    const mx = Math.min(left, right), my = Math.min(bottom, top);
    return mx < my
        ? { x: (left < right ? -1 : 1) * (mx + r), y: 0 }
        : { x: 0, y: (bottom < top ? -1 : 1) * (my + r) };
}

// Segment a→b against an AABB (slab method). Used for shells and line of sight.
function segmentHitsBox(a, b, box) {
    const d = [b.x - a.x, b.y - a.y];
    const from = [a.x, a.y];
    const min = [box.minX, box.minY];
    const max = [box.maxX, box.maxY];
    let t0 = 0, t1 = 1;
    for (let i = 0; i < 2; i++) {
        if (Math.abs(d[i]) < 1e-9) {
            if (from[i] < min[i] || from[i] > max[i]) return false;
            continue;
        }
        let ta = (min[i] - from[i]) / d[i];
        let tb = (max[i] - from[i]) / d[i];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) return false;
    }
    return true;
}

// Segment a→b against a circle — how a shell finds out it hit a tank.
function segmentHitsCircle(a, b, c, r) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const fx = a.x - c.x, fy = a.y - c.y;
    const A = dx * dx + dy * dy;
    if (A < 1e-12) return fx * fx + fy * fy <= r * r;
    const B = 2 * (fx * dx + fy * dy);
    const C = fx * fx + fy * fy - r * r;
    if (C <= 0) return true; // started inside
    const disc = B * B - 4 * A * C;
    if (disc < 0) return false;
    const root = Math.sqrt(disc);
    const t1 = (-B - root) / (2 * A);
    const t2 = (-B + root) / (2 * A);
    return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1);
}

function startDemo() {
    document.head.append(el("style", { textContent: STYLES }));

    const game = new RaptorEngine();
    const stage = el("div", { id: "stage" });
    game.createWindow(stage);
    const gl = game.context;

    // Axis-aligned boxes tanks and shells collide with (walls + obstacles).
    const colliders = [];
    const addBox = (cx, cy, hw, hh) => colliders.push({ minX: cx - hw, maxX: cx + hw, minY: cy - hh, maxY: cy + hh });

    // --- Reference grid (every 4 units) so panning reads clearly. ---
    const gridColor = { red: 0.19, green: 0.23, blue: 0.29 };
    const mapW = MAP.maxX - MAP.minX;
    const mapH = MAP.maxY - MAP.minY;
    for (let x = Math.ceil(MAP.minX / 4) * 4; x <= MAP.maxX; x += 4) {
        game.add(new Rectangle(gl, { width: 0.05, height: mapH }).setColor(gridColor).setPosition({ x, y: 0 }).init());
    }
    for (let y = Math.ceil(MAP.minY / 4) * 4; y <= MAP.maxY; y += 4) {
        game.add(new Rectangle(gl, { width: mapW, height: 0.05 }).setColor(gridColor).setPosition({ x: 0, y }).init());
    }

    // --- Border walls around the map edges (drawn + collidable). ---
    const wallColor = { red: 0.42, green: 0.38, blue: 0.31 };
    const wall = (w, h, x, y) => {
        game.add(new Rectangle(gl, { width: w, height: h }).setColor(wallColor).setPosition({ x, y }).init());
        addBox(x, y, w / 2, h / 2);
    };
    wall(mapW + WALL, WALL, 0, MAP.maxY); // top
    wall(mapW + WALL, WALL, 0, MAP.minY); // bottom
    wall(WALL, mapH + WALL, MAP.minX, 0); // left
    wall(WALL, mapH + WALL, MAP.maxX, 0); // right

    // --- Obstacles: cover to fight around (drawn + collidable). Scattered from
    // a fixed seed, kept apart from each other and clear of the player's start.
    const rng = makeRng(20260805);
    const palette = [
        { red: 0.30, green: 0.33, blue: 0.40 }, { red: 0.33, green: 0.30, blue: 0.38 },
        { red: 0.30, green: 0.36, blue: 0.40 }, { red: 0.34, green: 0.32, blue: 0.30 },
        { red: 0.28, green: 0.34, blue: 0.30 }, { red: 0.35, green: 0.33, blue: 0.30 },
    ];
    const blocks = [];
    for (let tries = 0; tries < OBSTACLES * 30 && blocks.length < OBSTACLES; tries++) {
        const size = 0.5 + rng() * 1.4;
        const x = MAP.minX + 1.6 + rng() * (mapW - 3.2);
        const y = MAP.minY + 1.6 + rng() * (mapH - 3.2);
        if (Math.hypot(x, y) < 3.5) continue;                       // keep the start clear
        const clear = blocks.every((b) => Math.hypot(b.x - x, b.y - y) > (b.s + size) / 2 + 1.6);
        if (!clear) continue;
        blocks.push({ x, y, s: size, c: palette[blocks.length % palette.length] });
    }
    for (const b of blocks) {
        game.add(new Square(gl, { size: b.s }).setColor(b.c).setPosition({ x: b.x, y: b.y }).init());
        addBox(b.x, b.y, b.s / 2, b.s / 2);
    }

    // Line of sight for the AI: can it shoot without hitting the scenery?
    const isBlocked = (from, to) => colliders.some((box) => segmentHitsBox(from, to, box));

    // --- Battle state ---
    let design = GARAGE[0];  // the player's chosen design
    let player = null;       // unit: { tank, driver, weapon, ai }
    let enemies = [];        // units with an `ai`
    let shells = [];         // { bullet, entity }
    let over = false;

    // Where the player is pointing, in *client* pixels. Converted to world every
    // frame so the aim tracks the same spot on screen while the camera moves.
    let aimPixel = null;
    let manualTraverse = 0; // -1 / 0 / 1 from Q and E; overrides pointer aim
    let gearMode = GEARBOX_MODE.AUTO; // the player's transmission mode, kept across restarts
    let aimMode = AIM_MODE.OFF;       // the player's auto-aim policy, kept across restarts
    let autoAim = null;               // AutoAim bound to the player's tank
    let lockedOn = null;              // the tank the reticle is currently drawn on
    let autoFire = false;             // holds the trigger for you when on

    const camera = game.camera;
    camera.smoothing = 6;
    camera.bounds = CAM_BOUNDS;

    // Targeting reticle: four corner ticks framing whatever auto-aim locked on.
    // Added to the scene only while something is locked, moved every frame.
    const RETICLE_COLOR = { red: 0.45, green: 0.85, blue: 1 };
    const reticle = Array.from({ length: 4 }, () =>
        new Rectangle(gl, { width: 0.16, height: 0.16 }).setColor(RETICLE_COLOR).init());

    // --- On-screen controls: steering left, throttle + fire right. ---
    const tbtn = (label, cls = "") => el("div", { className: `tbtn ${cls}`.trim(), textContent: label });
    const btn = {
        up: tbtn("▲"), down: tbtn("▼"), left: tbtn("◀"), right: tbtn("▶"),
        fire: tbtn("🔥", "fire"), aim: tbtn("🎯", "aim"), auto: tbtn("AUTO", "autofire"),
    };
    stage.append(
        el("div", { className: "pad left" }, [btn.left, btn.right]),
        el("div", { className: "pad right" }, [
            el("div", { className: "col" }, [btn.aim, btn.auto]),
            btn.fire,
            el("div", { className: "col" }, [btn.up, btn.down]),
        ]),
    );
    btn.fire.addEventListener("pointerdown", (e) => { e.preventDefault(); firePlayer(); });
    btn.aim.addEventListener("pointerdown", (e) => { e.preventDefault(); cycleAim(); });
    btn.auto.addEventListener("pointerdown", (e) => { e.preventDefault(); toggleAutoFire(); });

    // --- Banner shown when the battle ends. ---
    const bannerText = el("b");
    const banner = el("div", { id: "banner" }, [
        bannerText,
        el("button", { textContent: "Nueva batalla", onclick: () => startBattle() }),
    ]);
    stage.append(banner);

    // --- Panel / HUD ---
    const keyEls = {};
    const mkKey = (id, label) => (keyEls[id] = el("kbd", { textContent: label }));
    const spacer = () => el("kbd", { className: "sp", textContent: "·" });
    const keypad = el("div", { className: "keys" }, [
        spacer(), mkKey("up", "W"), spacer(),
        mkKey("left", "A"), mkKey("down", "S"), mkKey("right", "D"),
    ]);

    const garageBtns = GARAGE.map((d) =>
        el("button", { className: "tankbtn", onclick: () => setDesign(d) }, [
            el("b", { textContent: d.name }),
            el("small", { textContent: `${d.hp} HP · ${d.weapon.damage} daño` }),
        ]),
    );

    const hpFill = el("i");
    const hpBar = el("div", { className: "bar" }, [hpFill]);
    const kHp = kv("Integridad"), kSpeed = kv("Velocidad"), kTurret = kv("Torreta"), kAmmo = kv("Cañón");

    // Gearbox: current gear, tachometer and the auto/manual switch.
    const gearBox = el("div", { className: "gear", textContent: "1" });
    const tachFill = el("i");
    const tachLabel = el("span");
    const gearHint = el("span", { textContent: "Revoluciones" });
    const modeBtn = el("button", { onclick: () => setGearMode() });
    const upBtn = el("button", { textContent: "Subir ▲ (X)", onclick: () => shift(1) });
    const downBtn = el("button", { textContent: "Bajar ▼ (Z)", onclick: () => shift(-1) });
    const gearWidget = el("div", {}, [
        el("div", { className: "gearbox" }, [
            gearBox,
            el("div", { className: "right" }, [
                el("div", { className: "lbl" }, [gearHint, tachLabel]),
                el("div", { className: "tach" }, [tachFill]),
                el("div", { style: "margin-top:8px" }, [modeBtn]),
            ]),
        ]),
        el("div", { className: "shiftrow" }, [downBtn, upBtn]),
    ]);

    const roster = el("div");
    const kFoes = kv("Enemigos en pie");

    // Minimap: the whole map at a glance, with every tank and the viewport.
    const MINI_W = 252;
    const MINI_H = Math.round(MINI_W * (mapH / mapW));
    const mini = el("canvas", { width: MINI_W, height: MINI_H, className: "mini" });
    const miniCtx = mini.getContext("2d");

    // Auto-aim card: the mode it is on, and what it currently has locked.
    const aimDot = el("span", { className: "dot" });
    const aimName = el("b", { textContent: "Desactivado" });
    const aimBtn = el("button", { textContent: "Cambiar modo (T)", onclick: () => cycleAim() });
    const aimTarget = el("div", { className: "target", textContent: "Sin objetivo" });
    const autoFireDot = el("span", { className: "dot" });
    const autoFireName = el("b", { textContent: "Fuego manual" });
    const autoFireBtn = el("button", { textContent: "Fuego automático (F)", onclick: () => toggleAutoFire() });
    const aimWidget = el("div", {}, [
        el("div", { className: "aimrow" }, [aimDot, aimName]),
        aimTarget,
        el("div", { style: "margin-top:10px" }, [aimBtn]),
        el("div", { className: "aimrow", style: "margin-top:14px" }, [autoFireDot, autoFireName]),
        el("div", { style: "margin-top:8px" }, [autoFireBtn]),
    ]);

    const panel = el("div", { id: "panel" }, [
        el("h1", { textContent: "Batalla de tanques" }),
        el("div", { className: "card" }, [
            el("h2", { textContent: "Tu tanque" }),
            el("div", { className: "garage" }, garageBtns),
            el("div", { className: "row" }, [hpBar]),
            kHp.row, kSpeed.row, kTurret.row, kAmmo.row,
            el("div", { className: "hint", textContent: "Teclas 1-4 cambian de tanque (reinicia la batalla)" }),
        ]),
        el("div", { className: "card" }, [
            el("h2", { textContent: "Auto-apuntado" }), aimWidget,
            el("div", { className: "hint", textContent: "T (o 🎯) cicla el objetivo · F (o AUTO) mantiene el gatillo" }),
        ]),
        el("div", { className: "card" }, [
            el("h2", { textContent: "Caja de cambios" }), gearWidget,
            el("div", { className: "hint", textContent: "G alterna automática/manual · Z y X cambian de marcha" }),
        ]),
        el("div", { className: "card" }, [
            el("h2", { textContent: "Enemigos (máquina de estados)" }), roster, kFoes.row,
        ]),
        el("div", { className: "card" }, [
            el("h2", { textContent: "Controles" }), keypad,
            el("div", { className: "hint", textContent: "W/S avanzan · A/D giran el casco · ratón o dedo apuntan la torreta (Q/E a mano) · clic o Espacio disparan" }),
        ]),
        el("div", { className: "card" }, [
            el("h2", { textContent: "Minimapa" }), mini,
            el("div", { className: "hint", textContent: "Verde: tú · rojo: enemigos · recuadro azul: lo que ves" }),
        ]),
        el("div", { className: "card" }, [el("button", { textContent: "Nueva batalla", onclick: () => startBattle() })]),
    ]);

    document.body.append(el("div", { id: "app" }, [stage, panel]));

    startBattle();

    // Debug / test handle.
    window.raptorDrive = {
        game, camera, TANK_DESIGNS, setDesign, startBattle,
        get autoAim() { return autoAim; },
        get autoFire() { return autoFire; },
        get blocks() { return blocks; },
        get colliders() { return colliders; },
        toggleAutoFire,
        get lockedOn() { return lockedOn; },
        cycleAim,
        get player() { return player; },
        get enemies() { return enemies; },
        get shells() { return shells; },
        get over() { return over; },
        get tank() { return player.tank; },
        get driver() { return player.driver; },
        get hull() { return player.tank.hull; },
    };

    game.addUpdater(update);
    game.start();

    // --- Input ---
    const canvas = game.canvas;
    // A mouse aims on hover and fires on click; a touch aims by dragging and
    // fires with the 🔥 button (so aiming never shoots by accident).
    const onAim = (e) => { aimPixel = { x: e.clientX, y: e.clientY }; };
    canvas.addEventListener("pointermove", onAim);
    canvas.addEventListener("pointerdown", (e) => {
        onAim(e);
        if (e.pointerType === "mouse") firePlayer();
    });

    window.addEventListener("keydown", (e) => {
        const k = e.key.toLowerCase();
        if (e.code === "Space") { e.preventDefault(); firePlayer(); }
        else if (k === "q") manualTraverse = 1;
        else if (k === "e") manualTraverse = -1;
        else if (k === "t") cycleAim();
        else if (k === "f") toggleAutoFire();
        else if (k === "g") setGearMode();
        else if (k === "x") shift(1);
        else if (k === "z") shift(-1);
        else if (e.code >= "Digit1" && e.code <= "Digit4") {
            const d = GARAGE[Number(e.code.slice(-1)) - 1];
            if (d) setDesign(d);
        }
    });
    window.addEventListener("keyup", (e) => {
        const k = e.key.toLowerCase();
        if ((k === "q" && manualTraverse > 0) || (k === "e" && manualTraverse < 0)) manualTraverse = 0;
    });

    // --- Setup ---

    function kv(label) {
        const v = el("span", { className: "v", textContent: "—" });
        const row = el("div", { className: "kv" }, [el("span", { className: "k", textContent: label }), v]);
        return { row, v };
    }

    // Steps the auto-aim policy: off → nearest → weakest → toughest → strongest.
    function cycleAim() {
        if (!autoAim) return;
        autoAim.cycle();
        aimMode = autoAim.mode;
        refreshAimUi();
    }

    // Holds the trigger: while on, the gun goes off by itself as soon as it has
    // reloaded (and, when auto-aim has a target, as soon as it is lined up).
    function toggleAutoFire(on = !autoFire) {
        autoFire = on;
        refreshAimUi();
    }

    function refreshAimUi() {
        const on = autoAim && autoAim.enabled;
        aimName.textContent = autoAim ? autoAim.label : "Desactivado";
        aimDot.classList.toggle("on", !!on);
        btn.aim.classList.toggle("on", !!on);

        autoFireName.textContent = autoFire ? "Fuego automático" : "Fuego manual";
        autoFireDot.classList.toggle("on", autoFire);
        autoFireBtn.textContent = autoFire ? "Desactivar auto (F)" : "Fuego automático (F)";
        btn.auto.classList.toggle("on", autoFire);
    }

    // One frame of auto-fire: only spend a shell when it can actually land.
    function autoFireTick() {
        if (!autoFire || !player.weapon.ready) return;
        const target = autoAim.target;
        if (target) {
            // Wait for the turret to line up, and do not shoot into cover.
            if (player.tank.aimErrorTo(target.position) > AUTO_FIRE_ARC) return;
            if (isBlocked(player.tank.muzzle, target.position)) return;
        }
        fire(player);
    }

    // Switches the player's transmission between automatic and manual. In auto
    // the box shifts on revs; in manual you walk it through R · N · 1 · 2 · …
    function setGearMode(mode = null) {
        gearMode = mode ?? (gearMode === GEARBOX_MODE.AUTO ? GEARBOX_MODE.MANUAL : GEARBOX_MODE.AUTO);
        if (player) player.gearbox.setMode(gearMode);
        const auto = gearMode === GEARBOX_MODE.AUTO;
        modeBtn.textContent = auto ? "Automática ⇄ pasar a manual" : "Manual ⇄ pasar a automática";
        upBtn.disabled = downBtn.disabled = auto;
    }

    // Manual gear change (ignored while the box is automatic).
    function shift(dir) {
        if (!player || gearMode !== GEARBOX_MODE.MANUAL) return;
        if (dir > 0) player.gearbox.shiftUp();
        else player.gearbox.shiftDown();
    }

    // Builds a unit: tank + controller + gun (+ AI when it is an enemy).
    function spawn({ design: d, x, y, rotation = 0, enemy = false }) {
        const tank = new Tank(gl, { design: d, x, y, rotation, colors: enemy ? ENEMY_COLORS : d.colors });
        tank.addTo(game);

        // Every tank drives through a gearbox; only the player may switch it
        // to manual, so the enemies always shift automatically.
        const gearbox = new Gearbox({ ...d.gearbox, mode: enemy ? GEARBOX_MODE.AUTO : gearMode });
        const driver = new TankController(tank.hull, { ...d.drive, bounds: TANK_BOUNDS, gearbox });
        const weapon = new Weapon({ ...d.weapon, penetration: 999 });
        const unit = { tank, driver, weapon, gearbox, ai: null, enemy };

        if (enemy) {
            unit.ai = new TankAI(tank, driver, { bounds: TANK_BOUNDS, isBlocked });
        } else {
            driver.bindKeys(window);
            driver.bindTouch({ forward: btn.up, back: btn.down, left: btn.left, right: btn.right });
        }
        return unit;
    }

    function clearBattle() {
        for (const u of [player, ...enemies]) {
            if (!u) continue;
            u.tank.removeFrom(game);
            u.driver.unbind();
        }
        for (const s of shells) game.remove(s.entity);
        shells = [];
        for (const tick of reticle) game.remove(tick);
        lockedOn = null;
        enemies = [];
        player = null;
    }

    function startBattle() {
        clearBattle();
        over = false;
        banner.classList.remove("show");

        player = spawn({ design, x: 0, y: 0, rotation: 0 });
        enemies = SPAWNS.map((s) => spawn({ design: TANK_DESIGNS[s.design], x: s.x, y: s.y, rotation: s.rotation, enemy: true }));

        autoAim = new AutoAim(player.tank, { mode: aimMode });
        lockedOn = null;
        for (const tick of reticle) game.remove(tick);

        camera.centerOn(player.tank.position.x, player.tank.position.y);
        setGearMode(gearMode);
        refreshAimUi();
        buildRoster();
        for (let i = 0; i < GARAGE.length; i++) garageBtns[i].classList.toggle("active", GARAGE[i] === design);
    }

    // Switching tanks restarts the fight — you get a fresh vehicle.
    function setDesign(next) {
        design = next;
        startBattle();
    }

    // One row per enemy: name, live FSM state and a slim health bar.
    function buildRoster() {
        roster.replaceChildren();
        for (const foe of enemies) {
            const st = el("span", { className: "st" });
            const fill = el("i");
            const row = el("div", { className: "foe" }, [
                el("div", { className: "top" }, [
                    el("span", { textContent: foe.tank.design.name }),
                    st,
                ]),
                el("div", { className: "bar slim" }, [fill]),
            ]);
            foe.hud = { row, st, fill };
            roster.append(row);
        }
    }

    // --- Combat ---

    function fire(unit) {
        if (over || !unit.tank.alive || !unit.weapon.ready) return;
        const muzzle = unit.tank.muzzle;
        const dir = unit.tank.turretForward;
        const bullet = unit.weapon.fire(muzzle.x, muzzle.y, dir.x, dir.y, unit);
        if (!bullet) return;
        const entity = new Circle(gl, { radius: 0.075 })
            .setColor(unit.enemy ? { red: 1, green: 0.55, blue: 0.35 } : { red: 1, green: 0.85, blue: 0.3 })
            .setPosition(muzzle).init();
        game.add(entity);
        shells.push({ bullet, entity });
    }

    function firePlayer() {
        if (player) fire(player);
    }

    function destroy(unit) {
        // Leave the hull behind as a wreck; strip the moving parts and the bar.
        for (const part of [unit.tank.barrel, unit.tank.turret, unit.tank.barBack, unit.tank.barFill]) {
            game.remove(part);
        }
        unit.tank.hull.setColor(WRECK_COLOR);
        unit.driver.setInput({ forward: 0, turn: 0 });
        unit.driver.speed = 0;
    }

    function updateShells(dt) {
        for (const shell of shells.slice()) {
            const b = shell.bullet;
            b.update(dt);

            // Hit the first tank on the swept segment (never its own shooter).
            for (const unit of [player, ...enemies]) {
                if (!unit.tank.alive || unit === b.owner) continue;
                if (!segmentHitsCircle(b.prev, b.position, unit.tank.position, unit.tank.radius)) continue;
                unit.tank.takeDamage(b.damage);
                if (!unit.tank.alive) destroy(unit);
                b.alive = false;
                break;
            }

            // Scenery stops shells too.
            if (b.alive && colliders.some((box) => segmentHitsBox(b.prev, b.position, box))) b.alive = false;

            if (!b.alive) {
                game.remove(shell.entity);
                shells.splice(shells.indexOf(shell), 1);
            } else {
                shell.entity.setPosition(b.position);
            }
        }
    }

    // --- Physics-lite: keep bodies out of the scenery and out of each other ---

    function resolveWorld(unit) {
        const hull = unit.tank.hull;
        let pushed = 0;
        for (let pass = 0; pass < 2; pass++) {
            for (const box of colliders) {
                const p = pushOut(hull.position.x, hull.position.y, unit.tank.radius, box);
                if (!p) continue;
                hull.setPosition({ x: hull.position.x + p.x, y: hull.position.y + p.y });
                pushed += Math.hypot(p.x, p.y);
            }
        }
        if (pushed > 0.02) unit.driver.speed *= 0.35;
    }

    // Separates overlapping tanks, each giving way by half.
    function separate(units) {
        for (let i = 0; i < units.length; i++) {
            for (let j = i + 1; j < units.length; j++) {
                const a = units[i].tank, b = units[j].tank;
                const dx = b.position.x - a.position.x;
                const dy = b.position.y - a.position.y;
                const min = a.radius + b.radius;
                const d = Math.hypot(dx, dy);
                if (d >= min || d < 1e-6) continue;
                const push = (min - d) / 2;
                const nx = dx / d, ny = dy / d;
                a.hull.setPosition({ x: a.position.x - nx * push, y: a.position.y - ny * push });
                b.hull.setPosition({ x: b.position.x + nx * push, y: b.position.y + ny * push });
                units[i].driver.speed *= 0.5;
                units[j].driver.speed *= 0.5;
            }
        }
    }

    // Frames the locked target with the reticle, adding it to the scene only
    // while something is actually locked.
    function setLock(target) {
        if (target !== lockedOn) {
            if (target && !lockedOn) for (const tick of reticle) game.add(tick);
            else if (!target && lockedOn) for (const tick of reticle) game.remove(tick);
            lockedOn = target;
        }
        if (!lockedOn) return;
        const r = lockedOn.radius + 0.34;
        const p = lockedOn.position;
        const corners = [[-1, 1], [1, 1], [-1, -1], [1, -1]];
        reticle.forEach((tick, i) => tick.setPosition({ x: p.x + corners[i][0] * r, y: p.y + corners[i][1] * r }));
    }

    // --- Minimap ---

    const miniX = (x) => ((x - MAP.minX) / mapW) * MINI_W;
    const miniY = (y) => ((MAP.maxY - y) / mapH) * MINI_H;

    function miniTank(unit, color) {
        const t = unit.tank;
        const x = miniX(t.position.x), y = miniY(t.position.y);
        if (!t.alive) {
            miniCtx.fillStyle = "#4a4a52";
            miniCtx.fillRect(x - 2, y - 2, 4, 4);
            return;
        }
        if (t === lockedOn) {
            miniCtx.strokeStyle = "#73d9ff";
            miniCtx.lineWidth = 1.5;
            miniCtx.beginPath();
            miniCtx.arc(x, y, 6, 0, Math.PI * 2);
            miniCtx.stroke();
        }
        const g = t.turretForward;
        miniCtx.strokeStyle = color;
        miniCtx.lineWidth = 2;
        miniCtx.beginPath();
        miniCtx.moveTo(x, y);
        miniCtx.lineTo(x + g.x * 11, y - g.y * 11);
        miniCtx.stroke();
        miniCtx.fillStyle = color;
        miniCtx.beginPath();
        miniCtx.arc(x, y, 3.5, 0, Math.PI * 2);
        miniCtx.fill();
    }

    function drawMinimap() {
        const ctx = miniCtx;
        ctx.clearRect(0, 0, MINI_W, MINI_H);

        ctx.fillStyle = "#4c515f";
        for (const b of blocks) {
            const w = (b.s / mapW) * MINI_W;
            const h = (b.s / mapH) * MINI_H;
            ctx.fillRect(miniX(b.x) - w / 2, miniY(b.y) - h / 2, w, h);
        }

        ctx.strokeStyle = "rgba(106,169,224,.9)";
        ctx.lineWidth = 1.5;
        const vw = (2 * VIEW_W / mapW) * MINI_W;
        const vh = (2 * VIEW_H / mapH) * MINI_H;
        ctx.strokeRect(miniX(camera.x) - vw / 2, miniY(camera.y) - vh / 2, vw, vh);

        for (const foe of enemies) miniTank(foe, "#e06a5f");
        miniTank(player, "#5fe08a");
    }

    // --- Frame ---

    function finish(won) {
        over = true;
        bannerText.textContent = won ? "¡Victoria!" : "Tanque destruido";
        bannerText.style.color = won ? "#5fe08a" : "#e06a5f";
        banner.classList.add("show");
    }

    function update(dt) {
        const alive = [player, ...enemies].filter((u) => u.tank.alive);

        // Player: driving comes from the controller's own key/touch bindings.
        player.weapon.update(dt);
        if (player.tank.alive && !over) {
            player.driver.update(dt);
            // Aiming priority: hand traverse beats auto-aim, which beats the
            // pointer. Auto-aim only picks a target and swings the gun onto it.
            const locked = autoAim.update(manualTraverse !== 0 ? 0 : dt, enemies.map((e) => e.tank));
            if (manualTraverse !== 0) {
                player.tank.traverse(manualTraverse, dt);
            } else if (!locked && aimPixel) {
                player.tank.aimAt(camera.screenToWorld(aimPixel.x, aimPixel.y, canvas), dt);
            }
            setLock(locked);
            autoFireTick();
        }

        // Enemies: the FSM writes their input, then they drive and shoot.
        for (const foe of enemies) {
            foe.weapon.update(dt);
            if (!foe.tank.alive || over) continue;
            foe.ai.update(dt, player.tank);
            foe.driver.update(dt);
            if (foe.ai.wantsToFire) fire(foe);
        }

        for (const unit of alive) resolveWorld(unit);
        separate(alive);
        updateShells(dt);

        for (const unit of [player, ...enemies]) unit.tank.sync();
        camera.follow(player.tank.position, dt);

        // Win / lose.
        if (!over) {
            if (!player.tank.alive) finish(false);
            else if (enemies.every((f) => !f.tank.alive)) finish(true);
        }

        drawHud();
        drawMinimap();
    }

    function drawHud() {
        const tank = player.tank;
        const driver = player.driver;

        // Pressed directions, on the panel keypad and the on-screen buttons.
        const fwd = driver.input.forward > 0, back = driver.input.forward < 0;
        const left = driver.input.turn > 0, right = driver.input.turn < 0;
        keyEls.up.classList.toggle("on", fwd);
        keyEls.down.classList.toggle("on", back);
        keyEls.left.classList.toggle("on", left);
        keyEls.right.classList.toggle("on", right);
        btn.up.classList.toggle("on", fwd);
        btn.down.classList.toggle("on", back);
        btn.left.classList.toggle("on", left);
        btn.right.classList.toggle("on", right);

        const pct = tank.hpRatio * 100;
        hpFill.style.width = `${pct}%`;
        hpFill.style.background = pct > 50 ? "#43c06a" : pct > 20 ? "#d8b13a" : "#d84a3a";

        // Gearbox readout: gear, revs and whether the clutch is out mid-shift.
        const gb = player.gearbox;
        gearBox.textContent = gb.label;
        gearBox.classList.toggle("shifting", gb.shifting);
        const revs = gb.rpm;
        tachFill.style.width = `${revs * 100}%`;
        tachFill.style.background = gb.shifting ? "#7d838a" : revs > 0.88 ? "#d84a3a" : revs > 0.7 ? "#d8b13a" : "#6aa9e0";
        tachLabel.textContent = gb.shifting ? "cambiando…" : `${Math.round(revs * 100)}%`;

        const deg = (a) => (((a % 360) + 360) % 360).toFixed(0);
        kHp.v.textContent = `${Math.ceil(tank.hp)} / ${tank.maxHp} HP`;
        kSpeed.v.textContent = `${driver.speed.toFixed(2)} u/s`;
        kTurret.v.textContent = `${deg(tank.turretAngle)}°`;
        kAmmo.v.textContent = player.weapon.ready ? "Listo" : `Recargando ${(player.weapon.reloadProgress * 100).toFixed(0)}%`;

        if (!autoAim.enabled) {
            aimTarget.textContent = "Sin objetivo";
        } else if (!lockedOn) {
            aimTarget.textContent = "Buscando…";
        } else {
            const d = Math.hypot(lockedOn.position.x - tank.position.x, lockedOn.position.y - tank.position.y);
            aimTarget.replaceChildren(
                el("b", { textContent: lockedOn.design.name }),
                document.createTextNode(` · ${Math.ceil(lockedOn.hp)} HP · a ${d.toFixed(1)} u`),
            );
        }

        let standing = 0;
        for (const foe of enemies) {
            const t = foe.tank;
            if (t.alive) standing++;
            const state = foe.ai.state;
            foe.hud.st.textContent = AI_STATE_LABEL[state];
            foe.hud.st.className = `st ${state}`;
            foe.hud.row.classList.toggle("down", !t.alive);
            foe.hud.fill.style.width = `${t.hpRatio * 100}%`;
            foe.hud.fill.style.background = t.hpRatio > 0.5 ? "#43c06a" : t.hpRatio > 0.2 ? "#d8b13a" : "#d84a3a";
        }
        kFoes.v.textContent = `${standing} / ${enemies.length}`;
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startDemo);
} else {
    startDemo();
}
