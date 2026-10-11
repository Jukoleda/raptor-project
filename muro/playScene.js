// El Muro — the match.
//
// A brick breaker, which is a good shape for a framework demo because almost
// nothing in it is bespoke: the wall is `level.js`, the bouncing is the physics
// layer's `collide` against the real brick outlines, the sounds go through
// `app.audio`, the paddle follows the pointer through `camera.screenToWorld`,
// and the scene takes itself apart on the way out because `Scene` makes that
// the easy path.
//
// Three things here are game design rather than plumbing, and they are the
// three that decide whether it feels right:
//
//   - **The paddle steers the ball.** Where on the paddle the ball lands sets
//     the angle it leaves at. Without this the ball has a fixed trajectory and
//     the player is a spectator; with it, the paddle is an aiming device.
//   - **The ball never goes flat.** A bounce that leaves |dy| tiny sends the
//     ball skimming sideways for ten seconds, which is not difficulty, it is
//     waiting. Shallow angles are pushed back out.
//   - **It moves in substeps.** At four units a second and a 0.2-tall brick, a
//     long frame would step the ball clean through the wall without ever
//     overlapping anything.

import Scene from "../components/scenes/scene.js";
import { el } from "../components/ui/index.js";
import { Rectangle, Circle } from "../components/shapes/index.js";
import { collide } from "../components/physics/index.js";
import { viewHalfExtents } from "../components/render/index.js";
import { reflect } from "../components/weapons/index.js";
import { clamp } from "../components/math/angles.js";
import {
    FIELD, COLS, BRICK, BRICK_COLORS, MAX_STRENGTH,
    brickPosition, brickScore, generateLevel, countBricks, ballSpeed,
} from "./level.js";
import { golpeUrl, ladrilloUrl, paredUrl, falloUrl, nivelUrl, finUrl } from "./art.js";

export const GAME_STYLES = `
    .hud {
        position: absolute; top: 12px; left: 12px; right: 12px; z-index: 2;
        display: flex; align-items: center; gap: 10px; pointer-events: none;
        font-variant-numeric: tabular-nums;
    }
    .hud .chip {
        padding: 6px 12px; border-radius: 10px; background: rgba(10, 14, 24, .62);
        border: 1px solid rgba(255, 255, 255, .14); font-weight: 700; font-size: 16px;
    }
    .hud .chip small { display: block; font-size: 10px; font-weight: 500; color: #9aa6c0; }
    .hud .spacer { flex: 1; }
    .hud .chip.lives { letter-spacing: 2px; }
    .hud .chip.low { color: #ffb4a4; border-color: rgba(216, 74, 58, .6); }

    /* The tools ride inside the HUD row rather than in a corner of their own:
       two things both pinned to top-right is two things on top of each other. */
    .hud .tools { display: flex; gap: 8px; pointer-events: auto; }
    .hud .tools button {
        width: 38px; height: 38px; padding: 0; border-radius: 10px; font-size: 16px;
        background: rgba(10, 14, 24, .62); border: 1px solid rgba(255, 255, 255, .16);
        color: #e6e6e6; cursor: pointer;
    }
    .hud .tools button:hover { background: rgba(40, 52, 78, .8); }
    .hud .tools button.off { opacity: .45; }

    .flash {
        position: absolute; inset: 0; z-index: 2; display: flex;
        align-items: center; justify-content: center; pointer-events: none;
        font-size: clamp(22px, 5vw, 40px); font-weight: 800; letter-spacing: .02em;
        color: #eaf0ff; text-shadow: 0 3px 0 rgba(0, 0, 0, .45);
        opacity: 0; transition: opacity .18s ease;
    }
    .flash.show { opacity: 1; }
    .flash.paused { background: rgba(8, 11, 20, .55); }
`;

// Geometry of the moving parts, in world units.
const PADDLE = { width: 0.86, height: 0.14, y: -1.95, speed: 5.2 };
const BALL = { radius: 0.085 };

// The widest the ball can leave the paddle, measured from straight up. 60° at
// the very edge is steep enough to reach a corner and shallow enough to come
// back down.
const MAX_BOUNCE = 60;
// Below this the ball is travelling too flat to be interesting; it gets pushed
// back out to it. Expressed as a fraction of the speed.
const MIN_VERTICAL = 0.28;

