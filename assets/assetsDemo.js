// The asset loader, with the loading visible instead of hidden.
//
// A loader is the one system whose whole job is to happen before you can see
// anything, so this demo turns it inside out: the manifest is a table you watch
// fill in, with the state, the URL and the time each asset took, plus one entry
// pointed at a file that does not exist so the failure path is on screen rather
// than described.
//
// The assets are **built at startup and served as `data:` URIs** — a real PNG
// through a real `<img>`, real JSON through `fetch`, a real WAV decoded by Web
// Audio. So the async path is genuinely exercised while the page stays a single
// file you can open from `file://`. Pointing the same manifest at real files is
// a change of URL and nothing else.
//
// Controls: R recarga · S suena la moneda · espacio pausa.

import App from "../components/app.js";
import { el, kv, card, button, hint } from "../components/ui/index.js";
import { Sprite } from "../components/shapes/index.js";
import { Assets, SpriteSheet, Animator } from "../components/index.js";

const CELL = 32;
const PPU = 32;
const LAYER = { GROUND: 0, PROP: 10, ACTOR: 20 };

const STYLES = `
    .rows { display: flex; flex-direction: column; gap: 4px; }
    .arow {
        display: grid; grid-template-columns: 12px 1fr auto auto; gap: 8px; align-items: center;
        font-size: 12px; padding: 5px 7px; border-radius: 5px; background: #2f343a;
        border: 1px solid transparent;
    }
    .arow .dot { width: 8px; height: 8px; border-radius: 50%; background: #4a4f57; }
    .arow.loading .dot { background: #e8c24a; }
    .arow.ready   .dot { background: #43c06a; }
    .arow.error   .dot { background: #d84a3a; }
    .arow.error { border-color: #6b2f2f; background: #3a2626; }
    .arow .name { font-weight: 600; }
    .arow .kind { color: #7d838a; font-size: 11px; }
    .arow .ms { color: #9aa0a6; font-variant-numeric: tabular-nums; font-size: 11px; }
    .arow .why { grid-column: 2 / -1; color: #f0a094; font-size: 11px; }

    .prog { height: 8px; border-radius: 4px; overflow: hidden; background: #1b1d21; border: 1px solid #3a3f45; margin: 10px 0 6px; }
    .prog > i { display: block; height: 100%; width: 0; background: #6aa9e0; transition: width .12s ease; }
    .prog.failed > i { background: #d84a3a; }
`;

// --- Building the "files" ------------------------------------------------
// Everything below produces a data: URI. It is the only unusual thing here, and
// it exists so the page needs nothing next to it.

function sheetDataUrl() {
    const canvas = document.createElement("canvas");
    canvas.width = CELL * 4;
    canvas.height = CELL;
    const ctx = canvas.getContext("2d");
    const px = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

    px(0, 0, CELL, CELL, "#2f6b3a");                                     // 0 hierba
    for (const [x, y] of [[5, 7], [19, 4], [11, 20], [25, 24]]) px(x, y, 3, 3, "#387d45");
    px(CELL, 0, CELL, CELL, "#4a4f57");                                  // 1 muro
    px(CELL + 2, 2, CELL - 4, 12, "#585e68");
    px(CELL + 2, 17, CELL - 4, 12, "#585e68");
    px(CELL * 2 + 11, 6, 10, 20, "#f2c518");                             // 2 moneda
    px(CELL * 2 + 14, 9, 4, 14, "#c9a10f");
    px(CELL * 3 + 10, 9, 12, 13, "#e0533d");                             // 3 héroe
    px(CELL * 3 + 12, 4, 8, 6, "#f2a58c");
    px(CELL * 3 + 13, 6, 2, 2, "#1b1d21");
    px(CELL * 3 + 17, 6, 2, 2, "#1b1d21");
    px(CELL * 3 + 11, 22, 4, 7, "#35507f");
    px(CELL * 3 + 17, 22, 4, 7, "#35507f");

    return canvas.toDataURL("image/png");
}

function levelDataUrl() {
    // 1 = muro, 0 = suelo. Small enough to read at a glance in the panel.
    const level = {
        nombre: "Patio",
        tileSize: CELL,
        tiles: [
            "1111111111111",
            "1000000000001",
            "1011110011101",
            "1000000000001",
            "1001100111001",
            "1000000000001",
            "1110011110001",
            "1000000000001",
            "1111111111111",
        ],
        monedas: [[3, 3], [9, 3], [6, 5], [2, 7], [11, 7]],
        inicio: [1, 1],
    };
    return "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(level));
}

