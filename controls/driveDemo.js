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

import App from "../components/app.js";
import { el, kv, card, button, hint } from "../components/ui/index.js";
import { Rectangle, Square, Circle, Triangle } from "../components/shapes/index.js";
import { TankController, TankAI, AI_STATE_LABEL, Gearbox, GEARBOX_MODE, AutoAim, AIM_MODE } from "../components/controls/index.js";
import { Tank, TANK_DESIGNS } from "../components/vehicles/index.js";
import { Weapon, PROJECTILES, raycastShape, resolveShot, reflect } from "../components/weapons/index.js";
import { collide, boundingRadius } from "../components/physics/index.js";

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

// The hulls now collide with the walls by their real outline, so these bounds
// are only a last-resort net against escaping the map — keeping them tight would
// stop every tank at the same distance and hide the shape differences.
const TANK_BOUNDS = { minX: MAP.minX, maxX: MAP.maxX, minY: MAP.minY, maxY: MAP.maxY };
const CAM_BOUNDS = { minX: MAP.minX + VIEW_W, maxX: MAP.maxX - VIEW_W, minY: MAP.minY + VIEW_H, maxY: MAP.maxY - VIEW_H };

// Selectable player tanks, in the order shown in the panel.
const GARAGE = [TANK_DESIGNS.medium, TANK_DESIGNS.light, TANK_DESIGNS.heavy, TANK_DESIGNS.hunter];

// Team palettes: hostile red on one side, friendly blue on the other. The
// silhouette still tells you which design (and threat) each tank is. The player
// keeps his design's own colours so he can always find himself.
const ENEMY_COLORS = {
    hull: { red: 0.62, green: 0.25, blue: 0.22 },
    turret: { red: 0.5, green: 0.19, blue: 0.18 },
    barrel: { red: 0.33, green: 0.13, blue: 0.12 },
};
const ALLY_COLORS = {
    hull: { red: 0.24, green: 0.45, blue: 0.62 },
    turret: { red: 0.19, green: 0.36, blue: 0.5 },
    barrel: { red: 0.13, green: 0.25, blue: 0.35 },
};

// King of the hill: hold the middle. A side banks time only while it has tanks
// in the circle and the other side has none; both present freezes the clock.
const ZONE = { x: 0, y: 0, radius: 4.5 };
const CAPTURE_SECONDS = 30;
const CONTEST_DECAY = 0.25;   // per second, while nobody holds the ground
const ZONE_COLORS = {
    neutral: { red: 0.30, green: 0.32, blue: 0.36, alpha: 0.22 },
    ally: { red: 0.22, green: 0.55, blue: 0.85, alpha: 0.26 },
    foe: { red: 0.75, green: 0.26, blue: 0.22, alpha: 0.26 },
    contested: { red: 0.85, green: 0.72, blue: 0.22, alpha: 0.28 },
};

// Both squadrons deploy facing each other across the map, the objective between
// them. Local +Y is forward, so -90 faces east and 90 faces west.
const SQUAD = ["light", "medium", "hunter", "heavy", "medium"];
const DEPLOY_X = 14;
const deployment = (side) => SQUAD.map((design, i) => ({
    design,
    x: side * DEPLOY_X,
    y: (i - (SQUAD.length - 1) / 2) * 4.2,
    rotation: side < 0 ? -90 : 90,
}));
const ALLY_SPAWNS = deployment(-1);
const FOE_SPAWNS = deployment(1);
const PLAYER_SPAWN = { x: -DEPLOY_X - 2.5, y: 0, rotation: -90 };

const WRECK_COLOR = { red: 0.17, green: 0.17, blue: 0.19 };

// Shells the player can load, and how each impact reads on screen.
const AMMO = [PROJECTILES.AP, PROJECTILES.APCR, PROJECTILES.HEAT, PROJECTILES.HE];
const IMPACT = {
    penetration: { label: "PENETRA", color: { red: 0.2, green: 0.9, blue: 0.35 } },
    splash: { label: "ESQUIRLAS", color: { red: 0.95, green: 0.55, blue: 0.2 } },
    ricochet: { label: "REBOTE", color: { red: 0.95, green: 0.85, blue: 0.2 } },
    block: { label: "NO PENETRA", color: { red: 0.9, green: 0.25, blue: 0.2 } },
};

// Auto-fire holds off until the gun is this close to the locked target, so it
// spends shells on the target instead of spraying while the turret swings.
const AUTO_FIRE_ARC = 4; // degrees