const LIVES = 3;

export default class PlayScene extends Scene {
    constructor() {
        super("juego");
        this.score = 0;
        this.level = 1;
        this.lives = LIVES;
    }

    // Declared here, loaded on the way in: the menu is already on screen while
    // these are being built and decoded.
    preload(assets) {
        assets.add({
            sound: {
                golpe: golpeUrl(), ladrillo: ladrilloUrl(), pared: paredUrl(),
                fallo: falloUrl(), nivel: nivelUrl(), fin: finUrl(),
            },
        });
    }

    enter({ level = 1, score = 0, lives = LIVES } = {}) {
        this.level = level;
        this.score = score;
        this.lives = lives;
        this.paused = false;
        this.cleared = false;
        this.pointerX = null;       // client pixels, or null when using keys

        this._fitCamera();
        this._onResize = () => this._fitCamera();
        this.app.on("resize", this._onResize);

        this._buildField();
        this._buildWall();
        this._buildPaddle();
        this._buildBall();
        this._buildHud();
        this._bindInput();

        this._resetBall();
        this._flash(`Nivel ${this.level}`, 900);
    }

    // The field is a fixed size, the window is not. Rather than letting the
    // walls drift off screen on a phone, the camera zooms until the whole field
    // fits whatever aspect it is given. This is the one place the game cares
    // about the shape of the window at all.
    _fitCamera() {
        const canvas = this.app.canvas;
        const aspect = (canvas.clientWidth || canvas.width) / (canvas.clientHeight || canvas.height);
        // What the camera would show at zoom 1, which is what the zoom scales.
        const { halfW, halfH } = viewHalfExtents(aspect);
        const needW = FIELD.halfW + 0.25;
        const needH = (FIELD.top - FIELD.bottom) / 2 + 0.35;
        this.camera.zoom = Math.min(halfW / needW, halfH / needH);
        this.camera.centerOn(0, (FIELD.top + FIELD.bottom) / 2);
    }

    // --- Building ---------------------------------------------------------

    _buildField() {
        const midY = (FIELD.top + FIELD.bottom) / 2;
        const height = FIELD.top - FIELD.bottom;

        this.add(new Rectangle(this.gl, { width: FIELD.halfW * 2, height })
            .setColor({ red: 0.09, green: 0.11, blue: 0.18 })
            .setPosition({ x: 0, y: midY }).init());

        // Three walls, drawn so the playfield reads as a box with the bottom
        // deliberately missing — that gap is the whole game.
        const wall = { red: 0.26, green: 0.31, blue: 0.45 };
        const t = 0.09;
        this.add(new Rectangle(this.gl, { width: FIELD.halfW * 2 + t * 2, height: t })
            .setColor(wall).setPosition({ x: 0, y: FIELD.top + t / 2 }).init());
        for (const side of [-1, 1]) {
            this.add(new Rectangle(this.gl, { width: t, height })
                .setColor(wall).setPosition({ x: side * (FIELD.halfW + t / 2), y: midY }).init());
        }

        // The line you must not let the ball cross.
        this.add(new Rectangle(this.gl, { width: FIELD.halfW * 2, height: 0.02 })
            .setColor({ red: 0.45, green: 0.22, blue: 0.26 })
            .setPosition({ x: 0, y: FIELD.bottom }).init());
    }

    _buildWall() {
        this.grid = generateLevel(this.level);
        this.remaining = countBricks(this.grid);
        this.bricks = [];

        for (let row = 0; row < this.grid.length; row++) {
            for (let col = 0; col < COLS; col++) {
                const strength = this.grid[row][col];
                if (strength === 0) continue;
                const { x, y } = brickPosition(row, col);
                const shape = new Rectangle(this.gl, { width: BRICK.width, height: BRICK.height })
                    .setColor(BRICK_COLORS[strength])
                    .setPosition({ x, y })
                    .init();
                this.add(shape);
                this.bricks.push({ shape, strength, row, col, alive: true });
            }
        }
    }

