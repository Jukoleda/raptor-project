// The asset loader, with what it loaded standing in front of you.
//
// The 2D page turned the loader inside out and put the manifest on screen as a
// table. This one keeps that table and adds the part a flat page could not
// show: the PNG becomes the skin of a crate, the JSON becomes the arrangement
// of a scene, and the WAV plays when you knock one over. Loading is only
// interesting because of what it lets you build.

import App from "../components/app.js";
import { el, kv, card, button, hint } from "../components/ui/index.js";
import { Mesh, boxGeometry, planeGeometry, sphereGeometry } from "../components/render3d/index.js";
import { Assets } from "../components/assets/index.js";
import { createRandom } from "../components/math/random.js";
import { clamp } from "../components/math/angles.js";

const STYLES = `
    .rows { display: flex; flex-direction: column; gap: 4px; }
    .arow {
        display: grid; grid-template-columns: 12px 1fr auto auto; gap: 8px; align-items: center;
        font-size: 12px; padding: 5px 7px; border-radius: 5px; background: #2f343a; border: 1px solid transparent;
    }
    .arow .dot { width: 8px; height: 8px; border-radius: 50%; background: #4a4f57; }
    .arow.ready .dot { background: #43c06a; }
    .arow.error .dot { background: #d84a3a; }
    .arow.error { border-color: #6b2f2f; background: #3a2626; }
    .arow .name { font-weight: 600; }
    .arow .kind { color: #7d838a; font-size: 11px; }
    .arow .ms { color: #9aa0a6; font-variant-numeric: tabular-nums; font-size: 11px; }
    .arow .why { grid-column: 2 / -1; color: #f0a094; font-size: 11px; }
    .prog { height: 8px; border-radius: 4px; overflow: hidden; background: #1b1d21; border: 1px solid #3a3f45; margin: 10px 0 6px; }
    .prog > i { display: block; height: 100%; width: 0; background: #6aa9e0; transition: width .12s ease; }
    .prog.failed > i { background: #d84a3a; }
`;

function crateUrl() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#7d6a45"; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#5e4a2c";
    for (const [x, y, w, h] of [[0, 0, 64, 5], [0, 59, 64, 5], [0, 0, 5, 64], [59, 0, 5, 64]]) ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#4a3a22"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(5, 5); ctx.lineTo(59, 59); ctx.moveTo(59, 5); ctx.lineTo(5, 59); ctx.stroke();
    return canvas.toDataURL("image/png");
}

function levelUrl() {
    const random = createRandom(4242);
    const crates = [];
    for (let i = 0; i < 12; i++) {
        crates.push({
            x: +((random() - 0.5) * 11).toFixed(2),
            z: +((random() - 0.5) * 11).toFixed(2),
            stack: 1 + Math.floor(random() * 3),
        });
    }
    return "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ nombre: "Almacén", crates }));
}

function thudUrl() {
    const rate = 22050, seconds = 0.22, frames = Math.floor(rate * seconds);
    const bytes = new Uint8Array(44 + frames * 2);
    const view = new DataView(bytes.buffer);
    const ascii = (at, text) => { for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i)); };
    ascii(0, "RIFF"); view.setUint32(4, 36 + frames * 2, true); ascii(8, "WAVEfmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    ascii(36, "data"); view.setUint32(40, frames * 2, true);
    for (let i = 0; i < frames; i++) {
        const t = i / rate;
        const value = (Math.sin(2 * Math.PI * 110 * t) * 0.6 + (Math.random() - 0.5) * 0.4) * Math.exp(-t * 24);
        view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, value)) * 32767, true);
    }
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return "data:audio/wav;base64," + btoa(binary);
}

function declare(assets) {
    const crate = crateUrl();
    assets.add({
        texture: { caja: crate },
        json: { almacen: levelUrl() },
        sound: { golpe: thudUrl() },
    });
    assets.texture("caja_alias", crate);            // misma URL, una sola descarga
    assets.texture("cartel", "no-existe/cartel.png"); // la ruta de fallo, a la vista
    return assets;
}

