// Tank battle in three dimensions — the 2D battle, rendered from behind the
// hull.
//
// This demo is deliberately not a second implementation. `controls/driveDemo.js`
// and this file run the *same simulation*: the same TANK_DESIGNS, the same
// TankController and Gearbox, the same TankAI finite state machine, the same
// AutoAim policies, the same Weapon and the same penetration model against the
// same per-face armour. The map is generated from the same seed, so it is the
// same arena down to where each block sits.
//
// What changes is the view, and one number:
//
//     simulation      view
//     ──────────────  ──────────────
//     x               x
//     y               z          (the ground is XZ in three dimensions)
//     rotation θ      yaw −θ     (2D turns counter-clockwise, +Y forward;
//                                 a yaw turns the other way about +Y)
//
// That is the whole bridge, and it is the two functions below.
//
// A consequence worth spelling out: every tank still carries its 2D shapes —
// hull, turret, barrel. They are never added to the engine and never drawn.
// They are the *bodies*: SAT collision runs on the hull outline, the shell
// raycast finds which edge it crossed, and Armor.forHull turns those same edges
// into front/side/rear plates. The 3D hull you see is that very outline pushed
// up into a prism, which is why the tank destroyer's wedge nose bounces shells
// in three dimensions for exactly the reason it does in two.

import App from "../components/app.js";
import { el, kv, card, button, hint } from "../components/ui/index.js";
import {
    Mesh, boxGeometry, cylinderGeometry, planeGeometry, sphereGeometry, prismGeometry, torusGeometry,
} from "../components/render3d/index.js";
import { TankController, TankAI, AI_STATE_LABEL, Gearbox, GEARBOX_MODE, AutoAim, AIM_MODE } from "../components/controls/index.js";
import { Tank, TANK_DESIGNS } from "../components/vehicles/index.js";
import { Weapon, PROJECTILES, raycastShape, resolveShot, reflect } from "../components/weapons/index.js";
import { collide, boundingRadius } from "../components/physics/index.js";
import { createRandom } from "../components/math/random.js";
import { clamp, DEG_TO_RAD, RAD_TO_DEG } from "../components/math/angles.js";

// --- The bridge between the two worlds -----------------------------------

// A simulation point (x, y) is a ground point (x, z).
const scenePoint = (p) => ({ x: p.x, z: p.y });
// A simulation heading is the yaw that points the same way.
const yawOf = (rotation) => -rotation;

// --- The arena (identical to the 2D battle, same seed) -------------------

const MAP = { minX: -28.5, maxX: 28.5, minY: -20.5, maxY: 20.5 }; // 57 × 41
const WALL = 0.4;
const WALL_HEIGHT = 1.1;
const OBSTACLES = 78;
const MAP_SEED = 20260805;

const TANK_BOUNDS = { minX: MAP.minX, maxX: MAP.maxX, minY: MAP.minY, maxY: MAP.maxY };

// Heights, in the simulation's own units — a medium hull is 0.55 × 0.8, so
// everything here is small numbers. Nothing is scaled up: keeping one set of
// units is what lets the two demos share a map file's worth of constants.
const TRACK_H = 0.16;
const HULL_H = 0.26;
const TURRET_H = 0.2;
const HULL_Y = TRACK_H + HULL_H / 2;
const TURRET_Y = TRACK_H + HULL_H + TURRET_H / 2;
const BAR_Y = TURRET_Y + 0.3;       // where the DOM health tag hangs
const SHELL_Y = TURRET_Y;

// Chase camera: far enough back that the view covers about as much ground as
// the 2D camera did, so the fight reads at the same scale.
const CAM_BACK = 4.5;
const CAM_HEIGHT = 2.2;
const CAM_AHEAD = 1.6;
const CAM_SMOOTH = 7;

const GARAGE = [TANK_DESIGNS.medium, TANK_DESIGNS.light, TANK_DESIGNS.heavy, TANK_DESIGNS.hunter];

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
const WRECK_COLOR = { red: 0.17, green: 0.17, blue: 0.19 };
const TRACK_COLOR = { red: 0.13, green: 0.13, blue: 0.15 };

// King of the hill: hold the middle.
const ZONE = { x: 0, y: 0, radius: 4.5 };
const CAPTURE_SECONDS = 30;
const CONTEST_DECAY = 0.25;
// The objective is drawn as a rim with a faint wash inside it. A solid
// translucent disc was the obvious first try and it was wrong: standing in the
// circle put a coloured sheet over the whole foreground, and you could no
// longer read the ground or the tanks on it. A ring says the same thing —
// where the edge is, and whose it is — without painting over the fight.
const ZONE_COLORS = {
    neutral: { red: 0.62, green: 0.66, blue: 0.72 },
    ally: { red: 0.30, green: 0.62, blue: 0.92 },
    foe: { red: 0.85, green: 0.32, blue: 0.26 },
    contested: { red: 0.92, green: 0.78, blue: 0.28 },
};
const ZONE_FILL_ALPHA = 0.13;
const ZONE_RIM_ALPHA = 0.92;

// Both squadrons deploy facing each other, the objective between them.
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

const AMMO = [PROJECTILES.AP, PROJECTILES.APCR, PROJECTILES.HEAT, PROJECTILES.HE];
const IMPACT = {
    penetration: { label: "PENETRA", color: { red: 0.2, green: 0.9, blue: 0.35 } },
    splash: { label: "ESQUIRLAS", color: { red: 0.95, green: 0.55, blue: 0.2 } },
    ricochet: { label: "REBOTE", color: { red: 0.95, green: 0.85, blue: 0.2 } },
    block: { label: "NO PENETRA", color: { red: 0.9, green: 0.25, blue: 0.2 } },
};

