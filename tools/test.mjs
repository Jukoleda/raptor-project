// Raptor's test suite. Runs the generated pages in a real browser, because
// that is the only place a WebGL framework is actually true: a module can pass
// every unit test and still blank the page because two bundled files declared
// the same `const`.
//
//     node tools/test.mjs              todo
//     node tools/test.mjs keyboard     sólo los grupos que coincidan
//
// It needs Playwright and Chromium. If they are missing the suite says so and
// exits 0 rather than failing a checkout that simply has not installed them —
// `node tools/build.mjs --check` is the part that always runs.
//
// The graphics stack is software (SwiftShader), so this works headless on CI
// with no GPU.

import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));

// Playwright ships as CommonJS, and a global install is not on the ESM
// resolution path — so fall back to `require`, which honours NODE_PATH.
async function loadPlaywright() {
    try {
        return await import("playwright");
    } catch {
        try {
            const { createRequire } = await import("module");
            return createRequire(import.meta.url)("playwright");
        } catch {
            return null;
        }
    }
}

const playwright = await loadPlaywright();
if (!playwright) {
    console.log("Playwright no está instalado — se omiten las pruebas de navegador.");
    console.log("Instálalo con:  npm i -D playwright && npx playwright install chromium");
    process.exit(0);
}
const { chromium, devices } = playwright;

// The build has to be current or the pages under test are stale.
const build = spawnSync(process.execPath, [join(root, "tools/build.mjs")], { encoding: "utf8" });
if (build.status !== 0) {
    console.error(build.stderr || build.stdout);
    process.exit(1);
}

let passed = 0;
const failures = [];
let group = "";

