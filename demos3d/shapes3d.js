// The 3D hello world: every primitive the geometry builders ship, lit and
// turning, with an orbit camera you can drag.
//
// This is `engine.html` in three dimensions, and the comparison is the point.
// The 2D page draws flat colour and the shapes read as silhouettes; here the
// same six solids read as volumes, and the only reason is that each face
// catches the light differently. Take the lighting away — the "sin luz" button
// — and a sphere is a circle again.

import App from "../components/app.js";
import { el, kv, slider, card, button, hint } from "../components/ui/index.js";
import {
    Mesh, boxGeometry, sphereGeometry, cylinderGeometry, coneGeometry,
    torusGeometry, planeGeometry, prismGeometry, PROGRAM_FLAT,
} from "../components/render3d/index.js";
import { clamp } from "../components/math/angles.js";

const STYLES = `
    #stage canvas { cursor: grab; }
    #stage canvas:active { cursor: grabbing; }
    .legend { font-size: 12px; color: #9aa0a6; margin-top: 8px; line-height: 1.7; }
    .legend b { color: #cfd6dd; font-weight: 600; }
`;

const SOLIDS = [
    {
        name: "Cubo", color: { red: 0.88, green: 0.33, blue: 0.24 },
        make: () => boxGeometry({ width: 1.3, height: 1.3, depth: 1.3 }),
        note: "24 vértices, no 8: cada esquina pertenece a tres caras que miran a tres sitios distintos.",
    },
    {
        name: "Esfera", color: { red: 0.25, green: 0.55, blue: 0.92 },
        make: () => sphereGeometry({ radius: 0.8, segments: 28, rings: 20 }),
        note: "Comparte vértices: en una esfera unitaria la normal ES la posición.",
    },
    {
        name: "Cilindro", color: { red: 0.95, green: 0.78, blue: 0.25 },
        make: () => cylinderGeometry({ radiusTop: 0.6, radiusBottom: 0.6, height: 1.5, segments: 28 }),
        note: "Lados y dos tapas, con el bobinado invertido en una de ellas.",
    },
    {
        name: "Cono", color: { red: 0.55, green: 0.32, blue: 0.9 },
        make: () => coneGeometry({ radius: 0.75, height: 1.6, segments: 28 }),
        note: "Un cilindro con radio superior cero — y la normal del lado se inclina con la pendiente.",
    },
    {
        name: "Toro", color: { red: 0.2, green: 0.78, blue: 0.6 },
        make: () => torusGeometry({ radius: 0.62, tube: 0.24, segments: 36, sides: 20 }),
        note: "La normal apunta hacia fuera del tubo, no del centro del toro.",
    },
    {
        name: "Prisma", color: { red: 0.93, green: 0.55, blue: 0.2 },
        make: () => prismGeometry({
            points: [
                { x: 0, z: -0.85 }, { x: 0.8, z: -0.25 }, { x: 0.5, z: 0.75 },
                { x: -0.5, z: 0.75 }, { x: -0.8, z: -0.25 },
            ],
            height: 1.2,
        }),
        note: "Un contorno plano al que se le da altura: así se hacen los cascos sin modelador.",
    },
];

