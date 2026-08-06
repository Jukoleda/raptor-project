// Textures on solids, and the billboard trick.
//
// The 2D sprites page was about drawing part of a texture on a flat quad. Here
// the same texture wraps a box, tiles across a floor and — the bit that only
// exists in 3D — stands up as a **billboard**: a flat quad that turns to face
// the camera every frame, so it looks like a solid object from any angle while
// costing two triangles.
//
// Billboards are how grass, particles and distant trees are drawn in almost
// every 3D game, and the giveaway is exactly what this page lets you do: turn
// the billboard off and walk around, and the "tree" reveals itself as a sheet
// of paper.

import App from "../components/app.js";
import { el, kv, slider, card, button, hint } from "../components/ui/index.js";
import { Mesh, boxGeometry, planeGeometry, sphereGeometry, cylinderGeometry } from "../components/render3d/index.js";
import { Texture } from "../components/render/index.js";
import { createRandom, randomRange } from "../components/math/random.js";
import { clamp, RAD_TO_DEG } from "../components/math/angles.js";

const STYLES = `
    .sheet { display: block; width: 100%; height: auto; image-rendering: pixelated;
             border-radius: 6px; border: 1px solid #3a3f45; background: #14171b; }
`;

// A crate texture and a leafy one, drawn rather than loaded so the page stays a
// single file — the same approach as the 2D pages.
function crateTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#8a6236"; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#6d4c28";
    for (const [x, y, w, h] of [[0, 0, 64, 6], [0, 58, 64, 6], [0, 0, 6, 64], [58, 0, 6, 64], [0, 29, 64, 6]]) {
        ctx.fillRect(x, y, w, h);
    }
    ctx.strokeStyle = "#5a3f20"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(6, 6); ctx.lineTo(58, 28); ctx.moveTo(58, 6); ctx.lineTo(6, 28); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, 35); ctx.lineTo(58, 57); ctx.moveTo(58, 35); ctx.lineTo(6, 57); ctx.stroke();
    const random = createRandom(99);
    ctx.fillStyle = "rgba(255,255,255,.06)";
    for (let i = 0; i < 90; i++) ctx.fillRect(random() * 64, random() * 64, 2, 2);
    return canvas;
}

function grassTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#2f6b3a"; ctx.fillRect(0, 0, 64, 64);
    const random = createRandom(7);
    for (let i = 0; i < 220; i++) {
        ctx.fillStyle = random() < 0.5 ? "#347342" : "#285c32";
        ctx.fillRect(Math.floor(random() * 64), Math.floor(random() * 64), 3, 3);
    }
    return canvas;
}

function treeTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = "#4a3320"; ctx.fillRect(28, 34, 8, 30);
    for (const [x, y, r, c] of [[32, 26, 18, "#1f5c31"], [24, 22, 12, "#2a7a41"], [40, 24, 10, "#256b36"]]) {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    return canvas;
}

