// Tank-style movement for any shape.
//
// Drives a shape like a tracked vehicle: throttle accelerates it forward/back
// along the way it is facing, and steering rotates the hull in place (tanks can
// neutral-steer). Coasting bleeds speed off with friction, so it stops shortly
// after you let go — that heavy, planted feel a car controller wouldn't have.
//
// It is input-agnostic. Feed it `setInput({ forward, turn })` each frame from
// whatever you like, or use the built-in bindings that both drive the same set
// of held directions:
//   - `bindKeys()`  — WASD + arrow keys (desktop)
//   - `bindTouch()` — on-screen buttons via pointer events (touch / mouse)
// `update(dt)` moves the shape.
//
// Facing follows the engine's convention: rotation is CCW degrees and local +Y
// is "forward", so at rotation 0 the shape drives up the screen.

export default class TankController {
    constructor(shape, {
        accel = 5,           // forward acceleration (world units / s²)
        maxSpeed = 3,        // top forward speed (world units / s)
        reverseFactor = 0.5, // reverse is weaker and slower, like real tracks
        friction = 5,        // how hard it decelerates while coasting
        turnSpeed = 140,     // steering rate (degrees / s)
        bounds = null,       // optional { minX, maxX, minY, maxY } to stay inside
    } = {}) {
        this.shape = shape;
        this.accel = accel;
        this.maxSpeed = maxSpeed;
        this.reverseFactor = reverseFactor;
        this.friction = friction;
        this.turnSpeed = turnSpeed;
        this.bounds = bounds;

        this.speed = 0;                       // signed scalar along the heading
        this.input = { forward: 0, turn: 0 }; // each clamped to [-1, 1]

        // Directions currently held down, from any input source. Keyboard and
        // touch both toggle these, so combining sources "just works".
        this._held = { forward: false, back: false, left: false, right: false };
        this._unbindKeys = null;
        this._unbindTouch = null;
    }

    // Heading in radians (from the shape's rotation).
    get heading() {
        return (this.shape.rotation * Math.PI) / 180;
    }

    // Unit vector the tank is facing (local +Y rotated by the heading).
    get forward() {
        const h = this.heading;
        return { x: -Math.sin(h), y: Math.cos(h) };
    }

    // Current world velocity (forward * speed), handy for cameras or collisions.
    get velocity() {
        const f = this.forward;
        return { x: f.x * this.speed, y: f.y * this.speed };
    }

    // forward/turn in [-1, 1]. Only the given fields change.
    setInput({ forward = this.input.forward, turn = this.input.turn } = {}) {
        this.input.forward = Math.max(-1, Math.min(1, forward));
        this.input.turn = Math.max(-1, Math.min(1, turn));
        return this;
    }

    // Presses/releases a logical direction ("forward" | "back" | "left" |
    // "right"). Any input source can call this; it recomputes setInput.
    hold(dir, on) {
        if (!(dir in this._held)) return this;
        this._held[dir] = !!on;
        const forward = (this._held.forward ? 1 : 0) - (this._held.back ? 1 : 0);
        const turn = (this._held.left ? 1 : 0) - (this._held.right ? 1 : 0);
        return this.setInput({ forward, turn });
    }

    update(dt) {
        // Steer: rotate the hull. Independent of speed so it can pivot on the spot.
        this.shape.rotation += this.input.turn * this.turnSpeed * dt;

        if (this.input.forward !== 0) {
            // Throttle: reverse pulls with less force than forward.
            const gain = this.input.forward > 0 ? 1 : this.reverseFactor;
            this.speed += this.accel * gain * this.input.forward * dt;
        } else {
            // Coast: friction pulls speed toward zero without overshooting it.
            const drop = this.friction * dt;
            this.speed = Math.abs(this.speed) <= drop ? 0 : this.speed - Math.sign(this.speed) * drop;
        }

        // Cap the speed envelope (reverse capped lower than forward).
        this.speed = Math.max(-this.maxSpeed * this.reverseFactor, Math.min(this.maxSpeed, this.speed));

        // Advance along the heading.
        const f = this.forward;
        let x = this.shape.position.x + f.x * this.speed * dt;
        let y = this.shape.position.y + f.y * this.speed * dt;

        if (this.bounds) {
            const b = this.bounds;
            const cx = Math.max(b.minX, Math.min(b.maxX, x));
            const cy = Math.max(b.minY, Math.min(b.maxY, y));
            // Bumping a wall scrubs off most of the speed instead of gluing to it.
            if (cx !== x || cy !== y) this.speed *= 0.3;
            x = cx;
            y = cy;
        }

        this.shape.setPosition({ x, y });
        return this;
    }

    // Binds WASD + arrow keys on `target` (default: window). W/↑ and S/↓ drive,
    // A/← and D/→ steer. Returns an unbind function; also stored for unbind().
    bindKeys(target = window) {
        const map = {
            w: "forward", ArrowUp: "forward",
            s: "back", ArrowDown: "back",
            a: "left", ArrowLeft: "left",
            d: "right", ArrowRight: "right",
        };
        const keyOf = (e) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
        const onDown = (e) => {
            const dir = map[keyOf(e)];
            if (!dir) return;
            e.preventDefault();
            this.hold(dir, true);
        };
        const onUp = (e) => {
            const dir = map[keyOf(e)];
            if (dir) this.hold(dir, false);
        };

        target.addEventListener("keydown", onDown);
        target.addEventListener("keyup", onUp);
        if (this._unbindKeys) this._unbindKeys();
        this._unbindKeys = () => {
            target.removeEventListener("keydown", onDown);
            target.removeEventListener("keyup", onUp);
            this._unbindKeys = null;
        };
        return this._unbindKeys;
    }

    // Binds on-screen buttons for touch (and mouse) via pointer events. `buttons`
    // maps a direction to a DOM element: { forward, back, left, right }; any
    // subset is fine. Multi-touch works — hold two buttons to drive and turn at
    // once. Returns an unbind function; also stored for unbind().
    bindTouch(buttons = {}) {
        const teardown = [];
        for (const dir of Object.keys(buttons)) {
            const node = buttons[dir];
            if (!node || !(dir in this._held)) continue;

            const press = (e) => {
                e.preventDefault();
                if (node.setPointerCapture && e.pointerId != null) {
                    try { node.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
                }
                this.hold(dir, true);
            };
            const release = () => this.hold(dir, false);

            node.addEventListener("pointerdown", press);
            node.addEventListener("pointerup", release);
            node.addEventListener("pointercancel", release);
            node.addEventListener("pointerleave", release);
            // Keep touches from scrolling / selecting / zooming the page.
            node.style.touchAction = "none";
            node.style.userSelect = "none";

            teardown.push(() => {
                node.removeEventListener("pointerdown", press);
                node.removeEventListener("pointerup", release);
                node.removeEventListener("pointercancel", release);
                node.removeEventListener("pointerleave", release);
            });
        }

        if (this._unbindTouch) this._unbindTouch();
        this._unbindTouch = () => {
            for (const fn of teardown) fn();
            this._unbindTouch = null;
        };
        return this._unbindTouch;
    }

    // Removes any keyboard and touch bindings installed above.
    unbind() {
        if (this._unbindKeys) this._unbindKeys();
        if (this._unbindTouch) this._unbindTouch();
        return this;
    }
}
