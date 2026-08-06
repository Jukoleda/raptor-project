// The game itself: walk through the forest and collect the acorns before the
// clock runs out.
//
// This is the scene that actually uses everything the framework has: the asset
// loader declares the sheet and the sounds in `preload`, sprites and layers
// draw the world, the animator runs the walk cycle, the camera follows and is
// bounded by the map, and the input layer means a key and a finger cannot
// disagree.
//
// Note where the loading happens: `preload()` runs the first time you enter,
// not when the page opens. The menu is on screen while this is being fetched.

import Scene from "../components/scenes/scene.js";
import { el } from "../components/ui/index.js";
import { Sprite } from "../components/shapes/index.js";
import { SpriteSheet, Animator } from "../components/render/index.js";
import { CELL, PPU, TILE, PROP, ITEM, HERO, sheetUrl, pickupUrl, winUrl, loseUrl, tickUrl } from "./art.js";
import {
    MAP, HALF, CELL_KIND, generateForest, toWorld, moveWithCollision, walkableCells,
} from "./forest.js";

const SPEED = 4.2;              // world units per second
const PICKUP_RANGE = 0.55;      // generous: reaching for an acorn should not miss
const TILE_BLEED = 1.04;        // see the sprites demo — hides sub-pixel seams

const LAYER = { GROUND: -20, SHADOW: -5, PROP: 0, ITEM: 5, ACTOR: 10, CANOPY: 20 };

// Which sheet cell draws each grid kind, and whether it sits on the ground or
// stands as a prop above it.
const GROUND_CELL = {
    [CELL_KIND.GRASS]: TILE.GRASS, [CELL_KIND.ALT]: TILE.GRASS_ALT,
    [CELL_KIND.DIRT]: TILE.DIRT, [CELL_KIND.FLOWERS]: TILE.FLOWERS,
    [CELL_KIND.WATER]: TILE.WATER, [CELL_KIND.PATH]: TILE.PATH,
};
const PROP_CELL = {
    [CELL_KIND.ROCK]: PROP.ROCK, [CELL_KIND.BUSH]: PROP.BUSH,
    [CELL_KIND.STUMP]: PROP.STUMP, [CELL_KIND.LOG]: PROP.LOG,
};

export const GAME_STYLES = `
    .hud {
        position: absolute; top: 12px; left: 12px; right: 12px; z-index: 2;
        display: flex; align-items: center; gap: 12px; pointer-events: none;
    }
    .hud .chip {
        display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: 10px;
        background: rgba(10, 16, 12, .62); border: 1px solid rgba(255,255,255,.14);
        -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
        font-weight: 700; font-variant-numeric: tabular-nums; font-size: 17px;
    }
    .hud .chip small { font-size: 10px; font-weight: 500; color: #9aa0a6; letter-spacing: .06em; }
    .hud .clock.low { color: #ffb4a4; border-color: rgba(216,74,58,.6); }
    .hud .spacer { flex: 1; }
    .hud .bar { height: 6px; border-radius: 3px; background: rgba(0,0,0,.45); overflow: hidden; width: 120px; }
    .hud .bar > i { display: block; height: 100%; width: 0; background: #e8c24a; transition: width .2s ease; }

    .paused {
        position: absolute; inset: 0; z-index: 3; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 10px;
        background: rgba(8, 14, 10, .72); font-size: 22px; font-weight: 700;
    }
    .paused small { font-size: 13px; font-weight: 400; color: #9aa0a6; }
`;

export default class ForestScene extends Scene {
    constructor() {
        super("juego");
    }

    // Declared here, loaded on the way in — the menu is already on screen.
    preload(assets) {
        assets.add({
            texture: { bosque: sheetUrl() },
            sound: { bellota: pickupUrl(), victoria: winUrl(), derrota: loseUrl(), tic: tickUrl() },
        });
    }

    enter({ acorns = 10, seconds = 60, seed = 20260806 } = {}) {
        this.target = acorns;
        this.timeLeft = seconds;
        this.totalTime = seconds;
        this.collected = 0;
        this.elapsed = 0;
        this.paused = false;
        this._lastTick = Math.ceil(seconds);

        const texture = this.assets.texture("bosque");
        this.sheet = new SpriteSheet(texture, { frameWidth: CELL, frameHeight: CELL });
        this.grid = generateForest(seed);

        this._buildMap(texture);
        this._buildAcorns(texture, acorns, seed);
        this._buildHero(texture);
        this._buildHud();
        this._bindInput();

        this.camera.zoom = 0.95;
        this.camera.smoothing = 7;
        this.camera.centerOn(0, 0);
        const view = this.camera.viewExtents(this.app.canvas);
        this.camera.bounds = {
            minX: -HALF.x - 0.5 + view.halfW, maxX: HALF.x + 0.5 - view.halfW,
            minY: -HALF.y - 0.5 + view.halfH, maxY: HALF.y + 0.5 - view.halfH,
        };
    }

