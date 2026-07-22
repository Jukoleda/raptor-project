// A physics body attached to a shape. The shape remains the source of truth for
// the transform (position/rotation/scale); the body adds the dynamics on top:
// type, velocity, mass and collision filtering.
//
// Body types:
//   - "static":  never moves, infinite mass. Walls, ground.
//   - "dynamic": integrated every step and pushed by collisions (rigid body).
//
// Collision filtering (see World.shouldCollide):
//   - groupIndex: bodies sharing the same non-zero group always collide (>0) or
//     never collide (<0), overriding category/mask. 0 means "use category/mask".
//   - category/mask: bitmasks; A and B collide only if
//     (A.mask & B.category) && (B.mask & A.category).

export const STATIC = "static";
export const DYNAMIC = "dynamic";

export default class Body {
    constructor(shape, {
        type = DYNAMIC,
        mass = 1,
        restitution = 0.4,
        velocity = { x: 0, y: 0 },
        groupIndex = 0,
        category = 0x0001,
        mask = 0xffff,
    } = {}) {
        this.shape = shape;
        this.type = type;
        this.velocity = { x: velocity.x, y: velocity.y };
        this.restitution = restitution;
        this.groupIndex = groupIndex;
        this.category = category;
        this.mask = mask;
        this._mass = mass;
        this._recomputeMass();
    }

    get isDynamic() {
        return this.type === DYNAMIC;
    }

    // Convenience access to the shape transform.
    get position() {
        return this.shape.position;
    }

    _recomputeMass() {
        this.invMass = this.type === DYNAMIC && this._mass > 0 ? 1 / this._mass : 0;
    }

    setType(type) {
        this.type = type;
        if (type === STATIC) {
            this.velocity.x = 0;
            this.velocity.y = 0;
        }
        this._recomputeMass();
        return this;
    }

    setMass(mass) {
        this._mass = mass;
        this._recomputeMass();
        return this;
    }

    setVelocity(x, y) {
        this.velocity.x = x;
        this.velocity.y = y;
        return this;
    }
}
