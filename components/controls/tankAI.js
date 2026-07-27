// A finite state machine that drives an enemy tank.
//
// The AI never touches the engine or the weapons module: it reads the world,
// writes throttle/steering into a TankController, aims the tank's turret, and
// raises `wantsToFire` when it has a shot. Whoever owns the tank decides what
// firing actually means, which keeps this file about behaviour only.
//
//   PATROL  wander between random waypoints, gun forward
//     │  target within sight
//     ▼
//   CHASE   drive at the target, gun tracking it
//     │  target within attack range          ▲ target slips out of range
//     ▼                                      │
//   ATTACK  hold the range, aim, fire when lined up
//     │  health drops below the retreat threshold
//     ▼
//   RETREAT back away while still facing the threat, until it is far behind
//
// A tank that cannot make progress (nose against a wall) briefly reverses and
// turns — without that, a stuck tank grinds forever and the FSM looks broken.

export const AI_STATE = {
    PATROL: "patrol",
    CHASE: "chase",
    ATTACK: "attack",
    RETREAT: "retreat",
    DEAD: "dead",
};

// Readable Spanish labels, handy for HUDs.
export const AI_STATE_LABEL = {
    patrol: "Patrulla",
    chase: "Persigue",
    attack: "Ataca",
    retreat: "Se retira",
    dead: "Destruido",
};

const DEG = 180 / Math.PI;

// Shortest signed difference between two angles, in degrees, within (-180, 180].
function angleDiff(from, to) {
    return (((to - from + 180) % 360) + 360) % 360 - 180;
}

// Engine convention: local +Y is forward, so the angle whose (-sin, cos) points
// from `a` to `b`.
function angleToward(a, b) {
    return Math.atan2(-(b.x - a.x), b.y - a.y) * DEG;
}

function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

export default class TankAI {
    constructor(tank, driver, {
        bounds,                 // { minX, maxX, minY, maxY } to wander inside
        sightRange = 6.5,       // starts chasing a target this close
        attackRange = 4.5,      // stops and shoots inside this
        keepDistance = 0.55,    // backs off below attackRange * this
        retreatAt = 0.3,        // retreats under this fraction of health
        fireArc = 7,            // degrees of aim error it will still fire within
        isBlocked = null,       // optional (from, to) => bool line-of-sight test
    } = {}) {
        this.tank = tank;
        this.driver = driver;
        this.bounds = bounds;
        this.sightRange = sightRange;
        this.attackRange = attackRange;
        this.keepDistance = keepDistance;
        this.retreatAt = retreatAt;
        this.fireArc = fireArc;
        this.isBlocked = isBlocked;

        this.state = AI_STATE.PATROL;
        this.wantsToFire = false;
        this.waypoint = this._randomWaypoint();

        // Stuck detection.
        this._lastPos = { x: tank.position.x, y: tank.position.y };
        this._stuckFor = 0;
        this._unstickFor = 0;
    }

    _randomWaypoint() {
        const b = this.bounds;
        if (!b) return { x: this.tank.position.x, y: this.tank.position.y };
        return {
            x: b.minX + Math.random() * (b.maxX - b.minX),
            y: b.minY + Math.random() * (b.maxY - b.minY),
        };
    }

    // Steering that turns the hull toward `heading` (degrees). It pivots on the
    // spot when badly misaligned instead of driving a wide arc.
    _turnToward(heading, forwardWhenAligned = 1) {
        const diff = angleDiff(this.tank.rotation, heading);
        return {
            turn: Math.abs(diff) < 3 ? 0 : Math.sign(diff),
            forward: Math.abs(diff) < 55 ? forwardWhenAligned : 0,
        };
    }

    // Head for a point, nose first.
    _driveTo(point) {
        return this._turnToward(angleToward(this.tank.position, point));
    }

    // Give ground without turning your back: keep the hull facing the threat and
    // reverse. Slower than fleeing, but it stays covered — used to hold range.
    _backAwayFrom(point) {
        const diff = angleDiff(this.tank.rotation, angleToward(this.tank.position, point));
        return { turn: Math.abs(diff) < 3 ? 0 : Math.sign(diff), forward: -1 };
    }

    // Run: turn the hull away and drive forward (faster than reverse). The
    // turret is independent, so the gun can still cover the retreat.
    _fleeFrom(point) {
        return this._turnToward(angleToward(point, this.tank.position));
    }