    // --- Building ----------------------------------------------------------

    _sprite(texture, cellIndex, x, y, layer, size = null) {
        return this.add(new Sprite(this.gl, {
            texture, frame: this.sheet.frame(cellIndex), pixelsPerUnit: PPU, width: size, height: size,
        }).setPosition({ x, y }).setLayer(layer).init());
    }

    _buildMap(texture) {
        this.canopies = [];
        for (let row = 0; row < MAP.height; row++) {
            for (let col = 0; col < MAP.width; col++) {
                const kind = this.grid[row][col];
                const { x, y } = toWorld(col, row);

                // Every cell gets ground under it, including the ones with a
                // tree on top — otherwise a felled tree would leave a hole.
                const ground = GROUND_CELL[kind] ?? TILE.GRASS;
                this._sprite(texture, ground, x, y, LAYER.GROUND, TILE_BLEED);

                if (kind === CELL_KIND.TREE) {
                    this._sprite(texture, PROP.TRUNK, x, y, LAYER.PROP);
                    // One cell above, so trunk and canopy meet; and on the top
                    // layer, so the player can walk behind the leaves.
                    this.canopies.push(this._sprite(texture, PROP.CANOPY, x, y + 1, LAYER.CANOPY));
                } else if (PROP_CELL[kind] !== undefined) {
                    this._sprite(texture, PROP_CELL[kind], x, y, LAYER.PROP);
                }
            }
        }
    }

    _buildAcorns(texture, count, seed) {
        // Spread them out: sort the free tiles by distance from the clearing
        // and take an even spread, so they are never all in one corner.
        const cells = walkableCells(this.grid, { minDistance: 3 })
            .sort((a, b) => a.distance - b.distance);
        this.acorns = [];
        if (cells.length === 0) return;

        const step = Math.max(1, Math.floor(cells.length / count));
        let offset = seed % step;
        for (let i = 0; i < count; i++) {
            const cell = cells[Math.min(cells.length - 1, i * step + offset)];
            const sprite = this._sprite(texture, ITEM.ACORN_A, cell.x, cell.y, LAYER.ITEM);
            this.acorns.push({ sprite, x: cell.x, y: cell.y, phase: i * 0.9, taken: false });
        }
    }

    _buildHero(texture) {
        this.shadow = this._sprite(texture, ITEM.SHADOW, 0, 0, LAYER.SHADOW);
        this.hero = this._sprite(texture, HERO.WALK_0, 0, 0, LAYER.ACTOR);
        this.animator = new Animator(this.hero, {
            quieto: this.sheet.animation(HERO.IDLE_0, HERO.IDLE_1, { fps: 2 }),
            andar: this.sheet.animation(HERO.WALK_0, HERO.WALK_3, { fps: 11 }),
        }, { initial: "quieto" });
        this.position = { x: 0, y: 0 };
    }

    _buildHud() {
        this.acornLabel = el("span", { textContent: `0/${this.target}` });
        this.clockLabel = el("span", { textContent: `${Math.ceil(this.timeLeft)}` });
        this.clockChip = el("div", { className: "chip clock" }, [
            el("small", { textContent: "TIEMPO" }), this.clockLabel,
        ]);
        this.progressFill = el("i");

        this.overlay(el("div", { className: "hud" }, [
            el("div", { className: "chip" }, [el("small", { textContent: "BELLOTAS" }), this.acornLabel]),
            el("div", { className: "bar" }, [this.progressFill]),
            el("div", { className: "spacer" }),
            this.clockChip,
        ]));

        this.pauseNode = el("div", { className: "paused" }, [
            document.createTextNode("Pausa"),
            el("small", { textContent: "P para seguir · Esc para volver al menú" }),
        ]);
        this.pauseNode.style.display = "none";
        this.overlay(this.pauseNode);
    }

