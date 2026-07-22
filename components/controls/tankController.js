// Tank-style movement for any shape.
//
// Drives a shape like a tracked vehicle: throttle accelerates it forward/back
// along the way it is facing, and steering rotates the hull in place (tanks can
// neutral-steer). Coasting bleeds speed off with friction, so it stops shortly
// after you let go — that heavy, planted feel a car controller wouldn't have.
//
// It is input-agnostic: feed it `setInput({ forward, turn })` each frame from
// whatever you like (keyboard, gamepad, AI), or call `bindKeys()` for a ready
// WASD + arrow-keys binding. `update(dt)` moves the shape.
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
        this._unbind = null;
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
        const down = new Set();
        const tracked = ["w", "a", "s", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
        const keyOf = (e) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);

        const sync = () => {
            const forward = (down.has("w") || down.has("ArrowUp") ? 1 : 0) - (down.has("s") || down.has("ArrowDown") ? 1 : 0);
            const turn = (down.has("a") || down.has("ArrowLeft") ? 1 : 0) - (down.has("d") || down.has("ArrowRight") ? 1 : 0);
            this.setInput({ forward, turn });
        };
        const onDown = (e) => {
            const k = keyOf(e);
            if (!tracked.includes(k)) return;
            e.preventDefault();
            down.add(k);
            sync();
        };
        const onUp = (e) => {
            down.delete(keyOf(e));
            sync();
        };

        target.addEventListener("keydown", onDown);
        target.addEventListener("keyup", onUp);
        this._unbind = () => {
            target.removeEventListener("keydown", onDown);
            target.removeEventListener("keyup", onUp);
            this._unbind = null;
        };
        return this._unbind;
    }

    // Removes the keyboard binding installed by bindKeys(), if any.
    unbind() {
        if (this._unbind) this._unbind();
        return this;
    }
}
