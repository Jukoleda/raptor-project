// Keyboard input as state, not as a pile of event handlers.
//
// Every demo had grown the same shape by hand: a `held` Set filled by keydown
// and drained by keyup, an `if / else if` ladder for one-shot actions, and a
// list of keys that need `preventDefault` so the arrows do not scroll the page.
// This is that, once.
//
// Two kinds of input, because games need both:
//
//   held    — "is W down right now", read every frame:  kb.isDown("w")
//   actions — "the user pressed R", fired once per press: kb.on("r", reset)
//
// Keys are normalised: single characters are lower-cased ("W" → "w"), anything
// longer is left alone ("ArrowUp", "Space"), so bindings do not care about
// shift or caps lock.

const SCROLLERS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Space"];

export function normalizeKey(key) {
    return key.length === 1 ? key.toLowerCase() : key;
}

export default class Keyboard {
    // `preventDefault` takes a list of keys to swallow, or `true` for the usual
    // page-scrolling suspects, or `false` to never interfere.
    constructor({ target = null, preventDefault = true } = {}) {
        this.held = new Set();
        this.actions = new Map();
        this.target = null;
        this._prevent = preventDefault === true ? new Set(SCROLLERS)
            : preventDefault ? new Set(preventDefault) : new Set();

        this._onDown = (e) => {
            const key = normalizeKey(e.key);
            if (this._prevent.has(key) || this._prevent.has(e.code)) e.preventDefault();
            // Ignore auto-repeat for actions: holding R should reset once, not
            // thirty times a second. The held set does not care either way.
            const first = !this.held.has(key);
            this.held.add(key);
            if (first) this._fire(key, e);
        };
        this._onUp = (e) => {
            this.held.delete(normalizeKey(e.key));
        };
        // A tab-out never delivers the keyup, which would leave the key stuck
        // down. Dropping everything on blur is the standard cure.
        this._onBlur = () => this.held.clear();

        if (target) this.attach(target);
    }

    attach(target = window) {
        if (this.target) this.detach();
        this.target = target;
        target.addEventListener("keydown", this._onDown);
        target.addEventListener("keyup", this._onUp);
        (target.defaultView || target).addEventListener?.("blur", this._onBlur);
        return this;
    }

    detach() {
        if (!this.target) return this;
        this.target.removeEventListener("keydown", this._onDown);
        this.target.removeEventListener("keyup", this._onUp);
        (this.target.defaultView || this.target).removeEventListener?.("blur", this._onBlur);
        this.target = null;
        return this;
    }

    // Binds a one-shot action. Several keys can share a handler:
    //
    //     kb.on(["r", "Backspace"], reset);
    on(keys, handler) {
        for (const key of [].concat(keys)) {
            const list = this.actions.get(normalizeKey(key)) || [];
            list.push(handler);
            this.actions.set(normalizeKey(key), list);
        }
        return this;
    }

    off(key, handler = null) {
        const k = normalizeKey(key);
        if (!handler) this.actions.delete(k);
        else this.actions.set(k, (this.actions.get(k) || []).filter((h) => h !== handler));
        return this;
    }

    _fire(key, event) {
        for (const handler of this.actions.get(key) || []) handler(event);
    }

    // True while any of the given keys is down — so "w or up arrow" is one call.
    isDown(...keys) {
        for (const key of keys.flat()) if (this.held.has(normalizeKey(key))) return true;
        return false;
    }

    // −1, 0 or +1 from a pair of opposed key groups. This is what turns keys
    // into something a physics step can use:
    //
    //     const steer = kb.axis(["a", "ArrowLeft"], ["d", "ArrowRight"]);
    axis(negative, positive) {
        return (this.isDown(positive) ? 1 : 0) - (this.isDown(negative) ? 1 : 0);
    }

    // Lets code inject a virtual key press — the on-screen pad uses this so
    // touch and keyboard feed exactly the same state instead of racing.
    press(key) {
        const k = normalizeKey(key);
        if (!this.held.has(k)) { this.held.add(k); this._fire(k, null); }
        return this;
    }

    release(key) {
        this.held.delete(normalizeKey(key));
        return this;
    }

    clear() {
        this.held.clear();
        return this;
    }
}
