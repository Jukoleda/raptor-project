// Drive-a-tank demo: pick a tank and steer it around a map larger than the
// screen. W/↑ and S/↓ drive along the way the hull points; A/← and D/→ pivot it
// in place. The turret is independent of the hull: it follows the mouse (or your
// finger on the canvas), or Q/E traverse it by hand, each design at its own rate.
//
// Movement comes from components/controls/TankController, the vehicle itself
// from components/vehicles/Tank, and the view from the engine's Camera.

import RaptorEngine from "../components/raptorEngine.js";
import { Rectangle, Square } from "../components/shapes/index.js";
import { TankController } from "../components/controls/index.js";
import { Tank, TANK_DESIGNS } from "../components/vehicles/index.js";

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

// Selectable tanks, in the order shown in the panel.
const GARAGE = [TANK_DESIGNS.medium, TANK_DESIGNS.light, TANK_DESIGNS.heavy, TANK_DESIGNS.hunter];

const STYLES = `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #e6e6e6; background: #1b1d21; }
    #app { display: flex; gap: 16px; padding: 16px; align-items: flex-start; flex-wrap: wrap; }
    #stage { position: relative; background: #0a0d12; border-radius: 8px; overflow: hidden; box-shadow: 0 6px 24px rgba(0,0,0,.4); }
    #stage canvas { display: block; max-width: 100%; height: auto; touch-action: none; }
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
    .mini { display: block; width: 100%; height: auto; border-radius: 6px; background: #0a0d12; border: 1px solid #3a3f45; }
    button { cursor: pointer; border: 1px solid #3a3f45; background: #2f343a; color: #e6e6e6; border-radius: 6px; padding: 9px 10px; font-size: 13px; width: 100%; }
    button:hover { background: #3a4047; }

    /* Tank picker. */
    .garage { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    button.tankbtn { text-align: left; line-height: 1.3; padding: 8px 9px; }
    button.tankbtn.active { border-color: #4a7fb5; background: #2b3a4a; box-shadow: inset 0 0 0 1px #4a7fb5; }
    button.tankbtn b { display: block; font-size: 13px; }
    button.tankbtn small { color: #9aa0a6; font-size: 11px; }

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

    // Axis-aligned boxes the tank collides with (walls + obstacles), collected
    // as we build the scene. Each is { minX, maxX, minY, maxY } in world space.
    const colliders = [];
    const addBox = (cx, cy, hw, hh) => colliders.push({ minX: cx - hw, maxX: cx + hw, minY: cy - hh, maxY: cy + hh });

    // --- Reference grid (thin lines every 2 units) so panning reads clearly. ---
    const gridColor = { red: 0.22, green: 0.26, blue: 0.33 };
    const mapW = MAP.maxX - MAP.minX;
    const mapH = MAP.maxY - MAP.minY;
    for (let x = Math.ceil(MAP.minX); x <= MAP.maxX; x += 2) {
        game.add(new Rectangle(gl, { width: 0.04, height: mapH }).setColor(gridColor).setPosition({ x, y: 0 }).init());
    }
    for (let y = Math.ceil(MAP.minY); y <= MAP.maxY; y += 2) {
        game.add(new Rectangle(gl, { width: mapW, height: 0.04 }).setColor(gridColor).setPosition({ x: 0, y }).init());
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

    // --- Obstacles spread over the map (drawn + collidable). ---
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
        addBox(b.x, b.y, b.s / 2, b.s / 2);
    }

    // --- Tank + driver. Both are rebuilt when another design is picked. ---
    let design = GARAGE[0];
    let tank = null;    // Tank (hull + turret + barrel)
    let driver = null;  // TankController driving tank.hull

    // Where the player is pointing, in *client* pixels. Converted to world every
    // frame so the aim tracks the same spot on screen while the camera moves.
    let aimPixel = null;
    let manualTraverse = 0; // -1 / 0 / 1 from Q and E; overrides pointer aim

    // Camera follows the tank, kept inside the map edges. game.camera is the
    // engine's default Camera; we just configure and steer it.
    const camera = game.camera;
    camera.smoothing = 6;
    camera.bounds = CAM_BOUNDS;

    // On-screen controls overlaid on the canvas: steering on the left (for the
    // left thumb), throttle on the right. Works with touch and mouse; holding
    // two at once (e.g. ▲ + ◀) drives and turns together.
    const tbtn = (label) => el("div", { className: "tbtn", textContent: label });
    const btn = { up: tbtn("▲"), down: tbtn("▼"), left: tbtn("◀"), right: tbtn("▶") };
    stage.append(
        el("div", { className: "pad left" }, [btn.left, btn.right]),
        el("div", { className: "pad right" }, [el("div", { className: "col" }, [btn.up, btn.down])]),
    );

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
            el("small", { textContent: `${d.drive.maxSpeed} u/s · torreta ${d.traverse}°/s` }),
        ]),
    );

    const kSpeed = kv("Velocidad"), kHeading = kv("Rumbo"), kTurret = kv("Torreta"), kThrottle = kv("Acelerador"), kPos = kv("Posición");
    const speedFill = el("i");
    const speedBar = el("div", { className: "bar" }, [speedFill]);
    const resetBtn = el("button", { textContent: "Centrar tanque", onclick: reset });

    // Minimap: the whole map at a glance, with the tank and the visible viewport.
    const MINI_W = 244;
    const MINI_H = Math.round(MINI_W * (mapH / mapW));
    const mini = el("canvas", { width: MINI_W, height: MINI_H, className: "mini" });
    const miniCtx = mini.getContext("2d");

    const panel = el("div", { id: "panel" }, [
        el("h1", { textContent: "Conducción de tanque" }),
        el("div", { className: "card" }, [
            el("h2", { textContent: "Tanque" }),
            el("div", { className: "garage" }, garageBtns),
            el("div", { className: "hint", textContent: "Teclas 1-4 cambian de tanque" }),
        ]),
        el("div", { className: "card" }, [
            el("h2", { textContent: "Controles" }), keypad,
            el("div", { className: "hint", textContent: "W/S o ↑/↓ avanzan · A/D o ←/→ giran el casco · el ratón o el dedo sobre el lienzo apuntan la torreta (Q/E la giran)" }),
        ]),
        el("div", { className: "card" }, [
            el("h2", { textContent: "Minimapa" }), mini,
            el("div", { className: "hint", textContent: "El recuadro azul es lo que ves; la cámara sigue al tanque." }),
        ]),
        el("div", { className: "card" }, [
            el("h2", { textContent: "Telemetría" }), kSpeed.row, speedBar, kHeading.row, kTurret.row, kThrottle.row, kPos.row,
        ]),
        el("div", { className: "card" }, [resetBtn]),
    ]);

    document.body.append(el("div", { id: "app" }, [stage, panel]));

    setDesign(design, { x: 0, y: 0, rotation: 0 });

    // Debug / test handle.
    window.raptorDrive = {
        game, camera, reset, setDesign, TANK_DESIGNS,
        get tank() { return tank; },
        get driver() { return driver; },
        get hull() { return tank.hull; },
    };

    game.addUpdater(update);
    game.start();

    // --- Input: turret aiming (pointer over the canvas) and tank switching. ---
    const canvas = game.canvas;
    // A mouse aims on hover; a touch aims while it is dragged (touch only emits
    // pointermove while held down), so the same two listeners cover both.
    const onAim = (e) => { aimPixel = { x: e.clientX, y: e.clientY }; };
    canvas.addEventListener("pointerdown", onAim);
    canvas.addEventListener("pointermove", onAim);

    window.addEventListener("keydown", (e) => {
        const k = e.key.toLowerCase();
        if (k === "q") manualTraverse = 1;
        else if (k === "e") manualTraverse = -1;
        else if (e.code >= "Digit1" && e.code <= "Digit4") {
            const d = GARAGE[Number(e.code.slice(-1)) - 1];
            if (d) setDesign(d);
        }
    });
    window.addEventListener("keyup", (e) => {
        const k = e.key.toLowerCase();
        if ((k === "q" && manualTraverse > 0) || (k === "e" && manualTraverse < 0)) manualTraverse = 0;
    });

    // --- Behaviour ---
    function kv(label) {
        const v = el("span", { className: "v", textContent: "—" });
        const row = el("div", { className: "kv" }, [el("span", { className: "k", textContent: label }), v]);
        return { row, v };
    }

    // Swaps in another tank design, keeping the current pose (or the given one).
    function setDesign(next, pose = null) {
        // Keep the current pose across the swap unless one is given.
        const at = pose ?? (tank
            ? { x: tank.position.x, y: tank.position.y, rotation: tank.rotation, turretAngle: tank.turretAngle }
            : { x: 0, y: 0, rotation: 0 });

        if (tank) tank.removeFrom(game);
        if (driver) driver.unbind();

        design = next;
        tank = new Tank(gl, { design, ...at });
        tank.addTo(game);

        // Each design drives differently: feed its stats to the controller.
        driver = new TankController(tank.hull, { ...design.drive, bounds: TANK_BOUNDS });
        driver.bindKeys(window);
        driver.bindTouch({ forward: btn.up, back: btn.down, left: btn.left, right: btn.right });

        camera.centerOn(tank.position.x, tank.position.y);
        for (let i = 0; i < GARAGE.length; i++) garageBtns[i].classList.toggle("active", GARAGE[i] === design);
        resolveCollisions(); // a bigger hull may now overlap something
    }

    // Smallest vector that pushes a circle (cx, cy, r) out of an AABB `box`,
    // or null if they do not overlap. Used to keep the tank out of solids.
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
        // Center is inside the box: eject along the nearest face.
        const left = cx - box.minX, right = box.maxX - cx;
        const bottom = cy - box.minY, top = box.maxY - cy;
        const mx = Math.min(left, right), my = Math.min(bottom, top);
        return mx < my
            ? { x: (left < right ? -1 : 1) * (mx + r), y: 0 }
            : { x: 0, y: (bottom < top ? -1 : 1) * (my + r) };
    }

    // Resolves the tank (a circle) against every collider, pushing it out and
    // scrubbing speed on a solid head-on hit (so it stops instead of jittering,
    // but can still slide along a wall it's only grazing).
    function resolveCollisions() {
        const hull = tank.hull;
        let pushed = 0;
        for (let pass = 0; pass < 2; pass++) {
            for (const box of colliders) {
                const p = pushOut(hull.position.x, hull.position.y, tank.radius, box);
                if (!p) continue;
                hull.setPosition({ x: hull.position.x + p.x, y: hull.position.y + p.y });
                pushed += Math.hypot(p.x, p.y);
            }
        }
        if (pushed > 0.02) driver.speed *= 0.35;
    }

    // Draws the whole map into the minimap: obstacles, the tank (hull heading
    // and gun) and the camera viewport, so the big map is legible at a glance.
    const miniX = (x) => ((x - MAP.minX) / mapW) * MINI_W;
    const miniY = (y) => ((MAP.maxY - y) / mapH) * MINI_H;
    function drawMinimap() {
        const ctx = miniCtx;
        ctx.clearRect(0, 0, MINI_W, MINI_H);

        // Obstacles.
        ctx.fillStyle = "#4c515f";
        for (const b of blocks) {
            const w = (b.s / mapW) * MINI_W;
            const h = (b.s / mapH) * MINI_H;
            ctx.fillRect(miniX(b.x) - w / 2, miniY(b.y) - h / 2, w, h);
        }

        // Camera viewport (what's currently on screen).
        ctx.strokeStyle = "rgba(106,169,224,.9)";
        ctx.lineWidth = 1.5;
        const vw = (2 * VIEW_W / mapW) * MINI_W;
        const vh = (2 * VIEW_H / mapH) * MINI_H;
        ctx.strokeRect(miniX(camera.x) - vw / 2, miniY(camera.y) - vh / 2, vw, vh);

        const tx = miniX(tank.position.x), ty = miniY(tank.position.y);

        // Gun direction (yellow) — independent of where the hull faces.
        const g = tank.turretForward;
        ctx.strokeStyle = "#e8c24a";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx + g.x * 13, ty - g.y * 13);
        ctx.stroke();

        // Hull heading (green) + the tank itself.
        const f = driver.forward;
        ctx.strokeStyle = "#43c06a";
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx + f.x * 9, ty - f.y * 9);
        ctx.stroke();
        ctx.fillStyle = "#5fe08a";
        ctx.beginPath();
        ctx.arc(tx, ty, 3.5, 0, Math.PI * 2);
        ctx.fill();
    }

    function reset() {
        tank.hull.setPosition({ x: 0, y: 0 }).setRotation(0);
        tank.turretAngle = 0;
        driver.speed = 0;
        tank.sync();
        camera.centerOn(0, 0);
    }

    function update(dt) {
        driver.update(dt);
        resolveCollisions();          // push the tank out of walls / obstacles

        // Turret: manual traverse wins, otherwise track the pointer.
        if (manualTraverse !== 0) {
            tank.traverse(manualTraverse, dt);
        } else if (aimPixel) {
            tank.aimAt(camera.screenToWorld(aimPixel.x, aimPixel.y, canvas), dt);
        }

        tank.sync();                       // turret + barrel follow the hull
        camera.follow(tank.position, dt);  // keep the tank on screen as it roams

        // Highlight the active directions on both the panel keypad and the
        // on-screen buttons, whatever the input source (keyboard or touch).
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

        // Telemetry.
        const speed = driver.speed;
        const deg = (a) => (((a % 360) + 360) % 360).toFixed(0);
        kSpeed.v.textContent = `${speed.toFixed(2)} u/s`;
        kHeading.v.textContent = `${deg(tank.rotation)}°`;
        kTurret.v.textContent = `${deg(tank.turretAngle)}°`;
        kThrottle.v.textContent = fwd ? "Adelante" : back ? "Atrás" : "—";
        kPos.v.textContent = `${tank.position.x.toFixed(1)}, ${tank.position.y.toFixed(1)}`;

        const pct = Math.min(100, (Math.abs(speed) / driver.maxSpeed) * 100);
        speedFill.style.width = `${pct}%`;
        speedFill.style.background = speed >= 0 ? "#43c06a" : "#d8a13a";

        drawMinimap();
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startDemo);
} else {
    startDemo();
}
