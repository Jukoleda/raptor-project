// The visual editor in three dimensions.
//
// Same idea as `editor.html` — add solids, select one, edit it live, press play
// and watch physics take over — with the two things the extra axis forces:
// picking has to work when what you clicked is *behind* something else, and
// "position" is now three numbers instead of two.
//
// Picking is done by projecting each mesh's centre to the screen and taking the
// nearest hit that is also nearest to the camera. It is not a true ray-versus-
// mesh test, but for a scene of separated primitives it picks what you meant,
// and it is twenty lines instead of two hundred.

import App from "../components/app.js";
import { el, kv, slider, select, card, button, hint } from "../components/ui/index.js";
import {
    Mesh, boxGeometry, sphereGeometry, cylinderGeometry, coneGeometry,
    torusGeometry, planeGeometry,
} from "../components/render3d/index.js";
import { clamp } from "../components/math/angles.js";

const GRAVITY = -14;
const BOUNCE = 0.55;
const FLOOR = 0;

const STYLES = `
    #stage canvas { cursor: crosshair; }
    #list { display: flex; flex-direction: column; gap: 6px; max-height: 190px; overflow: auto; }
    .item {
        display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 6px;
        background: #2f343a; border: 1px solid transparent; cursor: pointer; font-size: 13px;
    }
    .item:hover { background: #363c43; }
    .item.selected { border-color: #5b8def; background: #2b3547; }
    .swatch { width: 14px; height: 14px; border-radius: 3px; border: 1px solid rgba(255,255,255,.2); flex: none; }
    .empty { color: #7d838a; font-size: 13px; font-style: italic; }
    #props.disabled { opacity: .4; pointer-events: none; }
    .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
    button.primary { border-color: #3a5bbf; background: #35507f; }
    button.danger { border-color: #6b2f2f; background: #3a2626; }
`;

const PALETTE = ["#e0533d", "#22b573", "#3d7fe0", "#f2c518", "#8e44e0", "#26c1a3"];

const FACTORIES = {
    "Cubo": () => boxGeometry({ width: 1.2, height: 1.2, depth: 1.2 }),
    "Esfera": () => sphereGeometry({ radius: 0.7, segments: 24, rings: 16 }),
    "Cilindro": () => cylinderGeometry({ radiusTop: 0.55, radiusBottom: 0.55, height: 1.4 }),
    "Cono": () => coneGeometry({ radius: 0.7, height: 1.4 }),
    "Toro": () => torusGeometry({ radius: 0.6, tube: 0.22 }),
};

const hexToRgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
};
const rgbToHex = ({ red, green, blue }) => {
    const h = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
    return `#${h(red)}${h(green)}${h(blue)}`;
};

