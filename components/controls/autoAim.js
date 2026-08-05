// Auto-aim: hands the turret over to a target-picking policy.
//
// One button cycles through the policies, so the driver can go from "point at
// whatever is closest" to "finish off the wounded one" to "deal with the big
// one" without ever letting go of the wheel:
//
//   OFF → NEAREST → WEAKEST → TOUGHEST → STRONGEST → OFF …
//
//   NEAREST    the closest target — the one most likely to be shooting at you
//   WEAKEST    the least health left — finish it off
//   TOUGHEST   the most health left — chip away at the one that will last
//   STRONGEST  the biggest threat by design (durability × damage per second),
//              regardless of how hurt it currently is
//
// It only picks the target and points the gun; it never fires. Ties break by
// distance, and the current target wins an exact tie so the gun does not
// twitch between two equal candidates.

export const AIM_MODE = {
    OFF: "off",
    NEAREST: "nearest",
    WEAKEST: "weakest",
    TOUGHEST: "toughest",
    STRONGEST: "strongest",
};

// Order the button walks through.
export const AIM_CYCLE = [AIM_MODE.OFF, AIM_MODE.NEAREST, AIM_MODE.WEAKEST, AIM_MODE.TOUGHEST, AIM_MODE.STRONGEST];

export const AIM_MODE_LABEL = {
    off: "Desactivado",
    nearest: "Más cercano",
    weakest: "Menos vida",
    toughest: "Más vida",
    strongest: "Más fuerte",
};

// How each mode scores a candidate. Higher score wins; distance is passed in so
// modes can use it directly or just as a tie-breaker.
const SCORES = {
    [AIM_MODE.NEAREST]: (tank, dist) => -dist,
    [AIM_MODE.WEAKEST]: (tank) => -tank.hp,
    [AIM_MODE.TOUGHEST]: (tank) => tank.hp,
    [AIM_MODE.STRONGEST]: (tank) => tank.power,
};

export default class AutoAim {
    constructor(tank, { mode = AIM_MODE.OFF, cycle = AIM_CYCLE } = {}) {
        this.tank = tank;
        this.cycleOrder = cycle;
        this.mode = mode;
        this.target = null;
    }

    get enabled() {
        return this.mode !== AIM_MODE.OFF;
    }

    get label() {
        return AIM_MODE_LABEL[this.mode];
    }

    setMode(mode) {
        this.mode = mode;
        if (!this.enabled) this.target = null;
        return this;
    }

    // Advances to the next policy — this is what the button is wired to.
    cycle() {
        const i = this.cycleOrder.indexOf(this.mode);
        return this.setMode(this.cycleOrder[(i + 1) % this.cycleOrder.length]);
    }

    // Best candidate under the current policy, or null when off / none alive.
    pick(candidates = []) {
        const score = SCORES[this.mode];
        if (!score) return null;

        const from = this.tank.position;
        let best = null;
        let bestScore = -Infinity;
        let bestDist = Infinity;

        for (const candidate of candidates) {
            if (!candidate || !candidate.alive || candidate === this.tank) continue;
            const dist = Math.hypot(candidate.position.x - from.x, candidate.position.y - from.y);
            const value = score(candidate, dist);
            // Break ties by distance, then keep the current target so the gun
            // does not flick between two identical candidates.
            const better = value > bestScore
                || (value === bestScore && dist < bestDist)
                || (value === bestScore && dist === bestDist && candidate === this.target);
            if (better) {
                best = candidate;
                bestScore = value;
                bestDist = dist;
            }
        }
        return best;
    }

    // Picks a target and swings the turret onto it. Returns the target (or null),
    // so the caller can draw a reticle on it. Does not fire.
    update(dt, candidates = []) {
        if (!this.enabled) {
            this.target = null;
            return null;
        }
        this.target = this.pick(candidates);
        if (this.target) this.tank.aimAt(this.target.position, dt);
        return this.target;
    }
}