function ok(label, condition, detail = "") {
    if (condition) { passed++; console.log(`  ok   ${label}${detail ? " — " + detail : ""}`); }
    else { failures.push(`${group} › ${label}${detail ? " — " + detail : ""}`); console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
}

const browser = await chromium.launch({
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});

// Opens a generated page and collects anything the console complains about.
// `expect` is a regex for messages a demo provokes on purpose — the assets one
// loads a missing file to show the failure path, and the browser logs that. It
// is deliberately narrow: everything not matching still counts as a failure.
async function open(file, contextOptions = null, { expect = null } = {}) {
    const context = contextOptions ? await browser.newContext(contextOptions) : null;
    const page = context ? await context.newPage() : await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    const record = (text) => { if (!expect || !expect.test(text)) errors.push(text); };
    page.on("pageerror", (e) => record(String(e)));
    page.on("console", (m) => { if (m.type() === "error") record(m.text()); });
    await page.goto(`file://${join(root, file)}`);
    await page.waitForTimeout(900);
    return { page, context, errors };
}

// The assets demo points one entry at a file that does not exist, on purpose,
// so its failure path is visible. The browser logs that as a console error.
const EXPECTED_404 = /ERR_FILE_NOT_FOUND|no-existe\/(retrato|cartel)\.png/;

const suites = [];
const suite = (name, fn) => suites.push({ name, fn });

// --- Every page boots, through the App shell ----------------------------

suite("pages", async () => {
    const pages = [
        ["engine.html", null], ["editor.html", "raptorEditor"], ["tanks.html", "raptorTanks"],
        ["dyno.html", "raptorDyno"], ["drive.html", "raptorDrive"],
        ["sprites.html", "raptorSprites"], ["assets.html", "raptorAssets"],
        ["bosque.html", "raptorBosque"],
    ];
    for (const [file, handle] of pages) {
        const { page, errors } = await open(file, null, { expect: EXPECTED_404 });
        const shape = await page.evaluate(() => ({
            app: !!document.querySelector("#app"),
            stage: !!document.querySelector("#stage"),
            canvas: !!document.querySelector("#stage canvas"),
            styles: !!document.getElementById("raptor-styles"),
            cards: document.querySelectorAll("#panel .card").length,
        }));
        ok(`${file} carga sin errores`, errors.length === 0, errors.join(" | "));
        ok(`${file} monta el shell de App`, shape.app && shape.stage && shape.canvas && shape.styles, JSON.stringify(shape));
        if (handle) {
            ok(`${file} expone window.${handle}`, await page.evaluate((h) => !!window[h], handle));
            // The game runs full-bleed with no side panel; everything else has one.
            if (file !== "bosque.html") ok(`${file} construye el panel`, shape.cards > 0, `${shape.cards} tarjetas`);
        }
        await page.close();
    }
});

// --- Keyboard: state, actions and the traps that used to bite -----------

suite("keyboard", async () => {
    const { page } = await open("dyno.html");
    const state = () => page.evaluate(() => {
        const k = window.raptorDyno.app.keyboard;
        return { held: [...k.held], down: k.isDown("w", "ArrowUp"), axis: k.axis("s", "w") };
    });

    await page.keyboard.down("w");
    await page.waitForTimeout(80);
    const down = await state();
    ok("una tecla pulsada entra en el conjunto", down.down && down.axis === 1, JSON.stringify(down));

    await page.waitForTimeout(900);
    ok("y mueve el coche de verdad", (await page.evaluate(() => window.raptorDyno.state.speed)) > 3);

    await page.keyboard.up("w");
    await page.waitForTimeout(120);
    ok("al soltarla sale", !(await state()).down);

    // An action must fire once per press, not once per auto-repeat.
    const shifts = await page.evaluate(async () => {
        window.raptorDyno.toggleMode();
        const before = window.raptorDyno.gearbox.gear;
        const kb = window.raptorDyno.app.keyboard;
        kb.press("x"); kb.press("x"); kb.press("x");
        await new Promise((r) => setTimeout(r, 50));
        return { before, after: window.raptorDyno.gearbox.gear };
    });
    ok("una acción ignora la repetición automática", shifts.after === shifts.before + 1, JSON.stringify(shifts));

    // Tabbing out never delivers the keyup: the key must not stay down.
    await page.keyboard.down("w");
    await page.waitForTimeout(60);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.waitForTimeout(60);
    ok("perder el foco suelta las teclas", (await state()).held.length === 0);
    await page.close();
});

// --- TouchPad: touch and keyboard must agree ----------------------------

suite("touch", async () => {
    const { page } = await open("dyno.html");
    const gas = page.locator("#stage .tbtn.gas");
    await gas.dispatchEvent("pointerdown");
    await page.waitForTimeout(500);
    const pressed = await page.evaluate(() => ({
        held: [...window.raptorDyno.app.keyboard.held],
        lit: document.querySelector(".tbtn.gas").classList.contains("on"),
        speed: window.raptorDyno.state.speed,
    }));
    ok("el pedal escribe en el mismo conjunto que el teclado", pressed.held.includes("gas"), JSON.stringify(pressed.held));
    ok("se enciende y acelera", pressed.lit && pressed.speed > 1, JSON.stringify(pressed));
    await gas.dispatchEvent("pointerup");
    await page.waitForTimeout(120);
    ok("al levantar el dedo se suelta", !(await page.evaluate(() => window.raptorDyno.app.keyboard.held.has("gas"))));
    await page.close();
});

// --- App lifecycle -------------------------------------------------------

suite("app", async () => {
    const { page } = await open("dyno.html");
    const distance = () => page.evaluate(() => window.raptorDyno.state.distance);
    await page.evaluate(() => { window.raptorDyno.throttle = 1; });
    await page.waitForTimeout(500);

    await page.evaluate(() => window.raptorDyno.app.pause());
    const paused = await distance();
    await page.waitForTimeout(400);
    ok("pause() detiene el bucle", Math.abs((await distance()) - paused) < 0.001, `${paused.toFixed(2)} m`);
    ok("running refleja el estado", (await page.evaluate(() => window.raptorDyno.app.running)) === false);

    await page.evaluate(() => window.raptorDyno.app.resume());
    await page.waitForTimeout(400);
    const after = await distance();
    ok("resume() lo reanuda", after > paused + 1, `${paused.toFixed(2)} → ${after.toFixed(2)} m`);
    // Resuming must not replay the paused seconds as one enormous step.
    ok("y no recupera el tiempo parado de golpe", after - paused < 30, `avanzó ${(after - paused).toFixed(2)} m`);
    await page.close();
});

// --- Fullscreen and synthesised audio ------------------------------------

suite("audio", async () => {
    const { page } = await open("dyno.html");
    ok("no hay AudioContext antes de un gesto",
        (await page.evaluate(() => !window.raptorDyno.sound.ctx)));

    await page.locator("#stage .tbtn.gas").dispatchEvent("pointerdown");
    await page.waitForTimeout(150);
    ok("un gesto lo arranca", (await page.evaluate(() => window.raptorDyno.sound.running)) === true);

    const pitch = async () => page.evaluate(() => ({
        rpm: window.raptorDyno.gearbox.engineRpm,
        expect: window.raptorDyno.sound.firingHz(window.raptorDyno.gearbox.engineRpm),
        gain: window.raptorDyno.sound.nodes.master.gain.value,
    }));
    const idle = await pitch();
    await page.evaluate(() => { window.raptorDyno.throttle = 1; });
    await page.waitForTimeout(1500);
    const revving = await pitch();
    ok("el tono sube con las vueltas", revving.expect > idle.expect + 5,
        `${idle.expect.toFixed(1)} → ${revving.expect.toFixed(1)} Hz`);
    ok("suena bajo carga", revving.gain > 0.001, `ganancia ${revving.gain.toFixed(4)}`);

    await page.evaluate(() => window.raptorDyno.toggleSound());
    await page.waitForTimeout(300);
    ok("silenciar lo calla", (await pitch()).gain < revving.gain * 0.05);
    await page.close();
});

suite("fullscreen", async () => {
    const { page } = await open("dyno.html");
    await page.evaluate(() => window.raptorDyno.app.toggleFullscreen());
    await page.waitForTimeout(300);
    ok("entra en pantalla completa sobre #app",
        (await page.evaluate(() => document.fullscreenElement?.id)) === "app");
    await page.evaluate(() => window.raptorDyno.app.toggleFullscreen());
    await page.waitForTimeout(300);
    ok("y sale", (await page.evaluate(() => document.fullscreenElement)) === null);
    await page.close();
});

// --- The demos still do what they say ------------------------------------

suite("demos", async () => {
    {
        const { page, errors } = await open("tanks.html");
        const shot = await page.evaluate(async () => {
            window.raptorTanks.setAngle(0);
            window.raptorTanks.setAmmo(window.raptorTanks.PROJECTILES.AP);
            window.raptorTanks.fire();
            await new Promise((r) => setTimeout(r, 900));
            return window.raptorTanks.last;
        });
        ok("tanks: un disparo AP de frente se resuelve", !!shot?.result, JSON.stringify(shot?.result));
        await page.keyboard.down("ArrowRight");
        await page.waitForTimeout(500);
        await page.keyboard.up("ArrowRight");
        const turned = await page.evaluate(() => window.raptorTanks.game.entities.find((e) => e.rotation)?.rotation ?? 0);
        ok("tanks: mantener la flecha gira el casco", turned > 5, `${turned.toFixed(1)}°`);
        ok("tanks: sin errores", errors.length === 0, errors.join(" | "));
        await page.close();
    }
    {
        const { page, errors } = await open("drive.html");
        const before = await page.evaluate(() => window.raptorDrive.tank.turret.rotation);
        await page.keyboard.down("q");
        await page.waitForTimeout(600);
        await page.keyboard.up("q");
        const after = await page.evaluate(() => window.raptorDrive.tank.turret.rotation);
        ok("drive: mantener Q gira la torreta", Math.abs(after - before) > 3, `${before.toFixed(1)}° → ${after.toFixed(1)}°`);
        const battle = await page.evaluate(() => ({
            enemies: window.raptorDrive.enemies.length,
            allies: window.raptorDrive.allies.length,
            over: window.raptorDrive.over,
        }));
        ok("drive: la batalla arranca con los dos bandos",
            battle.enemies > 0 && battle.allies > 0 && !battle.over, JSON.stringify(battle));
        ok("drive: sin errores", errors.length === 0, errors.join(" | "));
        await page.close();
    }
    {
        const { page, errors } = await open("editor.html");
        const fell = await page.evaluate(async () => {
            const buttons = [...document.querySelectorAll("#panel button")];
            buttons.find((b) => b.textContent === "Rectángulo").click();
            document.querySelector("#panel input[type=checkbox]").click();
            const shape = window.raptorEditor.game.entities.at(-1);
            const y0 = shape.position.y;
            buttons.find((b) => b.textContent.includes("Play")).click();
            await new Promise((r) => setTimeout(r, 700));
            return { y0, y1: shape.position.y };
        });
        ok("editor: con gravedad, un cuerpo nuevo cae", fell.y1 < fell.y0 - 0.1, JSON.stringify(fell));
        ok("editor: sin errores", errors.length === 0, errors.join(" | "));
        await page.close();
    }
});


// --- Textures, atlas frames, animation and draw order --------------------

suite("sprites", async () => {
    const { page, errors } = await open("sprites.html");

    const sheet = await page.evaluate(() => ({
        width: window.raptorSprites.texture.width,
        height: window.raptorSprites.texture.height,
        ready: window.raptorSprites.texture.ready,
        columns: window.raptorSprites.sheet.columns,
        rows: window.raptorSprites.sheet.rows,
        count: window.raptorSprites.sheet.count,
    }));
    ok("la textura procedural se sube", sheet.ready && sheet.width === 192 && sheet.height === 96, JSON.stringify(sheet));
    ok("la hoja se corta en 6×3", sheet.columns === 6 && sheet.rows === 3 && sheet.count === 18, JSON.stringify(sheet));

    // The frame rectangle is in pixels; the UVs must be 0..1 and Y-flipped,
    // because a texture's first row is its bottom and a sheet's is its top.
    const uv = await page.evaluate(() => {
        const s = window.raptorSprites;
        const saved = s.player.frame;
        s.player.frame = s.sheet.frame(7);   // columna 1, fila 1
        const coords = s.player.getTextureCoords();
        s.player.frame = saved;
        return coords;
    });
    ok("UV en 0..1, con la Y invertida",
        Math.abs(uv[0] - 1 / 6) < 1e-6 && Math.abs(uv[4] - 1 / 3) < 1e-6
        && Math.abs(uv[1] - 2 / 3) < 1e-6 && Math.abs(uv[3] - 1 / 3) < 1e-6,
        JSON.stringify(uv.map((v) => +v.toFixed(4))));

    const order = await page.evaluate(() => {
        const list = window.raptorSprites.app.entities;
        const layers = list.map((e) => e.layer);
        return {
            sorted: layers.every((v, i) => i === 0 || layers[i - 1] <= v),
            player: list.indexOf(window.raptorSprites.player),
            canopy: list.indexOf(window.raptorSprites.canopies[0]),
            shadow: list.indexOf(window.raptorSprites.shadow),
        };
    });
    ok("las entidades se dibujan en orden de capa", order.sorted, JSON.stringify(order));
    ok("la copa va por encima y la sombra por debajo",
        order.canopy > order.player && order.shadow < order.player, JSON.stringify(order));

    // Re-layering after the fact has to re-sort, not wait for the next add().
    const relayered = await page.evaluate(async () => {
        const s = window.raptorSprites;
        s.player.setLayer(999);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const last = s.app.entities.at(-1) === s.player;
        s.player.setLayer(s.LAYER.ACTOR);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return last && s.app.entities.indexOf(s.player) < s.app.entities.indexOf(s.canopies[0]);
    });
    ok("setLayer() reordena en caliente", relayered);

    const idle = await page.evaluate(() => window.raptorSprites.state);
    ok("en reposo reproduce la animación de espera", idle.animation === "quieto", JSON.stringify(idle));

    await page.keyboard.down("d");
    await page.waitForTimeout(700);
    const walking = await page.evaluate(() => window.raptorSprites.state);
    await page.keyboard.up("d");
    ok("al moverse cambia a andar y avanza",
        walking.animation === "andar" && walking.x > idle.x + 0.5,
        `${idle.x.toFixed(2)} → ${walking.x.toFixed(2)}`);
    ok("mirando a la derecha no se voltea", walking.flipX === false);

    await page.keyboard.down("a");
    await page.waitForTimeout(400);
    ok("hacia la izquierda se voltea", (await page.evaluate(() => window.raptorSprites.state)).flipX === true);
    await page.keyboard.up("a");

    // The frames have to cycle: a still animation is the classic symptom of
    // calling play() every frame and resetting it forever.
    const cycled = await page.evaluate(async () => {
        const s = window.raptorSprites;
        const seen = new Set();
        s.app.keyboard.press("d");
        for (let i = 0; i < 60; i++) {
            await new Promise((r) => requestAnimationFrame(r));
            seen.add(s.animator.current.index);
        }
        s.app.keyboard.release("d");
        return [...seen].sort();
    });
    ok("el ciclo de andar recorre sus 4 fotogramas", cycled.length === 4, JSON.stringify(cycled));

    await page.keyboard.press("2");
    await page.waitForTimeout(100);
    const tinted = await page.evaluate(() => window.raptorSprites.player.color);
    ok("el tinte multiplica el téxel", tinted.red === 1 && tinted.green < 0.5, JSON.stringify(tinted));
    await page.keyboard.press("4");
    await page.waitForTimeout(100);
    ok("el alfa del tinte desvanece", (await page.evaluate(() => window.raptorSprites.player.color.alpha)) < 0.5);
    await page.keyboard.press("1");

    await page.keyboard.press("l");
    await page.waitForTimeout(80);
    ok("L alterna NEAREST/LINEAR", await page.evaluate(() => window.raptorSprites.smooth));
    await page.keyboard.press("l");

    // Two shader programs in one scene is the thing that breaks quietly.
    const mixed = await page.evaluate(async () => {
        const s = window.raptorSprites;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return {
            shadow: s.shadow.program, player: s.player.program,
            glError: s.app.gl.getError(),
        };
    });
    ok("formas de color y sprites conviven sin error de GL",
        mixed.shadow === "color" && mixed.player === "texture" && mixed.glError === 0, JSON.stringify(mixed));

    ok("sprites: sin errores", errors.length === 0, errors.join(" | "));
    await page.close();
});


// --- Assets: manifest, progress, cache and the failure path --------------

suite("assets", async () => {
    const { page, errors } = await open("assets.html", null, { expect: EXPECTED_404 });

    const manifest = await page.evaluate(() => window.raptorAssets.manifest);
    const byKey = Object.fromEntries(manifest.map((e) => [e.key, e]));
    ok("se cargan las cuatro clases de asset",
        ["hoja", "nivel", "moneda", "creditos"].every((k) => byKey[k].status === "ready"),
        manifest.map((e) => `${e.key}:${e.status}`).join(" "));

    // A missing file has to be reported with its reason, and must not stop the
    // rest of the manifest — that is the whole difference between a loader and
    // a pile of awaits.
    ok("el asset roto queda en error, con motivo",
        byKey.retrato.status === "error" && !!byKey.retrato.error, JSON.stringify(byKey.retrato));

    const values = await page.evaluate(() => {
        const a = window.raptorAssets;
        return {
            texW: a.texture.width, texH: a.texture.height,
            level: a.level.nombre, rows: a.level.tiles.length, cols: a.level.tiles[0].length,
            coins: a.coins.length, declared: a.level.monedas.length,
            seconds: +a.app.assets.sound("moneda").duration.toFixed(3),
            entities: a.app.entities.length,
        };
    });
    ok("el PNG llega con su tamaño real", values.texW === 128 && values.texH === 32, JSON.stringify(values));
    ok("el AudioBuffer tiene la duración del WAV", Math.abs(values.seconds - 0.28) < 0.01, `${values.seconds}s`);
    ok("la escena se construye desde el JSON cargado",
        values.level === "Patio" && values.coins === values.declared
        && values.entities === values.rows * values.cols + values.coins + 1,
        `${values.rows}×${values.cols} + ${values.coins} + héroe = ${values.entities}`);

    ok("dos claves con la misma URL comparten una textura",
        await page.evaluate(() => {
            const a = window.raptorAssets.app.assets;
            return a.texture("hoja") === a.texture("hoja_alias");
        }));

    // Reading has to fail loudly, not hand back undefined for someone to trip
    // over three frames later.
    const guards = await page.evaluate(() => {
        const a = window.raptorAssets.app.assets;
        const out = {};
        const grab = (fn) => { try { fn(); return "no lanzó"; } catch (e) { return e.message; } };
        out.failed = grab(() => a.texture("retrato"));
        out.missing = grab(() => a.get("noexiste"));
        out.wrongKind = grab(() => a.json("hoja"));
        const fresh = new window.raptorAssets.Assets({ gl: window.raptorAssets.app.gl });
        fresh.texture("x", "a.png");
        out.pending = grab(() => fresh.texture("x"));
        return out;
    });
    ok("leer uno fallido relanza su error", guards.failed.includes("cargar"), guards.failed);
    ok("leer una clave inexistente avisa", guards.missing.includes("no hay ningún asset"), guards.missing);
    ok("leer con el tipo equivocado avisa", guards.wrongKind.includes("es texture, no json"), guards.wrongKind);
    ok("leer antes de load() señala el await que falta", guards.pending.includes("await"), guards.pending);

    const progress = await page.evaluate(async () => {
        const a = window.raptorAssets;
        const fresh = new a.Assets({ gl: a.app.gl });
        a.declare(fresh);
        const seen = [];
        await fresh.load({ tolerant: true, onProgress: (p) => seen.push({ ratio: +p.ratio.toFixed(3), loaded: p.loaded }) });
        fresh.dispose();
        return seen;
    });
    ok("onProgress avanza de uno en uno y acaba en 1",
        progress.length === 6 && progress.every((p, i) => i === 0 || p.loaded === progress[i - 1].loaded + 1)
        && progress.at(-1).ratio === 1,
        JSON.stringify(progress.map((p) => p.ratio)));

    const strict = await page.evaluate(async () => {
        const a = window.raptorAssets;
        const fresh = new a.Assets({ gl: a.app.gl });
        a.declare(fresh);
        try { await fresh.load(); return "no rechazó"; } catch (e) { return e.message; }
    });
    ok("sin tolerant, load() rechaza nombrando el asset",
        strict.includes("retrato") && strict.includes("fallaron"), strict.split("\n")[0]);

    ok("load() sin nada pendiente resuelve al instante",
        await page.evaluate(async () => {
            const fresh = new window.raptorAssets.Assets({});
            const t = Date.now();
            await fresh.load();
            return Date.now() - t < 50;
        }));

    ok("put() registra algo generado y se lee igual",
        await page.evaluate(() => {
            const fresh = new window.raptorAssets.Assets({});
            fresh.put("a-mano", { hola: 1 });
            return fresh.has("a-mano") && fresh.get("a-mano").hola === 1;
        }));

    ok("la pantalla de carga se retira al terminar",
        (await page.evaluate(() => document.querySelectorAll(".loading").length)) === 0);

    await page.locator("#panel button", { hasText: "Recargar" }).click();
    await page.waitForTimeout(900);
    const reloaded = await page.evaluate(() => ({
        rows: document.querySelectorAll(".arow").length,
        ready: document.querySelectorAll(".arow.ready").length,
        error: document.querySelectorAll(".arow.error").length,
        width: document.querySelector(".prog > i").style.width,
    }));
    ok("recargar repinta la tabla y llega al 100%",
        reloaded.rows === 6 && reloaded.ready === 5 && reloaded.error === 1 && reloaded.width === "100%",
        JSON.stringify(reloaded));

    // Decoding happened without a gesture; only playing needed one.
    await page.locator("#panel button", { hasText: "Sonar" }).click();
    ok("el sonido decodificado suena", await page.evaluate(() => window.raptorAssets.playCoin()));

    ok("assets: sin errores inesperados", errors.length === 0, errors.join(" | "));
    await page.close();
});


// --- Scenes, through the game that uses them -----------------------------

suite("escenas", async () => {
    const { page, errors } = await open("bosque.html");
    await page.waitForFunction(() => window.raptorBosque && window.raptorBosque.scene === "menu", { timeout: 15000 });

    // The menu has to appear *before* the game's assets exist — that is the
    // whole reason a scene declares its own manifest instead of the page doing
    // it all up front.
    const menu = await page.evaluate(() => ({
        scene: window.raptorBosque.scene,
        title: document.querySelector(".menu h1")?.textContent,
        entities: window.raptorBosque.app.entities.length,
        assetsLoaded: window.raptorBosque.app.assets.has("bosque"),
    }));
    ok("arranca en el menú", menu.scene === "menu" && menu.title === "El Bosque", JSON.stringify(menu));
    ok("el menú se dibuja sin esperar a ningún asset",
        menu.entities > 10 && menu.assetsLoaded === false, JSON.stringify(menu));

    await page.evaluate(() => window.raptorBosque.go("juego", { acorns: 6, seconds: 60 }));
    await page.waitForFunction(() => window.raptorBosque.scene === "juego" && window.raptorBosque.state, { timeout: 15000 });

    const game = await page.evaluate(() => ({
        entities: window.raptorBosque.app.entities.length,
        acorns: window.raptorBosque.game.acorns.length,
        canopies: window.raptorBosque.game.canopies.length,
        assets: window.raptorBosque.app.assets.has("bosque") && window.raptorBosque.app.assets.has("bellota"),
        menuGone: !document.querySelector(".menu"),
        hud: !!document.querySelector(".hud"),
    }));
    ok("entrar al juego carga sus assets", game.assets, JSON.stringify(game));
    ok("el bosque se construye", game.entities > 800 && game.canopies > 20 && game.acorns === 6,
        `${game.entities} entidades, ${game.canopies} copas, ${game.acorns} bellotas`);
    ok("el menú se desmonta al salir", game.menuGone && game.hud);

    // Movement, animation and the flip.
    const start = await page.evaluate(() => ({ ...window.raptorBosque.state }));
    await page.keyboard.down("d");
    await page.waitForTimeout(500);
    const moving = await page.evaluate(() => ({ ...window.raptorBosque.state }));
    await page.keyboard.up("d");
    ok("el personaje camina y anima",
        moving.x > start.x + 0.4 && moving.animation === "andar",
        `${start.x.toFixed(2)} → ${moving.x.toFixed(2)}`);
    await page.waitForTimeout(300);
    ok("parado vuelve a la animación de espera",
        (await page.evaluate(() => window.raptorBosque.state.animation)) === "quieto");

    // Collision: held against the map for hundreds of frames, it must stop
    // inside, and pressing a second direction must still slide along the wall.
    const walls = await page.evaluate(async () => {
        const g = window.raptorBosque.game;
        const kb = window.raptorBosque.app.keyboard;
        g.position.x = 0; g.position.y = 0;
        kb.press("w");
        for (let i = 0; i < 300; i++) await new Promise((r) => requestAnimationFrame(r));
        const stuck = { ...g.position };
        kb.press("d");
        for (let i = 0; i < 60; i++) await new Promise((r) => requestAnimationFrame(r));
        kb.release("w"); kb.release("d");
        return { stuck, slid: { ...g.position } };
    });
    ok("los árboles frenan al jugador dentro del mapa",
        Math.abs(walls.stuck.x) < 17 && Math.abs(walls.stuck.y) < 13, JSON.stringify(walls.stuck));
    ok("se desliza a lo largo del obstáculo en vez de clavarse",
        walls.slid.x > walls.stuck.x + 0.2, JSON.stringify(walls));

    const pick = await page.evaluate(async () => {
        const g = window.raptorBosque.game;
        const acorn = g.acorns.find((a) => !a.taken);
        g.position.x = acorn.x; g.position.y = acorn.y;
        const before = g.collected;
        for (let i = 0; i < 5; i++) await new Promise((r) => requestAnimationFrame(r));
        return { before, after: g.collected, hud: document.querySelector(".hud .chip span:last-child").textContent };
    });
    ok("recoger una bellota suma y se ve en el HUD",
        pick.after === pick.before + 1 && pick.hud.startsWith("1"), JSON.stringify(pick));

    await page.keyboard.press("p");
    await page.waitForTimeout(120);
    const paused = await page.evaluate(async () => {
        const g = window.raptorBosque.game;
        const t0 = g.timeLeft, x0 = g.position.x;
        window.raptorBosque.app.keyboard.press("d");
        for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r));
        window.raptorBosque.app.keyboard.release("d");
        return { clock: Math.abs(g.timeLeft - t0) < 0.001, still: Math.abs(g.position.x - x0) < 0.001 };
    });
    ok("la pausa congela el reloj y el movimiento", paused.clock && paused.still, JSON.stringify(paused));
    await page.keyboard.press("p");

    // Winning goes to the end scene, and the forest tears itself down.
    await page.evaluate(async () => {
        const g = window.raptorBosque.game;
        for (const acorn of g.acorns.filter((a) => !a.taken)) {
            g.position.x = acorn.x; g.position.y = acorn.y;
            await new Promise((r) => requestAnimationFrame(r));
            await new Promise((r) => requestAnimationFrame(r));
        }
    });
    await page.waitForFunction(() => window.raptorBosque.scene === "fin", { timeout: 6000 });
    const end = await page.evaluate(() => ({
        won: document.querySelector(".end .verdict")?.classList.contains("won"),
        hudGone: !document.querySelector(".hud"),
        entities: window.raptorBosque.app.entities.length,
        record: window.raptorBosque.scenes.get("fin").result.record,
    }));
    ok("juntarlas todas lleva a la escena final", end.won === true);
    ok("el bosque se desmonta al salir", end.hudGone && end.entities < 20, `${end.entities} entidades`);
    ok("la primera victoria marca récord", end.record === true);

    // Losing.
    await page.evaluate(() => window.raptorBosque.go("juego", { acorns: 6, seconds: 60 }));
    await page.waitForFunction(() => window.raptorBosque.scene === "juego" && window.raptorBosque.state);
    await page.evaluate(() => { window.raptorBosque.game.timeLeft = 0.05; });
    await page.waitForFunction(() => window.raptorBosque.scene === "fin", { timeout: 6000 });
    ok("quedarse sin tiempo lleva a derrota",
        await page.evaluate(() => document.querySelector(".end .verdict").classList.contains("lost")));

    // The point of all the bookkeeping: leaving a scene has to undo everything
    // it registered, or three round trips would triple the entity list.
    const leaks = await page.evaluate(async () => {
        const app = window.raptorBosque.app;
        const counts = [];
        for (let i = 0; i < 3; i++) {
            await window.raptorBosque.go("menu");
            await window.raptorBosque.go("juego", { acorns: 6, seconds: 60 });
            counts.push([
                app.entities.length,
                app.engine.updaters.length,
                document.querySelectorAll("#stage .pad").length,
                document.querySelectorAll("#stage .hud, #stage .menu, #stage .end").length,
            ].join("/"));
        }
        return counts;
    });
    // entidades/updaters/pads/overlays — si alguno crece, una escena no se
    // está desmontando del todo.
    ok("tres idas y vueltas no acumulan entidades, updaters ni nodos",
        leaks.every((c) => c === leaks[0]), leaks.join("  "));

    ok("bosque: sin errores", errors.length === 0, errors.join(" | "));
    await page.close();
});


