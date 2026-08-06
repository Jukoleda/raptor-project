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
const EXPECTED_404 = /ERR_FILE_NOT_FOUND|no-existe\/retrato\.png/;

const suites = [];
const suite = (name, fn) => suites.push({ name, fn });

// --- Every page boots, through the App shell ----------------------------

suite("pages", async () => {
    const pages = [
        ["engine.html", null], ["editor.html", "raptorEditor"], ["tanks.html", "raptorTanks"],
        ["dyno.html", "raptorDyno"], ["drive.html", "raptorDrive"],
        ["sprites.html", "raptorSprites"], ["assets.html", "raptorAssets"],
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
            ok(`${file} construye el panel`, shape.cards > 0, `${shape.cards} tarjetas`);
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

// --- Phone ---------------------------------------------------------------

suite("mobile", async () => {
    for (const file of ["dyno.html", "drive.html", "sprites.html"]) {
        const { page, context, errors } = await open(file, devices["iPhone 12"]);
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
