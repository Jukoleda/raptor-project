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
async function open(file, contextOptions = null) {
    const context = contextOptions ? await browser.newContext(contextOptions) : null;
    const page = context ? await context.newPage() : await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(`file://${join(root, file)}`);
    await page.waitForTimeout(900);
    return { page, context, errors };
}

const suites = [];
const suite = (name, fn) => suites.push({ name, fn });

// --- Every page boots, through the App shell ----------------------------

suite("pages", async () => {
    const pages = [
        ["engine.html", null], ["editor.html", "raptorEditor"], ["tanks.html", "raptorTanks"],
        ["dyno.html", "raptorDyno"], ["drive.html", "raptorDrive"],
    ];
    for (const [file, handle] of pages) {
        const { page, errors } = await open(file);
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

// --- Phone ---------------------------------------------------------------

suite("mobile", async () => {
    for (const file of ["dyno.html", "drive.html"]) {
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