// --- Optimizaciones: que sigan siendo correctas, no solo rápidas -----------

suite("rendimiento", async () => {
    const { page } = await open("bosque.html");
    await page.waitForFunction(() => window.raptorBosque?.scene === "menu", { timeout: 15000 });
    await page.evaluate(() => window.raptorBosque.go("juego", { acorns: 10, seconds: 600 }));
    await page.waitForFunction(() => window.raptorBosque.state, { timeout: 15000 });
    await page.waitForTimeout(400);

    // The projection matrix is shared per canvas and rebuilt only when the
    // aspect changes. Building one per shape per frame was most of the CPU cost
    // of a draw pass.
    ok("la proyección se comparte por canvas",
        await page.evaluate(() => {
            const c = window.raptorBosque.app.canvas;
            return window.Raptor === undefined
                ? projectionFor(c) === projectionFor(c)   // bundle plano
                : window.Raptor.projectionFor(c) === window.Raptor.projectionFor(c);
        }));

    // The one that matters: culling must never hide something that would have
    // been on screen. Ground truth comes from pushing every vertex through the
    // real matrices, not from a second copy of the cull maths.
    const cull = await page.evaluate(async () => {
        const app = window.raptorBosque.app;
        const g = window.raptorBosque.game;
        const { mat4, vec4 } = glMatrix;
        const results = [];

        for (const [px, py] of [[0, 0], [-14, 10], [14, -10], [0, 11], [-15, 0]]) {
            g.paused = false;
            g.position.x = px; g.position.y = py;
            for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r));
            g.paused = true;

            const cam = app.camera;
            const canvas = app.canvas;
            const aspect = (canvas.clientWidth || canvas.width) / (canvas.clientHeight || canvas.height);
            const proj = mat4.create();
            mat4.perspective(proj, (45 * Math.PI) / 180, aspect, 0.1, 100);
            const { halfW, halfH } = cam.viewExtents(canvas);
            const bounds = { minX: cam.x - halfW, maxX: cam.x + halfW, minY: cam.y - halfH, maxY: cam.y + halfH };

            let onScreen = 0, hidden = 0, drawn = 0;
            for (const e of app.entities) {
                if (!e.getVertices) continue;
                const verts = e.getVertices();
                const mv = mat4.create();
                mat4.translate(mv, mv, [(e.position.x - cam.x) * cam.zoom, (e.position.y - cam.y) * cam.zoom, e.depth]);
                mat4.rotate(mv, mv, (e.rotation * Math.PI) / 180, [0, 0, 1]);
                mat4.scale(mv, mv, [e.scale.x * cam.zoom, e.scale.y * cam.zoom, 1]);
                mat4.multiply(mv, proj, mv);

                let visible = false;
                for (let i = 0; i < verts.length && !visible; i += 2) {
                    const p = vec4.transformMat4(vec4.create(), vec4.fromValues(verts[i], verts[i + 1], 0, 1), mv);
                    if (p[3] <= 0) continue;
                    const nx = p[0] / p[3], ny = p[1] / p[3];
                    if (nx >= -1 && nx <= 1 && ny >= -1 && ny <= 1) visible = true;
                }
                const kept = app.engine.isVisible(e, bounds);
                if (visible) onScreen++;
                if (kept) drawn++;
                if (visible && !kept) hidden++;
            }
            results.push({ at: `${px},${py}`, onScreen, drawn, hidden, total: app.entities.length });
        }
        g.paused = false;
        return results;
    });

    ok("el culling no esconde nada que estuviera en pantalla",
        cull.every((r) => r.hidden === 0), JSON.stringify(cull.map((r) => `${r.at}:${r.hidden}`)));
    ok("y descarta la gran mayoría del mapa",
        cull.every((r) => r.drawn < r.total * 0.15),
        cull.map((r) => `${r.drawn}/${r.total}`).join(" "));

    await page.close();
});

