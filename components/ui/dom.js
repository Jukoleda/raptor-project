// The little DOM layer every demo was rewriting.
//
// Raptor draws the world in WebGL, but a panel, a slider and a readout row are
// still plain HTML — and four demos had each grown their own byte-identical
// copy of `el()`. That is the sort of duplication a framework exists to delete,
// so it lives here now.
//
// Nothing here knows about WebGL: this is deliberately usable on its own.

// Creates an element, assigns properties (not attributes — `className` and
// `textContent` work, and so do `onclick` handlers) and appends children.
//
//     el("div", { className: "card" }, [el("h2", { textContent: "Motor" })])
export function el(tag, props = {}, children = []) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children) node.append(child);
    return node;
}

// Appends a <style> to the head. Pass an `id` and it replaces its own previous
// copy instead of stacking, so calling a scene's setup twice is harmless.
export function injectStyles(css, id = null) {
    if (id) {
        const previous = document.getElementById(id);
        if (previous) previous.remove();
    }
    const node = el("style", { textContent: css });
    if (id) node.id = id;
    document.head.append(node);
    return node;
}

// A label/value row for a readout panel. `.v` is the element to write into:
//
//     const rpm = kv("Vueltas");
//     panel.append(rpm.row);
//     rpm.set(`${Math.round(engineRpm)} rpm`);
export function kv(label, initial = "—") {
    const v = el("span", { className: "v", textContent: initial });
    const row = el("div", { className: "kv" }, [el("span", { className: "k", textContent: label }), v]);
    return { row, v, set: (text) => { v.textContent = text; } };
}

// A labelled range input. `format` controls the printed value only — `apply`
// always receives the number. Returns `set()` so code can move the slider back
// when the underlying value changes elsewhere (a preset, a reset button).
export function slider(label, { min, max, step = 1, value = min, apply = () => {}, format = (v) => v } = {}) {
    const input = el("input", { type: "range", min, max, step, value });
    const val = el("span", { className: "val" });
    const render = () => { val.textContent = format(+input.value); };
    input.oninput = () => { render(); apply(+input.value); };
    render();
    const row = el("div", { className: "row" }, [el("label", { textContent: label }), input, val]);
    return {
        row, input, val,
        get value() { return +input.value; },
        set: (v) => { input.value = v; render(); },
    };
}

// A labelled <select>. `options` is a list of [value, text] pairs; `apply` gets
// the raw string value, because that is what the element actually holds.
export function select(label, options, { value = null, apply = () => {} } = {}) {
    const node = el("select");
    for (const [optValue, text] of options) node.append(el("option", { value: String(optValue), textContent: text }));
    if (value !== null) node.value = String(value);
    node.onchange = () => apply(node.value);
    const row = el("div", { className: "row" }, [el("label", { textContent: label }), node]);
    return { row, node, set: (v) => { node.value = String(v); } };
}

// A button. Kept as a function purely so call sites read the same as the rest.
export function button(label, onclick, props = {}) {
    return el("button", { textContent: label, onclick, ...props });
}

// A titled card — the panel building block. `title` is optional.
export function card(title, children = []) {
    const kids = title ? [el("h2", { textContent: title }), ...children] : children;
    return el("div", { className: "card" }, kids);
}

// A muted line of explanatory text, for keyboard hints and the like.
export function hint(text, props = {}) {
    return el("div", { className: "hint", textContent: text, ...props });
}

// The stylesheet those helpers assume: the dark panel look every demo had
// pasted into its own `STYLES` string. Scenes add their own CSS on top; this
// only covers the shared chrome (layout, cards, rows, buttons, readouts).
export const BASE_STYLES = `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #e6e6e6; background: #1b1d21; }
    #app { display: flex; gap: 16px; padding: 16px; align-items: flex-start; flex-wrap: wrap; }
    #stage { position: relative; background: #0a0d12; border-radius: 8px; overflow: hidden; box-shadow: 0 6px 24px rgba(0,0,0,.4); }
    #stage canvas { display: block; max-width: 100%; height: auto; touch-action: none; }
    #panel { width: 300px; display: flex; flex-direction: column; gap: 16px; }

    h1 { font-size: 17px; margin: 0 0 4px; }
    h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #9aa0a6; margin: 0 0 10px; }
    .card { background: #26292e; border: 1px solid #33373d; border-radius: 8px; padding: 12px; }
    .kv { display: flex; justify-content: space-between; font-size: 13px; margin: 5px 0; }
    .kv .k { color: #9aa0a6; }
    .kv .v { font-variant-numeric: tabular-nums; }
    .hint { font-size: 12px; color: #7d838a; margin-top: 10px; text-align: center; }

    button { cursor: pointer; border: 1px solid #3a3f45; background: #2f343a; color: #e6e6e6; border-radius: 6px; padding: 9px 10px; font-size: 13px; width: 100%; }
    button:hover { background: #3a4047; }
    button:disabled { opacity: .4; cursor: default; }

    .row { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
    .row label { width: 104px; font-size: 12px; color: #b9bfc6; }
    .row input[type=range] { flex: 1; min-width: 0; }
    .row select { flex: 1; min-width: 0; background: #2f343a; color: #e6e6e6; border: 1px solid #3a3f45; border-radius: 6px; padding: 6px; }
    .row .val { width: 60px; text-align: right; font-variant-numeric: tabular-nums; font-size: 12px; color: #9aa0a6; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

    @media (max-width: 720px) {
        #app { flex-direction: column; padding: 10px; gap: 10px; }
        #panel { width: 100%; }
    }
`;