// Only this page's own chrome: the layout, cards, rows, buttons and the
// on-screen pad all come from the framework (components/ui/, components/input/).
const STYLES = `
    #panel { width: 290px; }
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

    /* Ammo picker + last-impact readout. */
    .ammo { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    button.shell { text-align: left; line-height: 1.3; padding: 8px 9px; }
    button.shell.active { border-color: #4a7fb5; background: #2b3a4a; box-shadow: inset 0 0 0 1px #4a7fb5; }
    button.shell b { display: block; font-size: 13px; }
    button.shell small { color: #9aa0a6; font-size: 11px; }
    #impact { font-size: 15px; font-weight: 700; letter-spacing: .03em; margin-top: 12px; }

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

    /* Objective bars. */
    .cap { margin: 10px 0; }
    .cap .top { display: flex; justify-content: space-between; font-size: 12.5px; margin-bottom: 3px; }
    .cap .top .t { color: #9aa0a6; }
    .cap .top .s { font-variant-numeric: tabular-nums; }
    .zonestate { text-align: center; font-size: 13px; font-weight: 700; margin-top: 10px; letter-spacing: .03em; }

    /* Roster with live FSM state. */
    .foe { margin: 9px 0; }
    .foe:first-child { margin-top: 0; }
    .foe .top { display: flex; justify-content: space-between; font-size: 12.5px; }
    .foe .st { color: #9aa0a6; font-variant-numeric: tabular-nums; }
    .foe.down .top { opacity: .45; }
    .foe .st.attack { color: #e8776a; }
    .foe .st.chase { color: #e8c24a; }
    .foe .st.retreat { color: #6aa9e0; }
    .foe .st.advance { color: #7d9bb5; }
    .foe .dist { color: #7d838a; font-size: 11px; }

    /* Stack the panel under the canvas and grow the touch buttons on phones. */
    @media (max-width: 720px) {
        #panel { width: 100%; }
    }
`;

// --- Geometry helpers (bullets and bodies against the static map) ---

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

