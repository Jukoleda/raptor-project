// Basic visual editor for RaptorEngine, with a physics layer.
//
// It renders the engine canvas next to a control panel. You can add shapes,
// select them from the scene list and edit their color, position, rotation,
// scale and physics (body type, collision group, restitution). Press Play to
// run the simulation: dynamic bodies fall (if gravity is on), collide and bounce
// off each other, static bodies and the world bounds.

import RaptorEngine from "../components/raptorEngine.js";
import { Rectangle, Square, Triangle, Circle, RegularPolygon } from "../components/shapes/index.js";
import { World, Body, STATIC, DYNAMIC } from "../components/physics/index.js";

// Visible world area at the default camera depth (used as physics bounds).
const BOUNDS = { minX: -3.2, maxX: 3.2, minY: -2.4, maxY: 2.4 };
const GRAVITY_Y = -6;

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
    button.primary { border-color: #3a5bbf; background: #35507f; }
    button.primary:hover { background: #3d5f96; }
    button.danger { border-color: #6b2f2f; background: #3a2626; width: 100%; }
    button.danger:hover { background: #4a2c2c; }
    .row { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
    .row label { width: 78px; font-size: 12px; color: #b9bfc6; }
    .row input[type=range] { flex: 1; min-width: 0; }
    .row input[type=color] { width: 44px; height: 26px; padding: 0; border: none; background: none; }
    .row select { flex: 1; min-width: 0; background: #2f343a; color: #e6e6e6; border: 1px solid #3a3f45; border-radius: 6px; padding: 6px; }
    .row .val { width: 42px; text-align: right; font-variant-numeric: tabular-nums; font-size: 12px; color: #9aa0a6; }
    #list { display: flex; flex-direction: column; gap: 6px; max-height: 180px; overflow: auto; }
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

function slider(labelText, min, max, step, apply) {
    const input = el("input", { type: "range", min, max, step });
    const val = el("span", { className: "val" });
    input.oninput = () => { val.textContent = (+input.value).toFixed(2); apply(+input.value); };
    const row = el("div", { className: "row" }, [el("label", { textContent: labelText }), input, val]);
    return { row, input, val };
}

function select(labelText, options, apply) {
    const node = el("select");
    for (const [value, text] of options) node.append(el("option", { value: String(value), textContent: text }));
    node.onchange = () => apply(node.value);
    const row = el("div", { className: "row" }, [el("label", { textContent: labelText }), node]);
    return { row, node };
}

// --- Editor -----------------------------------------------------------------

function startEditor() {
    document.head.append(el("style", { textContent: STYLES }));

    const game = new RaptorEngine();
    const stage = el("div", { id: "stage" });
    game.createWindow(stage);
    const gl = game.context;

    const world = new World({ gravity: { x: 0, y: 0 }, bounds: BOUNDS, linearDamping: 0.05 });

    let playing = false;
    let snapshot = null; // captured transforms to restore on reset

    // Physics stepping is driven by the engine loop but only while playing.
    game.addUpdater((dt) => { if (playing) world.step(dt); });

    const FACTORIES = {
        "Rectángulo": () => new Rectangle(gl, { width: 1.2, height: 0.8 }),
        "Cuadrado": () => new Square(gl, { size: 1 }),
        "Triángulo": () => new Triangle(gl, { width: 1.2, height: 1.2 }),
        "Círculo": () => new Circle(gl, { radius: 0.5 }),
        "Hexágono": () => new RegularPolygon(gl, { sides: 6, radius: 0.6 }),
    };

    const entries = new Map(); // shape -> { shape, item, body, type, inWorld }
    let selected = null;       // selected shape or null

    // --- Property controls ---
    const color = el("input", { type: "color", value: "#ffffff" });
    color.oninput = () => selected && selected.setColor({ ...hexToRgb01(color.value), alpha: 1 });

    const posX = slider("Posición X", -3, 3, 0.05, (v) => selected && selected.setPosition({ x: v }));
    const posY = slider("Posición Y", -2.5, 2.5, 0.05, (v) => selected && selected.setPosition({ y: v }));
    const rot = slider("Rotación", 0, 360, 1, (v) => selected && selected.setRotation(v));
    const scale = slider("Escala", 0.1, 3, 0.05, (v) => selected && selected.setScale({ x: v, y: v }));

    const bodyType = select("Cuerpo", [
        [DYNAMIC, "Dinámico (rigid)"],
        [STATIC, "Estático"],
        ["none", "Sin física"],
    ], (v) => selected && setBodyType(entries.get(selected), v));

    const group = select("Grupo", [
        [0, "Ninguno"],
        [-1, "Equipo 1 (se ignoran)"],
        [-2, "Equipo 2 (se ignoran)"],
    ], (v) => { if (selected) entries.get(selected).body.groupIndex = parseInt(v, 10); });

    const bounce = slider("Rebote", 0, 1, 0.05, (v) => { if (selected) entries.get(selected).body.restitution = v; });

    const delBtn = el("button", { className: "danger", textContent: "Eliminar forma", onclick: deleteSelected });

    const props = el("div", { id: "props", className: "disabled" }, [
        el("div", { className: "row" }, [el("label", { textContent: "Color" }), color]),
        posX.row, posY.row, rot.row, scale.row,
        bodyType.row, group.row, bounce.row,
        el("div", { className: "row" }, [delBtn]),
    ]);

    // --- Scene list ---
    const list = el("div", { id: "list" });
    const emptyHint = el("div", { className: "empty", textContent: "Escena vacía. Añade una forma." });
    list.append(emptyHint);

    // --- Add buttons ---
    const addButtons = Object.keys(FACTORIES).map((name) =>
        el("button", { textContent: name, onclick: () => addShape(name) })
    );

    // --- Simulation controls ---
    const playBtn = el("button", { className: "primary", textContent: "▶ Play", onclick: togglePlay });
    const resetBtn = el("button", { textContent: "↺ Reiniciar", onclick: reset });
    const gravityChk = el("input", { type: "checkbox" });
    gravityChk.onchange = () => { world.gravity.y = gravityChk.checked ? GRAVITY_Y : 0; };
    const gravityRow = el("label", { className: "row" }, [gravityChk, el("span", { textContent: "Gravedad" })]);

    const panel = el("div", { id: "panel" }, [
        el("h1", { textContent: "Raptor Editor" }),
        el("div", { className: "card" }, [
            el("h2", { textContent: "Simulación" }),
            el("div", { className: "grid" }, [playBtn, resetBtn]),
            gravityRow,
        ]),
        el("div", { className: "card" }, [el("h2", { textContent: "Añadir" }), el("div", { className: "grid" }, addButtons)]),
        el("div", { className: "card" }, [el("h2", { textContent: "Escena" }), list]),
        el("div", { className: "card" }, [el("h2", { textContent: "Propiedades" }), props]),
    ]);

    document.body.append(el("div", { id: "editor" }, [stage, panel]));

    game.start();

    // Debug handle (useful from the console or automated tests).
    window.raptorEditor = { game, world, entries };

    // --- Behaviour ---

    function addShape(name) {
        const hex = PALETTE[colorIndex++ % PALETTE.length];
        const shape = FACTORIES[name]()
            .setColor({ ...hexToRgb01(hex), alpha: 1 })
            .setPosition({ x: 0, y: 0 })
            .init();
        game.add(shape);

        const body = new Body(shape, { type: DYNAMIC, restitution: 0.4 });
        world.add(body);

        const swatch = el("span", { className: "swatch" });
        swatch.style.background = hex;
        const item = el("div", { className: "item" }, [swatch, el("span", { textContent: name })]);
        item.onclick = () => selectShape(shape);

        const entry = { shape, item, body, type: DYNAMIC, inWorld: true };
        emptyHint.remove();
        list.append(item);
        entries.set(shape, entry);

        selectShape(shape);
    }

    function selectShape(shape) {
        selected = shape;
        const entry = entries.get(shape);
        for (const [s, e] of entries) e.item.classList.toggle("selected", s === shape);
        props.classList.remove("disabled");

        color.value = rgb01ToHex(shape.color);
        setSlider(posX, shape.position.x);
        setSlider(posY, shape.position.y);
        setSlider(rot, shape.rotation);
        setSlider(scale, shape.scale.x);
        bodyType.node.value = entry.type;
        group.node.value = String(entry.body.groupIndex);
        setSlider(bounce, entry.body.restitution);
    }

    function setBodyType(entry, type) {
        entry.type = type;
        if (type === "none") {
            if (entry.inWorld) { world.remove(entry.body); entry.inWorld = false; }
        } else {
            if (!entry.inWorld) { world.add(entry.body); entry.inWorld = true; }
            entry.body.setType(type);
        }
    }

    function deleteSelected() {
        if (!selected) return;
        const entry = entries.get(selected);
        game.remove(selected);
        world.remove(entry.body);
        entry.item.remove();
        entries.delete(selected);
        selected = null;
        props.classList.add("disabled");
        if (entries.size === 0) list.append(emptyHint);
    }

    function togglePlay() {
        playing = !playing;
        if (playing && !snapshot) snapshot = capture();
        playBtn.textContent = playing ? "⏸ Pausa" : "▶ Play";
    }

    function reset() {
        playing = false;
        playBtn.textContent = "▶ Play";
        if (snapshot) restore(snapshot);
        snapshot = null;
        for (const entry of entries.values()) entry.body.setVelocity(0, 0);
    }

    function capture() {
        const state = new Map();
        for (const entry of entries.values()) {
            state.set(entry, { x: entry.shape.position.x, y: entry.shape.position.y, rot: entry.shape.rotation });
        }
        return state;
    }

    function restore(state) {
        for (const [entry, t] of state) {
            entry.shape.setPosition({ x: t.x, y: t.y });
            entry.shape.setRotation(t.rot);
        }
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