App.boot({ title: "Texturas y billboards 3D", styles: STYLES }, (app) => {
    const gl = app.gl;
    const camera = app.use3D({ clearColor: { red: 0.44, green: 0.58, blue: 0.72 } });
    camera.orbit({ yaw: 24, pitch: 20, distance: 15, target: { x: 0, y: 1, z: 0 } });

    const crateCanvas = crateTexture();
    const crate = Texture.fromCanvas(gl, crateCanvas, { smooth: false });
    const grass = Texture.fromCanvas(gl, grassTexture(), { smooth: false, wrap: true });
    const tree = Texture.fromCanvas(gl, treeTexture(), { smooth: false });

    // The ground tiles the texture instead of stretching one copy over 120
    // metres, which is what `textureRepeat` is for.
    app.add(new Mesh(gl, planeGeometry({ width: 120, depth: 120 }), {
        texture: grass, textureRepeat: { x: 60, y: 60 },
    }).init());

    // A stack of textured crates: the same 64×64 image on every face.
    const crates = [];
    for (const [x, y, z, size] of [[-3, 0.7, 0, 1.4], [-3, 2.1, 0, 1.4], [-1.4, 0.7, 1.2, 1.4], [-4.4, 0.7, -1.1, 1.4]]) {
        crates.push(app.add(new Mesh(gl, boxGeometry({ width: size, height: size, depth: size }), { texture: crate })
            .setPosition({ x, y, z }).init()));
    }
    // A textured sphere, to show the UV wrap the sphere builder produces.
    const globe = app.add(new Mesh(gl, sphereGeometry({ radius: 1.1, segments: 32, rings: 24 }), { texture: crate })
        .setPosition({ x: 1.8, y: 1.1, z: -1.5 }).init());

    // --- Billboards ---------------------------------------------------------
    // Flat quads standing upright. Every frame they are turned to face the
    // camera, which is the whole trick.
    const billboards = [];
    const random = createRandom(20260806);
    for (let i = 0; i < 14; i++) {
        const angle = (i / 14) * Math.PI * 2;
        const distance = randomRange(random, 5, 11);
        const height = randomRange(random, 1.8, 3);
        const mesh = app.add(new Mesh(gl, planeGeometry({ width: height * 0.9, depth: height }), { texture: tree })
            .setPosition({ x: Math.cos(angle) * distance, y: height / 2, z: Math.sin(angle) * distance })
            // The plane builder lies flat in XZ, so it is stood up once here and
            // only spun about Y from then on. The sign matters: standing it up
            // the other way flips the texture's V axis and the tree grows
            // downwards.
            .setRotation({ x: -90 })
            .setDoubleSided(true)
            .init());
        billboards.push(mesh);
    }

    let facing = true;
    let spinning = true;
    let elapsed = 0;

    // --- Panel --------------------------------------------------------------
    const preview = el("canvas", { className: "sheet", width: 64, height: 64 });
    preview.getContext("2d").drawImage(crateCanvas, 0, 0);

    const kFacing = kv("Billboards"), kTris = kv("Triángulos"), kCam = kv("Cámara");
    const faceBtn = button("", () => setFacing(!facing));
    const spinBtn = button("⏸ Parar cajas", () => {
        spinning = !spinning;
        spinBtn.textContent = spinning ? "⏸ Parar cajas" : "▶ Girar cajas";
    });
    const smoothBtn = button("Filtrado: nítido (L)", () => {
        const smooth = !crate.smooth;
        for (const t of [crate, grass, tree]) t.setSmooth(smooth);
        smoothBtn.textContent = smooth ? "Filtrado: suave (L)" : "Filtrado: nítido (L)";
    });
    const repeatCtl = slider("Repetición del suelo", {
        min: 1, max: 120, value: 60,
        apply: (v) => { app.entities[0].textureRepeat = { x: v, y: v }; }, format: (v) => `${v}×`,
    });

    app.addPanel(
        card("La textura", [preview, hint("64×64, dibujada al arrancar y subida con Texture.fromCanvas")]),
        card("Escena", [
            el("div", { className: "grid2" }, [faceBtn, spinBtn]),
            el("div", { style: "margin-top:8px" }, [smoothBtn]),
            repeatCtl.row, kFacing.row, kTris.row, kCam.row,
        ]),
        card("Qué mirar", [
            hint("Apaga «mirar a cámara» y gira la vista: los árboles se ven de canto y se revelan como láminas. Ese es todo el truco del billboard, y es como se dibuja la vegetación en casi cualquier juego 3D."),
        ]),
    );

    // --- Camera -------------------------------------------------------------
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
    });
    for (const ev of ["pointerup", "pointercancel"]) app.canvas.addEventListener(ev, () => { dragging = null; });
    app.canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        camera.orbit({ distance: clamp(camera.distance + Math.sign(e.deltaY), 5, 40) });
    }, { passive: false });

    app.keyboard.on("b", () => setFacing(!facing)).on("l", () => smoothBtn.click());

    setFacing(true);

    window.raptorSprites3D = {
        app, camera, crate, grass, tree, billboards, crates, globe,
        get facing() { return facing; },
        setFacing,
    };

    app.onUpdate((dt) => {
        elapsed += dt;
        if (spinning) {
            crates.forEach((mesh, i) => mesh.setRotation({ y: elapsed * 25 + i * 40 }));
            globe.setRotation({ y: elapsed * 18 });
        }
        if (facing) {
            // Turn each quad about Y until its face points at the camera. Only
            // yaw: tilting them would make the trees lean as you rise, which
            // looks worse than the flatness it hides.
            for (const mesh of billboards) {
                const dx = camera.position.x - mesh.position.x;
                const dz = camera.position.z - mesh.position.z;
                mesh.setRotation({ x: -90, y: Math.atan2(dx, dz) * RAD_TO_DEG });
            }
        }
        kCam.set(`${Math.round(camera.yaw)}° / ${Math.round(camera.pitch)}°`);
        kTris.set(String(app.entities.reduce((sum, m) => sum + (m.indexCount || 0) / 3, 0)));
    });

    function setFacing(on) {
        facing = on;
        faceBtn.textContent = on ? "🎭 Mirando a cámara (B)" : "🃏 Fijos (B)";
        kFacing.set(on ? "giran hacia la cámara" : "orientación fija");
        if (!on) for (const mesh of billboards) mesh.setRotation({ x: -90, y: 0 });
    }
});