// Auto-fire holds off until the gun is this close to the locked target.
const AUTO_FIRE_ARC = 4; // degrees

// Draw layers: the ground first, the translucent objective over it, solids on
// top. Blending needs what is behind it to already be in the buffer.
const LAYER_GROUND = 0;
const LAYER_ZONE = 1;
const LAYER_SOLID = 2;

const STYLES = `
    #panel { width: 290px; }
    .tbtn.fire { background: rgba(122, 47, 47, .6); border-color: rgba(230, 140, 140, .45); }
    .tbtn.fire:active { background: rgba(170, 60, 60, .8); }
    .tbtn.aim { background: rgba(30, 74, 92, .6); border-color: rgba(120, 210, 240, .45); font-size: 20px; }
    .tbtn.aim.on { background: rgba(60, 150, 190, .8); border-color: #7fe0ff; }
    .tbtn.autofire { background: rgba(92, 48, 30, .6); border-color: rgba(240, 170, 120, .45);
                     font-size: 12px; font-weight: 700; letter-spacing: .04em; }
    .tbtn.autofire.on { background: rgba(190, 95, 45, .85); border-color: #ffbe86; }

    /* Over the canvas: a slim HUD, a health tag per tank, edge arrows for the
       squadron, and the end-of-battle banner. */
    .hud { position: absolute; top: 12px; left: 12px; right: 12px; z-index: 2;
           display: flex; gap: 10px; pointer-events: none; }
    .hud .chip { padding: 7px 12px; border-radius: 10px; background: rgba(10,14,20,.62);
                 border: 1px solid rgba(255,255,255,.14); font-weight: 700; font-size: 16px;
                 font-variant-numeric: tabular-nums; }
    .hud .chip small { font-size: 10px; font-weight: 500; color: #9aa0a6; display: block; }
    .hud .spacer { flex: 1; }
    .hud .chip.low { color: #ffb4a4; border-color: rgba(216,74,58,.6); }

    .tag { position: absolute; transform: translate(-50%, -100%); pointer-events: none;
           z-index: 2; display: none; }
    .tag .bar { width: 42px; height: 5px; border-radius: 3px; background: rgba(0,0,0,.55);
                overflow: hidden; border: 1px solid rgba(255,255,255,.22); }
    .tag .bar > i { display: block; height: 100%; width: 100%; background: #43c06a; }

    .mark { position: absolute; z-index: 1; pointer-events: none; display: none; opacity: .85;
            width: 0; height: 0; border-left: 7px solid transparent; border-right: 7px solid transparent;
            border-bottom: 12px solid #5aa9ee; filter: drop-shadow(0 0 3px rgba(0,0,0,.6)); }

    #banner { position: absolute; inset: 0; display: none; z-index: 3;
        flex-direction: column; align-items: center; justify-content: center; gap: 14px;
        background: rgba(10, 13, 18, .72); text-align: center; padding: 20px; }
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
    button { cursor: pointer; border: 1px solid #3a3f45; background: #2f343a; color: #e6e6e6;
             border-radius: 6px; padding: 9px 10px; font-size: 13px; width: 100%; }
    button:hover { background: #3a4047; }

    .garage { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    button.tankbtn { text-align: left; line-height: 1.3; padding: 8px 9px; }
    button.tankbtn.active { border-color: #4a7fb5; background: #2b3a4a; box-shadow: inset 0 0 0 1px #4a7fb5; }
    button.tankbtn b { display: block; font-size: 13px; }
    button.tankbtn small { color: #9aa0a6; font-size: 11px; }

    .ammo { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    button.shell { text-align: left; line-height: 1.3; padding: 8px 9px; }
    button.shell.active { border-color: #4a7fb5; background: #2b3a4a; box-shadow: inset 0 0 0 1px #4a7fb5; }
    button.shell b { display: block; font-size: 13px; }
    button.shell small { color: #9aa0a6; font-size: 11px; }
    #impact { font-size: 15px; font-weight: 700; letter-spacing: .03em; margin-top: 12px; }

    .aimrow { display: flex; align-items: center; gap: 10px; }
    .aimrow .dot { width: 10px; height: 10px; border-radius: 50%; background: #4a4f57; flex: none; }
    .aimrow .dot.on { background: #73d9ff; box-shadow: 0 0 8px #73d9ff; }
    .aimrow b { font-size: 14px; }
    .target { font-size: 12.5px; color: #9aa0a6; margin-top: 8px; }
    .target b { color: #cfe4fb; }

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

    .cap { margin: 10px 0; }
    .cap .top { display: flex; justify-content: space-between; font-size: 12.5px; margin-bottom: 3px; }
    .cap .top .t { color: #9aa0a6; }
    .cap .top .s { font-variant-numeric: tabular-nums; }
    .zonestate { text-align: center; font-size: 13px; font-weight: 700; margin-top: 10px; letter-spacing: .03em; }

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

    @media (max-width: 720px) {
        #panel { width: 100%; }
    }
`;

// Segment a→b against an AABB (slab method), for line of sight and for shells
// meeting the scenery. Straight out of the 2D battle: the colliders are the
// same boxes, because the blocks you see in 3D stand on the same footprints.
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