App.boot({
    title: "Carga de assets 3D", styles: STYLES, touch: false,
    loadingTitle: "Cargando el almacén…", tolerantAssets: true,
    assets: (assets) => declare(assets),
}, (app) => {
    const gl = app.gl;
    const camera = app.use3D({ clearColor: { red: 0.1, green: 0.12, blue: 0.16 } });
    camera.orbit({ yaw: 25, pitch: 30, distance: 18, target: { x: 0, y: 1, z: 0 } });

    const texture = app.assets.texture("caja");
    const level = app.assets.json("almacen");

    app.add(new Mesh(gl, planeGeometry({ width: 120, depth: 120 }))
        .setColor({ red: 0.17, green: 0.18, blue: 0.21 }).init());

    // The scene comes out of the JSON that was just loaded, wearing the PNG that
    // was just loaded. Neither was in the HTML.
    const crates = [];
    for (const spec of level.crates) {
        for (let level2 = 0; level2 < spec.stack; level2++) {
            crates.push(app.add(new Mesh(gl, boxGeometry({ width: 1.1, height: 1.1, depth: 1.1 }), { texture })
                .setPosition({ x: spec.x, y: 0.55 + level2 * 1.12, z: spec.z })
                .setRotation({ y: (spec.x * 17 + level2 * 23) % 360 })
                .init()));
        }
    }

    const ball = app.add(new Mesh(gl, sphereGeometry({ radius: 0.6, segments: 20, rings: 14 }))
        .setPosition({ x: 0, y: 6, z: 0 })
        .setColor({ red: 0.9, green: 0.35, blue: 0.3 }).setShininess(60).init());
    let ballVelocity = 0;

    // --- Panel --------------------------------------------------------------
    const rowsBox = el("div", { className: "rows" });
    const progFill = el("i");
    const progBar = el("div", { className: "prog" }, [progFill]);
    const kTotal = kv("Assets"), kFailed = kv("Fallidos"), kCache = kv("Descargas evitadas"),
          kScene = kv("Escena"), kCrates = kv("Cajas");

    const reloadBtn = button("Recargar (R)", () => reload());
    const dropBtn = button("Soltar la bola (espacio)", () => drop());

    app.addPanel(
        card("Manifiesto", [progBar, rowsBox, kTotal.row, kFailed.row, kCache.row]),
        card("Lo que se cargó", [
            kScene.row, kCrates.row,
            hint("El PNG es la piel de las cajas, el JSON su disposición y el WAV suena al golpear. Nada venía en el HTML."),
        ]),
        card("Probar", [el("div", { className: "grid2" }, [reloadBtn, dropBtn])]),
    );

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
        camera.orbit({ distance: clamp(camera.distance + Math.sign(e.deltaY), 6, 45) });
    }, { passive: false });

    app.keyboard.on("r", () => reload()).on([" ", "Space"], () => drop());

    renderManifest(app.assets);
    kScene.set(level.nombre);
    kCrates.set(`${crates.length} de ${level.crates.length} pilas`);

    window.raptorAssets3D = {
        app, camera, texture, level, crates, Assets, declare, drop, reload,
        get manifest() { return app.assets.manifest; },
        get failed() { return app.assets.failed.map((e) => ({ key: e.key, error: e.error.message })); },
    };

    app.onUpdate((dt) => {
        ballVelocity -= 16 * dt;
        ball.setPosition({ y: ball.position.y + ballVelocity * dt });
        if (ball.position.y <= 0.6) {
            ball.setPosition({ y: 0.6 });
            if (ballVelocity < -1.5) { play("golpe"); ballVelocity = -ballVelocity * 0.45; }
            else ballVelocity = 0;
        }
    });

    function drop() {
        ball.setPosition({ x: (Math.random() - 0.5) * 6, y: 7, z: (Math.random() - 0.5) * 6 });
        ballVelocity = 0;
    }

    function play(key) {
        const context = app.assets.audioContext;
        if (!context || app.assets.status(key) !== "ready") return false;
        if (context.state === "suspended") context.resume();
        const source = context.createBufferSource();
        source.buffer = app.assets.sound(key);
        const gain = context.createGain();
        gain.gain.value = 0.5;
        source.connect(gain).connect(context.destination);
        source.start();
        return true;
    }

    function renderManifest(assets, progress = null) {
        rowsBox.replaceChildren();
        const manifest = assets.manifest;
        for (const entry of manifest) {
            const row = el("div", { className: `arow ${entry.status}` }, [
                el("span", { className: "dot" }),
                el("span", { className: "name", textContent: entry.key }),
                el("span", { className: "kind", textContent: entry.kind }),
                el("span", { className: "ms", textContent: entry.status === "pending" ? "—" : `${entry.ms} ms` }),
            ]);
            if (entry.error) row.append(el("span", { className: "why", textContent: entry.error }));
            rowsBox.append(row);
        }
        const ready = manifest.filter((e) => e.status === "ready").length;
        const failed = manifest.filter((e) => e.status === "error").length;
        progFill.style.width = `${Math.round((progress ? progress.ratio : (ready + failed) / Math.max(1, manifest.length)) * 100)}%`;
        progBar.classList.toggle("failed", failed > 0);
        kTotal.set(`${ready} de ${manifest.length} listos`);
        kFailed.set(failed ? `${failed} — mira las filas rojas` : "ninguno");
        const urls = new Set(manifest.filter((e) => e.url).map((e) => `${e.kind}:${e.url}`));
        kCache.set(String(manifest.filter((e) => e.url).length - urls.size));
    }

    async function reload() {
        reloadBtn.disabled = true;
        const fresh = new Assets({ gl });
        declare(fresh);
        renderManifest(fresh);
        try {
            await fresh.load({ tolerant: true, onProgress: (p) => renderManifest(fresh, p) });
        } finally {
            renderManifest(fresh);
            fresh.dispose();
            reloadBtn.disabled = false;
        }
    }
});
