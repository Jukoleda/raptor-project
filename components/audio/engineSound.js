// Engine note, synthesised from revs. No audio files: the pages are
// self-contained and open from file://, so everything is built with Web Audio.
//
// An engine's pitch is its *firing frequency* — how often a cylinder fires:
//
//   f = rpm / 60 · cilindros / 2        (four-stroke: one bang every two turns)
//
// For a four-cylinder that is rpm/30, so 800 rpm ≈ 27 Hz and 6800 rpm ≈ 227 Hz.
// Those fundamentals are too low for a phone speaker on their own, which is why
// the note is stacked from several sawtooth partials — the harmonics are what
// you actually hear. A touch of filtered noise adds the intake/exhaust rasp, and
// a lowpass that opens with load is what makes the difference between a distant
// hum and something under full throttle.
//
// Browsers refuse to start audio without a user gesture, so `start()` has to be
// called from a click or a tap. Everything degrades to a no-op if Web Audio is
// missing, so callers never need to guard.

const PARTIALS = [
    { mul: 1, gain: 0.55, type: "sawtooth" },
    { mul: 2, gain: 0.32, type: "sawtooth", detune: 6 },
    { mul: 3, gain: 0.18, type: "sawtooth", detune: -8 },
    { mul: 0.5, gain: 0.30, type: "square" }, // the rumble underneath
];

const SMOOTH = 0.05; // seconds — how fast parameters chase their target

export default class EngineSound {
    constructor({ cylinders = 4, strokes = 4, volume = 0.5 } = {}) {
        this.cylinders = cylinders;
        this.strokes = strokes;
        this.volume = volume;
        this.muted = false;
        this.ctx = null;
        this.nodes = null;
    }

    get running() {
        return !!this.ctx && this.ctx.state === "running";
    }

    // Firing frequency for a given engine speed, in Hz.
    firingHz(rpm) {
        return (rpm / 60) * (this.cylinders / (this.strokes / 2));
    }

    // Must be called from a user gesture. Safe to call again: it just resumes.
    start() {
        const AudioCtx = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
        if (!AudioCtx) return false;
        if (!this.ctx) {
            try { this.ctx = new AudioCtx(); } catch { return false; }
            this._build();
        }
        if (this.ctx.state === "suspended") this.ctx.resume();
        return true;
    }

    _build() {
        const ctx = this.ctx;

        const master = ctx.createGain();
        master.gain.value = 0;
        master.connect(ctx.destination);

        // One lowpass for the lot: opening it with load is most of the "effort".
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 500;
        filter.Q.value = 0.9;
        filter.connect(master);

        const oscillators = PARTIALS.map((p) => {
            const osc = ctx.createOscillator();
            osc.type = p.type;
            osc.frequency.value = 40;
            if (p.detune) osc.detune.value = p.detune;
            const gain = ctx.createGain();
            gain.gain.value = p.gain;
            osc.connect(gain).connect(filter);
            osc.start();
            return { osc, gain, mul: p.mul };
        });

        // Two seconds of white noise on a loop, band-passed into a rasp.
        const frames = ctx.sampleRate * 2;
        const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        noise.loop = true;
        const noiseBand = ctx.createBiquadFilter();
        noiseBand.type = "bandpass";
        noiseBand.frequency.value = 900;
        noiseBand.Q.value = 0.7;
        const noiseGain = ctx.createGain();
        noiseGain.gain.value = 0;
        noise.connect(noiseBand).connect(noiseGain).connect(filter);
        noise.start();

        this.nodes = { master, filter, oscillators, noiseGain };
    }

    // Feed it the drivetrain each frame. `load` is 0..1 (throttle); `cut` mutes
    // the drive for a moment, which is what a gearshift sounds like.
    update({ rpm = 0, redlineRpm = 7000, load = 0, cut = false } = {}) {
        if (!this.nodes || !this.ctx) return;
        const { master, filter, oscillators, noiseGain } = this.nodes;
        const now = this.ctx.currentTime;
        const revs = Math.max(0, Math.min(1, rpm / redlineRpm));
        const base = Math.max(12, this.firingHz(rpm));

        for (const { osc, mul } of oscillators) {
            osc.frequency.setTargetAtTime(base * mul, now, SMOOTH);
        }

        // Louder with revs and throttle; a shift drops it out entirely.
        const level = this.muted || cut ? 0 : this.volume * (0.09 + 0.16 * load + 0.1 * revs);
        master.gain.setTargetAtTime(level, now, SMOOTH);

        // The filter opening under load is what sells the effort.
        filter.frequency.setTargetAtTime(320 + 2600 * revs * (0.45 + 0.55 * load), now, SMOOTH);
        noiseGain.gain.setTargetAtTime(this.muted || cut ? 0 : 0.05 + 0.12 * load * revs, now, SMOOTH);
    }

    // Muting takes effect at once; unmuting is left to the next `update()`,
    // which is the only thing that knows what the level should be.
    setMuted(muted) {
        this.muted = muted;
        if (muted && this.nodes && this.ctx) {
            this.nodes.master.gain.setTargetAtTime(0, this.ctx.currentTime, SMOOTH);
            this.nodes.noiseGain.gain.setTargetAtTime(0, this.ctx.currentTime, SMOOTH);
        }
        return this;
    }

    toggleMuted() {
        return this.setMuted(!this.muted);
    }

    stop() {
        if (!this.ctx) return;
        this.ctx.close();
        this.ctx = null;
        this.nodes = null;
    }
}
