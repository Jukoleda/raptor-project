// The physics world: holds the bodies, integrates them and resolves collisions.
// Call step(dt) once per frame (register it as an engine updater).
//
// Scope (Fase A): linear rigid-body dynamics. Bodies translate and bounce along
// the collision normal; angular response (spin from off-center hits) is not
// simulated yet.

import { STATIC } from "./body.js";
import { collide, boundingRadius } from "./collision.js";

// Positional correction keeps overlapping bodies from sinking into each other.
const CORRECTION_PERCENT = 0.8;
const CORRECTION_SLOP = 0.001;
const SOLVER_ITERATIONS = 2;

export default class World {
    constructor({ gravity = { x: 0, y: 0 }, bounds = null, linearDamping = 0 } = {}) {
        this.bodies = [];
        this.gravity = gravity;
        this.bounds = bounds; // { minX, maxX, minY, maxY } or null
        this.linearDamping = linearDamping;
    }

    add(body) {
        this.bodies.push(body);
        return body;
    }

    remove(body) {
        const i = this.bodies.indexOf(body);
        if (i !== -1) this.bodies.splice(i, 1);
        return this;
    }

    // Whether two bodies are allowed to collide, per group/category/mask rules.
    static shouldCollide(a, b) {
        if (a.type === STATIC && b.type === STATIC) return false;
        if (a.groupIndex !== 0 && a.groupIndex === b.groupIndex) {
            return a.groupIndex > 0;
        }
        return (a.mask & b.category) !== 0 && (b.mask & a.category) !== 0;
    }

    step(dt) {
        if (dt <= 0) return;
        this.integrate(dt);

        for (let iter = 0; iter < SOLVER_ITERATIONS; iter++) {
            for (let i = 0; i < this.bodies.length; i++) {
                for (let j = i + 1; j < this.bodies.length; j++) {
                    const a = this.bodies[i];
                    const b = this.bodies[j];
                    if (!World.shouldCollide(a, b)) continue;

                    const manifold = collide(a, b);
                    if (manifold && manifold.penetration > 0) {
                        this.resolve(a, b, manifold);
                    }
                }
            }
        }

        if (this.bounds) this.applyBounds();
    }

    integrate(dt) {
        const damp = Math.max(0, 1 - this.linearDamping * dt);
        for (const body of this.bodies) {
            if (!body.isDynamic) continue;
            body.velocity.x += this.gravity.x * dt;
            body.velocity.y += this.gravity.y * dt;
            body.velocity.x *= damp;
            body.velocity.y *= damp;
            body.shape.position.x += body.velocity.x * dt;
            body.shape.position.y += body.velocity.y * dt;
        }
    }

    resolve(a, b, { normal, penetration }) {
        const invSum = a.invMass + b.invMass;
        if (invSum === 0) return;

        // Positional correction so bodies stop overlapping.
        const correction = (Math.max(penetration - CORRECTION_SLOP, 0) / invSum) * CORRECTION_PERCENT;
        a.shape.position.x -= normal.x * correction * a.invMass;
        a.shape.position.y -= normal.y * correction * a.invMass;
        b.shape.position.x += normal.x * correction * b.invMass;
        b.shape.position.y += normal.y * correction * b.invMass;

        // Impulse along the normal (relative velocity is B - A).
        const rvx = b.velocity.x - a.velocity.x;
        const rvy = b.velocity.y - a.velocity.y;
        const velAlongNormal = rvx * normal.x + rvy * normal.y;
        if (velAlongNormal > 0) return; // already separating

        const e = Math.min(a.restitution, b.restitution);
        const jImpulse = (-(1 + e) * velAlongNormal) / invSum;
        const ix = jImpulse * normal.x;
        const iy = jImpulse * normal.y;

        a.velocity.x -= ix * a.invMass;
        a.velocity.y -= iy * a.invMass;
        b.velocity.x += ix * b.invMass;
        b.velocity.y += iy * b.invMass;
    }

    applyBounds() {
        const { minX, maxX, minY, maxY } = this.bounds;
        for (const body of this.bodies) {
            if (!body.isDynamic) continue;
            const r = boundingRadius(body.shape);
            const pos = body.shape.position;

            if (pos.x - r < minX) {
                pos.x = minX + r;
                if (body.velocity.x < 0) body.velocity.x = -body.velocity.x * body.restitution;
            } else if (pos.x + r > maxX) {
                pos.x = maxX - r;
                if (body.velocity.x > 0) body.velocity.x = -body.velocity.x * body.restitution;
            }

            if (pos.y - r < minY) {
                pos.y = minY + r;
                if (body.velocity.y < 0) body.velocity.y = -body.velocity.y * body.restitution;
            } else if (pos.y + r > maxY) {
                pos.y = maxY - r;
                if (body.velocity.y > 0) body.velocity.y = -body.velocity.y * body.restitution;
            }
        }
    }
}
