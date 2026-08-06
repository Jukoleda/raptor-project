// A gearbox for the drivetrain: what turns a flat "hold W to accelerate" into
// something that feels mechanical.
//
// Each forward gear reaches a fraction of the vehicle's top speed (`ratios`).
// Short gears pull hard but run out of revs early; the top gear barely pulls but
// is the only way to reach full speed. Engine revs (`rpm`, normalised 0..1) come
// from how far into the current gear's speed band you are, and a torque curve
// makes the engine bog down under load and taper off near the redline. Changing
// gear cuts the drive for `shiftTime`, which is what you actually feel.
//
// Two modes:
//   AUTO    shifts by itself on revs (with hysteresis so it does not hunt), and
//           picks reverse when you ask to back up from a standstill.
//   MANUAL  you pick the gear: R · N · 1 · 2 · … Leave it in too high a gear and
//           it bogs; hold it too long and you bounce off the limiter.
//
// It knows nothing about input — a TankController feeds it the current speed and
// throttle, and reads back `torque` and `speedLimit`.
//
// Given real gear ratios and an Engine it switches to a *mechanical* mode: revs
// come from road speed through the drivetrain (`engineRpm`), and `wheelTorque` /
// `wheelForce` say what actually reaches the ground, so a caller can integrate
// real vehicle physics. Without them it keeps the light normalised model above.

export const GEARBOX_MODE = { AUTO: "auto", MANUAL: "manual" };

// Revs below this count as "about to stall", above as "into the limiter".
const TORQUE_PEAK = 0.65;   // revs where the engine pulls hardest
const TORQUE_SPREAD = 1.7;  // how quickly torque falls away from the peak
const TORQUE_FLOOR = 0.45;  // never less than this fraction of the gear's pull
const STOPPED = 0.15;       // speed under which the vehicle counts as stopped
// Inverse of the engine module's rad/s conversion, named apart from it: both
// become globals in the standalone build and a clash there is fatal.
const RPM_PER_RAD = 60 / (2 * Math.PI);

export default class Gearbox {
    constructor({
        ratios = [0.3, 0.52, 0.75, 1.0], // fraction of top speed per forward gear
        reverseRatio = 0.4,
        maxSpeed = 3,          // vehicle top speed; the controller keeps this in sync
        shiftTime = 0.25,      // seconds of cut drive while changing gear
        upshiftAt = 0.88,      // revs that trigger an automatic upshift
        downshiftAt = 0.35,    // revs that trigger an automatic downshift
        mode = GEARBOX_MODE.AUTO,

        // --- Mechanical mode (optional) -------------------------------------
        // Give it real gear ratios and an Engine and it stops guessing: revs
        // come from road speed through the drivetrain, and `wheelTorque` is what
        // actually reaches the ground. `ratios` above is then unused.
        engine = null,
        gearRatios = null,     // e.g. [3.6, 2.1, 1.4, 1.0, 0.8]
        reverseGearRatio = 3.2,
        finalDrive = 3.9,
        wheelRadius = 0.34,    // metres
    } = {}) {
        this.ratios = ratios;
        this.reverseRatio = reverseRatio;
        this.maxSpeed = maxSpeed;
        this.engine = engine;
        this.gearRatios = gearRatios;
        this.reverseGearRatio = reverseGearRatio;
        this.finalDrive = finalDrive;
        this.wheelRadius = wheelRadius;
        this.shiftTime = shiftTime;
        this.upshiftAt = upshiftAt;
        this.downshiftAt = downshiftAt;
        this.mode = mode;

        this.gear = 1;      // -1 reverse · 0 neutral · 1..N forward
        this.speed = 0;     // last speed the controller reported
        this._shiftFor = 0; // seconds left of the current gear change
        this.shifts = 0;    // how many changes so far (handy for HUDs/tests)
    }

    // True when it is driven by a real engine and real ratios.
    get mechanical() {
        return !!(this.engine && this.gearRatios);
    }

    // Selectable gears in order, so manual shifting can walk the list.
    get sequence() {
        return [-1, 0, ...Array.from({ length: this.topGear }, (_, i) => i + 1)];
    }

    get topGear() {
        return (this.mechanical ? this.gearRatios : this.ratios).length;
    }

    // Gear ratio actually turning the driveshaft (mechanical mode only).
    get gearRatio() {
        if (!this.mechanical || this.gear === 0) return 0;
        return this.gear === -1 ? this.reverseGearRatio : this.gearRatios[this.gear - 1];
    }

    // Total reduction from crank to wheel.
    get driveRatio() {
        return this.gearRatio * this.finalDrive;
    }

    // Engine revs for the current road speed and gear. Idles when the clutch is
    // out (neutral or mid-shift) or when the wheels are barely turning.
    get engineRpm() {
        if (!this.mechanical) return 0;
        const { idleRpm, redlineRpm } = this.engine;
        if (this.gear === 0) return idleRpm;
        const wheelRadPerSec = Math.abs(this.speed) / this.wheelRadius;
        const rpm = wheelRadPerSec * Math.abs(this.driveRatio) * RPM_PER_RAD;
        return Math.max(idleRpm, Math.min(redlineRpm, rpm));
    }