App.boot({ title: "Editor 3D", styles: STYLES, touch: false }, (app) => {
    const gl = app.gl;
    const camera = app.use3D({ clearColor: { red: 0.06, green: 0.07, blue: 0.09 } });
    camera.orbit({ yaw: 30, pitch: 28, distance: 13, target: { x: 0, y: 1, z: 0 } });

    app.add(new Mesh(gl, planeGeometry({ width: 200, depth: 200 }))
        .setColor({ red: 0.15, green: 0.17, blue: 0.2 }).init());

    // A grid of thin slabs, so the ground has a sense of scale you can judge a
    // position against.
    for (let i = -6; i <= 6; i++) {
        for (const [w, d, x, z] of [[13, 0.03, 0, i], [0.03, 13, i, 0]]) {
            app.add(new Mesh(gl, boxGeometry({ width: w, height: 0.02, depth: d }))
                .setPosition({ x, y: 0.011, z })
                .setColor({ red: 0.22, green: 0.25, blue: 0.3 }).init());
        }
    }

    const entries = [];       // { mesh, velocity, colorHex, name }
    let selected = null;
    let playing = false;
    let colorIndex = 0;

    // --- Panel ------------------------------------------------------------
    const list = el("div", { id: "list" });
    const emptyHint = el("div", { className: "empty", textContent: "Escena vacía. Añade un sólido." });
    list.append(emptyHint);

    const kCount = kv("Sólidos"), kSel = kv("Seleccionado"), kCam = kv("Cámara");

    const color = el("input", { type: "color" });
    color.oninput = () => {
        if (!selected) return;
        selected.colorHex = color.value;
        selected.mesh.setColor(hexToRgb(color.value));
        renderList();
    };

    const axis = (label, key, min, max) => slider(label, {
        min, max, step: 0.1, value: 0,
        apply: (v) => { if (selected) selected.mesh.setPosition({ [key]: v }); },
        format: (v) => v.toFixed(1),
    });
    const posX = axis("Posición X", "x", -6, 6);
    const posY = axis("Posición Y", "y", 0, 8);
    const posZ = axis("Posición Z", "z", -6, 6);
    const spin = slider("Giro Y", {
        min: 0, max: 360, value: 0,
        apply: (v) => { if (selected) selected.mesh.setRotation({ y: v }); },
        format: (v) => `${Math.round(v)}°`,
    });
    const size = slider("Escala", {
        min: 0.2, max: 3, step: 0.05, value: 1,
        apply: (v) => { if (selected) selected.mesh.setScale(v); },
        format: (v) => v.toFixed(2),
    });
    const shine = slider("Brillo", {
        min: 0, max: 90, value: 0,
        apply: (v) => { if (selected) selected.mesh.setShininess(v); },
        format: (v) => String(Math.round(v)),
    });

    const deleteBtn = button("Eliminar", () => deleteSelected(), { className: "danger" });
    const props = el("div", { id: "props", className: "disabled" }, [
        el("div", { className: "row" }, [el("label", { textContent: "Color" }), color]),
        posX.row, posY.row, posZ.row, spin.row, size.row, shine.row,
        el("div", { className: "row" }, [deleteBtn]),
    ]);

    const playBtn = button("▶ Play", () => setPlaying(!playing), { className: "primary" });
    const resetBtn = button("↺ Reiniciar", () => reset());

    app.addPanel(
        card("Simulación", [
            el("div", { className: "grid2" }, [playBtn, resetBtn]),
            hint("Con play, los sólidos caen y rebotan en el suelo"),
        ]),
        card("Añadir", [
            el("div", { className: "grid3" }, Object.keys(FACTORIES).map((name) => button(name, () => addSolid(name)))),
        ]),
        card("Escena", [list, kCount.row, kSel.row]),
        card("Propiedades", [props]),
        card("Cámara", [kCam.row, hint("Arrastra con el botón derecho para girar · rueda para acercar · clic izquierdo selecciona")]),
    );

    // --- Camera and picking -------------------------------------------------
    let dragging = null;
    app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    app.canvas.addEventListener("pointerdown", (e) => {
        if (e.button === 0) { pickAt(e.clientX, e.clientY); return; }
        dragging = { x: e.clientX, y: e.clientY, yaw: camera.yaw, pitch: camera.pitch };
        app.canvas.setPointerCapture(e.pointerId);
    });
    app.canvas.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        camera.orbit({
            yaw: dragging.yaw - (e.clientX - dragging.x) * 0.4,
            pitch: dragging.pitch + (e.clientY - dragging.y) * 0.3,
        });
    });
    for (const ev of ["pointerup", "pointercancel"]) app.canvas.addEventListener(ev, () => { dragging = null; });
    app.canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        camera.orbit({ distance: clamp(camera.distance + Math.sign(e.deltaY), 4, 30) });
    }, { passive: false });

    // Nearest projected centre wins, and among those, the one closest to the
    // camera — so clicking a stack picks the front of it.
    function pickAt(clientX, clientY) {
        const rect = app.canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        let best = null;
        for (const entry of entries) {
            const screen = camera.project(entry.mesh.position, app.canvas);
            if (!screen) continue;
            const distance = Math.hypot(screen.x - x, screen.y - y);
            // A generous radius in pixels, scaled down as things get further
            // away, so a distant cube is not impossible to hit.
            const radius = Math.max(18, 900 / screen.depth);
            if (distance > radius) continue;
            if (!best || screen.depth < best.depth) best = { entry, depth: screen.depth };
        }
        selectEntry(best ? best.entry : null);
    }

    app.keyboard.on("Delete", () => deleteSelected()).on(" ", () => setPlaying(!playing));

    setPlaying(false);
    addSolid("Cubo");
    addSolid("Esfera");

    window.raptorEditor3D = {
        app, camera, entries,
        get selected() { return selected; },
        get playing() { return playing; },
        addSolid, selectEntry, deleteSelected, setPlaying, reset, pickAt,
    };

    app.onUpdate((dt) => {
        if (playing) {
            for (const entry of entries) {
                entry.velocity.y += GRAVITY * dt;
                const mesh = entry.mesh;
                mesh.setPosition({ y: mesh.position.y + entry.velocity.y * dt });
                const rest = entry.restHeight;
                if (mesh.position.y <= FLOOR + rest) {
                    mesh.setPosition({ y: FLOOR + rest });
                    // Below a threshold the bounce is noise, and letting it run
                    // leaves everything jittering forever.
                    entry.velocity.y = Math.abs(entry.velocity.y) < 0.6 ? 0 : -entry.velocity.y * BOUNCE;
                }
            }
            if (selected) posY.set(selected.mesh.position.y);
        }
        kCam.set(`${Math.round(camera.yaw)}° / ${Math.round(camera.pitch)}° · ${camera.distance.toFixed(0)}`);
    });

    // --- Behaviour ---------------------------------------------------------

    function addSolid(name) {
        const colorHex = PALETTE[colorIndex++ % PALETTE.length];
        const mesh = app.add(new Mesh(gl, FACTORIES[name]())
            .setColor(hexToRgb(colorHex))
            .setPosition({ x: (Math.random() - 0.5) * 5, y: 2.5 + entries.length * 0.4, z: (Math.random() - 0.5) * 5 })
            .init());
        // How high its centre sits when it is resting on the floor.
        const entry = { mesh, name, colorHex, velocity: { y: 0 }, restHeight: mesh.cullRadius * 0.72 };
        entries.push(entry);
        selectEntry(entry);
        renderList();
        return entry;
    }

    function deleteSelected() {
        if (!selected) return;
        app.remove(selected.mesh);
        entries.splice(entries.indexOf(selected), 1);
        selectEntry(entries.at(-1) || null);
        renderList();
    }

    function selectEntry(entry) {
        selected = entry;
        props.classList.toggle("disabled", !entry);
        if (entry) {
            color.value = entry.colorHex;
            posX.set(entry.mesh.position.x);
            posY.set(entry.mesh.position.y);
            posZ.set(entry.mesh.position.z);
            spin.set(entry.mesh.rotation.y);
            size.set(entry.mesh.scale.x);
            shine.set(entry.mesh.shininess);
        }
        renderList();
    }

    function renderList() {
        list.replaceChildren();
        if (entries.length === 0) { list.append(emptyHint); }
        for (const entry of entries) {
            const row = el("div", { className: `item ${entry === selected ? "selected" : ""}`.trim() }, [
                el("span", { className: "swatch", style: `background:${entry.colorHex}` }),
                el("span", { textContent: entry.name }),
            ]);
            row.onclick = () => selectEntry(entry);
            list.append(row);
        }
        kCount.set(String(entries.length));
        kSel.set(selected ? selected.name : "ninguno");
    }

    function setPlaying(on) {
        playing = on;
        playBtn.textContent = on ? "⏸ Pausa" : "▶ Play";
    }

    function reset() {
        setPlaying(false);
        for (const entry of entries) {
            entry.velocity.y = 0;
            entry.mesh.setPosition({ y: 2.5 });
        }
        if (selected) posY.set(selected.mesh.position.y);
    }
});
