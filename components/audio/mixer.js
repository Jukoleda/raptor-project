// The thing that actually plays a sound.
//
// `Assets` already loads a WAV and decodes it into an AudioBuffer. Turning that
// buffer into something you can hear was, until this file existed, twelve lines
// of Web Audio that every game had to write for itself — and two of them did,
// identically, in `game/forestScene.js` and `assets/assetsDemo.js`:
//
//     const context = assets.audioContext;
//     if (context.state === "suspended") context.resume();
//     const source = context.createBufferSource();
//     source.buffer = assets.sound(key);
//     const gain = context.createGain();
//     gain.gain.value = 0.45;
//     source.connect(gain).connect(context.destination);
//     source.start();
//
// Neither copy could turn the volume down, mute, stop a sound once started, or
// stop making new ones when a hundred were already going. That is the whole
// reason this is a layer and not a snippet:
//
//     app.audio.play(app.assets.sound("moneda"));
//     app.audio.play(buffer, { volume: 0.3, rate: 1.4 });
//     const loop = app.audio.play(ambience, { loop: true });
//     loop.stop(0.5);          // se desvanece en medio segundo
//     app.audio.setVolume(0.2);
//     app.audio.setMuted(true);
//
// It also owns *the* audio context. Before this, `Assets` made one to decode
// into and `EngineSound` made another to synthesise into, so a page could end up
// with two — and a master volume that reached neither. Both now take a mixer.
//
// Two rules the browser imposes, and this file absorbs so callers do not have to:
//
//   - An AudioContext created before a user gesture starts suspended and Chrome
//     complains, so the context here is created on first use, not in the
//     constructor. Building a Mixer costs nothing.
//   - Playing needs a gesture; decoding does not. `play()` resumes the context
//     itself, so the first click that plays something also unblocks it.
//
// Without Web Audio every method is a no-op and `play` returns null, which means
// a caller never has to guard — the same contract `EngineSound` already had.

const RAMP = 0.02;       // seconds — smoothing a gain change so it does not click

function audioContextClass() {
    return typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
}

export default class Mixer {
    constructor({ volume = 1, maxVoices = 24, context = null } = {}) {
        this._volume = volume;
        this._muted = false;
        this.maxVoices = maxVoices;

        this._context = context;
        this._master = null;
        // True once `context.resume()` has actually *landed*. Not the same as
        // `context.state === "running"`: the state flips before the audio thread
        // is producing, and automation scheduled inside that window is simply
        // lost. Anything that has to survive that gap is set outright instead.
        this._started = false;
        // Insertion order is age order, which is what the voice cap needs.
        this._voices = new Set();
    }

    get available() {
        return !!audioContextClass() || !!this._context;
    }

    // Created on first use. Reading this property is what starts the audio
    // hardware, so nothing does it during page construction.
    get context() {
        if (!this._context) {
            const AudioCtx = audioContextClass();
            if (!AudioCtx) return null;
            try {
                this._context = new AudioCtx();
            } catch {
                return null;   // some browsers refuse outright (autoplay policy)
            }
        }
        return this._context;
    }

    // The node everything goes through: connect a synthesiser here and it obeys
    // the master volume and the mute like any played buffer. `EngineSound` does.
    get input() {
        const context = this.context;
        if (!context) return null;
        if (!this._master) {
            this._master = context.createGain();
            this._master.gain.value = this._muted ? 0 : this._volume;
            this._master.connect(context.destination);
        }
        return this._master;
    }

    get volume() { return this._volume; }
    set volume(value) { this.setVolume(value); }

    setVolume(value) {
        this._volume = Math.max(0, Math.min(1, value));
        this._applyGain();
        return this;
    }

    get muted() { return this._muted; }

    setMuted(muted = true) {
        this._muted = !!muted;
        this._applyGain();
        return this;
    }

    toggleMuted() {
        return this.setMuted(!this._muted);
    }

