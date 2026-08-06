// Basic visual editor for RaptorEngine, with a physics layer.
//
// It renders the engine canvas next to a control panel. You can add shapes,
// select them from the scene list and edit their color, position, rotation,
// scale and physics (body type, collision group, restitution). Press Play to
// run the simulation: dynamic bodies fall (if gravity is on), collide and bounce
// off each other, static bodies and the world bounds.

import App from "../components/app.js";
import { el, slider, select, card, button } from "../components/ui/index.js";
import { Rectangle, Square, Triangle, Circle, RegularPolygon } from "../components/shapes/index.js";
import { World, Body, STATIC, DYNAMIC } from "../components/physics/index.js";

// Visible world area at the default camera depth (used as physics bounds).
const BOUNDS = { minX: -3.2, maxX: 3.2, minY: -2.4, maxY: 2.4 };
const GRAVITY_Y = -6;

// --- Styles -----------------------------------------------------------------

// Only the editor's own chrome. The page layout, cards, rows, sliders and
// buttons all come from the framework (components/ui/).
const STYLES = `
    #panel { gap: 18px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    button.primary { border-color: #3a5bbf; background: #35507f; }
    button.primary:hover { background: #3d5f96; }
    button.danger { border-color: #6b2f2f; background: #3a2626; }
    button.danger:hover { background: #4a2c2c; }
    .row label { width: 78px; }
    .row input[type=color] { width: 44px; height: 26px; padding: 0; border: none; background: none; }
    .row .val { width: 42px; }
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

// --- Editor -----------------------------------------------------------------

App.boot({ title: "Raptor Editor", styles: STYLES, touch: false, keyboard: false }, (app) => {
    const { gl } = app;
    const game = app;

    const world = new World({ gravity: { x: 0, y: 0 }, bounds: BOUNDS, linearDamping: 0.05 });

    let playing = false;
    let snapshot = null; // captured transforms to restore on reset

    // Physics stepping is driven by the engine loop but only while playing.
    app.onUpdate((dt) => { if (playing) world.step(dt); });

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

    const posX = slider("Posición X", { min: -3, max: 3, step: 0.05, value: -3, apply: (v) => selected && selected.setPosition({ x: v }), format: (v) => v.toFixed(2) });
    const posY = slider("Posición Y", { min: -2.5, max: 2.5, step: 0.05, value: -2.5, apply: (v) => selected && selected.setPosition({ y: v }), format: (v) => v.toFixed(2) });
    const rot = slider("Rotación", { min: 0, max: 360, step: 1, value: 0, apply: (v) => selected && selected.setRotation(v), format: (v) => v.toFixed(2) });
    const scale = slider("Escala", { min: 0.1, max: 3, step: 0.05, value: 0.1, apply: (v) => selected && selected.setScale({ x: v, y: v }), format: (v) => v.toFixed(2) });

    const bodyType = select("Cuerpo", [
        [DYNAMIC, "Dinámico (rigid)"],
        [STATIC, "Estático"],
        ["none", "Sin física"],
    ], { apply: (v) => selected && setBodyType(entries.get(selected), v) });

    const group = select("Grupo", [
        [0, "Ninguno"],
        [-1, "Equipo 1 (se ignoran)"],
        [-2, "Equipo 2 (se ignoran)"],
    ], { apply: (v) => { if (selected) entries.get(selected).body.groupIndex = parseInt(v, 10); } });

    const bounce = slider("Rebote", { min: 0, max: 1, step: 0.05, value: 0, apply: (v) => { if (selected) entries.get(selected).body.restitution = v; }, format: (v) => v.toFixed(2) });

    const delBtn = button("Eliminar forma", deleteSelected, { className: "danger" });

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
    const addButtons = Object.keys(FACTORIES).map((name) => button(name, () => addShape(name)));

    // --- Simulation controls ---
    const playBtn = button("▶ Play", togglePlay, { className: "primary" });
    const resetBtn = button("↺ Reiniciar", reset);
    const gravityChk = el("input", { type: "checkbox" });
    gravityChk.onchange = () => { world.gravity.y = gravityChk.checked ? GRAVITY_Y : 0; };
    const gravityRow = el("label", { className: "row" }, [gravityChk, el("span", { textContent: "Gravedad" })]);

    app.addPanel(
        card("Simulación", [el("div", { className: "grid" }, [playBtn, resetBtn]), gravityRow]),
        card("Añadir", [el("div", { className: "grid" }, addButtons)]),
        card("Escena", [list]),
        card("Propiedades", [props]),
    );

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

    function setSlider(control, value) {
        control.set(value);
    }
});
