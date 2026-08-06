// El Bosque in three dimensions — the same game, the same map, the same rules.
//
// The reuse is the point. `generateForest` and `moveWithCollision` come
// straight from `game/forest.js`: the grid, the tile kinds, the sliding
// collision and the acorn scattering are shared line for line with the 2D game.
// A tile that was a square becomes a patch of ground, a tree that was two
// sprites becomes a trunk and a canopy, and the character that walked in XY now
// walks in XZ — but nothing about *what the game is* changed.
//
// Menu, match and result are three `Scene`s, exactly as in the flat version.

import App from "../components/app.js";
import SceneManager from "../components/scenes/sceneManager.js";
import Scene from "../components/scenes/scene.js";
import { el, kv, card, button, hint } from "../components/ui/index.js";
import {
    Mesh, boxGeometry, sphereGeometry, cylinderGeometry, coneGeometry, planeGeometry,
} from "../components/render3d/index.js";
import {
    MAP, HALF, CELL_KIND, generateForest, toWorld, moveWithCollision, walkableCells,
} from "../game/forest.js";
import { createRandom, randomRange } from "../components/math/random.js";
import { clamp, DEG_TO_RAD, RAD_TO_DEG, wrapDegrees } from "../components/math/angles.js";

const SPEED = 5;
const PICKUP_RANGE = 0.8;
const DIFFICULTIES = [
    { label: "Paseo", acorns: 6, seconds: 80 },
    { label: "Bosque", acorns: 10, seconds: 65 },
    { label: "Espesura", acorns: 14, seconds: 55 },
];

const STYLES = `
    .menu, .end {
        position: absolute; inset: 0; z-index: 3; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 6px; text-align: center; padding: 24px;
        background: radial-gradient(120% 90% at 50% 30%, rgba(20,40,26,.2) 0%, rgba(8,14,10,.8) 70%);
    }
    .menu h1, .end h1 { font-size: clamp(28px, 5.5vw, 48px); margin: 0; font-weight: 800; color: #eaf3ea;
                        text-shadow: 0 3px 0 rgba(0,0,0,.45); }
    .menu .sub, .end .sub { color: #a9c0ab; font-size: 14px; margin: 4px 0 18px; max-width: 36ch; }
    .menu .actions, .end .actions { display: flex; flex-direction: column; gap: 10px; width: min(260px, 70%); }
    .menu button, .end button { padding: 12px 14px; font-size: 15px; font-weight: 600; white-space: nowrap; }
    .menu button.play, .end button.again { background: #2f7a45; border-color: #43a15e; }
    .menu .keys { margin-top: 16px; font-size: 12px; color: #8fa891; line-height: 1.8; }
    .end .stats { display: flex; gap: 22px; margin: 14px 0 20px; }
    .end .stat b { display: block; font-size: 26px; font-variant-numeric: tabular-nums; }
    .end .stat small { font-size: 11px; color: #8fa891; }
    .hud3 { position: absolute; top: 12px; left: 12px; right: 12px; z-index: 2;
            display: flex; align-items: center; gap: 12px; pointer-events: none; }
    .hud3 .chip { padding: 7px 12px; border-radius: 10px; background: rgba(10,16,12,.62);
                  border: 1px solid rgba(255,255,255,.14); font-weight: 700; font-size: 17px;
                  font-variant-numeric: tabular-nums; }
    .hud3 .chip small { font-size: 10px; font-weight: 500; color: #9aa0a6; display: block; }
    .hud3 .spacer { flex: 1; }
    .hud3 .low { color: #ffb4a4; border-color: rgba(216,74,58,.6); }
`;

// --- Menu -----------------------------------------------------------------

class Menu3D extends Scene {
    constructor() { super("menu"); this.difficulty = DIFFICULTIES[1]; }

