// A combustion engine: revs in, torque out, power derived.
//
// Torque is not flat — it climbs off idle, peaks somewhere in the mid range and
// falls away toward the redline. That shape is the whole reason gears exist, so
// the curve here is the thing worth getting right:
//
//   torque(rpm) = peakTorque · (1 − k · offset²)
//
// with a different k below and above the peak, chosen so the curve passes
// exactly through the idle and redline values you specify. Smooth, monotonic on
// each side, and tunable with numbers a person can reason about.
//
// Power is not an independent setting — it *falls out* of torque and revs:
//
//   P [W] = T [N·m] · ω [rad/s],   ω = rpm · 2π / 60
//
// which is why peak power always sits at higher revs than peak torque: torque is
// sagging, but ω is climbing faster. `peakPower` finds that point by sampling.

const RPM_TO_RAD = (2 * Math.PI) / 60;
const W_PER_HP = 735.5; // metric horsepower (CV)

export default class Engine {
    constructor({
        idleRpm = 800,
        redlineRpm = 6800,
        peakTorque = 340,        // N·m
        peakTorqueRpm = 3400,
        torqueAtIdle = 0.55,     // fraction of peak torque down at idle
        torqueAtRedline = 0.74,  // ... and up at the limiter
    } = {}) {
        this.idleRpm = idleRpm;
        this.redlineRpm = redlineRpm;
        this.peakTorque = peakTorque;
        this.peakTorqueRpm = peakTorqueRpm;
        this.torqueAtIdle = torqueAtIdle;
        this.torqueAtRedline = torqueAtRedline;
    }

    // Torque in N·m at the crank.
    torqueAt(rpm) {
        const r = Math.max(0, Math.min(this.redlineRpm, rpm));
        if (r <= this.peakTorqueRpm) {
            const span = this.peakTorqueRpm - this.idleRpm || 1;
            const off = Math.max(0, (this.peakTorqueRpm - r) / span); // 1 at idle, 0 at peak
            return this.peakTorque * (1 - (1 - this.torqueAtIdle) * off * off);
        }
        const span = this.redlineRpm - this.peakTorqueRpm || 1;
        const off = (r - this.peakTorqueRpm) / span;                   // 0 at peak, 1 at redline
        return this.peakTorque * (1 - (1 - this.torqueAtRedline) * off * off);
    }

    // Power in watts — torque times angular velocity, nothing more.
    powerAt(rpm) {
        return this.torqueAt(rpm) * rpm * RPM_TO_RAD;
    }

    powerHpAt(rpm) {
        return this.powerAt(rpm) / W_PER_HP;
    }

    // Where the engine makes the most power, found by sampling the curve.
    get peakPower() {
        if (this._peak) return this._peak;
        let best = { rpm: this.idleRpm, watts: 0 };
        for (let rpm = this.idleRpm; rpm <= this.redlineRpm; rpm += 10) {
            const watts = this.powerAt(rpm);
            if (watts > best.watts) best = { rpm, watts };
        }
        this._peak = { rpm: best.rpm, watts: best.watts, hp: best.watts / W_PER_HP };
        return this._peak;
    }
}