// --- La aleatoriedad tiene que ser reproducible ---------------------------

suite("random", async () => {
    const { page } = await open("bosque.html");
    await page.waitForFunction(() => window.raptorBosque, { timeout: 15000 });

    // A level that cannot be reproduced cannot be tested or shared. The exact
    // sequence matters too: it is the one every map in the repo was built with.
    const seq = await page.evaluate(() => {
        const first = createRandom(20260806);
        const second = createRandom(20260806);
        const a = [], b = [];
        for (let i = 0; i < 5; i++) { a.push(first()); b.push(second()); }
        return { a, b, different: createRandom(1)() !== createRandom(2)() };
    });
    ok("la misma semilla da la misma secuencia",
        seq.a.every((v, i) => v === seq.b[i]), seq.a.map((v) => v.toFixed(4)).join(","));
    ok("semillas distintas divergen", seq.different);
    ok("todo cae en [0, 1)", seq.a.every((v) => v >= 0 && v < 1));

    const ints = await page.evaluate(() => {
        const r = createRandom(7);
        const seen = new Set();
        for (let i = 0; i < 400; i++) seen.add(randomInt(r, 1, 6));
        return [...seen].sort();
    });
    // Inclusive at both ends: "entre 1 y 6" has to be able to give a 6.
    ok("randomInt incluye los dos extremos",
        ints.length === 6 && ints[0] === 1 && ints[5] === 6, JSON.stringify(ints));

    // Two runs of the generator must build the identical forest.
    const same = await page.evaluate(() => {
        const a = generateForest(123), b = generateForest(123), c = generateForest(124);
        const flat = (g) => g.map((row) => row.join("")).join("");
        return { equal: flat(a) === flat(b), differs: flat(a) !== flat(c) };
    });
    ok("el mapa es reproducible desde su semilla", same.equal && same.differs, JSON.stringify(same));
    await page.close();
});