    _bindInput() {
        this.onKey("p", () => this.togglePause());
        this.onKey("Escape", () => this.go("menu"));

        // The same four directions on screen, writing into the same held set as
        // the keyboard, so a finger and a key can never disagree.
        const pad = this.touch;
        if (!pad) return;
        for (const [name, label, key] of [["up", "▲", "w"], ["down", "▼", "s"], ["left", "◀", "a"], ["right", "▶", "d"]]) {
            pad.pedal(pad.button(name, label, "round"), key);
        }
        this.overlay(pad.pad("left", [pad.get("left"), pad.get("right")]));
        this.overlay(pad.pad("right", [[pad.get("up"), pad.get("down")]]));
    }

    // --- Playing -----------------------------------------------------------

    togglePause() {
        this.paused = !this.paused;
        this.pauseNode.style.display = this.paused ? "flex" : "none";
        return this;
    }

    update(dt) {
        if (this.paused) return;
        this.elapsed += dt;

        this._move(dt);
        this._bobAcorns();
        this._collect();
        this._tickClock(dt);

        this.animator.update(dt);
        this.camera.follow(this.position, dt);
        this._drawHud();
    }

    _move(dt) {
        const dx = this.keyboard.axis(["a", "ArrowLeft"], ["d", "ArrowRight"]);
        const dy = this.keyboard.axis(["s", "ArrowDown"], ["w", "ArrowUp"]);

        if (dx || dy) {
            // Normalise, or a diagonal would be 41% faster than a straight line.
            const length = Math.hypot(dx, dy);
            const moved = moveWithCollision(
                this.grid, this.position,
                (dx / length) * SPEED * dt,
                (dy / length) * SPEED * dt,
            );
            this.position.x = moved.x;
            this.position.y = moved.y;
            this.animator.play("andar");
            // Only flip on a real left/right input: walking straight up should
            // not snap the character round to face right.
            if (dx) this.hero.setFlip({ x: dx < 0 });
        } else {
            this.animator.play("quieto");
        }

        this.hero.setPosition(this.position);
        this.shadow.setPosition({ x: this.position.x, y: this.position.y - 0.02 });
    }

    _bobAcorns() {
        for (const acorn of this.acorns) {
            if (acorn.taken) continue;
            acorn.sprite.setPosition({ y: acorn.y + Math.sin(this.elapsed * 3 + acorn.phase) * 0.1 });
        }
    }

    _collect() {
        for (const acorn of this.acorns) {
            if (acorn.taken) continue;
            if (Math.hypot(acorn.x - this.position.x, acorn.y - this.position.y) > PICKUP_RANGE) continue;

            acorn.taken = true;
            this.remove(acorn.sprite);
            this.collected++;
            this.play("bellota");

            if (this.collected >= this.target) this._finish(true);
        }
    }

    _tickClock(dt) {
        if (this.finished) return;
        this.timeLeft = Math.max(0, this.timeLeft - dt);

        // One tick per second over the last five, not one per frame.
        const whole = Math.ceil(this.timeLeft);
        if (whole <= 5 && whole !== this._lastTick && whole > 0) this.play("tic");
        this._lastTick = whole;

        if (this.timeLeft <= 0) this._finish(false);
    }

    _finish(won) {
        if (this.finished) return;
        this.finished = true;
        this.play(won ? "victoria" : "derrota");
        // A beat before the screen changes, so the last acorn is seen landing
        // rather than cut off by the fade.
        setTimeout(() => {
            if (this.active) {
                this.go("fin", {
                    won,
                    acorns: this.collected,
                    target: this.target,
                    time: this.totalTime - this.timeLeft,
                    difficulty: { acorns: this.target, seconds: this.totalTime },
                });
            }
        }, 450);
    }

    _drawHud() {
        this.acornLabel.textContent = `${this.collected}/${this.target}`;
        this.clockLabel.textContent = `${Math.ceil(this.timeLeft)}`;
        this.clockChip.classList.toggle("low", this.timeLeft <= 10);
        this.progressFill.style.width = `${(this.collected / this.target) * 100}%`;
    }

    // Fire-and-forget playback of a loaded buffer. Web Audio needs a gesture to
    // *start*, which the menu button already provided, so by the time anything
    // here plays the context is running.
    play(key) {
        const context = this.assets.audioContext;
        if (!context || this.assets.status(key) !== "ready") return false;
        if (context.state === "suspended") context.resume();
        const source = context.createBufferSource();
        source.buffer = this.assets.sound(key);
        const gain = context.createGain();
        gain.gain.value = 0.45;
        source.connect(gain).connect(context.destination);
        source.start();
        return true;
    }

    exit() {
        this.finished = false;
        this.paused = false;
    }
}