// A short chime, written out as an actual RIFF/WAV file so the loader has to
// fetch bytes and hand them to decodeAudioData — the real path, not a shortcut.
function coinDataUrl() {
    const rate = 22050;
    const seconds = 0.28;
    const frames = Math.floor(rate * seconds);
    const bytes = new Uint8Array(44 + frames * 2);
    const view = new DataView(bytes.buffer);
    const ascii = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };

    ascii(0, "RIFF");
    view.setUint32(4, 36 + frames * 2, true);
    ascii(8, "WAVEfmt ");
    view.setUint32(16, 16, true);        // tamaño del bloque fmt
    view.setUint16(20, 1, true);         // PCM
    view.setUint16(22, 1, true);         // mono
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);  // bytes por segundo
    view.setUint16(32, 2, true);         // alineación de bloque
    view.setUint16(34, 16, true);        // bits por muestra
    ascii(36, "data");
    view.setUint32(40, frames * 2, true);

    // Two notes a fifth apart, with a decay: the universal "picked something up".
    for (let i = 0; i < frames; i++) {
        const t = i / rate;
        const hz = t < 0.08 ? 988 : 1319;
        const decay = Math.exp(-t * 11);
        const sample = Math.sin(2 * Math.PI * hz * t) * decay * 0.5;
        view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 32767, true);
    }

    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return "data:audio/wav;base64," + btoa(binary);
}

// Declares the manifest. Shared by the boot load and the "recargar" button, so
// both go through exactly the same code.
function declare(assets, { includeBroken = true } = {}) {
    const sheet = sheetDataUrl();
    assets.add({
        texture: { hoja: sheet },
        json: { nivel: levelDataUrl() },
        sound: { moneda: coinDataUrl() },
        text: { creditos: "data:text/plain;charset=utf-8," + encodeURIComponent("Raptor — demo de carga de assets") },
    });
    // The same file under a second name: the loader must fetch, decode and
    // upload it once, not twice.
    assets.texture("hoja_alias", sheet);
    // And one that is not there, to put the failure path on screen.
    if (includeBroken) assets.texture("retrato", "no-existe/retrato.png");
    return assets;
}