App.boot({ title: "Batalla de tanques", styles: STYLES }, (app) => {
    const { stage, keyboard, touch } = app;
    const game = app;
    const gl = app.gl;

    // Two views of the same scenery. `colliders` are axis-aligned boxes — cheap
    // enough to test a shell or a line of sight against every frame. `solids`
    // keeps the actual shapes, so tank bodies collide against the real outline
    // (SAT from the physics module) instead of a bounding circle.
    const colliders = [];
    const solids = [];
    const addBox = (cx, cy, hw, hh) => colliders.push({ minX: cx - hw, maxX: cx + hw, minY: cy - hh, maxY: cy + hh });
    // Scenery never moves, so its bounding radius and centre are computed once.
    const addSolid = (shape) => solids.push({ shape, r: boundingRadius(shape), x: shape.position.x, y: shape.position.y });

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

    // --- The objective: a translucent disc in the middle of the map. Added
    // before the walls and tanks so everything else draws on top of it. ---
    const zoneShape = new Circle(gl, { radius: ZONE.radius, segments: 64 })
        .setColor(ZONE_COLORS.neutral).setPosition({ x: ZONE.x, y: ZONE.y }).init();
    game.add(zoneShape);

    // --- Border walls around the map edges (drawn + collidable). ---
    const wallColor = { red: 0.42, green: 0.38, blue: 0.31 };
    const wall = (w, h, x, y) => {
        const shape = new Rectangle(gl, { width: w, height: h }).setColor(wallColor).setPosition({ x, y }).init();
        game.add(shape);
        addBox(x, y, w / 2, h / 2);
        addSolid(shape);
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
        const shape = new Square(gl, { size: b.s }).setColor(b.c).setPosition({ x: b.x, y: b.y }).init();
        game.add(shape);
        addBox(b.x, b.y, b.s / 2, b.s / 2);
        addSolid(shape);
    }

    // Line of sight for the AI: can it shoot without hitting the scenery?
    const isBlocked = (from, to) => colliders.some((box) => segmentHitsBox(from, to, box));

    // --- Battle state ---
    let design = GARAGE[0];  // the player's chosen design
    let player = null;       // unit: { tank, driver, weapon, ai }
    let allies = [];         // friendly AI units (the player fights alongside them)
    let enemies = [];        // hostile AI units
    let allyHold = 0;        // seconds of the objective banked by each side
    let foeHold = 0;
    let zoneState = "neutral";
    let shells = [];         // { bullet, entity }
    let over = false;

    // Where the player is pointing, in *client* pixels. Converted to world every
    // frame so the aim tracks the same spot on screen while the camera moves.
    let aimPixel = null;
    let manualTraverse = 0; // -1 / 0 / 1 from Q and E, read per frame in update
    let gearMode = GEARBOX_MODE.AUTO; // the player's transmission mode, kept across restarts
    let aimMode = AIM_MODE.OFF;       // the player's auto-aim policy, kept across restarts
    let autoAim = null;               // AutoAim bound to the player's tank
    let lockedOn = null;              // the tank the reticle is currently drawn on
    let autoFire = false;             // holds the trigger for you when on
    let ammo = PROJECTILES.AP;        // the shell the player has loaded
    const markers = [];               // fading impact dots

    const camera = game.camera;
    camera.smoothing = 6;
    camera.bounds = CAM_BOUNDS;

    // Targeting reticle: four corner ticks framing whatever auto-aim locked on.
    // Added to the scene only while something is locked, moved every frame.
    const RETICLE_COLOR = { red: 0.45, green: 0.85, blue: 1 };
    const reticle = Array.from({ length: 4 }, () =>
        new Rectangle(gl, { width: 0.16, height: 0.16 }).setColor(RETICLE_COLOR).init());

    // Squad markers: on a map this size your allies are usually off screen, so
    // each living one gets a small arrow pinned to the edge of the view pointing
    // at them. They live in the world, so the camera carries them along.
    const SQUAD_MARK_COLOR = { red: 0.35, green: 0.72, blue: 1 };
    const squadMarks = ALLY_SPAWNS.map(() =>
        new Triangle(gl, { width: 0.28, height: 0.34 }).setColor(SQUAD_MARK_COLOR).init());
    const shownMarks = new Set();

    // --- On-screen controls: steering left, throttle + fire right. ---
    const btn = {
        up: touch.button("up", "▲", "round"), down: touch.button("down", "▼", "round"),
        left: touch.button("left", "◀", "round"), right: touch.button("right", "▶", "round"),
        fire: touch.button("fire", "🔥", "round fire"),
        aim: touch.button("aim", "🎯", "round aim"), auto: touch.button("auto", "AUTO", "round autofire"),
    };
    touch.pad("left", [btn.left, btn.right]);
    touch.pad("right", [[btn.aim, btn.auto], btn.fire, [btn.up, btn.down]]);
    touch.tap(btn.fire, () => firePlayer());
    touch.tap(btn.aim, () => cycleAim());
    touch.tap(btn.auto, () => toggleAutoFire());

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

    // Objective: one bar per side toward the 30 s hold.
    const capBar = (color) => {
        const fill = el("i");
        fill.style.background = color;
        const secs = el("span", { className: "s", textContent: "0 s" });
        return { fill, secs, node: (label) => el("div", { className: "cap" }, [
            el("div", { className: "top" }, [el("span", { className: "t", textContent: label }), secs]),
            el("div", { className: "bar" }, [fill]),
        ]) };
    };
    const allyCap = capBar("#4a9fe0");
    const foeCap = capBar("#d84a3a");
    const zoneStateLine = el("div", { className: "zonestate", textContent: "Zona neutral" });

    const allyRoster = el("div");
    const roster = el("div");
    const kFoes = kv("En pie (tuyos / enemigos)");

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
    // Ammo picker: each shell bends the penetration model differently.
    const ammoBtns = AMMO.map((type) =>
        el("button", { className: "shell", onclick: () => setAmmo(type) }, [
            el("b", { textContent: type.name }),
            el("small", { textContent: "" }),
        ]),
    );
    const impactLine = el("div", { id: "impact", textContent: "—" });
    const kFace = kv("Cara"), kAngle = kv("Ángulo"), kEff = kv("Blindaje efectivo"), kPen = kv("Penetración");

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

    app.addPanel(
        card("Objetivo · zona central", [
            allyCap.node("Tu escuadrón"), foeCap.node("Enemigo"), zoneStateLine,
            hint(`Controla la zona ${CAPTURE_SECONDS} s para ganar · si están los dos bandos, el reloj se para`),
        ]),
        card("Tu tanque", [
            el("div", { className: "garage" }, garageBtns),
            el("div", { className: "row" }, [hpBar]),
            kHp.row, kSpeed.row, kTurret.row, kAmmo.row,
            hint("Teclas 1-4 cambian de tanque (reinicia la batalla)"),
        ]),
        card("Munición y blindaje", [
            el("div", { className: "ammo" }, ammoBtns),
            impactLine, kFace.row, kAngle.row, kEff.row, kPen.row,
            hint("C cambia de proyectil · el blindaje efectivo crece con el ángulo"),
        ]),
        card("Auto-apuntado", [aimWidget, hint("T (o 🎯) cicla el objetivo · F (o AUTO) mantiene el gatillo")]),
        card("Caja de cambios", [gearWidget, hint("G alterna automática/manual · Z y X cambian de marcha")]),
        card("Tu escuadrón", [allyRoster]),
        card("Enemigos (máquina de estados)", [roster, kFoes.row]),
        card("Controles", [
            keypad,
            hint("W/S avanzan · A/D giran el casco · ratón o dedo apuntan la torreta (Q/E a mano) · clic o Espacio disparan"),
        ]),
        card("Minimapa", [mini, hint("Verde: tú · rojo: enemigos · recuadro azul: lo que ves")]),
        card(null, [button("Nueva batalla", () => startBattle())]),
    );

    startBattle();

    // Debug / test handle.
    window.raptorDrive = {
        game, camera, TANK_DESIGNS, setDesign, startBattle,
        get autoAim() { return autoAim; },
        get autoFire() { return autoFire; },
        get blocks() { return blocks; },
        ammoId: () => ammo.id,
        cycleAmmo, firePlayer,
        get colliders() { return colliders; },
        toggleAutoFire,
        get lockedOn() { return lockedOn; },
        cycleAim,
        get player() { return player; },
        get enemies() { return enemies; },
        get allies() { return allies; },
        get hold() { return { ally: allyHold, foe: foeHold, state: zoneState }; },
        setHold: (a, f) => { allyHold = a; foeHold = f; },
        ZONE, CAPTURE_SECONDS,
        get shells() { return shells; },
        get over() { return over; },
        get tank() { return player.tank; },
        get driver() { return player.driver; },
        get hull() { return player.tank.hull; },
    };

    app.onUpdate(update);

    // --- Input ---
    const canvas = app.canvas;
    // A mouse aims on hover and fires on click; a touch aims by dragging and
    // fires with the 🔥 button (so aiming never shoots by accident).
    const onAim = (e) => { aimPixel = { x: e.clientX, y: e.clientY }; };
    canvas.addEventListener("pointermove", onAim);
    canvas.addEventListener("pointerdown", (e) => {
        onAim(e);
        if (e.pointerType === "mouse") firePlayer();
    });

    keyboard
        .on([" ", "Space"], () => firePlayer())
        .on("t", () => cycleAim())
        .on("f", () => toggleAutoFire())
        .on("c", () => cycleAmmo())
        .on("g", () => setGearMode())
        .on("x", () => shift(1))
        .on("z", () => shift(-1));
    for (let i = 0; i < GARAGE.length; i++) keyboard.on(String(i + 1), () => setDesign(GARAGE[i]));
    // Q/E are held rather than tapped, so they are read from the key state in
    // update() — no keyup bookkeeping, and no way to get stuck traversing.

    // --- Setup ---

    // Loads a shell type and refreshes the picker's stat line.
    function setAmmo(type) {
        ammo = type;
        refreshAmmo();
    }

    function cycleAmmo() {
        setAmmo(AMMO[(AMMO.indexOf(ammo) + 1) % AMMO.length]);
    }

    function refreshAmmo() {
        const gun = player ? player.tank.design.weapon : null;
        AMMO.forEach((type, i) => {
            ammoBtns[i].classList.toggle("active", type === ammo);
            ammoBtns[i].querySelector("small").textContent = gun
                ? `${Math.round(gun.penetration * type.penMultiplier)} mm · ${Math.round(gun.damage * type.damageMultiplier)} daño`
                : "";
        });
    }

    // Panel readout for the player's own shots.
    function showImpact(key, unit, face, shot, penetration) {
        const info = IMPACT[key];
        impactLine.textContent = `${info.label} · ${shot.type.name}`;
        impactLine.style.color = `rgb(${[info.color.red, info.color.green, info.color.blue].map((c) => Math.round(c * 255)).join(",")})`;
        kFace.v.textContent = `${face.name} de ${unit.tank.design.name} (${face.armor} mm)`;
        kAngle.v.textContent = `${shot.angle.toFixed(0)}°`;
        kEff.v.textContent = Number.isFinite(shot.effectiveArmor) ? `${shot.effectiveArmor.toFixed(0)} mm` : "∞";
        kPen.v.textContent = `${Math.round(penetration)} mm`;
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
    function spawn({ design: d, x, y, rotation = 0, enemy = false, isPlayer = false, slot = 0 }) {
        const colors = isPlayer ? d.colors : enemy ? ENEMY_COLORS : ALLY_COLORS;
        const tank = new Tank(gl, { design: d, x, y, rotation, colors });
        tank.addTo(game);

        // Every tank drives through a gearbox; only the player may switch it
        // to manual, so the enemies always shift automatically.
        const gearbox = new Gearbox({ ...d.gearbox, mode: enemy ? GEARBOX_MODE.AUTO : gearMode });
        const driver = new TankController(tank.hull, { ...d.drive, bounds: TANK_BOUNDS, gearbox });
        const weapon = new Weapon({ ...d.weapon });
        const unit = { tank, driver, weapon, gearbox, ai: null, enemy, isPlayer, bodyRadius: boundingRadius(tank.hull) };

        if (isPlayer) {
            driver.bindKeys(window);
            driver.bindTouch({ forward: btn.up, back: btn.down, left: btn.left, right: btn.right });
        } else {
            // Every AI tank is sent to the objective, fanned out around it so a
            // squadron spreads across the circle instead of stacking on a point.
            const angle = (slot / SQUAD.length) * Math.PI * 2 + (enemy ? 0 : Math.PI);
            unit.ai = new TankAI(tank, driver, {
                bounds: TANK_BOUNDS,
                isBlocked,
                objective: {
                    x: ZONE.x + Math.cos(angle) * ZONE.radius * 0.55,
                    y: ZONE.y + Math.sin(angle) * ZONE.radius * 0.55,
                },
            });
        }
        return unit;
    }

    // Everyone on the field, and just the player's side.
    const allUnits = () => [player, ...allies, ...enemies];
    const myTeam = () => [player, ...allies];

    // Closest living opponent of `unit`, which is who its AI goes after.
    function nearestFoe(unit) {
        const pool = unit.enemy ? myTeam() : enemies;
        let best = null;
        let bestDist = Infinity;
        for (const other of pool) {
            if (!other.tank.alive) continue;
            const d = Math.hypot(other.tank.position.x - unit.tank.position.x, other.tank.position.y - unit.tank.position.y);
            if (d < bestDist) { bestDist = d; best = other; }
        }
        return best ? best.tank : null;
    }

    function clearBattle() {
        for (const u of [player, ...allies, ...enemies]) {
            if (!u) continue;
            u.tank.removeFrom(game);
            u.driver.unbind();
        }
        for (const s of shells) game.remove(s.entity);
        shells = [];
        for (const tick of reticle) game.remove(tick);
        lockedOn = null;
        for (const m of markers) game.remove(m.shape);
        markers.length = 0;
        hideSquadMarks();
        allies = [];
        enemies = [];
        player = null;
    }

    function startBattle() {
        clearBattle();
        over = false;
        banner.classList.remove("show");

        allyHold = 0;
        foeHold = 0;
        setZoneState("neutral");

        player = spawn({ design, ...PLAYER_SPAWN, isPlayer: true });
        allies = ALLY_SPAWNS.map((s, i) =>
            spawn({ design: TANK_DESIGNS[s.design], x: s.x, y: s.y, rotation: s.rotation, slot: i }));
        enemies = FOE_SPAWNS.map((s, i) =>
            spawn({ design: TANK_DESIGNS[s.design], x: s.x, y: s.y, rotation: s.rotation, enemy: true, slot: i }));

        autoAim = new AutoAim(player.tank, { mode: aimMode });
        lockedOn = null;
        for (const tick of reticle) game.remove(tick);

        camera.centerOn(player.tank.position.x, player.tank.position.y);
        setGearMode(gearMode);
        refreshAimUi();
        refreshAmmo();
        impactLine.textContent = "—";
        impactLine.style.color = "";
        kFace.v.textContent = kAngle.v.textContent = kEff.v.textContent = kPen.v.textContent = "—";
        buildRoster();
        for (let i = 0; i < GARAGE.length; i++) garageBtns[i].classList.toggle("active", GARAGE[i] === design);
    }

    // Switching tanks restarts the fight — you get a fresh vehicle.
    function setDesign(next) {
        design = next;
        startBattle();
    }

    // One row per enemy: name, live FSM state and a slim health bar.
    // One row per AI tank: name, live FSM state and a slim health bar.
    function buildRoster() {
        for (const [container, units] of [[allyRoster, allies], [roster, enemies]]) {
            container.replaceChildren();
            for (const unit of units) {
                const st = el("span", { className: "st" });
                const fill = el("i");
                const dist = el("small", { className: "dist" });
                const row = el("div", { className: "foe" }, [
                    el("div", { className: "top" }, [
                        el("span", {}, [document.createTextNode(unit.tank.design.name), dist]),
                        st,
                    ]),
                    el("div", { className: "bar slim" }, [fill]),
                ]);
                unit.hud = { row, st, fill, dist };
                container.append(row);
            }
        }
    }

    // --- Combat ---

    function fire(unit) {
        if (over || !unit.tank.alive || !unit.weapon.ready) return;
        const muzzle = unit.tank.muzzle;
        const dir = unit.tank.turretForward;
        const shell = unit.enemy ? (PROJECTILES[unit.tank.design.ammo] ?? PROJECTILES.AP) : ammo;
        const bullet = unit.weapon.fire(muzzle.x, muzzle.y, dir.x, dir.y, unit, shell);
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

    // A shell that hit armor: run the penetration model for its type against the
    // face it actually struck, then apply what that means.
    function resolveImpact(shell, unit, hit) {
        const b = shell.bullet;
        const face = unit.tank.faceForEdge(hit.edgeIndex);
        const shot = resolveShot({
            type: b.type,
            penetration: b.penetration,
            damage: b.damage,
            direction: b.direction,
            normal: hit.normal,
            armor: face.armor,
        });

        const key = shot.result === "block" && shot.damage > 0 ? "splash" : shot.result;
        spawnMarker(hit.point, key);
        if (b.owner === player) showImpact(key, unit, face, shot, b.penetration);

        if (shot.damage > 0) {
            unit.tank.takeDamage(shot.damage);
            if (!unit.tank.alive) destroy(unit);
        }

        if (shot.result === "ricochet") {
            // Skips off and keeps flying, slower and with less punch left.
            b.velocity = reflect(b.velocity, hit.normal);
            b.velocity.x *= 0.7;
            b.velocity.y *= 0.7;
            b.penetration *= 0.8;
            b.position = { x: hit.point.x + hit.normal.x * 0.06, y: hit.point.y + hit.normal.y * 0.06 };
            b.prev = { x: b.position.x, y: b.position.y };
            return;
        }
        b.alive = false;
    }

    function updateShells(dt) {
        for (const shell of shells.slice()) {
            const b = shell.bullet;
            b.update(dt);

            // Raycast the swept segment against every hull and take the nearest
            // hit, so a shell cannot pass through a tank standing in front.
            let best = null;
            for (const unit of allUnits()) {
                if (!unit.tank.alive || unit === b.owner) continue;
                // Shells pass through your own squadron: no friendly fire.
                if (unit.enemy === b.owner.enemy) continue;
                const hit = raycastShape(b.prev, b.position, unit.tank.hull);
                if (hit && (!best || hit.t < best.hit.t)) best = { unit, hit };
            }
            if (best) resolveImpact(shell, best.unit, best.hit);

            // Scenery stops shells too.
            if (b.alive && !best && colliders.some((box) => segmentHitsBox(b.prev, b.position, box))) {
                spawnMarker(b.position, "block");
                b.alive = false;
            }

            if (!b.alive) {
                game.remove(shell.entity);
                shells.splice(shells.indexOf(shell), 1);
            } else {
                shell.entity.setPosition(b.position);
            }
        }

        // Fade out the impact dots.
        for (const marker of markers.slice()) {
            marker.life -= dt;
            if (marker.life <= 0) {
                game.remove(marker.shape);
                markers.splice(markers.indexOf(marker), 1);
            }
        }
    }

    // A short-lived dot where a shell met armor, coloured by what happened.
    function spawnMarker(point, key) {
        const shape = new Circle(gl, { radius: 0.14 })
            .setColor(IMPACT[key].color).setPosition(point).init();
        game.add(shape);
        markers.push({ shape, life: 0.45 });
    }

    // --- Physics-lite: keep bodies out of the scenery and out of each other ---

    // Nudges a hull out along a manifold from the physics module. `sign` flips
    // the push because collide() reports its normal pointing A -> B.
    function push(shape, manifold, sign, share = 1) {
        shape.setPosition({
            x: shape.position.x + sign * manifold.normal.x * manifold.penetration * share,
            y: shape.position.y + sign * manifold.normal.y * manifold.penetration * share,
        });
    }

    // Tank body against the scenery, by its actual outline: a cheap radius test
    // picks the few solids within reach, then SAT resolves the real overlap.
    // That is why a wedge can slip past a corner a boxy hull would catch on.
    function resolveWorld(unit) {
        const hull = unit.tank.hull;
        const reach = unit.bodyRadius;
        let pushed = 0;
        for (let pass = 0; pass < 2; pass++) {
            for (const solid of solids) {
                if (Math.hypot(solid.x - hull.position.x, solid.y - hull.position.y) > reach + solid.r) continue;
                const hit = collide({ shape: hull }, { shape: solid.shape });
                if (!hit) continue;
                push(hull, hit, -1);
                pushed += hit.penetration;
            }
        }
        if (pushed > 0.02) unit.driver.speed *= 0.35;
    }

    // Separates overlapping tanks by their outlines, each giving way by half.
    function separate(units) {
        for (let i = 0; i < units.length; i++) {
            for (let j = i + 1; j < units.length; j++) {
                const a = units[i], b = units[j];
                const dx = b.tank.position.x - a.tank.position.x;
                const dy = b.tank.position.y - a.tank.position.y;
                if (Math.hypot(dx, dy) > a.bodyRadius + b.bodyRadius) continue;
                const hit = collide({ shape: a.tank.hull }, { shape: b.tank.hull });
                if (!hit) continue;
                push(a.tank.hull, hit, -1, 0.5);
                push(b.tank.hull, hit, 1, 0.5);
                a.driver.speed *= 0.5;
                b.driver.speed *= 0.5;
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

    // Places (or hides) the edge arrow for each ally that is off screen.
    function updateSquadMarks() {
        const { halfW, halfH } = camera.viewExtents(canvas);
        const marginX = halfW - 0.35;
        const marginY = halfH - 0.35;

        allies.forEach((mate, i) => {
            const mark = squadMarks[i];
            const dx = mate.tank.position.x - camera.x;
            const dy = mate.tank.position.y - camera.y;
            const offScreen = mate.tank.alive && (Math.abs(dx) > marginX || Math.abs(dy) > marginY);

            if (!offScreen) {
                if (shownMarks.has(i)) { game.remove(mark); shownMarks.delete(i); }
                return;
            }
            if (!shownMarks.has(i)) { game.add(mark); shownMarks.add(i); }

            // Slide along the direction to the ally until it meets the edge.
            const scale = Math.min(marginX / Math.abs(dx || 1e-6), marginY / Math.abs(dy || 1e-6));
            mark.setPosition({ x: camera.x + dx * scale, y: camera.y + dy * scale });
            mark.setRotation((Math.atan2(-dx, dy) * 180) / Math.PI); // point outward, at them
        });
    }

    function hideSquadMarks() {
        for (const i of shownMarks) game.remove(squadMarks[i]);
        shownMarks.clear();
    }

    // --- The objective ---

    const inZone = (unit) =>
        unit.tank.alive && Math.hypot(unit.tank.position.x - ZONE.x, unit.tank.position.y - ZONE.y) <= ZONE.radius;

    // Numbers help, but with diminishing returns — a lone tank still captures.
    const captureRate = (n) => Math.min(1.6, 1 + 0.2 * (n - 1));

    function setZoneState(state) {
        if (state === zoneState) return;   // recolouring re-uploads a buffer
        zoneState = state;
        zoneShape.setColor(ZONE_COLORS[state]);
    }

    // Banks time for whichever side holds the middle alone. Returns nothing;
    // the win check reads allyHold / foeHold.
    function updateCapture(dt) {
        const mine = myTeam().filter(inZone).length;
        const theirs = enemies.filter(inZone).length;

        if (mine > 0 && theirs > 0) {
            setZoneState("contested");
        } else if (mine > 0) {
            setZoneState("ally");
            allyHold = Math.min(CAPTURE_SECONDS, allyHold + dt * captureRate(mine));
        } else if (theirs > 0) {
            setZoneState("foe");
            foeHold = Math.min(CAPTURE_SECONDS, foeHold + dt * captureRate(theirs));
        } else {
            // Nobody on the ground: both sides slowly bleed their progress.
            setZoneState("neutral");
            allyHold = Math.max(0, allyHold - dt * CONTEST_DECAY);
            foeHold = Math.max(0, foeHold - dt * CONTEST_DECAY);
        }
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

        // The objective.
        const zr = (ZONE.radius / mapW) * MINI_W;
        ctx.fillStyle = { neutral: "rgba(150,155,165,.16)", ally: "rgba(74,159,224,.24)",
                          foe: "rgba(216,74,58,.24)", contested: "rgba(232,194,74,.26)" }[zoneState];
        ctx.beginPath();
        ctx.arc(miniX(ZONE.x), miniY(ZONE.y), zr, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "rgba(106,169,224,.9)";
        ctx.lineWidth = 1.5;
        const vw = (2 * VIEW_W / mapW) * MINI_W;
        const vh = (2 * VIEW_H / mapH) * MINI_H;
        ctx.strokeRect(miniX(camera.x) - vw / 2, miniY(camera.y) - vh / 2, vw, vh);

        for (const foe of enemies) miniTank(foe, "#e06a5f");
        for (const mate of allies) miniTank(mate, "#4a9fe0");
        miniTank(player, "#5fe08a");
    }

    // --- Frame ---

    function finish(won, reason = "") {
        over = true;
        bannerText.textContent = (won ? "¡Victoria!" : "Derrota") + (reason ? ` — ${reason}` : "");
        bannerText.style.color = won ? "#5fe08a" : "#e06a5f";
        banner.classList.add("show");
    }

    function update(dt) {
        const alive = allUnits().filter((u) => u.tank.alive);

        // Player: driving comes from the controller's own key/touch bindings.
        player.weapon.update(dt);
        // Q and E are held, so they come from the key state rather than from an
        // event pair — there is nothing left to get stuck when the tab blurs.
        manualTraverse = keyboard.axis("e", "q");
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

        // Both squadrons: the FSM writes their input, then they drive and shoot.
        for (const unit of [...allies, ...enemies]) {
            unit.weapon.update(dt);
            if (!unit.tank.alive || over) continue;
            unit.ai.update(dt, nearestFoe(unit));
            unit.driver.update(dt);
            if (unit.ai.wantsToFire) fire(unit);
        }

        for (const unit of alive) resolveWorld(unit);
        separate(alive);
        updateShells(dt);

        for (const unit of allUnits()) unit.tank.sync();
        camera.follow(player.tank.position, dt);
        updateSquadMarks();

        if (!over) updateCapture(dt);

        // Win / lose: hold the middle for long enough, or wipe the other side.
        if (!over) {
            if (allyHold >= CAPTURE_SECONDS) finish(true, "Zona controlada 30 s");
            else if (foeHold >= CAPTURE_SECONDS) finish(false, "El enemigo controló la zona");
            else if (enemies.every((f) => !f.tank.alive)) finish(true, "Escuadrón enemigo destruido");
            else if (!player.tank.alive) finish(false, "Tu tanque fue destruido");
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

        // Objective progress.
        allyCap.fill.style.width = `${(allyHold / CAPTURE_SECONDS) * 100}%`;
        foeCap.fill.style.width = `${(foeHold / CAPTURE_SECONDS) * 100}%`;
        allyCap.secs.textContent = `${allyHold.toFixed(1)} s`;
        foeCap.secs.textContent = `${foeHold.toFixed(1)} s`;
        const zoneLabels = {
            neutral: ["Zona neutral", "#9aa0a6"],
            ally: ["Capturando", "#6aa9e0"],
            foe: ["El enemigo captura", "#e06a5f"],
            contested: ["En disputa", "#e8c24a"],
        };
        const [zoneText, zoneColor] = zoneLabels[zoneState];
        zoneStateLine.textContent = zoneText;
        zoneStateLine.style.color = zoneColor;

        // Both rosters.
        let standing = 0;
        for (const unit of [...allies, ...enemies]) {
            const t = unit.tank;
            if (t.alive && unit.enemy) standing++;
            const state = unit.ai.state;
            unit.hud.st.textContent = AI_STATE_LABEL[state];
            unit.hud.st.className = `st ${state}`;
            unit.hud.row.classList.toggle("down", !t.alive);
            unit.hud.fill.style.width = `${t.hpRatio * 100}%`;
            unit.hud.fill.style.background = t.hpRatio > 0.5 ? "#43c06a" : t.hpRatio > 0.2 ? "#d8b13a" : "#d84a3a";
            unit.hud.dist.textContent = t.alive
                ? ` · a ${Math.hypot(t.position.x - tank.position.x, t.position.y - tank.position.y).toFixed(0)} u`
                : "";
        }
        const mineStanding = myTeam().filter((u) => u.tank.alive).length;
        kFoes.v.textContent = `${mineStanding} / ${standing}`;
    }
});