// --- Assets abierto a extensión, cerrado a modificación -------------------

suite("extensible", async () => {
    const { page } = await open("assets.html", null, { expect: EXPECTED_404 });

    // A new kind must be an addition, not an edit: registering one gives it a
    // declaring method and a loading path without touching the class.
    const custom = await page.evaluate(async () => {
        const Assets = window.raptorAssets.Assets;
        Assets.register("mayusculas", async (entry) => {
            const response = await fetch(entry.url);
            return (await response.text()).toUpperCase();
        });
        const assets = new Assets({});
        assets.mayusculas("saludo", "data:text/plain,hola%20bosque");
        await assets.load();
        return { value: assets.mayusculas("saludo"), kind: assets.manifest[0].kind };
    });
    ok("un tipo nuevo se registra sin tocar la clase",
        custom.value === "HOLA BOSQUE" && custom.kind === "mayusculas", JSON.stringify(custom));
    await page.close();
});


// --- 3D: el núcleo y las ocho páginas ------------------------------------

suite("3d", async () => {
    const pages = [
        ["shapes3d.html", "raptorShapes3D"], ["editor3d.html", "raptorEditor3D"],
        ["tanks3d.html", "raptorTanks3D"], ["dyno3d.html", "raptorDyno3D"],
        ["sprites3d.html", "raptorSprites3D"], ["assets3d.html", "raptorAssets3D"],
        ["drive3d.html", "raptorDrive3D"], ["bosque3d.html", "raptorBosque3D"],
    ];
    for (const [file, handle] of pages) {
        const { page, errors } = await open(file, null, { expect: EXPECTED_404 });
        if (file === "bosque3d.html") {
            await page.waitForFunction(() => window.raptorBosque3D?.scene === "menu", { timeout: 15000 });
        }
        const shape = await page.evaluate((h) => {
            const api = window[h];
            const app = api?.app || api?.scenes?.app;
            const gl = app?.gl;
            return {
                handle: !!api,
                // The two bits of state that separate 3D from 2D. Without depth
                // testing a near face does not hide a far one; without backface
                // culling you see the inside of every solid.
                depth: gl ? gl.isEnabled(gl.DEPTH_TEST) : false,
                cull: gl ? gl.isEnabled(gl.CULL_FACE) : false,
                glError: gl ? gl.getError() : -1,
                meshes: app ? app.entities.length : 0,
            };
        }, handle);
        ok(`${file} carga sin errores`, errors.length === 0, errors.join(" | "));
        ok(`${file} está en modo 3D`, shape.handle && shape.depth && shape.cull, JSON.stringify(shape));
        ok(`${file} dibuja sin error de GL`, shape.glError === 0 && shape.meshes > 0, JSON.stringify(shape));
        await page.close();
    }
});

