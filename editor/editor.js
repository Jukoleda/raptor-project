// Basic visual editor for RaptorEngine.
//
// It renders the engine canvas next to a control panel. You can add shapes,
// select them from the scene list and edit their color, position, rotation and
// scale — everything updates live because the engine redraws every frame and
// shapes read their transform in draw().

import RaptorEngine from "../components/raptorEngine.js";
import { Rectangle, Square, Triangle, Circle, RegularPolygon } from "../components/shapes/index.js";

// --- Styles -----------------------------------------------------------------

const STYLES = `
    * { box-sizing: border-box; }
    body {
        margin: 0;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        color: #e6e6e6;
        background: #1b1d21;
    }
    #editor { display: flex; gap: 16px; padding: 16px; align-items: flex-start; flex-wrap: wrap; }
    #stage { background: #000; border-radius: 8px; overflow: hidden; box-shadow: 0 6px 24px rgba(0,0,0,.4); }
    #stage canvas { display: block; max-width: 100%; height: auto; }
    #panel { width: 300px; display: flex; flex-direction: column; gap: 18px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #9aa0a6; margin: 0 0 10px; }
    .card { background: #26292e; border: 1px solid #33373d; border-radius: 8px; padding: 12px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    button {
        cursor: pointer; border: 1px solid #3a3f45; background: #2f343a; color: #e6e6e6;
        border-radius: 6px; padding: 8px 10px; font-size: 13px;
    }
    button:hover { background: #3a4047; }
    button.danger { border-color: #6b2f2f; background: #3a2626; width: 100%; }
    button.danger:hover { background: #4a2c2c; }
    .row { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
    .row label { width: 78px; font-size: 12px; color: #b9bfc6; }
    .row input[type=range] { flex: 1; min-width: 0; }
    .row input[type=color] { width: 44px; height: 26px; padding: 0; border: none; background: none; }
    .row .val { width: 42px; text-align: right; font-variant-numeric: tabular-nums; font-size: 12px; color: #9aa0a6; }
    #list { display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow: auto; }
    .item {
        display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 6px;
        background: #2f343a; border: 1px solid transparent; cursor: pointer; font-size: 13px;
    }
    .item:hover { background: #363c43; }
    .item.selected { border-color: #5b8def; background: #2b3547; }
    .swatch { width: 14px; height: 14px; border-radius: 3px; border: 1px solid rgba(255,255,255,.2); flex: none; }
    .empty { color: #7d838a; font-size: 13px; font-style: italic; }
    #props.disabled { opacity: .4; pointer-events: none; }
`;

// --- Helpers ----------------------------------------------------------------

// Pleasant, well-separated default colors cycled as shapes are added.
const PALETTE = ["#e0533d", "#22b573", "#3d7fe0", "#f2c518", "#8e44e0", "#26c1a3"];
let colorIndex = 0;

function hexToRgb01(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}

function rgb01ToHex({ red, green, blue }) {
    const h = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
    return `#${h(red)}${h(green)}${h(blue)}`;
}

function el(tag, props = {}, children = []) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children) node.append(child);
    return node;
}

// Builds a labelled range control and returns its parts.
function slider(labelText, min, max, step, apply) {
    const input = el("input", { type: "range", min, max, step });
    const val = el("span", { className: "val" });
    input.oninput = () => { val.textContent = (+input.value).toFixed(2); apply(+input.value); };
    const row = el("div", { className: "row" }, [el("label", { textContent: labelText }), input, val]);
    return { row, input, val };
}

// --- Editor -----------------------------------------------------------------

function startEditor() {
    document.head.append(el("style", { textContent: STYLES }));

    const game = new RaptorEngine();
    const stage = el("div", { id: "stage" });
    game.createWindow(stage);
    const gl = game.context;

    const FACTORIES = {
        "Rectángulo": () => new Rectangle(gl, { width: 1.2, height: 0.8 }),
        "Cuadrado": () => new Square(gl, { size: 1 }),
        "Triángulo": () => new Triangle(gl, { width: 1.2, height: 1.2 }),
        "Círculo": () => new Circle(gl, { radius: 0.6 }),
        "Hexágono": () => new RegularPolygon(gl, { sides: 6, radius: 0.7 }),
    };

    const items = new Map(); // shape -> list DOM node
    let selected = null;

    // Property controls (their apply() mutates the selected shape live).
    const color = el("input", { type: "color", value: "#ffffff" });
    color.oninput = () => selected && selected.setColor({ ...hexToRgb01(color.value), alpha: 1 });

    const posX = slider("Posición X", -3, 3, 0.05, (v) => selected && selected.setPosition({ x: v }));
    const posY = slider("Posición Y", -2.5, 2.5, 0.05, (v) => selected && selected.setPosition({ y: v }));
    const rot = slider("Rotación", 0, 360, 1, (v) => selected && selected.setRotation(v));
    const scale = slider("Escala", 0.1, 3, 0.05, (v) => selected && selected.setScale({ x: v, y: v }));

    const delBtn = el("button", { className: "danger", textContent: "Eliminar forma", onclick: deleteSelected });

    const props = el("div", { id: "props", className: "disabled" }, [
        el("div", { className: "row" }, [el("label", { textContent: "Color" }), color]),
        posX.row, posY.row, rot.row, scale.row,
        el("div", { className: "row" }, [delBtn]),
    ]);

    const list = el("div", { id: "list" });
    const emptyHint = el("div", { className: "empty", textContent: "Escena vacía. Añade una forma." });
    list.append(emptyHint);

    const addButtons = Object.keys(FACTORIES).map((name) =>
        el("button", { textContent: name, onclick: () => addShape(name) })
    );

    const panel = el("div", { id: "panel" }, [
        el("h1", { textContent: "Raptor Editor" }),
        el("div", { className: "card" }, [el("h2", { textContent: "Añadir" }), el("div", { className: "grid" }, addButtons)]),
        el("div", { className: "card" }, [el("h2", { textContent: "Escena" }), list]),
        el("div", { className: "card" }, [el("h2", { textContent: "Propiedades" }), props]),
    ]);

    document.body.append(el("div", { id: "editor" }, [stage, panel]));

    game.start();

    // --- Behaviour ---

    function addShape(name) {
        const hex = PALETTE[colorIndex++ % PALETTE.length];
        const shape = FACTORIES[name]()
            .setColor({ ...hexToRgb01(hex), alpha: 1 })
            .setPosition({ x: 0, y: 0 })
            .init();
        game.add(shape);

        const swatch = el("span", { className: "swatch" });
        swatch.style.background = hex;
        const item = el("div", { className: "item" }, [swatch, el("span", { textContent: name })]);
        item.onclick = () => select(shape);

        emptyHint.remove();
        list.append(item);
        items.set(shape, item);

        select(shape);
    }

    function select(shape) {
        selected = shape;
        for (const [s, node] of items) node.classList.toggle("selected", s === shape);
        props.classList.remove("disabled");

        color.value = rgb01ToHex(shape.color);
        setSlider(posX, shape.position.x);
        setSlider(posY, shape.position.y);
        setSlider(rot, shape.rotation);
        setSlider(scale, shape.scale.x);
    }

    function deleteSelected() {
        if (!selected) return;
        game.remove(selected);
        items.get(selected).remove();
        items.delete(selected);
        selected = null;
        props.classList.add("disabled");
        if (items.size === 0) list.append(emptyHint);
    }

    function setSlider(s, value) {
        s.input.value = value;
        s.val.textContent = (+value).toFixed(2);
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startEditor);
} else {
    startEditor();
}