    // True when the gun is lined up on `point` closely enough to shoot.
    _onTarget(point) {
        const desired = angleToward(this.tank.position, point);
        return Math.abs(angleDiff(this.tank.turretAngle, desired)) <= this.fireArc;
    }

    _canSee(target) {
        if (!this.isBlocked) return true;
        return !this.isBlocked(this.tank.position, target.position);
    }

    // Picks the state for this frame from distance, health and visibility.
    _transition(target, dist) {
        if (!this.tank.alive) return AI_STATE.DEAD;
        if (!target || !target.alive) return AI_STATE.PATROL;

        // Wounded tanks disengage, whatever else is going on.
        if (this.tank.hpRatio < this.retreatAt) {
            return dist > this.sightRange ? AI_STATE.PATROL : AI_STATE.RETREAT;
        }

        switch (this.state) {
            case AI_STATE.PATROL:
                return dist <= this.sightRange && this._canSee(target) ? AI_STATE.CHASE : AI_STATE.PATROL;
            case AI_STATE.CHASE:
                if (dist > this.sightRange * 1.35) return AI_STATE.PATROL;
                return dist <= this.attackRange ? AI_STATE.ATTACK : AI_STATE.CHASE;
            case AI_STATE.ATTACK:
                return dist > this.attackRange * 1.25 ? AI_STATE.CHASE : AI_STATE.ATTACK;
            case AI_STATE.RETREAT:
                // Recovered range (health cannot go back up) — resume patrolling.
                return dist > this.sightRange ? AI_STATE.PATROL : AI_STATE.RETREAT;
            default:
                return AI_STATE.PATROL;
        }
    }

    // Runs one frame of behaviour. `target` is the tank it hunts (the player).
    update(dt, target = null) {
        this.wantsToFire = false;

        if (!this.tank.alive) {
            this.state = AI_STATE.DEAD;
            this.driver.setInput({ forward: 0, turn: 0 });
            return this;
        }

        const pos = this.tank.position;
        const dist = target && target.alive ? distance(pos, target.position) : Infinity;
        this.state = this._transition(target, dist);

        // --- Nudge out of whatever it is grinding against. ---
        const moved = distance(pos, this._lastPos);
        this._lastPos = { x: pos.x, y: pos.y };
        if (this._unstickFor > 0) {
            this._unstickFor -= dt;
            this.driver.setInput({ forward: -1, turn: 1 });
            if (this.state !== AI_STATE.PATROL && target) this.tank.aimAt(target.position, dt);
            return this;
        }
        if (this.driver.input.forward !== 0 && moved < 0.004) {
            this._stuckFor += dt;
            if (this._stuckFor > 0.7) {
                this._stuckFor = 0;
                this._unstickFor = 0.6;
                this.waypoint = this._randomWaypoint();
            }
        } else {
            this._stuckFor = 0;
        }

        // --- Act on the current state. ---
        switch (this.state) {
            case AI_STATE.PATROL: {
                if (distance(pos, this.waypoint) < 0.6) this.waypoint = this._randomWaypoint();
                this.driver.setInput(this._driveTo(this.waypoint));
                // Gun rests forward while nothing is in sight.
                this.tank.turnTurretTo(this.tank.rotation, dt);
                break;
            }

            case AI_STATE.CHASE: {
                this.driver.setInput(this._driveTo(target.position));
                this.tank.aimAt(target.position, dt);
                break;
            }

            case AI_STATE.ATTACK: {
                // Hold a firing distance: give ground when the target crowds it,
                // otherwise stand still, face it and let the turret do the work.
                const tooClose = dist < this.attackRange * this.keepDistance;
                const steer = tooClose ? this._backAwayFrom(target.position) : this._driveTo(target.position);
                this.driver.setInput({ forward: tooClose ? steer.forward : 0, turn: steer.turn });
                this.tank.aimAt(target.position, dt);
                this.wantsToFire = this._onTarget(target.position) && this._canSee(target);
                break;
            }

            case AI_STATE.RETREAT: {
                // Break contact, gun still trained on the threat.
                this.driver.setInput(this._fleeFrom(target.position));
                this.tank.aimAt(target.position, dt);
                break;
            }
        }

        return this;
    }
}