    enter(data = {}) {
        const gl = this.gl;
        const camera = this.app.use3D({ clearColor: { red: 0.36, green: 0.5, blue: 0.62 } });
        camera.orbit({ yaw: 0, pitch: 16, distance: 34, target: { x: 0, y: 3, z: 0 } });

        this.add(new Mesh(gl, planeGeometry({ width: 300, depth: 300 }))
            .setColor({ red: 0.2, green: 0.4, blue: 0.24 }).init());

        // A little grove that turns behind the title. No textures and no assets:
        // this scene has to be on screen before anything has loaded.
        const random = createRandom(4242);
        for (let i = 0; i < 30; i++) {
            const angle = random() * Math.PI * 2;
            const distance = randomRange(random, 12, 30);
            const height = randomRange(random, 2.4, 5);
            const x = Math.cos(angle) * distance, z = Math.sin(angle) * distance;
            this.add(new Mesh(gl, cylinderGeometry({ radiusTop: 0.2, radiusBottom: 0.3, height, segments: 8 }))
                .setPosition({ x, y: height / 2, z }).setColor({ red: 0.29, green: 0.2, blue: 0.13 }).init());
            this.add(new Mesh(gl, sphereGeometry({ radius: randomRange(random, 1.2, 2), segments: 12, rings: 8 }))
                .setPosition({ x, y: height + 0.6, z })
                .setColor({ red: 0.14, green: randomRange(random, 0.38, 0.52), blue: 0.22 }).init());
        }

        this.playBtn = button("▶  Jugar", () => this.play(), { className: "play" });
        this.diffBtn = button("", () => this.cycle(1));
        const keys = el("div", { className: "keys" });
        keys.innerHTML = "<kbd>WASD</kbd> mueven · <kbd>Enter</kbd> empieza · <kbd>P</kbd> pausa";

        const children = [
            el("h1", { textContent: "El Bosque 3D" }),
            el("div", { className: "sub", textContent: "Junta todas las bellotas antes de que se acabe el tiempo. Los árboles siguen sin cruzarse." }),
            el("div", { className: "actions" }, [this.playBtn, this.diffBtn]),
            keys,
        ];
        if (data.best) children.push(el("div", { style: "margin-top:14px;color:#e8c24a;font-weight:600;font-size:13px", textContent: `Mejor marca: ${data.best.time.toFixed(1)} s` }));
        this.overlay(el("div", { className: "menu" }, children));
        this.render();

        this.onKey(["Enter", " ", "Space"], () => this.play());
        this.onKey(["ArrowLeft", "a"], () => this.cycle(-1));
        this.onKey(["ArrowRight", "d"], () => this.cycle(1));

        let spin = 0;
        this.onUpdate((dt) => { spin += dt * 4; camera.orbit({ yaw: spin }); });
    }

    render() {
        const { label, acorns, seconds } = this.difficulty;
        this.diffBtn.textContent = `◂ ${label} ▸   ${acorns} bellotas · ${seconds}s`;
    }
    cycle(direction) {
        const i = DIFFICULTIES.indexOf(this.difficulty);
        this.difficulty = DIFFICULTIES[(i + direction + DIFFICULTIES.length) % DIFFICULTIES.length];
        this.render();
        return this;
    }
    play() { return this.go("juego", { ...this.difficulty }); }
}

// --- The forest -----------------------------------------------------------

class Forest3D extends Scene {
    constructor() { super("juego"); }

    enter({ acorns = 10, seconds = 65, seed = 20260806 } = {}) {
        const gl = this.gl;
        this.target = acorns;
        this.timeLeft = seconds;
        this.totalTime = seconds;
        this.collected = 0;
        this.elapsed = 0;
        this.paused = false;
        this.finished = false;
        this.position = { x: 0, y: 0 };     // el mapa vive en XY; se dibuja en XZ
        this.heading = 0;

        const camera = this.app.use3D({ clearColor: { red: 0.44, green: 0.58, blue: 0.7 } });
        camera.fov = 62;
        camera.far = 260;
        this.camera3d = camera;

        // The very same generator the 2D game uses.
        this.grid = generateForest(seed);

        this.add(new Mesh(gl, planeGeometry({ width: 400, depth: 400 }))
            .setColor({ red: 0.18, green: 0.34, blue: 0.2 }).init());

        this._buildForest();
        this._buildAcorns(acorns, seed);
        this._buildHero();
        this._buildHud();

        this.onKey("p", () => { this.paused = !this.paused; this.pauseNode.style.display = this.paused ? "flex" : "none"; });
        this.onKey("Escape", () => this.go("menu"));

        const pad = this.touch;
        if (pad) {
            for (const [name, label, key] of [["up", "▲", "w"], ["down", "▼", "s"], ["left", "◀", "a"], ["right", "▶", "d"]]) {
                pad.pedal(pad.button(name, label, "round"), key);
            }
            this.overlay(pad.pad("left", [pad.get("left"), pad.get("right")]));
            this.overlay(pad.pad("right", [[pad.get("up"), pad.get("down")]]));
        }
    }