suite("geometria", async () => {
    const { page } = await open("shapes3d.html");
    await page.waitForFunction(() => !!window.raptorShapes3D, { timeout: 15000 });

    // A box's corners cannot be shared: each belongs to three faces pointing
    // three different ways, and a vertex carries one normal.
    const box = await page.evaluate(() => {
        const g = boxGeometry({ width: 2, height: 2, depth: 2 });
        const normals = new Set();
        for (let i = 0; i < g.normals.length; i += 3) normals.add(g.normals.slice(i, i + 3).join(","));
        return { vertices: g.positions.length / 3, triangles: g.indices.length / 3, distinctNormals: normals.size };
    });
    ok("un cubo tiene 24 vértices y 12 triángulos",
        box.vertices === 24 && box.triangles === 12, JSON.stringify(box));
    ok("y seis normales distintas, una por cara", box.distinctNormals === 6, String(box.distinctNormals));

    // On a unit sphere the normal is the position, so every normal is unit length.
    const sphere = await page.evaluate(() => {
        const g = sphereGeometry({ radius: 3, segments: 16, rings: 12 });
        let worst = 0;
        for (let i = 0; i < g.normals.length; i += 3) {
            const length = Math.hypot(g.normals[i], g.normals[i + 1], g.normals[i + 2]);
            worst = Math.max(worst, Math.abs(length - 1));
        }
        return { worst, hasUvs: g.uvs.length / 2 === g.positions.length / 3 };
    });
    ok("las normales de la esfera son unitarias", sphere.worst < 1e-6, `error máx ${sphere.worst.toExponential(1)}`);
    ok("y trae una UV por vértice", sphere.hasUvs);

    // Every index has to point at a vertex that exists — an off-by-one here
    // draws garbage or nothing, with no error from WebGL.
    const bounds = await page.evaluate(() => {
        const builders = [
            ["cubo", boxGeometry({})], ["esfera", sphereGeometry({})],
            ["cilindro", cylinderGeometry({})], ["cono", coneGeometry({})],
            ["plano", planeGeometry({ segmentsX: 3, segmentsZ: 3 })], ["toro", torusGeometry({})],
            ["prisma", prismGeometry({ points: [{ x: 0, z: -1 }, { x: 1, z: 1 }, { x: -1, z: 1 }], height: 1 })],
        ];
        return builders.map(([name, g]) => ({
            name,
            ok: g.indices.every((i) => i >= 0 && i < g.positions.length / 3)
                && g.normals.length === g.positions.length
                && g.indices.length % 3 === 0,
        }));
    });
    ok("todos los constructores dan índices y normales coherentes",
        bounds.every((b) => b.ok), bounds.filter((b) => !b.ok).map((b) => b.name).join(",") || "los siete");

    // The cap-winding bug: with it, looking down at a cylinder you saw straight
    // through the missing top. Both caps must face outwards.
    const caps = await page.evaluate(() => {
        const g = cylinderGeometry({ radiusTop: 1, radiusBottom: 1, height: 2, segments: 8 });
        const area = (sign) => {
            let signedArea = 0;
            for (let t = 0; t < g.indices.length; t += 3) {
                const p = [0, 1, 2].map((k) => {
                    const i = g.indices[t + k] * 3;
                    return { x: g.positions[i], y: g.positions[i + 1], z: g.positions[i + 2] };
                });
                // Only the triangles lying on this cap.
                if (!p.every((v) => Math.abs(v.y - sign) < 1e-6)) continue;
                signedArea += (p[1].x - p[0].x) * (p[2].z - p[0].z) - (p[2].x - p[0].x) * (p[1].z - p[0].z);
            }
            return signedArea;
        };
        return { top: area(1), bottom: area(-1) };
    });
    // Seen from above, an outward-facing top cap winds the opposite way to an
    // outward-facing bottom one — so their signed areas must have opposite signs.
    ok("las dos tapas del cilindro miran hacia fuera",
        caps.top !== 0 && caps.bottom !== 0 && Math.sign(caps.top) !== Math.sign(caps.bottom),
        JSON.stringify(caps));

    await page.close();
});

suite("camara3d", async () => {
    const { page } = await open("shapes3d.html");
    await page.waitForFunction(() => !!window.raptorShapes3D, { timeout: 15000 });

    const orbit = await page.evaluate(() => {
        const camera = window.raptorShapes3D.camera;
        camera.orbit({ yaw: 0, pitch: 0, distance: 10, target: { x: 0, y: 0, z: 0 } });
        const front = { ...camera.position };
        camera.orbit({ yaw: 90 });
        const side = { ...camera.position };
        camera.orbit({ pitch: 400 });     // debe recortarse
        return { front, side, clampedPitch: camera.pitch };
    });
    ok("orbitar coloca la cámara en la esfera",
        Math.abs(orbit.front.z - 10) < 1e-6 && Math.abs(orbit.side.x - 10) < 1e-6,
        JSON.stringify(orbit));
    // At exactly 90° the view direction is parallel to `up` and the matrix
    // collapses, so the pitch is clamped just short of it.
    ok("el cabeceo se recorta antes de la vertical", orbit.clampedPitch === 89, String(orbit.clampedPitch));

    const projected = await page.evaluate(() => {
        const s = window.raptorShapes3D;
        s.camera.orbit({ yaw: 0, pitch: 0, distance: 10, target: { x: 0, y: 0, z: 0 } });
        const centre = s.camera.project({ x: 0, y: 0, z: 0 }, s.app.canvas);
        const behind = s.camera.project({ x: 0, y: 0, z: 30 }, s.app.canvas);
        const right = s.camera.project({ x: 3, y: 0, z: 0 }, s.app.canvas);
        return {
            centreX: centre.x, centreY: centre.y,
            width: s.app.canvas.clientWidth, height: s.app.canvas.clientHeight,
            behind, rightOfCentre: right.x > centre.x,
        };
    });
    ok("el origen se proyecta al centro del canvas",
        Math.abs(projected.centreX - projected.width / 2) < 1
        && Math.abs(projected.centreY - projected.height / 2) < 1,
        JSON.stringify(projected));
    ok("un punto a la derecha cae a la derecha", projected.rightOfCentre);
    ok("lo que queda detrás de la cámara no se proyecta", projected.behind === null);

    // Turning the light off swaps the shader program: same geometry, no volume.
    await page.evaluate(() => window.raptorShapes3D.setLit(false));
    ok("apagar la luz cambia de programa",
        (await page.evaluate(() => window.raptorShapes3D.meshes[0].program)) === "flat3d");
    await page.evaluate(() => window.raptorShapes3D.setLit(true));
    ok("y volver a encenderla lo devuelve",
        (await page.evaluate(() => window.raptorShapes3D.meshes[0].program)) === "lit3d");
    await page.close();
});