    // Torque reaching the wheels, in N·m. Zero with the drive cut.
    get wheelTorque() {
        if (!this.mechanical || this.shifting || this.gear === 0) return 0;
        return this.engine.torqueAt(this.engineRpm) * Math.abs(this.driveRatio);
    }

    // Tractive force at the contact patch, in newtons.
    get wheelForce() {
        return this.wheelTorque / this.wheelRadius;
    }

    // What the engine is making right now, for a readout.
    get power() {
        return this.mechanical ? this.engine.powerAt(this.engineRpm) : 0;
    }

    // Road speed the current gear tops out at (redline in that gear).
    get gearTopSpeed() {
        if (!this.mechanical || this.gear === 0) return Infinity;
        return (this.engine.redlineRpm / RPM_PER_RAD) * this.wheelRadius / Math.abs(this.driveRatio);
    }

    get inReverse() {
        return this.gear === -1;
    }

    get inNeutral() {
        return this.gear === 0;
    }

    // Which way the current gear drives: +1 forward, -1 reverse, 0 in neutral.
    get direction() {
        return this.gear === 0 ? 0 : Math.sign(this.gear);
    }

    // Fraction of top speed the current gear can reach.
    get ratio() {
        if (this.gear === -1) return this.reverseRatio;
        if (this.gear === 0) return 0;
        return this.ratios[this.gear - 1];
    }

    // Fastest the vehicle can go in this gear. Neutral does not drive, but it
    // must not brake either — coasting keeps whatever speed it had.
    get speedLimit() {
        if (this.mechanical) return this.gear === 0 ? Infinity : this.gearTopSpeed;
        return this.gear === 0 ? this.maxSpeed : this.maxSpeed * this.ratio;
    }

    // Revs as a 0..1 fraction of the redline — what the shift logic and the
    // tachometer both read, in either mode.
    get rpm() {
        if (this.mechanical) return this.engineRpm / this.engine.redlineRpm;
        const limit = this.maxSpeed * this.ratio;
        if (limit <= 0) return 0;
        return Math.min(1, Math.abs(this.speed) / limit);
    }

    get shifting() {
        return this._shiftFor > 0;
    }

    // Multiplier the controller applies to its acceleration. Zero while the
    // drive is cut (mid-shift or in neutral).
    get torque() {
        if (this.shifting || this.gear === 0) return 0;
        // Short gears multiply the pull; the top gear barely does.
        const gearPull = 0.5 / this.ratio;
        const off = this.rpm - TORQUE_PEAK;
        const curve = Math.max(TORQUE_FLOOR, 1 - TORQUE_SPREAD * off * off);
        return gearPull * curve;
    }

    // Readable gear for a HUD: "R", "N", "1", "2", ...
    get label() {
        if (this.gear === -1) return "R";
        if (this.gear === 0) return "N";
        return String(this.gear);
    }

    setMode(mode) {
        this.mode = mode;
        return this;
    }

    toggleMode() {
        return this.setMode(this.mode === GEARBOX_MODE.AUTO ? GEARBOX_MODE.MANUAL : GEARBOX_MODE.AUTO);
    }

    // Engages a gear, cutting the drive while the change happens.
    shiftTo(gear) {
        const target = Math.max(-1, Math.min(this.topGear, gear));
        if (target === this.gear || this.shifting) return this;
        this.gear = target;
        this._shiftFor = this.shiftTime;
        this.shifts++;
        return this;
    }

    // Manual shifting: step through R · N · 1 · 2 · …
    shiftUp() {
        const seq = this.sequence;
        const i = seq.indexOf(this.gear);
        return i < seq.length - 1 ? this.shiftTo(seq[i + 1]) : this;
    }

    shiftDown() {
        const seq = this.sequence;
        const i = seq.indexOf(this.gear);
        return i > 0 ? this.shiftTo(seq[i - 1]) : this;
    }

    // Called once per frame by the controller with the current drivetrain state.
    // `throttle` is the driver's demand in [-1, 1].
    update(dt, { speed = 0, throttle = 0 } = {}) {
        this.speed = speed;
        if (this._shiftFor > 0) {
            this._shiftFor = Math.max(0, this._shiftFor - dt);
            return this;
        }
        if (this.mode === GEARBOX_MODE.AUTO) this._autoShift(throttle);
        return this;
    }

    // Automatic logic: pick reverse/forward from a standstill, then ride the
    // revs. The gap between upshiftAt and downshiftAt stops it hunting.
    _autoShift(throttle) {
        const stopped = Math.abs(this.speed) < STOPPED;

        if (throttle < 0 && stopped && !this.inReverse) return void this.shiftTo(-1);
        if (throttle >= 0 && this.inReverse && stopped) return void this.shiftTo(1);
        if (this.inReverse || this.inNeutral) return;

        const revs = this.rpm;
        if (revs > this.upshiftAt && this.gear < this.topGear) this.shiftTo(this.gear + 1);
        else if (revs < this.downshiftAt && this.gear > 1) this.shiftTo(this.gear - 1);
    }
}