    _buildForest() {
        const gl = this.gl;
        const random = createRandom(7);
        // One patch of ground per tile would be 884 meshes for nothing: the
        // ground is already a plane. Only the things that stand up get a mesh.
        for (let row = 0; row < MAP.height; row++) {
            for (let col = 0; col < MAP.width; col++) {
                const kind = this.grid[row][col];
                const { x, y } = toWorld(col, row);
                const z = -y;   // el mapa cuenta Y hacia arriba, la escena Z hacia el fondo

                if (kind === CELL_KIND.TREE) {
                    const height = randomRange(random, 2.2, 3.6);
                    this.add(new Mesh(gl, cylinderGeometry({ radiusTop: 0.16, radiusBottom: 0.24, height, segments: 7 }))
                        .setPosition({ x, y: height / 2, z })
                        .setColor({ red: 0.3, green: 0.21, blue: 0.13 }).init());
                    this.add(new Mesh(gl, coneGeometry({ radius: randomRange(random, 0.7, 1), height: randomRange(random, 1.6, 2.4), segments: 9 }))
                        .setPosition({ x, y: height + 0.7, z })
                        .setColor({ red: 0.12, green: randomRange(random, 0.34, 0.48), blue: 0.2 }).init());
                } else if (kind === CELL_KIND.ROCK) {
                    this.add(new Mesh(gl, sphereGeometry({ radius: 0.42, segments: 8, rings: 6 }))
                        .setPosition({ x, y: 0.25, z }).setScale({ x: 1.2, y: 0.7, z: 1 })
                        .setColor({ red: 0.42, green: 0.44, blue: 0.47 }).init());
                } else if (kind === CELL_KIND.BUSH) {
                    this.add(new Mesh(gl, sphereGeometry({ radius: 0.44, segments: 8, rings: 6 }))
                        .setPosition({ x, y: 0.3, z })
                        .setColor({ red: 0.14, green: 0.42, blue: 0.22 }).init());
                } else if (kind === CELL_KIND.WATER) {
                    this.add(new Mesh(gl, boxGeometry({ width: 1.02, height: 0.08, depth: 1.02 }))
                        .setPosition({ x, y: 0.04, z })
                        .setColor({ red: 0.16, green: 0.36, blue: 0.5 }).setShininess(60).init());
                } else if (kind === CELL_KIND.PATH || kind === CELL_KIND.DIRT) {
                    this.add(new Mesh(gl, boxGeometry({ width: 1.02, height: 0.03, depth: 1.02 }))
                        .setPosition({ x, y: 0.015, z })
                        .setColor({ red: 0.42, green: 0.35, blue: 0.23 }).init());
                }
            }
        }
    }

    _buildAcorns(count, seed) {
        const gl = this.gl;
        const cells = walkableCells(this.grid, { minDistance: 3 }).sort((a, b) => a.distance - b.distance);
        this.acorns = [];
        if (cells.length === 0) return;
        const step = Math.max(1, Math.floor(cells.length / count));
        const offset = seed % step;
        for (let i = 0; i < count; i++) {
            const cell = cells[Math.min(cells.length - 1, i * step + offset)];
            const mesh = this.add(new Mesh(gl, sphereGeometry({ radius: 0.26, segments: 12, rings: 9 }))
                .setPosition({ x: cell.x, y: 0.6, z: -cell.y })
                .setColor({ red: 0.82, green: 0.6, blue: 0.24 }).setShininess(50).init());
            this.acorns.push({ mesh, x: cell.x, y: cell.y, phase: i * 0.9, taken: false });
        }
    }