    // Ramped rather than set: a gain that jumps discontinuously is an audible
    // click, and muting is exactly the case where you would hear it.
    //
    // Only once the context is genuinely running, though. Before that a ramp is
    // both pointless and unreliable: pointless because nothing is audible yet,
    // so there is no click to avoid, and unreliable because automation
    // scheduled while the audio thread is still starting never arrives — the
    // volume then silently stays where it was, which is exactly what a game
    // setting its volume at startup would hit. `resume()` re-applies this when
    // it lands, so a volume chosen before the first click still takes effect.
    _applyGain() {
        if (!this._master) return;
        const target = this._muted ? 0 : this._volume;
        const context = this._context;
        const param = this._master.gain;
        param.cancelScheduledValues(context.currentTime);
        if (this._started && context.state === "running") {
            // Anchored at where the gain actually is: after a cancel the ramp's
            // start value is otherwise whatever the last scheduled event said,
            // which is not necessarily what you can hear.
            param.setValueAtTime(param.value, context.currentTime);
            param.linearRampToValueAtTime(target, context.currentTime + RAMP);
        } else {
            param.value = target;
        }
    }

    // Playing needs a user gesture. `play` calls this itself, so you only need
    // it directly to unblock the context ahead of time (on the menu button, say,
    // so the first real sound is not late).
    //
    // Returns a promise for when the context is actually producing — which is
    // later than `state` flipping to "running", and the difference is a real
    // race, not a nicety. Awaiting it is optional; `play` does not.
    resume() {
        const context = this.context;
        if (!context) return Promise.resolve(false);
        if (this._started) return Promise.resolve(true);
        if (context.state !== "suspended") {
            this._started = true;
            this._applyGain();
            return Promise.resolve(true);
        }
        return Promise.resolve(context.resume()).then(
            () => {
                this._started = true;
                // Whatever volume was chosen while the context was asleep was
                // set outright rather than ramped; re-apply it now that
                // automation works, so the two paths cannot disagree.
                this._applyGain();
                return true;
            },
            () => false,
        );
    }

    // Fires a buffer and returns a handle, or null when there is nothing to play
    // (no Web Audio, no buffer). The handle is only needed to stop something
    // early; a one-shot can be ignored entirely.
    play(buffer, { volume = 1, rate = 1, loop = false, delay = 0 } = {}) {
        if (!buffer) return null;
        const context = this.context;
        if (!context) return null;
        this.resume();

        // A rapid-fire gun can ask for a new voice every frame. Without a cap
        // they pile up until the mix is mud and the tab is busy; the oldest is
        // the one you are least likely to still be listening to.
        if (this._voices.size >= this.maxVoices) {
            const oldest = this._voices.values().next().value;
            if (oldest) oldest.stop();
        }

        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = loop;
        source.playbackRate.value = rate;

        const gain = context.createGain();
        gain.gain.value = Math.max(0, volume);
        source.connect(gain).connect(this.input);

        const voice = {
            source,
            gain,
            get playing() { return this._playing; },
            _playing: true,
            // A fade is what keeps stopping a looping sound from clicking.
            stop: (fade = 0) => {
                if (!voice._playing) return voice;
                voice._playing = false;
                // Dropped from the roster here and not only in `onended`, which
                // fires a turn later: a loop that fires forty shots in one frame
                // would blow straight past the cap while every `onended` was
                // still queued. A voice fading out is on its way regardless, so
                // it stops counting against the cap the moment it is told to go.
                this._voices.delete(voice);
                const now = context.currentTime;
                if (fade > 0) {
                    gain.gain.cancelScheduledValues(now);
                    gain.gain.setValueAtTime(gain.gain.value, now);
                    gain.gain.linearRampToValueAtTime(0, now + fade);
                    try { source.stop(now + fade); } catch { /* already stopped */ }
                } else {
                    try { source.stop(); } catch { /* already stopped */ }
                }
                return voice;
            },
        };

        source.onended = () => {
            voice._playing = false;
            this._voices.delete(voice);
            try { gain.disconnect(); } catch { /* already gone */ }
        };

        this._voices.add(voice);
        source.start(delay > 0 ? context.currentTime + delay : 0);
        return voice;
    }

    get playing() {
        return this._voices.size;
    }

    // Silence everything at once — what a scene wants when it unmounts.
    stopAll(fade = 0) {
        for (const voice of [...this._voices]) voice.stop(fade);
        return this;
    }

    // Releases the hardware. Mostly for tests and for a page that tears an app
    // down; a normal game never needs it.
    dispose() {
        this.stopAll();
        this._voices.clear();
        this._master = null;
        this._started = false;
        const context = this._context;
        this._context = null;
        if (context && typeof context.close === "function" && context.state !== "closed") {
            try { context.close(); } catch { /* already closing */ }
        }
        return this;
    }
}