    _buildPaddle() {
        this.paddle = this.add(new Rectangle(this.gl, { width: PADDLE.width, height: PADDLE.height })
            .setColor({ red: 0.82, green: 0.86, blue: 0.95 })
            .setPosition({ x: 0, y: PADDLE.y })
            .init());
    }

    _buildBall() {
        this.ball = this.add(new Circle(this.gl, { radius: BALL.radius, segments: 20 })
            .setColor({ red: 1, green: 0.93, blue: 0.6 })
            .init());
        this.velocity = { x: 0, y: 0 };
        this.stuck = true;      // sitting on the paddle, waiting to be launched
    }

    _buildHud() {
        this.scoreLabel = el("span", { textContent: "0" });
        this.levelLabel = el("span", { textContent: "1" });
        this.livesLabel = el("span", { textContent: "" });
        this.livesChip = el("div", { className: "chip lives" }, [
            el("small", { textContent: "VIDAS" }), this.livesLabel,
        ]);
        this.muteBtn = el("button", { title: "Silenciar (M)", textContent: "🔊", onclick: () => this._toggleMute() });
        const tools = el("div", { className: "tools" }, [
            el("button", { title: "Pausa (P)", textContent: "⏸", onclick: () => this._togglePause() }),
            this.muteBtn,
            el("button", { title: "Pantalla completa (F)", textContent: "⛶", onclick: () => this.app.toggleFullscreen() }),
        ]);

        this.overlay(el("div", { className: "hud" }, [
            el("div", { className: "chip" }, [el("small", { textContent: "PUNTOS" }), this.scoreLabel]),
            el("div", { className: "chip" }, [el("small", { textContent: "NIVEL" }), this.levelLabel]),
            el("div", { className: "spacer" }),
            this.livesChip,
            tools,
        ]));

        this.flashLabel = this.overlay(el("div", { className: "flash" }));
        this._drawHud();
    }

    _bindInput() {
        // Three ways to move the paddle, and they do not fight: the pointer
        // wins while it is moving, the keys take over the moment one is held.
        const canvas = this.app.canvas;
        this._onPointerMove = (e) => { this.pointerX = e.clientX; };
        this._onPointerDown = (e) => { this.pointerX = e.clientX; this._launch(); };
        canvas.addEventListener("pointermove", this._onPointerMove);
        canvas.addEventListener("pointerdown", this._onPointerDown);

        this.onKey([" ", "Space"], () => this._launch());
        this.onKey("p", () => this._togglePause());
        this.onKey("m", () => this._toggleMute());
        this.onKey("f", () => this.app.toggleFullscreen());

        // On-screen arrows drive the same keys the keyboard does, so there is
        // one movement path rather than two that have to agree.
        const left = this.touch.button("izq", "◀", "round");
        const right = this.touch.button("der", "▶", "round");
        const fire = this.touch.button("lanzar", "●", "round");
        this.touch.pedal(left, "ArrowLeft");
        this.touch.pedal(right, "ArrowRight");
        this.touch.tap(fire, () => this._launch());
        // Keep the pad containers, not the buttons: a button nested in a column
        // has the column as its parent, and removing that would leave the pad.
        this._pads = [this.touch.pad("left", [left, right]), this.touch.pad("right", [fire])];
    }

    // --- Input helpers -----------------------------------------------------

    _launch() {
        if (this.paused || !this.stuck) return;
        this.stuck = false;
        // Always upward, leaning the way the paddle is off centre, so a launch
        // from the left of the field tends to open the field rather than
        // bouncing straight back down.
        const lean = clamp(this.paddle.position.x / FIELD.halfW, -0.6, 0.6);
        this._setDirection(lean, 1);
    }

    _togglePause() {
        if (this.cleared) return;
        this.paused = !this.paused;
        this.flashLabel.textContent = this.paused ? "Pausa" : "";
        this.flashLabel.classList.toggle("show", this.paused);
        this.flashLabel.classList.toggle("paused", this.paused);
    }

    _toggleMute() {
        const muted = this.app.audio.toggleMuted().muted;
        this.muteBtn.textContent = muted ? "🔇" : "🔊";
        this.muteBtn.classList.toggle("off", muted);
    }