// --- Las dos cámaras hablan el mismo idioma -------------------------------
//
// `Camera` y `Camera3D` responden las dos mismas preguntas —«dónde cae esto en
// pantalla» y «qué hay bajo este píxel»— con los mismos nombres y los mismos
// argumentos. Los píxeles que entran son de cliente (lo que da un evento de
// puntero) y los que salen son del canvas (lo que necesita un overlay en CSS).
// Esto no es una preferencia de estilo: el canvas está desplazado dentro de la
// página, así que una implementación que no reste el rect se equivoca por el
// margen entero, y es un fallo que solo se nota apuntando.
suite("camaras", async () => {
    for (const [file, handle, kind] of [["drive.html", "raptorDrive", "2D"], ["drive3d.html", "raptorDrive3D", "3D"]]) {
        const { page } = await open(file);
        await page.waitForFunction((h) => !!window[h], handle, { timeout: 15000 });

        const shape = await page.evaluate((h) => {
            const camera = window[h].camera;
            return ["project", "screenToWorld"].every((m) => typeof camera[m] === "function");
        }, handle);
        ok(`${kind}: la cámara tiene project y screenToWorld`, shape);

        const trip = await page.evaluate((h) => {
            const api = window[h];
            const app = api.app || api.game;
            const canvas = app.canvas;
            const camera = api.camera;
            const rect = canvas.getBoundingClientRect();
            const flat = typeof camera.zoom === "number";     // the 2D one

            // A world point a little off centre, projected and then read back
            // from the pixel it landed on. Everything in one synchronous block,
            // so no frame moves the camera in between.
            const point = flat
                ? { x: camera.x + 1.2, y: camera.y - 0.7 }
                : { x: camera.target.x + 1.5, y: 0, z: camera.target.z + 0.8 };
            const pixels = camera.project(point, canvas);
            // project() gives canvas pixels; screenToWorld() wants client ones.
            const back = camera.screenToWorld(pixels.x + rect.left, pixels.y + rect.top, canvas);

            // And the centre of the canvas, in client pixels, must land where
            // the camera is aimed.
            const centre = camera.screenToWorld(
                rect.left + rect.width / 2, rect.top + rect.height / 2, canvas);

            // In 3D the centre pixel does not land *on* the target: a chase
            // camera looks a little above the ground, so the middle ray carries
            // on past it and meets the floor further away. What must hold is
            // that it lands along the direction the camera is looking.
            let alignment = null;
            if (!flat && centre) {
                const f = camera.forward;
                const fl = Math.hypot(f.x, f.z) || 1;
                const dx = centre.x - camera.position.x;
                const dz = centre.z - camera.position.z;
                const dl = Math.hypot(dx, dz) || 1;
                alignment = (f.x / fl) * (dx / dl) + (f.z / fl) * (dz / dl);   // 1 = dead ahead
            }

            return {
                flat, point, pixels, back, centre, alignment,
                offset: { left: rect.left, top: rect.top },
                aim: flat ? { x: camera.x, y: camera.y } : { x: camera.target.x, z: camera.target.z },
            };
        }, handle);

        // If the canvas sat at the viewport origin this would prove nothing.
        ok(`${kind}: el canvas está desplazado, así que el rect importa`,
            trip.offset.left > 0 && trip.offset.top > 0, JSON.stringify(trip.offset));

        const near = (a, b, tol) => Math.abs(a - b) < tol;
        ok(`${kind}: proyectar y volver devuelve el mismo punto`,
            trip.flat
                ? near(trip.back.x, trip.point.x, 0.01) && near(trip.back.y, trip.point.y, 0.01)
                : near(trip.back.x, trip.point.x, 0.05) && near(trip.back.z, trip.point.z, 0.05),
            JSON.stringify(trip));

        ok(`${kind}: el centro del canvas es a dónde mira la cámara`,
            trip.flat
                ? near(trip.centre.x, trip.aim.x, 0.01) && near(trip.centre.y, trip.aim.y, 0.01)
                : trip.centre !== null && near(trip.alignment, 1, 1e-6),
            JSON.stringify(trip));

        await page.close();
    }

    // The one difference geometry forces: in three dimensions a pixel can point
    // at the sky and meet no ground at all. The flat camera has no sky.
    const { page } = await open("drive3d.html");
    await page.waitForFunction(() => !!window.raptorDrive3D, { timeout: 15000 });
    const sky = await page.evaluate(() => {
        const api = window.raptorDrive3D;
        const canvas = api.app.canvas;
        const rect = canvas.getBoundingClientRect();
        return {
            up: api.camera.screenToWorld(rect.left + rect.width / 2, rect.top + 2, canvas),
            down: api.camera.screenToWorld(rect.left + rect.width / 2, rect.bottom - 2, canvas),
        };
    });
    ok("3D: apuntar al cielo no devuelve punto, apuntar al suelo sí",
        sky.up === null && sky.down !== null, JSON.stringify(sky));
    await page.close();
});

