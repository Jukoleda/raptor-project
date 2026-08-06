// On-screen controls overlaid on the canvas, so a demo is playable on a phone.
//
// Two kinds of button, and the difference matters:
//
//   pedal — held down. Presses on pointerdown, releases on up/cancel/leave, and
//           grabs the pointer so sliding a finger off the button still counts
//           as released rather than sticking forever.
//   tap   — fires once on pointerdown. Deliberately not `click`: on touch that
//           waits ~300 ms, which feels broken on a fire button.
//
// A pedal writes into a `Keyboard`, so touch and keys land in the same held
// set and neither can fight the other — that bug (finger says go, key says
// stop) is exactly what this avoids.

import { el } from "../ui/dom.js";

export const PAD_STYLES = `
    .pad { position: absolute; display: flex; gap: 10px; align-items: flex-end; }
    .pad.left { left: 14px; bottom: 14px; }
    .pad.right { right: 14px; bottom: 14px; }
    .pad.top-left { left: 12px; top: 12px; align-items: flex-start; }
    .pad.top-right { right: 12px; top: 12px; align-items: flex-start; }
    .pad .col { display: flex; flex-direction: column; gap: 10px; }
    .tbtn {
        min-width: 62px; height: 62px; padding: 0 12px; border-radius: 12px;
        display: flex; align-items: center; justify-content: center;
        font-size: 20px; line-height: 1; color: #e6e6e6;
        background: rgba(38, 43, 51, .6); border: 1px solid rgba(255, 255, 255, .26);
        -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
        touch-action: none; user-select: none; -webkit-user-select: none;
        -webkit-tap-highlight-color: transparent; cursor: pointer;
    }
    .tbtn.round { width: 60px; min-width: 0; padding: 0; border-radius: 50%; font-size: 22px; }
    .tbtn.small { min-width: 52px; height: 52px; font-size: 17px; border-radius: 10px; }
    .tbtn.label { font-size: 13px; font-weight: 700; letter-spacing: .04em; }
    .tbtn.on, .tbtn.round:active { background: rgba(74, 127, 181, .8); border-color: #7fb2e6; }
    .tbtn.off { opacity: .35; }

    @media (max-width: 720px) {
        .pad { gap: 8px; }
        .pad.left { left: 10px; bottom: 10px; }
        .pad.right { right: 10px; bottom: 10px; }
        .pad .col { gap: 8px; }
        .tbtn { min-width: 66px; height: 56px; font-size: 19px; padding: 0 8px; }
        .tbtn.round { width: 64px; min-width: 0; height: 64px; padding: 0; }
        .tbtn.small { min-width: 44px; height: 40px; font-size: 16px; }
    }
`;

export default class TouchPad {
    // `mount` is the positioned element the pads sit on (the #stage wrapper).
    // `keyboard` is optional: without one, pedals still report through `held`.
    constructor(mount, { keyboard = null } = {}) {
        this.mount = mount;
        this.keyboard = keyboard;
        this.held = keyboard ? keyboard.held : new Set();
        this.buttons = new Map();
    }

    // Creates a button element. `name` is how you look it up later.
    button(name, label, className = "") {
        const node = el("div", { className: `tbtn ${className}`.trim(), textContent: label });
        this.buttons.set(name, node);
        return node;
    }

    get(name) {
        return this.buttons.get(name);
    }

    // Places children into a pad anchored to a corner: "left", "right",
    // "top-left" or "top-right". Nested arrays become vertical columns.
    pad(where, children) {
        const nodes = children.map((child) =>
            Array.isArray(child) ? el("div", { className: "col" }, child) : child);
        const node = el("div", { className: `pad ${where}` }, nodes);
        this.mount.append(node);
        return node;
    }

    // Held button. `key` is what lands in the keyboard's held set; the button
    // gets the `on` class while pressed so it lights up.
    pedal(node, key, { onChange = null } = {}) {
        const set = (down) => {
            if (down) this.held.add(key); else this.held.delete(key);
            node.classList.toggle("on", down);
            if (onChange) onChange(down);
        };
        node.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            // Capture so a finger sliding off the button still releases it.
            if (node.setPointerCapture && e.pointerId != null) {
                try { node.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
            }
            set(true);
        });
        for (const ev of ["pointerup", "pointercancel", "pointerleave"]) {
            node.addEventListener(ev, () => set(false));
        }
        return node;
    }

    // One-shot button. Fires on pointerdown, not click — touch delays click.
    tap(node, handler) {
        node.addEventListener("pointerdown", (e) => { e.preventDefault(); handler(e); });
        return node;
    }

    // Reflects state back onto a button: lit, or dimmed when unavailable.
    setActive(name, active) {
        this.get(name)?.classList.toggle("on", !!active);
        return this;
    }

    setEnabled(name, enabled) {
        this.get(name)?.classList.toggle("off", !enabled);
        return this;
    }

    setLabel(name, label) {
        const node = this.get(name);
        if (node) node.textContent = label;
        return this;
    }
}