App.boot({ title: "Formas 3D", styles: STYLES }, (app) => {
    const gl = app.gl;
    const camera = app.use3D({ clearColor: { red: 0.07, green: 0.09, blue: 0.12 } });
    camera.orbit({ yaw: 22, pitch: 26, distance: 12, target: { x: 0, y: 0.2, z: 0 } });

    // A ground plane, so the solids have somewhere to be instead of floating in
    // an empty void with nothing to judge their size against.
    app.add(new Mesh(gl, planeGeometry({ width: 220, depth: 220 }))
        .setPosition({ y: -1.15 })
        .setColor({ red: 0.16, green: 0.18, blue: 0.22 })
        .init());

    // Two rows of three, laid out in X and Z so the depth is visible from the
    // start — a single row would look like a 2D strip.
    const meshes = SOLIDS.map((solid, index) => {
        const column = index % 3;
        const row = Math.floor(index / 3);
        return app.add(new Mesh(gl, solid.make())
            .setPosition({ x: (column - 1) * 3.4, y: 0, z: (row - 0.5) * 3.4 })
            .setColor(solid.color)
            .setShininess(28)
            .init());
    });

    let spinning = true;
    let lit = true;
    let elapsed = 0;

    // --- Panel ------------------------------------------------------------
    const kCamera = kv("Cámara"), kTris = kv("Triángulos"), kDrawn = kv("Mallas");

    const spinBtn = button("", () => setSpinning(!spinning));
    const litBtn = button("", () => setLit(!lit));
    const pitchCtl = slider("Altura", {
        min: -85, max: 85, value: 22,
        apply: (v) => camera.orbit({ pitch: v }), format: (v) => `${v}°`,
    });
    const zoomCtl = slider("Distancia", {
        min: 5, max: 26, step: 0.5, value: 12,
        apply: (v) => camera.orbit({ distance: v }), format: (v) => `${v.toFixed(1)}`,
    });
    const fovCtl = slider("Campo de visión", {
        min: 25, max: 100, value: 55,
        apply: (v) => { camera.fov = v; }, format: (v) => `${v}°`,
    });

    const legend = el("div", { className: "legend" });
    for (const solid of SOLIDS) {
        legend.append(el("div", {}, [
            el("b", { textContent: `${solid.name}: ` }),
            document.createTextNode(solid.note),
        ]));
    }

    app.addPanel(
        card("Cámara", [
            pitchCtl.row, zoomCtl.row, fovCtl.row, kCamera.row,
            hint("Arrastra sobre la escena para girar · rueda para acercar"),
        ]),
        card("Escena", [
            el("div", { className: "grid2" }, [spinBtn, litBtn]),
            kTris.row, kDrawn.row,
        ]),
        card("Las seis primitivas", [legend]),
    );

    // --- Dragging to orbit -------------------------------------------------
    // Pointer events rather than mouse events, so one code path covers a
    // trackpad and a finger.
    let dragging = null;
    app.canvas.addEventListener("pointerdown", (e) => {
        dragging = { x: e.clientX, y: e.clientY, yaw: camera.yaw, pitch: camera.pitch };
        app.canvas.setPointerCapture(e.pointerId);
    });
    app.canvas.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        camera.orbit({
            yaw: dragging.yaw - (e.clientX - dragging.x) * 0.4,
            pitch: dragging.pitch + (e.clientY - dragging.y) * 0.3,
        });
        pitchCtl.set(Math.round(camera.pitch));
    });
    for (const event of ["pointerup", "pointercancel"]) {
        app.canvas.addEventListener(event, () => { dragging = null; });
    }
    app.canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        camera.orbit({ distance: clamp(camera.distance + Math.sign(e.deltaY) * 0.9, 5, 26) });
        zoomCtl.set(camera.distance);
    }, { passive: false });

    app.keyboard.on(" ", () => setSpinning(!spinning)).on("l", () => setLit(!lit));

    setSpinning(true);
    setLit(true);

    window.raptorShapes3D = {
        app, camera, meshes,
        get spinning() { return spinning; },
        get lit() { return lit; },
        setSpinning, setLit,
        get triangles() { return meshes.reduce((sum, m) => sum + m.indexCount / 3, 0); },
    };

    app.onUpdate((dt) => {
        if (spinning) {
            elapsed += dt;
            meshes.forEach((mesh, i) => {
                mesh.setRotation({ y: elapsed * 40 + i * 25, x: Math.sin(elapsed * 0.7 + i) * 12 });
            });
        }
        kCamera.set(`${Math.round(camera.yaw)}° / ${Math.round(camera.pitch)}° · ${camera.distance.toFixed(1)}`);
        kTris.set(String(meshes.reduce((sum, m) => sum + m.indexCount / 3, 0) + 2));
        kDrawn.set(`${app.entities.length} mallas`);
    });

    function setSpinning(on) {
        spinning = on;
        spinBtn.textContent = on ? "⏸ Parar el giro (espacio)" : "▶ Girar (espacio)";
    }

    // Swapping the program shows what shading is actually doing: the same
    // geometry, the same colours, and suddenly no volume at all.
    function setLit(on) {
        lit = on;
        for (const mesh of meshes) {
            mesh.program = on ? "lit3d" : PROGRAM_FLAT;
            mesh.programInfo = null;
            mesh.buffers = null;
            mesh.init();
        }
        litBtn.textContent = on ? "💡 Con luz (L)" : "🌑 Sin luz (L)";
    }
});