    // --- Ball -------------------------------------------------------------

    // Points the ball along (x, y), normalised to the level's speed and never
    // so flat that it skims.
    _setDirection(x, y) {
        const speed = ballSpeed(this.level);
        let dx = x;
        let dy = y;
        const length = Math.hypot(dx, dy) || 1;
        dx /= length;
        dy /= length;
        if (Math.abs(dy) < MIN_VERTICAL) {
            dy = Math.sign(dy || 1) * MIN_VERTICAL;
            dx = Math.sign(dx || 1) * Math.sqrt(Math.max(0, 1 - dy * dy));
        }
        this.velocity = { x: dx * speed, y: dy * speed };
    }

    _resetBall() {
        this.stuck = true;
        this.velocity = { x: 0, y: 0 };
        this.paddle.setPosition({ x: 0, y: PADDLE.y });
        this.ball.setPosition({ x: 0, y: PADDLE.y + PADDLE.height / 2 + BALL.radius + 0.01 });
    }

    play(key, options) {
        if (this.assets.status(key) !== "ready") return false;
        return !!this.app.audio.play(this.assets.sound(key), options);
    }

    // --- Frame -------------------------------------------------------------

    update(dt) {
        if (this.paused || this.cleared) return;
        this._movePaddle(dt);

        if (this.stuck) {
            this.ball.setPosition({
                x: this.paddle.position.x,
                y: PADDLE.y + PADDLE.height / 2 + BALL.radius + 0.01,
            });
            return;
        }

        // Substepped so a long frame cannot step the ball through a brick: no
        // step is longer than the ball's own radius.
        const distance = Math.hypot(this.velocity.x, this.velocity.y) * dt;
        const steps = Math.max(1, Math.ceil(distance / BALL.radius));
        for (let i = 0; i < steps && !this.cleared; i++) this._step(dt / steps);

        this._drawHud();
    }

    _movePaddle(dt) {
        const axis = this.keyboard.axis(["a", "ArrowLeft"], ["d", "ArrowRight"]);
        let x = this.paddle.position.x;

        if (axis !== 0) {
            // A key beats the pointer, and forgets where the pointer was — so
            // letting go of the key does not snap the paddle back to the mouse.
            this.pointerX = null;
            x += axis * PADDLE.speed * dt;
        } else if (this.pointerX !== null) {
            // The whole of the pointer-to-world conversion, and the reason both
            // cameras now answer this question the same way.
            const world = this.camera.screenToWorld(this.pointerX, 0, this.app.canvas);
            x = world.x;
        }

        const limit = FIELD.halfW - PADDLE.width / 2;
        this.paddle.setPosition({ x: clamp(x, -limit, limit), y: PADDLE.y });
    }

    _step(dt) {
        const next = {
            x: this.ball.position.x + this.velocity.x * dt,
            y: this.ball.position.y + this.velocity.y * dt,
        };
        this.ball.setPosition(next);

        this._bounceWalls();
        this._bouncePaddle();
        this._bounceBricks();

        if (this.ball.position.y < FIELD.bottom - BALL.radius) this._loseLife();
    }

    _bounceWalls() {
        const limit = FIELD.halfW - BALL.radius;
        const { x, y } = this.ball.position;
        let hit = false;

        if (x < -limit || x > limit) {
            this.ball.setPosition({ x: clamp(x, -limit, limit) });
            this.velocity.x = -this.velocity.x;
            hit = true;
        }
        const ceiling = FIELD.top - BALL.radius;
        if (y > ceiling) {
            this.ball.setPosition({ y: ceiling });
            this.velocity.y = -this.velocity.y;
            hit = true;
        }
        if (hit) this.play("pared", { volume: 0.35 });
    }