App.boot({ title: "Batalla de tanques 3D", styles: STYLES }, (app) => {
    const gl = app.gl;
    const { stage, keyboard, touch } = app;
    const canvas = app.canvas;

    const camera = app.use3D({ clearColor: { red: 0.44, green: 0.52, blue: 0.62 } });
    camera.fov = 55;
    camera.far = 200;

    // --- Scenery -----------------------------------------------------------
    // `colliders` are the axis-aligned boxes shells and sight lines test
    // against; `solids` keeps the 2D shapes so hulls collide by their real
    // outline (SAT). Both are the 2D demo's, unchanged — the meshes are the
    // only thing this file adds.
    const colliders = [];
    const solids = [];
    const addBox = (cx, cy, hw, hh) => colliders.push({ minX: cx - hw, maxX: cx + hw, minY: cy - hh, maxY: cy + hh });
    const addSolid = (shape) => solids.push({ shape, r: boundingRadius(shape), x: shape.position.x, y: shape.position.y });

    const mapW = MAP.maxX - MAP.minX;
    const mapH = MAP.maxY - MAP.minY;

    app.add(new Mesh(gl, planeGeometry({ width: mapW + 40, depth: mapH + 40 }))
        .setColor({ red: 0.33, green: 0.36, blue: 0.29 }).setLayer(LAYER_GROUND).init());

    // The objective, painted on the ground: a faint wash and a rim around it.
    // The torus already lies in XZ, so it needs no rotation to be a ring on the
    // floor.
    const zoneFill = app.add(new Mesh(gl, cylinderGeometry({
        radiusTop: ZONE.radius, radiusBottom: ZONE.radius, height: 0.02, segments: 56,
    })).setPosition({ x: ZONE.x, y: 0.012, z: ZONE.y }).setLayer(LAYER_ZONE).init());
    const zoneRim = app.add(new Mesh(gl, torusGeometry({
        radius: ZONE.radius, tube: 0.07, segments: 72, sides: 6,
    })).setPosition({ x: ZONE.x, y: 0.07, z: ZONE.y }).setLayer(LAYER_ZONE).init());

    // A rectangular body for the physics layer, with no drawing attached. SAT
    // and boundingRadius only ever read these five fields, and the scenery is
    // drawn as a mesh, so building a real Shape here would upload a GL buffer
    // nothing ever renders.
    const rectangleBody = (w, h, x, y) => ({
        position: { x, y },
        rotation: 0,
        scale: { x: 1, y: 1 },
        colliderShape: "polygon",
        getColliderVertices: () => [
            { x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 },
            { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 },
        ],
    });

    const wallColor = { red: 0.42, green: 0.38, blue: 0.31 };
    const wall = (w, h, x, y) => {
        // The collider is the flat rectangle the 2D battle uses; the box just
        // gives it height.
        app.add(new Mesh(gl, boxGeometry({ width: w, height: WALL_HEIGHT, depth: h }))
            .setPosition({ x, y: WALL_HEIGHT / 2, z: y }).setColor(wallColor)
            .setLayer(LAYER_SOLID).init());
        addBox(x, y, w / 2, h / 2);
        addSolid(rectangleBody(w, h, x, y));
    };

    wall(mapW + WALL, WALL, 0, MAP.maxY);
    wall(mapW + WALL, WALL, 0, MAP.minY);
    wall(WALL, mapH + WALL, MAP.minX, 0);
    wall(WALL, mapH + WALL, MAP.maxX, 0);

    // Cover, scattered from the same seed as the 2D map — the same 78 blocks in
    // the same places. Their height is the only thing invented here; the
    // footprint a shell or a hull meets is the 2D square.
    const rng = createRandom(MAP_SEED);
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
        if (Math.hypot(x, y) < 3.5) continue;
        const clear = blocks.every((b) => Math.hypot(b.x - x, b.y - y) > (b.s + size) / 2 + 1.6);
        if (!clear) continue;
        blocks.push({ x, y, s: size, c: palette[blocks.length % palette.length] });
    }
    for (const b of blocks) {
        const height = b.s * 0.85;
        app.add(new Mesh(gl, boxGeometry({ width: b.s, height, depth: b.s }))
            .setPosition({ x: b.x, y: height / 2, z: b.y }).setColor(b.c)
            .setLayer(LAYER_SOLID).init());
        addBox(b.x, b.y, b.s / 2, b.s / 2);
        addSolid(rectangleBody(b.s, b.s, b.x, b.y));
    }

    const isBlocked = (from, to) => colliders.some((box) => segmentHitsBox(from, to, box));

    // --- Battle state ------------------------------------------------------
    let design = GARAGE[0];
    let player = null;
    let allies = [];
    let enemies = [];
    let allyHold = 0;
    let foeHold = 0;
    let zoneState = "neutral";
    let shells = [];
    let over = false;
    let kills = 0;

    let aimPixel = null;              // where the pointer is, in client pixels
    let manualTraverse = 0;
    let gearMode = GEARBOX_MODE.AUTO;
    let aimMode = AIM_MODE.OFF;
    let autoAim = null;
    let lockedOn = null;
    let autoFire = false;
    let ammo = PROJECTILES.AP;
    let lastImpact = null;            // what the panel is showing, for tests
    const marks = [];                 // fading impact bursts

    // Declared with the state they read, not next to the code that uses them:
    // startBattle() runs during setup and would otherwise hit their temporal
    // dead zone.
    const allUnits = () => [player, ...allies, ...enemies];
    const myTeam = () => [player, ...allies];

    // Reticle: four cubes framing whatever auto-aim has locked, floating at
    // turret height so they read against the ground.
    const RETICLE_COLOR = { red: 0.45, green: 0.85, blue: 1 };
    const reticle = Array.from({ length: 4 }, () => new Mesh(gl, boxGeometry({ width: 0.11, height: 0.11, depth: 0.11 }))
        .setColor(RETICLE_COLOR).setLayer(LAYER_SOLID).init());

    // --- The view for one tank ---------------------------------------------

    // The geometry to give a 2D shape, using the distinction the physics layer
    // already makes: a "circle" collider becomes a cylinder, a polygon outline
    // becomes that outline extruded. Nothing here invents a silhouette.
    function solidFor(shape, height) {
        if (shape.colliderShape === "circle") {
            return cylinderGeometry({ radiusTop: shape.radius, radiusBottom: shape.radius, height, segments: 20 });
        }
        return prismGeometry({ points: shape.getColliderVertices().map(scenePoint), height });
    }

    function buildView(tank, colors) {
        const d = tank.design;
        const hull = app.add(new Mesh(gl, solidFor(tank.hull, HULL_H))
            .setColor(colors.hull).setShininess(18).setLayer(LAYER_SOLID).init());
        const turret = app.add(new Mesh(gl, solidFor(tank.turret, TURRET_H))
            .setColor(colors.turret).setShininess(22).setLayer(LAYER_SOLID).init());
        const barrel = app.add(new Mesh(gl, cylinderGeometry({
            radiusTop: d.barrel.width * 0.45, radiusBottom: d.barrel.width * 0.6,
            height: d.barrel.length, segments: 10,
        })).setColor(colors.barrel).setShininess(40).setLayer(LAYER_SOLID).init());
        // Tracks are the one part with no 2D counterpart: in a top-down view
        // they were never visible, so there was nothing to share.
        const tracks = [-1, 1].map(() => app.add(new Mesh(gl, boxGeometry({
            width: d.radius * 0.36, height: TRACK_H, depth: d.radius * 1.9,
        })).setColor(TRACK_COLOR).setLayer(LAYER_SOLID).init()));
        return { hull, turret, barrel, tracks, parts: [hull, turret, barrel, ...tracks] };
    }

    // Copies the simulation's transform onto the meshes. Called once per tank
    // per frame, after the 2D bodies have moved.
    function placeView(unit) {
        const { tank, view } = unit;
        const p = tank.position;
        const yaw = yawOf(tank.rotation);
        const turretYaw = yawOf(tank.turretAngle);

        view.hull.setPosition({ x: p.x, y: HULL_Y, z: p.y }).setRotation({ y: yaw });

        const rad = yaw * DEG_TO_RAD;
        const sideX = Math.cos(rad), sideZ = -Math.sin(rad);   // the hull's right
        const offset = tank.design.radius * 0.72;
        view.tracks.forEach((track, i) => {
            const s = i === 0 ? -offset : offset;
            track.setPosition({ x: p.x + sideX * s, y: TRACK_H / 2, z: p.y + sideZ * s })
                .setRotation({ y: yaw });
        });

        if (!tank.alive) return;
        view.turret.setPosition({ x: p.x, y: TURRET_Y, z: p.y }).setRotation({ y: turretYaw });
        // The barrel points along the turret, which is the whole reason the two
        // rotations are worth seeing in three dimensions.
        const f = tank.turretForward;                    // 2D unit vector
        const reach = tank.design.barrel.offset;
        view.barrel
            .setPosition({ x: p.x + f.x * reach, y: TURRET_Y, z: p.y + f.y * reach })
            // Lying down (x: 90) and then swung round to the gun's bearing.
            .setRotation({ y: turretYaw, x: 90 });
    }

    // --- On-screen controls -------------------------------------------------
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

    // --- Overlay ------------------------------------------------------------
    const hpChip = el("span", { textContent: "100" });
    const hpChipBox = el("div", { className: "chip" }, [el("small", { textContent: "INTEGRIDAD" }), hpChip]);
    const killChip = el("span", { textContent: `0/${SQUAD.length}` });
    const zoneChip = el("span", { textContent: "0.0 s" });
    app.addOverlay(el("div", { className: "hud" }, [
        hpChipBox,
        el("div", { className: "chip" }, [el("small", { textContent: "BAJAS" }), killChip]),
        el("div", { className: "spacer" }),
        el("div", { className: "chip" }, [el("small", { textContent: "ZONA" }), zoneChip]),
    ]));

    const bannerText = el("b");
    const banner = el("div", { id: "banner" }, [
        bannerText,
        el("button", { textContent: "Nueva batalla", onclick: () => startBattle() }),
    ]);
    stage.append(banner);

    // Health tags and squad arrows live in the overlay for the whole session;
    // only their visibility changes, so a restart never churns the DOM.
    const makeTag = () => {
        const fill = el("i");
        const node = el("div", { className: "tag" }, [el("div", { className: "bar" }, [fill])]);
        app.addOverlay(node);
        return { node, fill };
    };
    const squadMarks = ALLY_SPAWNS.map(() => {
        const node = el("div", { className: "mark" });
        app.addOverlay(node);
        return node;
    });

    // --- Panel --------------------------------------------------------------
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

    const gearBox = el("div", { className: "gear", textContent: "1" });
    const tachFill = el("i");
    const tachLabel = el("span");
    const modeBtn = el("button", { onclick: () => setGearMode() });
    const upBtn = el("button", { textContent: "Subir ▲ (X)", onclick: () => shift(1) });
    const downBtn = el("button", { textContent: "Bajar ▼ (Z)", onclick: () => shift(-1) });
    const gearWidget = el("div", {}, [
        el("div", { className: "gearbox" }, [
            gearBox,
            el("div", { className: "right" }, [
                el("div", { className: "lbl" }, [el("span", { textContent: "Revoluciones" }), tachLabel]),
                el("div", { className: "tach" }, [tachFill]),
                el("div", { style: "margin-top:8px" }, [modeBtn]),
            ]),
        ]),
        el("div", { className: "shiftrow" }, [downBtn, upBtn]),
    ]);

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

    const MINI_W = 252;
    const MINI_H = Math.round(MINI_W * (mapH / mapW));
    const mini = el("canvas", { width: MINI_W, height: MINI_H, className: "mini" });
    const miniCtx = mini.getContext("2d");

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

    const ammoBtns = AMMO.map((type) =>
        el("button", { className: "shell", onclick: () => setAmmo(type) }, [
            el("b", { textContent: type.name }),
            el("small", { textContent: "" }),
        ]),
    );
    const impactLine = el("div", { id: "impact", textContent: "—" });
    const kFace = kv("Cara"), kAngle = kv("Ángulo"), kEff = kv("Blindaje efectivo"), kPen = kv("Penetración");

    app.addPanel(
        card("Objetivo · zona central", [
            allyCap.node("Tu escuadrón"), foeCap.node("Enemigo"), zoneStateLine,
            hint(`Controla la zona ${CAPTURE_SECONDS} s para ganar · si están los dos bandos, el reloj se para`),
        ]),
        card("Tu tanque", [
            el("div", { className: "garage" }, garageBtns),
            el("div", { className: "row" }, [hpBar]),
            kHp.row, kSpeed.row, kTurret.row, kAmmo.row,
            hint("Teclas 1-4 cambian de tanque (reinicia la batalla) · el casco 3D es su contorno de colisión extruido"),
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
        card("Minimapa", [mini, hint("Verde: tú · rojo: enemigos · cuña azul: hacia dónde mira la cámara")]),
        card(null, [button("Nueva batalla", () => startBattle())]),
    );

    startBattle();

    window.raptorDrive3D = {
        app, camera, TANK_DESIGNS, setDesign, startBattle,
        restart: startBattle,
        get autoAim() { return autoAim; },
        get autoFire() { return autoFire; },
        get blocks() { return blocks; },
        get colliders() { return colliders; },
        ammoId: () => ammo.id,
        get ammo() { return ammo; },
        setAmmo, cycleAmmo, firePlayer, fire,
        toggleAutoFire, cycleAim,
        get lockedOn() { return lockedOn; },
        get lastImpact() { return lastImpact; },
        get player() { return player; },
        get enemies() { return enemies; },
        get allies() { return allies; },
        get kills() { return kills; },
        get hold() { return { ally: allyHold, foe: foeHold, state: zoneState }; },
        setHold: (a, f) => { allyHold = a; foeHold = f; },
        ZONE, CAPTURE_SECONDS,
        get shells() { return shells; },
        get over() { return over; },
        get tank() { return player.tank; },
        get driver() { return player.driver; },
        get state() {
            return {
                x: player.tank.position.x, y: player.tank.position.y,
                heading: player.tank.rotation, turret: player.tank.turretAngle, hp: player.tank.hp,
            };
        },
    };

    app.onUpdate(update);

    // --- Input --------------------------------------------------------------
    // The mouse aims by pointing at the ground: the pixel becomes a ray, the ray
    // meets the plane the turret sits on, and that point is where the gun goes.
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

    // Turns a pointer position into a simulation point on the turret's plane.
    function aimWorldPoint() {
        if (!aimPixel) return null;
        const rect = canvas.getBoundingClientRect();
        const ground = camera.groundPoint(aimPixel.x - rect.left, aimPixel.y - rect.top, canvas, TURRET_Y);
        return ground ? { x: ground.x, y: ground.z } : null;
    }

    // --- Setup --------------------------------------------------------------

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

    function showImpact(key, unit, face, shot, penetration) {
        const info = IMPACT[key];
        lastImpact = {
            result: key, target: unit.tank.design.id, face: face.name, armor: face.armor,
            angle: shot.angle, effectiveArmor: shot.effectiveArmor,
            penetration, damage: shot.damage, type: shot.type.id,
        };
        impactLine.textContent = `${info.label} · ${shot.type.name}`;
        impactLine.style.color = `rgb(${[info.color.red, info.color.green, info.color.blue].map((c) => Math.round(c * 255)).join(",")})`;
        kFace.v.textContent = `${face.name} de ${unit.tank.design.name} (${face.armor} mm)`;
        kAngle.v.textContent = `${shot.angle.toFixed(0)}°`;
        kEff.v.textContent = Number.isFinite(shot.effectiveArmor) ? `${shot.effectiveArmor.toFixed(0)} mm` : "∞";
        kPen.v.textContent = `${Math.round(penetration)} mm`;
    }

    function cycleAim() {
        if (!autoAim) return;
        autoAim.cycle();
        aimMode = autoAim.mode;
        refreshAimUi();
    }

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

    // Only spend a shell when it can actually land.
    function autoFireTick() {
        if (!autoFire || !player.weapon.ready) return;
        const target = autoAim.target;
        if (target) {
            if (player.tank.aimErrorTo(target.position) > AUTO_FIRE_ARC) return;
            if (isBlocked(player.tank.muzzle, target.position)) return;
        }
        fire(player);
    }

    function setGearMode(mode = null) {
        gearMode = mode ?? (gearMode === GEARBOX_MODE.AUTO ? GEARBOX_MODE.MANUAL : GEARBOX_MODE.AUTO);
        if (player) player.gearbox.setMode(gearMode);
        const auto = gearMode === GEARBOX_MODE.AUTO;
        modeBtn.textContent = auto ? "Automática ⇄ pasar a manual" : "Manual ⇄ pasar a automática";
        upBtn.disabled = downBtn.disabled = auto;
    }

    function shift(dir) {
        if (!player || gearMode !== GEARBOX_MODE.MANUAL) return;
        if (dir > 0) player.gearbox.shiftUp();
        else player.gearbox.shiftDown();
    }

    // Builds a unit: the 2D body (never drawn), its 3D view, a controller, a
    // gun and — for everyone but the player — the FSM.
    function spawn({ design: d, x, y, rotation = 0, enemy = false, isPlayer = false, slot = 0 }) {
        const colors = isPlayer ? d.colors : enemy ? ENEMY_COLORS : ALLY_COLORS;
        const tank = new Tank(gl, { design: d, x, y, rotation, colors });

        const gearbox = new Gearbox({ ...d.gearbox, mode: enemy ? GEARBOX_MODE.AUTO : gearMode });
        const driver = new TankController(tank.hull, { ...d.drive, bounds: TANK_BOUNDS, gearbox });
        const weapon = new Weapon({ ...d.weapon });
        const unit = {
            tank, driver, weapon, gearbox, ai: null, enemy, isPlayer,
            bodyRadius: boundingRadius(tank.hull),
            view: buildView(tank, colors),
            tag: isPlayer ? null : makeTag(),
        };

        if (isPlayer) {
            driver.bindKeys(window);
            driver.bindTouch({ forward: btn.up, back: btn.down, left: btn.left, right: btn.right });
        } else {
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
        for (const u of allUnits()) {
            if (!u) continue;
            for (const part of u.view.parts) app.remove(part);
            u.driver.unbind();
            u.tag?.node.remove();
        }
        for (const s of shells) app.remove(s.mesh);
        shells = [];
        for (const tick of reticle) app.remove(tick);
        lockedOn = null;
        for (const m of marks) app.remove(m.mesh);
        marks.length = 0;
        for (const mark of squadMarks) mark.style.display = "none";
        allies = [];
        enemies = [];
        player = null;
    }

    function startBattle() {
        clearBattle();
        over = false;
        kills = 0;
        banner.classList.remove("show");

        allyHold = 0;
        foeHold = 0;
        zoneState = null;              // force the repaint below
        setZoneState("neutral");

        player = spawn({ design, ...PLAYER_SPAWN, isPlayer: true });
        allies = ALLY_SPAWNS.map((s, i) =>
            spawn({ design: TANK_DESIGNS[s.design], x: s.x, y: s.y, rotation: s.rotation, slot: i }));
        enemies = FOE_SPAWNS.map((s, i) =>
            spawn({ design: TANK_DESIGNS[s.design], x: s.x, y: s.y, rotation: s.rotation, enemy: true, slot: i }));

        autoAim = new AutoAim(player.tank, { mode: aimMode });
        lockedOn = null;
        for (const tick of reticle) app.remove(tick);

        // Put the camera behind the player before the first frame, so the
        // battle does not open with the lens flying across the map.
        const rad = yawOf(player.tank.rotation) * DEG_TO_RAD;
        camera.lookFrom(
            { x: player.tank.position.x - Math.sin(rad) * CAM_BACK, y: CAM_HEIGHT, z: player.tank.position.y - Math.cos(rad) * CAM_BACK },
            { x: player.tank.position.x, y: 0.4, z: player.tank.position.y },
        );

        setGearMode(gearMode);
        refreshAimUi();
        refreshAmmo();
        lastImpact = null;
        impactLine.textContent = "—";
        impactLine.style.color = "";
        kFace.v.textContent = kAngle.v.textContent = kEff.v.textContent = kPen.v.textContent = "—";
        buildRoster();
        for (let i = 0; i < GARAGE.length; i++) garageBtns[i].classList.toggle("active", GARAGE[i] === design);

        for (const unit of allUnits()) placeView(unit);
    }

    function setDesign(next) {
        design = next;
        startBattle();
    }

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

    // --- Combat --------------------------------------------------------------

    function fire(unit) {
        if (over || !unit.tank.alive || !unit.weapon.ready) return false;
        const muzzle = unit.tank.muzzle;
        const dir = unit.tank.turretForward;
        const shell = unit.enemy ? (PROJECTILES[unit.tank.design.ammo] ?? PROJECTILES.AP) : ammo;
        const bullet = unit.weapon.fire(muzzle.x, muzzle.y, dir.x, dir.y, unit, shell);
        if (!bullet) return false;
        const mesh = app.add(new Mesh(gl, sphereGeometry({ radius: 0.055, segments: 8, rings: 6 }))
            .setColor(unit.enemy ? { red: 1, green: 0.55, blue: 0.35 } : { red: 1, green: 0.85, blue: 0.3 })
            .setPosition({ x: muzzle.x, y: SHELL_Y, z: muzzle.y })
            .setLayer(LAYER_SOLID).init());
        shells.push({ bullet, mesh });
        return true;
    }

    function firePlayer() {
        return player ? fire(player) : false;
    }

    // A destroyed tank keeps its hull as a wreck; the turret, barrel and health
    // tag go.
    function destroy(unit) {
        app.remove(unit.view.turret);
        app.remove(unit.view.barrel);
        unit.view.hull.setColor(WRECK_COLOR);
        if (unit.tag) unit.tag.node.style.display = "none";
        unit.driver.setInput({ forward: 0, turn: 0 });
        unit.driver.speed = 0;
        if (unit.enemy) kills++;
    }

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
        spawnMark(hit.point, key);
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

            let best = null;
            for (const unit of allUnits()) {
                if (!unit.tank.alive || unit === b.owner) continue;
                if (unit.enemy === b.owner.enemy) continue;   // no friendly fire
                const hit = raycastShape(b.prev, b.position, unit.tank.hull);
                if (hit && (!best || hit.t < best.hit.t)) best = { unit, hit };
            }
            if (best) resolveImpact(shell, best.unit, best.hit);

            if (b.alive && !best && colliders.some((box) => segmentHitsBox(b.prev, b.position, box))) {
                spawnMark(b.position, "block");
                b.alive = false;
            }

            if (!b.alive) {
                app.remove(shell.mesh);
                shells.splice(shells.indexOf(shell), 1);
            } else {
                shell.mesh.setPosition({ x: b.position.x, y: SHELL_Y, z: b.position.y });
            }
        }

        for (const mark of marks.slice()) {
            mark.life -= dt;
            mark.mesh.setScale(0.5 + (1 - mark.life / mark.total));
            mark.mesh.color.alpha = Math.max(0, mark.life / mark.total);
            if (mark.life <= 0) {
                app.remove(mark.mesh);
                marks.splice(marks.indexOf(mark), 1);
            }
        }
    }

    function spawnMark(point, key) {
        const mesh = app.add(new Mesh(gl, sphereGeometry({ radius: 0.16, segments: 10, rings: 8 }))
            .setPosition({ x: point.x, y: SHELL_Y, z: point.y })
            .setColor({ ...IMPACT[key].color, alpha: 1 })
            .setLayer(LAYER_SOLID).init());
        marks.push({ mesh, life: 0.45, total: 0.45 });
    }

    // --- Physics-lite: hulls out of the scenery and out of each other --------

    function push(shape, manifold, sign, share = 1) {
        shape.setPosition({
            x: shape.position.x + sign * manifold.normal.x * manifold.penetration * share,
            y: shape.position.y + sign * manifold.normal.y * manifold.penetration * share,
        });
    }

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

    function setLock(target) {
        if (target !== lockedOn) {
            if (target && !lockedOn) for (const tick of reticle) app.add(tick);
            else if (!target && lockedOn) for (const tick of reticle) app.remove(tick);
            lockedOn = target;
        }
        if (!lockedOn) return;
        const r = lockedOn.radius + 0.3;
        const p = lockedOn.position;
        const corners = [[-1, 1], [1, 1], [-1, -1], [1, -1]];
        reticle.forEach((tick, i) => tick.setPosition({
            x: p.x + corners[i][0] * r, y: TURRET_Y + 0.12, z: p.y + corners[i][1] * r,
        }));
    }

    // --- Overlay placement ---------------------------------------------------

    // Health tags: project each tank to pixels and hang the bar there. Anything
    // behind the camera, off the canvas or dead is simply hidden.
    function updateTags() {
        for (const unit of [...allies, ...enemies]) {
            const tag = unit.tag;
            if (!tag) continue;
            if (!unit.tank.alive) { tag.node.style.display = "none"; continue; }
            const screen = camera.project(
                { x: unit.tank.position.x, y: BAR_Y, z: unit.tank.position.y }, canvas);
            const onCanvas = screen
                && screen.x >= 0 && screen.x <= canvas.clientWidth
                && screen.y >= 0 && screen.y <= canvas.clientHeight;
            if (!onCanvas) { tag.node.style.display = "none"; continue; }
            tag.node.style.display = "block";
            tag.node.style.left = `${screen.x}px`;
            tag.node.style.top = `${screen.y}px`;
            const ratio = unit.tank.hpRatio;
            tag.fill.style.width = `${ratio * 100}%`;
            tag.fill.style.background = ratio > 0.5 ? "#43c06a" : ratio > 0.2 ? "#d8b13a" : "#d84a3a";
        }
    }

    // Squad arrows. On a map this size your allies are usually somewhere else,
    // so each living one that is not on screen gets an arrow pinned to the edge
    // of the view, pointing at them.
    //
    // The bearing comes from the world, not from the projection: a point behind
    // the camera has no screen position at all, and mirroring one is the classic
    // way to get an arrow that points at the wrong side of the screen.
    function updateSquadMarks() {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        const camYaw = Math.atan2(camera.target.x - camera.position.x, camera.target.z - camera.position.z);
        const sinY = Math.sin(camYaw), cosY = Math.cos(camYaw);
        const margin = 30;
        // The on-screen pads own the bottom corners. An arrow that lands down
        // there slides along to the middle of the strip rather than sitting
        // under a thumb — the bottom centre is the one part of that edge free.
        const padStrip = 210;

        allies.forEach((mate, i) => {
            const node = squadMarks[i];
            if (!mate.tank.alive) { node.style.display = "none"; return; }

            const screen = camera.project(
                { x: mate.tank.position.x, y: TURRET_Y, z: mate.tank.position.y }, canvas);
            if (screen && screen.x >= 0 && screen.x <= w && screen.y >= 0 && screen.y <= h) {
                node.style.display = "none";
                return;
            }

            // Bearing relative to where the camera looks: 0 straight ahead,
            // positive to the right.
            const dx = mate.tank.position.x - camera.position.x;
            const dz = mate.tank.position.y - camera.position.z;
            const ahead = dx * sinY + dz * cosY;
            const right = dx * cosY - dz * sinY;
            const bearing = Math.atan2(right, ahead);

            // Slide out from the centre along that bearing until it meets the
            // edge of the canvas box.
            const dirX = Math.sin(bearing);
            const dirY = -Math.cos(bearing);
            const halfW = w / 2 - margin;
            const halfH = h / 2 - margin;
            const scale = Math.min(
                halfW / Math.max(Math.abs(dirX), 1e-6),
                halfH / Math.max(Math.abs(dirY), 1e-6),
            );
            let left = w / 2 + dirX * scale;
            let top = h / 2 + dirY * scale;
            if (top > h - padStrip) {
                top = Math.min(top, h - margin);
                left = clamp(left, w * 0.34, w * 0.66);
            }
            node.style.display = "block";
            node.style.left = `${left - 7}px`;
            node.style.top = `${top - 6}px`;
            node.style.transform = `rotate(${bearing * RAD_TO_DEG}deg)`;
        });
    }

    // --- The objective --------------------------------------------------------

    const inZone = (unit) =>
        unit.tank.alive && Math.hypot(unit.tank.position.x - ZONE.x, unit.tank.position.y - ZONE.y) <= ZONE.radius;

    const captureRate = (n) => Math.min(1.6, 1 + 0.2 * (n - 1));

    function setZoneState(state) {
        if (state === zoneState) return;   // recolouring re-uploads nothing, but it is still churn
        zoneState = state;
        const c = ZONE_COLORS[state];
        zoneFill.setColor({ ...c, alpha: ZONE_FILL_ALPHA });
        zoneRim.setColor({ ...c, alpha: ZONE_RIM_ALPHA });
    }

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
            setZoneState("neutral");
            allyHold = Math.max(0, allyHold - dt * CONTEST_DECAY);
            foeHold = Math.max(0, foeHold - dt * CONTEST_DECAY);
        }
    }

    // --- Minimap ---------------------------------------------------------------

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

        const zr = (ZONE.radius / mapW) * MINI_W;
        ctx.fillStyle = { neutral: "rgba(150,155,165,.16)", ally: "rgba(74,159,224,.24)",
                          foe: "rgba(216,74,58,.24)", contested: "rgba(232,194,74,.26)" }[zoneState];
        ctx.beginPath();
        ctx.arc(miniX(ZONE.x), miniY(ZONE.y), zr, 0, Math.PI * 2);
        ctx.fill();

        // A 3D camera has a frustum, not a rectangle, so the minimap draws the
        // wedge it can actually see instead of the 2D version's viewport box.
        const camYaw = Math.atan2(camera.target.x - camera.position.x, camera.target.z - camera.position.z);
        const half = camera.fov * DEG_TO_RAD * 0.5 * 1.3; // widened by the aspect
        const reach = 16;
        const cx = miniX(camera.position.x), cy = miniY(camera.position.z);
        ctx.fillStyle = "rgba(106,169,224,.16)";
        ctx.strokeStyle = "rgba(106,169,224,.75)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        for (const edge of [-half, half]) {
            const a = camYaw + edge;
            ctx.lineTo(
                miniX(camera.position.x + Math.sin(a) * reach),
                miniY(camera.position.z + Math.cos(a) * reach),
            );
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        for (const foe of enemies) miniTank(foe, "#e06a5f");
        for (const mate of allies) miniTank(mate, "#4a9fe0");
        miniTank(player, "#5fe08a");
    }

    // --- Frame -----------------------------------------------------------------

    function finish(won, reason = "") {
        over = true;
        bannerText.textContent = (won ? "¡Victoria!" : "Derrota") + (reason ? ` — ${reason}` : "");
        bannerText.style.color = won ? "#5fe08a" : "#e06a5f";
        banner.classList.add("show");
    }

    function update(dt) {
        const alive = allUnits().filter((u) => u.tank.alive);

        player.weapon.update(dt);
        manualTraverse = keyboard.axis("e", "q");
        if (player.tank.alive && !over) {
            player.driver.update(dt);
            // Aiming priority: hand traverse beats auto-aim, which beats the
            // pointer — the same order as the flat version.
            const locked = autoAim.update(manualTraverse !== 0 ? 0 : dt, enemies.map((e) => e.tank));
            if (manualTraverse !== 0) {
                player.tank.traverse(manualTraverse, dt);
            } else if (!locked) {
                const point = aimWorldPoint();
                if (point) player.tank.aimAt(point, dt);
            }
            setLock(locked);
            autoFireTick();
        }

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

        for (const unit of allUnits()) {
            unit.tank.sync();
            placeView(unit);
        }

        // Chase camera: behind the hull, looking a little ahead of it. The
        // target is eased rather than the position, so a pivot does not throw
        // the lens around the map.
        const rad = yawOf(player.tank.rotation) * DEG_TO_RAD;
        const p = player.tank.position;
        const wanted = {
            x: p.x - Math.sin(rad) * CAM_BACK,
            y: CAM_HEIGHT,
            z: p.y - Math.cos(rad) * CAM_BACK,
        };
        const t = 1 - Math.exp(-CAM_SMOOTH * dt);
        camera.position.x += (wanted.x - camera.position.x) * t;
        camera.position.y += (wanted.y - camera.position.y) * t;
        camera.position.z += (wanted.z - camera.position.z) * t;
        camera.target = {
            x: p.x + Math.sin(rad) * CAM_AHEAD,
            y: 0.45,
            z: p.y + Math.cos(rad) * CAM_AHEAD,
        };

        updateTags();
        updateSquadMarks();

        if (!over) updateCapture(dt);

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
        hpChip.textContent = String(Math.ceil(tank.hp));
        hpChipBox.classList.toggle("low", tank.hpRatio <= 0.3);
        killChip.textContent = `${kills}/${enemies.length}`;
        zoneChip.textContent = `${allyHold.toFixed(1)} s`;

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
        // Relative to the hull, because that is the thing 3D shows and 2D did not.
        kTurret.v.textContent = `${deg(tank.turretAngle)}° · ${clamp(
            Math.round(((tank.turretAngle - tank.rotation + 540) % 360) - 180), -180, 180)}° respecto al casco`;
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