suite("juegos3d", async () => {
    // The forest game: same generator, same collision, three scenes.
    const { page, errors } = await open("bosque3d.html");
    await page.waitForFunction(() => window.raptorBosque3D?.scene === "menu", { timeout: 15000 });
    ok("el bosque 3D arranca en el menú",
        (await page.evaluate(() => window.raptorBosque3D.scene)) === "menu");

    await page.evaluate(() => window.raptorBosque3D.go("juego", { acorns: 8, seconds: 90 }));
    await page.waitForFunction(() => window.raptorBosque3D.state, { timeout: 15000 });
    await page.waitForTimeout(300);

    const start = await page.evaluate(() => ({ ...window.raptorBosque3D.state }));
    await page.keyboard.down("w");
    await page.waitForTimeout(700);
    await page.keyboard.up("w");
    const moved = await page.evaluate(() => ({ ...window.raptorBosque3D.state }));
    ok("el personaje camina por el bosque 3D",
        Math.hypot(moved.x - start.x, moved.y - start.y) > 0.5,
        `(${start.x.toFixed(1)},${start.y.toFixed(1)}) → (${moved.x.toFixed(1)},${moved.y.toFixed(1)})`);

    // The whole point of the port: the collision is the 2D game's, unchanged.
    const walls = await page.evaluate(async () => {
        const g = window.raptorBosque3D.game;
        g.position.x = 0; g.position.y = 0;
        const kb = window.raptorBosque3D.app.keyboard;
        kb.press("w");
        for (let i = 0; i < 260; i++) await new Promise((r) => requestAnimationFrame(r));
        kb.release("w");
        return { ...g.position };
    });
    ok("los árboles siguen frenando, con el mismo código que en 2D",
        Math.abs(walls.x) < 17 && Math.abs(walls.y) < 13, JSON.stringify(walls));

    const picked = await page.evaluate(async () => {
        const g = window.raptorBosque3D.game;
        const acorn = g.acorns.find((a) => !a.taken);
        g.position.x = acorn.x; g.position.y = acorn.y;
        const before = g.collected;
        for (let i = 0; i < 5; i++) await new Promise((r) => requestAnimationFrame(r));
        return { before, after: g.collected };
    });
    ok("recoger una bellota suma", picked.after === picked.before + 1, JSON.stringify(picked));
    ok("bosque3d: sin errores", errors.length === 0, errors.join(" | "));
    await page.close();

    // The battle: not a second implementation, the 2D one seen from behind the
    // hull. Everything below is checking that claim rather than trusting it.
    const battle = await open("drive3d.html");
    await battle.page.waitForFunction(() => !!window.raptorDrive3D, { timeout: 15000 });

    const fought = await battle.page.evaluate(async () => {
        const api = window.raptorDrive3D;
        api.player.tank.turretAngle = 45;
        const fired = api.fire(api.player);
        await new Promise((r) => setTimeout(r, 120));
        return {
            fired, shells: api.shells.length,
            enemies: api.enemies.length, allies: api.allies.length,
            turret: api.player.tank.turretAngle, hull: api.player.tank.rotation,
        };
    });
    ok("drive3d: dispara y la torreta gira aparte del casco",
        fought.fired && fought.shells > 0 && fought.turret === 45 && fought.turret !== fought.hull,
        JSON.stringify(fought));
    ok("drive3d: hay dos escuadrones, no solo enemigos",
        fought.enemies === 5 && fought.allies === 5, JSON.stringify(fought));

    // The garage: four designs, and each one really is a different hull — the
    // 3D mesh is the collision outline extruded, so a different silhouette is a
    // different vertex count.
    const garage = await battle.page.evaluate(() => {
        const api = window.raptorDrive3D;
        const seen = [];
        for (const name of ["medium", "light", "heavy", "hunter"]) {
            api.setDesign(api.TANK_DESIGNS[name]);
            seen.push({
                name,
                design: api.player.tank.design.id,
                hp: api.player.tank.maxHp,
                corners: api.player.tank.hull.getColliderVertices().length,
                faces: api.player.tank.hull.getColliderVertices().map((_, i) => api.player.tank.faceForEdge(i).name),
            });
        }
        api.setDesign(api.TANK_DESIGNS.medium);
        return seen;
    });
    ok("drive3d: el garaje cambia de tanque de verdad",
        garage.every((g) => g.design === g.name)
        && new Set(garage.map((g) => g.corners)).size > 1
        && new Set(garage.map((g) => g.hp)).size > 1,
        JSON.stringify(garage));
    // Every hull has a nose and a back; how many plates sit between them is the
    // design's business. The triangular light tank genuinely has no side plate —
    // both of its flanks are inside the frontal arc — and that is the point of
    // deriving armour from the outline instead of assuming four faces.
    ok("drive3d: el blindaje sale del contorno de cada casco",
        garage.every((g) => g.faces.length === g.corners
            && g.faces.includes("Frontal") && g.faces.includes("Trasera"))
        && garage.some((g) => g.faces.includes("Lateral"))
        && garage.find((g) => g.name === "light").faces.length === 3,
        JSON.stringify(garage.map((g) => [g.name, g.faces])));

    // Ammo: the picker changes what actually leaves the barrel.
    const ammo = await battle.page.evaluate(() => {
        const before = window.raptorDrive3D.ammoId();
        window.raptorDrive3D.cycleAmmo();
        const after = window.raptorDrive3D.ammoId();
        window.raptorDrive3D.setAmmo(window.raptorDrive3D.ammo);
        return { before, after };
    });
    ok("drive3d: el selector de munición cambia el proyectil",
        ammo.before === "AP" && ammo.after !== "AP", JSON.stringify(ammo));

    // Auto-aim: cycling the policy locks a target and swings the gun onto it.
    const aimed = await battle.page.evaluate(async () => {
        const api = window.raptorDrive3D;
        const off = api.autoAim.mode;
        api.cycleAim();                              // OFF → NEAREST
        const mode = api.autoAim.mode;
        await new Promise((r) => setTimeout(r, 400));
        const target = api.lockedOn;
        const error = target ? api.player.tank.aimErrorTo(target.position) : null;
        api.autoAim.setMode("off");
        return { off, mode, locked: !!target, error };
    });
    ok("drive3d: el auto-apuntado engancha un objetivo y gira la torreta",
        aimed.off === "off" && aimed.mode === "nearest" && aimed.locked && aimed.error < 90,
        JSON.stringify(aimed));

    // A shot that lands: the panel readout comes from the 2D penetration model
    // against the plate the raycast actually crossed, not from a flat number.
    // Fired nose to nose at two different hulls, three units apart.
    const shootAt = async (index) => battle.page.evaluate(async (i) => {
        const api = window.raptorDrive3D;
        api.startBattle();
        api.autoAim.setMode("off");
        // Everyone out of the way but the one being shot at, so nothing else
        // wanders into the shell's path.
        for (const u of [...api.allies, ...api.enemies]) u.tank.hull.setPosition({ x: 26, y: 18 });
        const foe = api.enemies[i];
        foe.tank.hull.setPosition({ x: 0, y: 0 });
        foe.tank.hull.rotation = 180;                 // nose toward the player
        foe.tank.turretAngle = 180;
        api.player.tank.hull.setPosition({ x: 0, y: -3 });
        api.player.tank.hull.rotation = 0;
        api.player.tank.turretAngle = 0;              // straight up +Y at the foe
        api.fire(api.player);
        await new Promise((r) => setTimeout(r, 700));
        return { design: foe.tank.design.id, impact: api.lastImpact };
    }, index);

    const boxHull = await shootAt(1);   // "medium": a rectangular hull
    ok("drive3d: un impacto llena el panel desde el modelo de penetración",
        boxHull.impact
        && ["Frontal", "Lateral", "Trasera"].includes(boxHull.impact.face)
        && boxHull.impact.armor > 0 && boxHull.impact.penetration > 0
        && boxHull.impact.angle >= 0 && boxHull.impact.angle <= 180,
        JSON.stringify(boxHull));
    ok("drive3d: de frente contra una placa recta el ángulo es casi cero",
        boxHull.design === "medium" && boxHull.impact.face === "Frontal" && boxHull.impact.angle < 20,
        JSON.stringify(boxHull));

    // The same shot against the triangular light tank meets its nose at a
    // steep slope: same plate name, far more effective armour. That is the
    // whole reason armour is derived from the outline instead of assumed.
    const wedgeHull = await shootAt(0);   // "light": a triangular hull
    ok("drive3d: contra un morro en cuña la misma placa cuenta mucho más",
        wedgeHull.design === "light"
        && wedgeHull.impact.face === "Frontal"
        && wedgeHull.impact.angle > boxHull.impact.angle + 30
        && wedgeHull.impact.effectiveArmor > wedgeHull.impact.armor * 2,
        JSON.stringify(wedgeHull));

    // Auto-fire holds the trigger.
    const auto = await battle.page.evaluate(() => {
        window.raptorDrive3D.toggleAutoFire(true);
        const on = window.raptorDrive3D.autoFire;
        window.raptorDrive3D.toggleAutoFire(false);
        return { on, off: window.raptorDrive3D.autoFire };
    });
    ok("drive3d: el fuego automático se puede activar y apagar",
        auto.on === true && auto.off === false, JSON.stringify(auto));

    // The objective: holding the circle *alone* banks time, and an enemy
    // standing on it with you stops the clock.
    const zone = await battle.page.evaluate(async () => {
        const api = window.raptorDrive3D;
        api.startBattle();
        api.setHold(0, 0);
        // Both squadrons drive for the middle, so park them in a corner first —
        // otherwise whether the zone is held or contested is a race.
        for (const u of [...api.allies, ...api.enemies]) u.tank.hull.setPosition({ x: 26, y: 18 });
        api.player.tank.hull.setPosition({ x: api.ZONE.x, y: api.ZONE.y });
        await new Promise((r) => setTimeout(r, 400));
        const held = { ally: api.hold.ally, state: api.hold.state };

        // Now put an enemy on it too: contested, and the clock stops.
        api.enemies[0].tank.hull.setPosition({ x: api.ZONE.x, y: api.ZONE.y });
        await new Promise((r) => setTimeout(r, 60));
        const banked = api.hold.ally;
        await new Promise((r) => setTimeout(r, 350));
        return { held, contestedState: api.hold.state, banked, after: api.hold.ally };
    });
    ok("drive3d: mantener la zona acumula tiempo",
        zone.held.ally > 0 && zone.held.state === "ally", JSON.stringify(zone));
    ok("drive3d: con los dos bandos dentro el reloj se para",
        zone.contestedState === "contested" && Math.abs(zone.after - zone.banked) < 0.02,
        JSON.stringify(zone));

    // The gearbox is the same one the dyno drives.
    const gears = await battle.page.evaluate(() => {
        const api = window.raptorDrive3D;
        const gb = api.player.gearbox;
        gb.setMode("manual");
        const first = gb.label;
        gb.shiftUp();
        return { first, next: gb.label, mode: gb.mode };
    });
    ok("drive3d: la caja de cambios se puede llevar a mano",
        gears.mode === "manual" && gears.first !== gears.next, JSON.stringify(gears));

    // The FSM is running for both squadrons, not just the enemy.
    const fsm = await battle.page.evaluate(() => {
        const api = window.raptorDrive3D;
        return {
            allies: api.allies.map((u) => u.ai.state),
            enemies: api.enemies.map((u) => u.ai.state),
        };
    });
    ok("drive3d: aliados y enemigos corren la misma máquina de estados",
        fsm.allies.length === 5 && fsm.enemies.length === 5
        && fsm.allies.every((s) => typeof s === "string") && fsm.enemies.every((s) => typeof s === "string"),
        JSON.stringify(fsm));

    ok("drive3d: sin errores", battle.errors.length === 0, battle.errors.join(" | "));
    await battle.page.close();
});

// --- Phone ---------------------------------------------------------------

suite("mobile", async () => {
    for (const file of ["dyno.html", "drive.html", "sprites.html", "bosque.html"]) {
        const { page, context, errors } = await open(file, devices["iPhone 12"]);
        // The game opens on its menu, whose controls are ordinary DOM buttons.
        // The on-screen pad belongs to the forest scene, so get into it first.
        if (file === "bosque.html") {
            await page.waitForFunction(() => window.raptorBosque?.scene === "menu", { timeout: 15000 });
            await page.evaluate(() => window.raptorBosque.go("juego", { acorns: 6, seconds: 60 }));
            await page.waitForFunction(() => window.raptorBosque.state, { timeout: 15000 });
            await page.waitForTimeout(300);
        }
        const fit = await page.evaluate(() => {
            const stage = document.querySelector("#stage").getBoundingClientRect();
            const pads = [...document.querySelectorAll(".pad")];
            return {
                pads: pads.length,
                inside: pads.every((p) => {
                    const b = p.getBoundingClientRect();
                    return b.left >= stage.left - 1 && b.right <= stage.right + 1
                        && b.top >= stage.top - 1 && b.bottom <= stage.bottom + 1;
                }),
                noScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
            };
        });
        ok(`${file}: los mandos caben dentro de la pista`, fit.inside && fit.pads > 0, JSON.stringify(fit));
        ok(`${file}: no hay scroll horizontal`, fit.noScroll);
        ok(`${file}: sin errores`, errors.length === 0, errors.join(" | "));
        await context.close();
    }
});

// --- Run -----------------------------------------------------------------

for (const { name, fn } of suites) {
    if (only.length && !only.some((f) => name.includes(f))) continue;
    group = name;
    console.log(`\n== ${name} ==`);
    await fn();
}

await browser.close();

console.log(failures.length
    ? `\n${failures.length} fallo(s), ${passed} correcto(s):\n  ${failures.join("\n  ")}`
    : `\n${passed} comprobaciones, todo en verde.`);
process.exit(failures.length ? 1 : 0);