    _bouncePaddle() {
        // Only on the way down: catching the ball from below would let it be
        // scooped up through the paddle.
        if (this.velocity.y > 0) return;
        if (!collide({ shape: this.ball }, { shape: this.paddle })) return;

        // Where it landed decides where it goes. This is the mechanic that
        // turns the paddle from a wall into an aiming device.
        const offset = clamp(
            (this.ball.position.x - this.paddle.position.x) / (PADDLE.width / 2), -1, 1);
        const angle = (offset * MAX_BOUNCE * Math.PI) / 180;
        this._setDirection(Math.sin(angle), Math.cos(angle));
        this.ball.setPosition({ y: PADDLE.y + PADDLE.height / 2 + BALL.radius + 0.001 });
        this.play("golpe", { volume: 0.5 });
    }

    _bounceBricks() {
        // The deepest overlap, not the first found: against a corner the ball
        // can touch two bricks in one step, and the one it is further into is
        // the one it actually hit.
        let best = null;
        for (const brick of this.bricks) {
            if (!brick.alive) continue;
            // A cheap reject before the real test — most bricks are nowhere near.
            if (Math.abs(brick.shape.position.x - this.ball.position.x) > BRICK.width) continue;
            if (Math.abs(brick.shape.position.y - this.ball.position.y) > BRICK.height) continue;
            const hit = collide({ shape: this.ball }, { shape: brick.shape });
            if (hit && (!best || hit.penetration > best.hit.penetration)) best = { brick, hit };
        }
        if (!best) return;

        const { brick, hit } = best;
        // `collide` reports its normal pointing A → B, so out of the brick is
        // the other way.
        this.ball.setPosition({
            x: this.ball.position.x - hit.normal.x * hit.penetration,
            y: this.ball.position.y - hit.normal.y * hit.penetration,
        });
        const bounced = reflect(this.velocity, hit.normal);
        this._setDirection(bounced.x, bounced.y);

        brick.strength -= 1;
        if (brick.strength > 0) {
            brick.shape.setColor(BRICK_COLORS[brick.strength]);
            this.play("ladrillo", { volume: 0.4, rate: 0.8 });
            return;
        }

        brick.alive = false;
        this.remove(brick.shape);
        this.remaining -= 1;
        this.score += brickScore(this.grid[brick.row][brick.col]);
        // One sound file, three pitches: the tougher the brick was, the lower
        // the note it breaks on.
        const rate = 1.25 - 0.18 * (this.grid[brick.row][brick.col] - 1);
        this.play("ladrillo", { volume: 0.5, rate });

        if (this.remaining === 0) this._clearLevel();
    }

    _loseLife() {
        this.lives -= 1;
        this.play("fallo", { volume: 0.5 });
        this._drawHud();

        if (this.lives <= 0) {
            this.cleared = true;
            this.play("fin", { volume: 0.5 });
            this._flash("Fin de la partida", 700);
            setTimeout(() => this.active && this.go("fin", {
                won: false, score: this.score, level: this.level,
            }), 900);
            return;
        }
        this._resetBall();
    }

    _clearLevel() {
        this.cleared = true;
        this.play("nivel", { volume: 0.5 });
        this._flash("¡Muro derribado!", 900);
        setTimeout(() => this.active && this.go("juego", {
            level: this.level + 1, score: this.score, lives: this.lives,
        }), 1100);
    }

    _flash(text, ms) {
        this.flashLabel.textContent = text;
        this.flashLabel.classList.add("show");
        this.flashLabel.classList.remove("paused");
        clearTimeout(this._flashTimer);
        this._flashTimer = setTimeout(() => {
            if (!this.paused) this.flashLabel.classList.remove("show");
        }, ms);
    }

    _drawHud() {
        this.scoreLabel.textContent = String(this.score);
        this.levelLabel.textContent = String(this.level);
        this.livesLabel.textContent = "●".repeat(Math.max(0, this.lives)) || "—";
        this.livesChip.classList.toggle("low", this.lives <= 1);
    }

    // Everything the recording helpers in `Scene` do not cover: a raw DOM
    // listener, a timer, an app-level subscription and the on-screen pads.
    exit() {
        const canvas = this.app.canvas;
        canvas.removeEventListener("pointermove", this._onPointerMove);
        canvas.removeEventListener("pointerdown", this._onPointerDown);
        this.app.off("resize", this._onResize);
        clearTimeout(this._flashTimer);
        this.app.audio.stopAll();
        for (const pad of this._pads || []) pad?.remove();
    }
}