App.boot({
    title: "Carga de assets",
    styles: STYLES,
    touch: false,
    loadingTitle: "Cargando el nivel…",
    // A missing asset must not stop the demo whose subject is missing assets.
    tolerantAssets: true,
    assets: (assets) => declare(assets),
}, (app) => {
    const { gl, keyboard } = app;

    const texture = app.assets.texture("hoja");
    const level = app.assets.json("nivel");
    const sheet = new SpriteSheet(texture, { frameWidth: CELL, frameHeight: CELL });

    // --- The scene, built from the JSON that was just loaded --------------
    const rows = level.tiles.length;
    const cols = level.tiles[0].length;
    const originX = -(cols - 1) / 2;
    const originY = (rows - 1) / 2;
    const place = (frameIndex, col, row, layer, size = null) =>
        app.add(new Sprite(gl, {
            texture, frame: sheet.frame(frameIndex), pixelsPerUnit: PPU, width: size, height: size,
        }).setPosition({ x: originX + col, y: originY - row }).setLayer(layer).init());

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            place(level.tiles[row][col] === "1" ? 1 : 0, col, row, LAYER.GROUND, 1.04);
        }
    }

    const coins = level.monedas.map(([col, row]) => place(2, col, row, LAYER.PROP));
    const hero = place(3, level.inicio[0], level.inicio[1], LAYER.ACTOR);

    // The coins bob, so it is obvious the scene is live and not a screenshot.
    const bobbing = coins.map((coin, i) => ({ coin, base: coin.position.y, phase: i * 0.7 }));

    app.camera.zoom = 0.62;
    app.camera.centerOn(0, 0);

    // --- Panel -------------------------------------------------------------
    const rowsBox = el("div", { className: "rows" });
    const progFill = el("i");
    const progBar = el("div", { className: "prog" }, [progFill]);
    const kTotal = kv("Assets"), kTime = kv("Tiempo total"), kFailed = kv("Fallidos"),
          kCache = kv("Descargas evitadas"), kLevel = kv("Nivel");

    const reloadBtn = button("Recargar todo (R)", () => reload());
    const soundBtn = button("Sonar moneda (S)", () => playCoin());
    const brokenBox = el("input", { type: "checkbox", checked: true });
    const brokenRow = el("label", { className: "row" }, [
        brokenBox, el("span", { textContent: "Incluir un asset roto" }),
    ]);

    app.addPanel(
        card("Manifiesto", [
            progBar, rowsBox,
            kTotal.row, kTime.row, kFailed.row, kCache.row,
            hint("Cada fila es un asset: el punto es su estado y el número, lo que tardó."),
        ]),
        card("Volver a cargar", [
            reloadBtn,
            el("div", { style: "margin-top:8px" }, [soundBtn]),
            brokenRow,
            hint("Recargar usa un Assets nuevo con el mismo manifiesto, para poder ver el proceso en vez de solo el resultado."),
        ]),
        card("Lo que se cargó", [
            kLevel.row,
            el("div", { className: "hint", style: "margin-top:6px; text-align:left" }, [
                el("div", { textContent: app.assets.text("creditos") }),
            ]),
            hint("El mapa de arriba está construido a partir del JSON, con la textura del PNG y el sonido del WAV. Nada de eso venía en el HTML."),
        ]),
    );

    keyboard.on("r", () => reload()).on("s", () => playCoin());

    renderManifest(app.assets);
    kLevel.set(`${level.nombre} · ${cols}×${rows}`);

    window.raptorAssets = {
        app, texture, level, sheet, coins, hero,
        get manifest() { return app.assets.manifest; },
        get failed() { return app.assets.failed.map((e) => ({ key: e.key, error: e.error.message })); },
        reload, playCoin, declare,
        Assets,
    };

    app.onUpdate((dt) => {
        elapsed += dt;
        for (const { coin, base, phase } of bobbing) {
            coin.setPosition({ y: base + Math.sin(elapsed * 3 + phase) * 0.09 });
        }
        hero.setRotation(Math.sin(elapsed * 2) * 4);
    });
    let elapsed = 0;

    // --- Behaviour ---------------------------------------------------------

    function renderManifest(assets, { progress = null } = {}) {
        rowsBox.replaceChildren();
        const manifest = assets.manifest;
        for (const entry of manifest) {
            const row = el("div", { className: `arow ${entry.status}` }, [
                el("span", { className: "dot" }),
                el("span", { className: "name", textContent: entry.key }),
                el("span", { className: "kind", textContent: entry.kind }),
                el("span", { className: "ms", textContent: entry.status === "ready" || entry.status === "error" ? `${entry.ms} ms` : "—" }),
            ]);
            if (entry.error) row.append(el("span", { className: "why", textContent: entry.error }));
            rowsBox.append(row);
        }

        const ready = manifest.filter((e) => e.status === "ready").length;
        const failed = manifest.filter((e) => e.status === "error").length;
        const ratio = progress ? progress.ratio : (ready + failed) / Math.max(1, manifest.length);
        progFill.style.width = `${Math.round(ratio * 100)}%`;
        progBar.classList.toggle("failed", failed > 0);

        kTotal.set(`${ready} de ${manifest.length} listos`);
        kTime.set(`${manifest.reduce((sum, e) => sum + e.ms, 0)} ms`);
        kFailed.set(failed ? `${failed} — mira las filas rojas` : "ninguno");
        // Two keys pointing at one URL: the second is served from the cache, so
        // it costs a lookup rather than a download.
        const urls = new Set(manifest.filter((e) => e.url).map((e) => `${e.kind}:${e.url}`));
        kCache.set(`${manifest.filter((e) => e.url).length - urls.size}`);
    }

    async function reload() {
        reloadBtn.disabled = true;
        const fresh = new Assets({ gl });
        declare(fresh, { includeBroken: brokenBox.checked });
        renderManifest(fresh);
        try {
            await fresh.load({
                tolerant: true,
                onProgress: (progress) => renderManifest(fresh, { progress }),
            });
        } finally {
            renderManifest(fresh);
            // The scene keeps using the textures it already has; this pass is
            // about watching the loader work. Free the new GPU copies so a
            // dozen reloads do not leak a dozen textures.
            fresh.dispose();
            reloadBtn.disabled = false;
        }
    }

    // Playing needs a user gesture — decoding did not, which is why the buffer
    // was already sitting there when the button was first clicked.
    function playCoin() {
        const context = app.assets.audioContext;
        const buffer = app.assets.status("moneda") === "ready" ? app.assets.sound("moneda") : null;
        if (!context || !buffer) return false;
        if (context.state === "suspended") context.resume();
        const source = context.createBufferSource();
        source.buffer = buffer;
        const gain = context.createGain();
        gain.gain.value = 0.5;
        source.connect(gain).connect(context.destination);
        source.start();
        return true;
    }
});