    _buildHero() {
        const gl = this.gl;
        this.body = this.add(new Mesh(gl, cylinderGeometry({ radiusTop: 0.26, radiusBottom: 0.3, height: 0.8, segments: 12 }))
            .setColor({ red: 0.3, green: 0.62, blue: 0.36 }).init());
        this.head = this.add(new Mesh(gl, sphereGeometry({ radius: 0.24, segments: 12, rings: 9 }))
            .setColor({ red: 0.94, green: 0.71, blue: 0.55 }).init());
        this.hat = this.add(new Mesh(gl, coneGeometry({ radius: 0.3, height: 0.34, segments: 10 }))
            .setColor({ red: 0.75, green: 0.28, blue: 0.24 }).init());
        this.legs = [-1, 1].map(() => this.add(new Mesh(gl, boxGeometry({ width: 0.16, height: 0.42, depth: 0.16 }))
            .setColor({ red: 0.2, green: 0.28, blue: 0.5 }).init()));
    }

    _buildHud() {
        this.acornLabel = el("span", { textContent: `0/${this.target}` });
        this.clockLabel = el("span", { textContent: `${Math.ceil(this.timeLeft)}` });
        this.clockChip = el("div", { className: "chip" }, [el("small", { textContent: "TIEMPO" }), this.clockLabel]);
        this.overlay(el("div", { className: "hud3" }, [
            el("div", { className: "chip" }, [el("small", { textContent: "BELLOTAS" }), this.acornLabel]),
            el("div", { className: "spacer" }),
            this.clockChip,
        ]));
        this.pauseNode = el("div", { className: "menu" }, [el("h1", { textContent: "Pausa" }),
            el("div", { className: "sub", textContent: "P para seguir · Esc para volver al menú" })]);
        this.pauseNode.style.display = "none";
        this.overlay(this.pauseNode);
    }

    update(dt) {
        if (this.paused || this.finished) return;
        this.elapsed += dt;

        const dx = this.keyboard.axis(["a", "ArrowLeft"], ["d", "ArrowRight"]);
        const dy = this.keyboard.axis(["s", "ArrowDown"], ["w", "ArrowUp"]);
        let moving = false;
        if (dx || dy) {
            const length = Math.hypot(dx, dy);
            // The identical collision routine the 2D game uses, on the identical
            // grid. Only the rendering below knows this is 3D.
            const moved = moveWithCollision(this.grid, this.position,
                (dx / length) * SPEED * dt, (dy / length) * SPEED * dt);
            this.position.x = moved.x;
            this.position.y = moved.y;
            this.heading = Math.atan2(dx, dy) * RAD_TO_DEG;
            moving = true;
        }

        this._placeHero(moving);
        this._bobAcorns();
        this._collect();

        this.timeLeft = Math.max(0, this.timeLeft - dt);
        if (this.timeLeft <= 0) this._finish(false);

        // Third-person, behind whichever way you last moved.
        const rad = this.heading * DEG_TO_RAD;
        const x = this.position.x, z = -this.position.y;
        this.camera3d.lookFrom(
            { x: x - Math.sin(rad) * 6.5, y: 4.6, z: z - Math.cos(rad) * 6.5 },
            { x: x + Math.sin(rad) * 2, y: 1, z: z + Math.cos(rad) * 2 },
        );

        this.acornLabel.textContent = `${this.collected}/${this.target}`;
        this.clockLabel.textContent = `${Math.ceil(this.timeLeft)}`;
        this.clockChip.classList.toggle("low", this.timeLeft <= 10);
    }

    _placeHero(moving) {
        const x = this.position.x, z = -this.position.y;
        // A bob while walking, which is all the animation a capsule needs.
        const bob = moving ? Math.abs(Math.sin(this.elapsed * 9)) * 0.09 : 0;
        this.body.setPosition({ x, y: 0.82 + bob, z }).setRotation({ y: this.heading });
        this.head.setPosition({ x, y: 1.36 + bob, z });
        this.hat.setPosition({ x, y: 1.62 + bob, z }).setRotation({ y: this.heading });
        const swing = moving ? Math.sin(this.elapsed * 9) * 0.18 : 0;
        this.legs.forEach((leg, i) => {
            const side = i === 0 ? -0.14 : 0.14;
            const rad = this.heading * DEG_TO_RAD;
            leg.setPosition({
                x: x + Math.cos(rad) * side + Math.sin(rad) * (i === 0 ? swing : -swing),
                y: 0.24,
                z: z - Math.sin(rad) * side + Math.cos(rad) * (i === 0 ? swing : -swing),
            }).setRotation({ y: this.heading });
        });
    }

    _bobAcorns() {
        for (const acorn of this.acorns) {
            if (acorn.taken) continue;
            acorn.mesh.setPosition({ y: 0.6 + Math.sin(this.elapsed * 3 + acorn.phase) * 0.14 })
                .setRotation({ y: this.elapsed * 90 });
        }
    }

    _collect() {
        for (const acorn of this.acorns) {
            if (acorn.taken) continue;
            if (Math.hypot(acorn.x - this.position.x, acorn.y - this.position.y) > PICKUP_RANGE) continue;
            acorn.taken = true;
            this.remove(acorn.mesh);
            this.collected++;
            if (this.collected >= this.target) this._finish(true);
        }
    }

    _finish(won) {
        if (this.finished) return;
        this.finished = true;
        setTimeout(() => {
            if (this.active) {
                this.go("fin", {
                    won, acorns: this.collected, target: this.target,
                    time: this.totalTime - this.timeLeft,
                    difficulty: { acorns: this.target, seconds: this.totalTime },
                });
            }
        }, 400);
    }
}

// --- Result ---------------------------------------------------------------

class End3D extends Scene {
    constructor() { super("fin"); this.best = null; }

    enter({ won = false, acorns = 0, target = 0, time = 0, difficulty = null } = {}) {
        const record = won && (!this.best || time < this.best.time);
        if (record) this.best = { acorns, time };

        const stat = (value, label) => el("div", { className: "stat" }, [
            el("b", { textContent: value }), el("small", { textContent: label }),
        ]);
        const children = [
            el("h1", { textContent: won ? "¡Bosque recorrido!" : "Se acabó el tiempo",
                       style: `color:${won ? "#7fe0a0" : "#f0a094"}` }),
            el("div", { className: "sub", textContent: won ? "Juntaste todas las bellotas." : `Te faltaron ${target - acorns}.` }),
            el("div", { className: "stats" }, [stat(`${acorns}/${target}`, "BELLOTAS"), stat(`${time.toFixed(1)}s`, "TIEMPO")]),
            el("div", { className: "actions" }, [
                button("↻  Otra vez", () => this.go("juego", difficulty || {}), { className: "again" }),
                button("Volver al menú", () => this.go("menu", { best: this.best })),
            ]),
        ];
        if (record) children.push(el("div", { style: "margin-top:12px;color:#e8c24a;font-weight:600;font-size:13px", textContent: "¡Nueva mejor marca!" }));
        this.overlay(el("div", { className: "end" }, children));

        this.onKey(["Enter", " ", "Space"], () => this.go("juego", difficulty || {}));
        this.onKey("Escape", () => this.go("menu", { best: this.best }));
        this.result = { won, acorns, target, time, record };
    }
}

App.boot({ title: "El Bosque 3D", styles: STYLES, panel: false }, (app) => {
    const scenes = new SceneManager(app, { fadeMs: 200 });
    scenes.add("menu", new Menu3D());
    scenes.add("juego", new Forest3D());
    scenes.add("fin", new End3D());
    scenes.go("menu");

    window.raptorBosque3D = {
        app, scenes,
        get scene() { return scenes.name; },
        get game() { return scenes.get("juego"); },
        get state() {
            const game = scenes.get("juego");
            return game && game.active
                ? { x: game.position.x, y: game.position.y, collected: game.collected,
                    target: game.target, timeLeft: game.timeLeft, paused: game.paused }
                : null;
        },
        go: (name, data) => scenes.go(name, data),
    };
});
