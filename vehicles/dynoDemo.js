// Engine and gearbox test bed: a long straight strip to play with a drivetrain.
//
// Everything here is in real units — metres, seconds, newtons, N·m — so the
// numbers on the panel mean something. The car is integrated longitudinally:
//
//   tractive force = wheelTorque / wheelRadius        (capped by grip)
//   drag           = ½·ρ·Cd·A·v²
//   rolling        = Crr·m·g
//   a              = (force − drag − rolling) / mass
//
// Revs come *back* from road speed through the gears, which is what makes the
// gearbox interesting: a short gear multiplies torque but runs out of revs, a
// tall one barely pulls. Play with the sliders and watch the curve move.
//
// Controls: W/↑ throttle · S/↓ brake · G auto/manual · Z/X shift · R reset.

import RaptorEngine from "../components/raptorEngine.js";
import { Rectangle } from "../components/shapes/index.js";
import { Gearbox, GEARBOX_MODE } from "../components/controls/index.js";
import { Engine } from "../components/vehicles/index.js";

// The strip: 420 m long, 9 m wide. Roughly 47 times longer than it is wide.
const TRACK = { length: 420, width: 9 };
const MEASURE_AT = 400;      // metres, the classic standing-start run
const SPRINT_TO = 100 / 3.6; // 100 km/h in m/s

// Vehicle. Mass and aero are what stop the engine from being the whole story.
const CAR = {
    mass: 1500,        // kg
    dragArea: 0.42,    // ½·ρ·Cd·A, so drag = dragArea · v²
    rollingCrr: 0.015,
    grip: 1.05,        // µ — caps how much force the tyres can actually put down
    brakeForce: 12000, // N
    length: 4.2,
    width: 1.8,
};
const G = 9.81;

const GEAR_RATIOS = [3.6, 2.1, 1.4, 1.0, 0.8];

const STYLES = `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #e6e6e6; background: #1b1d21; }
    #app { display: flex; gap: 16px; padding: 16px; align-items: flex-start; flex-wrap: wrap; }
    #stage { position: relative; background: #0a0d12; border-radius: 8px; overflow: hidden; box-shadow: 0 6px 24px rgba(0,0,0,.4); }
    #stage canvas { display: block; max-width: 100%; height: auto; touch-action: none; }
    #panel { width: 300px; display: flex; flex-direction: column; gap: 16px; }
    h1 { font-size: 17px; margin: 0 0 4px; }
    h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #9aa0a6; margin: 0 0 10px; }
    .card { background: #26292e; border: 1px solid #33373d; border-radius: 8px; padding: 12px; }
    .kv { display: flex; justify-content: space-between; font-size: 13px; margin: 5px 0; }
    .kv .k { color: #9aa0a6; }
    .kv .v { font-variant-numeric: tabular-nums; }
    .hint { font-size: 12px; color: #7d838a; margin-top: 10px; text-align: center; }
    button { cursor: pointer; border: 1px solid #3a3f45; background: #2f343a; color: #e6e6e6; border-radius: 6px; padding: 9px 10px; font-size: 13px; width: 100%; }
    button:hover { background: #3a4047; }
    button:disabled { opacity: .4; cursor: default; }

    /* Speed + gear headline. */
    .dash { display: flex; align-items: center; gap: 14px; }
    .dash .gear {
        width: 58px; height: 58px; flex: none; border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums;
        background: #1b1d21; border: 1px solid #3a3f45;
    }
    .dash .gear.shifting { color: #7d838a; border-color: #4a7fb5; }
    .dash .speed { font-size: 30px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; }
    .dash .speed small { display: block; font-size: 11px; font-weight: 400; color: #9aa0a6; letter-spacing: .06em; }

    /* Tachometer. */
    .tach { height: 14px; background: #1b1d21; border-radius: 7px; overflow: hidden; border: 1px solid #3a3f45; margin-top: 10px; position: relative; }
    .tach > i { display: block; height: 100%; width: 0; background: #6aa9e0; }
    .tach > u { position: absolute; top: 0; bottom: 0; width: 2px; background: rgba(216,74,58,.85); }
    .tachlbl { display: flex; justify-content: space-between; font-size: 11.5px; color: #9aa0a6; margin-top: 4px; font-variant-numeric: tabular-nums; }

    .curve { display: block; width: 100%; height: auto; border-radius: 6px; background: #14171b; border: 1px solid #3a3f45; }
    .legend { display: flex; gap: 14px; justify-content: center; font-size: 11.5px; color: #9aa0a6; margin-top: 6px; }
    .legend i { display: inline-block; width: 10px; height: 3px; border-radius: 2px; vertical-align: middle; margin-right: 5px; }

    .row { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
    .row label { width: 104px; font-size: 12px; color: #b9bfc6; }
    .row input[type=range] { flex: 1; min-width: 0; }
    .row .val { width: 60px; text-align: right; font-variant-numeric: tabular-nums; font-size: 12px; color: #9aa0a6; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

    @media (max-width: 720px) {
        #app { flex-direction: column; padding: 10px; gap: 10px; }
        #panel { width: 100%; }
    }
`;

function el(tag, props = {}, children = []) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children) node.append(child);
    return node;
}

function slider(label, min, max, step, value, apply, format = (v) => v) {
    const input = el("input", { type: "range", min, max, step, value });
    const val = el("span", { className: "val" });
    const render = () => { val.textContent = format(+input.value); };
    input.oninput = () => { render(); apply(+input.value); };
    render();
    return { row: el("div", { className: "row" }, [el("label", { textContent: label }), input, val]) };
}

function startDemo() {
    document.head.append(el("style", { textContent: STYLES }));

    const game = new RaptorEngine();
    const stage = el("div", { id: "stage" });
    game.createWindow(stage);
    const gl = game.context;

    // --- The strip -------------------------------------------------------
    // Verge first, so the frame is not mostly void once the camera pulls back.
    game.add(new Rectangle(gl, { width: TRACK.length + 40, height: TRACK.width * 5 })
        .setColor({ red: 0.07, green: 0.09, blue: 0.08 })
        .setPosition({ x: TRACK.length / 2, y: 0 }).init());
    for (const side of [-1, 1]) {
        game.add(new Rectangle(gl, { width: TRACK.length + 40, height: 0.35 })
            .setColor({ red: 0.16, green: 0.2, blue: 0.16 })
            .setPosition({ x: TRACK.length / 2, y: side * (TRACK.width / 2 + 1.4) }).init());
    }

    const asphalt = new Rectangle(gl, { width: TRACK.length, height: TRACK.width })
        .setColor({ red: 0.11, green: 0.12, blue: 0.14 })
        .setPosition({ x: TRACK.length / 2, y: 0 }).init();
    game.add(asphalt);

    // Lane dashes down the middle, so speed is legible even on bare asphalt.
    for (let x = 4; x < TRACK.length; x += 12) {
        game.add(new Rectangle(gl, { width: 4, height: 0.18 })
            .setColor({ red: 0.3, green: 0.32, blue: 0.36 }).setPosition({ x, y: 0 }).init());
    }
    // Distance markers along both kerbs; every 100 m gets a taller, brighter one.
    for (let x = 0; x <= TRACK.length; x += 25) {
        const major = x % 100 === 0;
        const color = major ? { red: 0.55, green: 0.58, blue: 0.62 } : { red: 0.26, green: 0.28, blue: 0.32 };
        for (const side of [-1, 1]) {
            game.add(new Rectangle(gl, { width: 0.5, height: major ? 1.6 : 0.9 })
                .setColor(color).setPosition({ x, y: side * (TRACK.width / 2 - 0.5) }).init());
        }
    }
    // Start and measured-distance gates.
    game.add(new Rectangle(gl, { width: 0.5, height: TRACK.width })
        .setColor({ red: 0.85, green: 0.85, blue: 0.9 }).setPosition({ x: 0, y: 0 }).init());
    game.add(new Rectangle(gl, { width: 0.5, height: TRACK.width })
        .setColor({ red: 0.85, green: 0.7, blue: 0.25 }).setPosition({ x: MEASURE_AT, y: 0 }).init());

    // --- The car ---------------------------------------------------------
    const body = new Rectangle(gl, { width: CAR.length, height: CAR.width })
        .setColor({ red: 0.82, green: 0.36, blue: 0.24 }).setPosition({ x: 0, y: 0 }).init();
    const stripe = new Rectangle(gl, { width: CAR.length * 0.55, height: 0.3 })
        .setColor({ red: 0.95, green: 0.82, blue: 0.4 }).init();
    game.add(body);
    game.add(stripe);

    // --- Drivetrain ------------------------------------------------------
    const engine = new Engine();
    const gearbox = new Gearbox({
        engine,
        gearRatios: GEAR_RATIOS,
        finalDrive: 3.9,
        wheelRadius: 0.34,
        shiftTime: 0.22,
        upshiftAt: 0.94,
        downshiftAt: 0.45,
        mode: GEARBOX_MODE.AUTO,
    });

    let speed = 0;        // m/s
    let distance = 0;     // m from the start line
    let throttle = 0;     // 0..1
    let brake = 0;        // 0..1
    let runTime = 0;      // seconds since the car started moving
    let sprintTime = null; // 0-100 km/h
    let measureTime = null; // time at MEASURE_AT
    let trapSpeed = null;  // speed there
    let peakG = 0;

    const camera = game.camera;
    camera.smoothing = 9;

    // --- Panel -----------------------------------------------------------
    const gearBox = el("div", { className: "gear", textContent: "1" });
    const speedNum = el("div", { className: "speed" }, [
        document.createTextNode("0"),
        el("small", { textContent: "KM/H" }),
    ]);
    const tachFill = el("i");
    const redlineMark = el("u");
    const rpmNum = el("span", { textContent: "0 rpm" });
    const redlineNum = el("span");

    const kTorque = kv("Par al cigüeñal"), kWheel = kv("Fuerza a la rueda"),
          kPower = kv("Potencia"), kRatio = kv("Desmultiplicación"), kAccel = kv("Aceleración");

    const CURVE_W = 274, CURVE_H = 128;
    const curve = el("canvas", { width: CURVE_W, height: CURVE_H, className: "curve" });
    const curveCtx = curve.getContext("2d");

    const kSprint = kv("0 → 100 km/h"), kRun = kv(`${MEASURE_AT} m`), kTrap = kv("Velocidad de paso"),
          kDist = kv("Distancia"), kPeakG = kv("G máxima");

    const modeBtn = el("button", { onclick: () => toggleMode() });
    const upBtn = el("button", { textContent: "Subir ▲ (X)", onclick: () => shift(1) });
    const downBtn = el("button", { textContent: "Bajar ▼ (Z)", onclick: () => shift(-1) });
    const resetBtn = el("button", { textContent: "Volver a la salida (R)", onclick: () => reset() });

    const torqueCtl = slider("Par máximo", 180, 600, 10, engine.peakTorque,
        (v) => { engine.peakTorque = v; engine._peak = null; drawCurve(); }, (v) => `${v} Nm`);
    const peakRpmCtl = slider("Par máx a", 1800, 5500, 100, engine.peakTorqueRpm,
        (v) => { engine.peakTorqueRpm = v; engine._peak = null; drawCurve(); }, (v) => `${v} rpm`);
    const redlineCtl = slider("Corte", 4000, 9500, 100, engine.redlineRpm,
        (v) => { engine.redlineRpm = v; engine._peak = null; drawCurve(); }, (v) => `${v} rpm`);
    const finalCtl = slider("Grupo final", 2.5, 5.5, 0.1, gearbox.finalDrive,
        (v) => { gearbox.finalDrive = v; }, (v) => v.toFixed(1));

    const panel = el("div", { id: "panel" }, [
        el("h1", { textContent: "Banco de pruebas · motor y caja" }),
        el("div", { className: "card" }, [
            el("div", { className: "dash" }, [gearBox, speedNum]),
            el("div", { className: "tach" }, [tachFill, redlineMark]),
            el("div", { className: "tachlbl" }, [rpmNum, redlineNum]),
            kTorque.row, kWheel.row, kPower.row, kRatio.row, kAccel.row,
        ]),
        el("div", { className: "card" }, [
            el("h2", { textContent: "Curva de par y potencia" }), curve,
            el("div", { className: "legend" }, [
                el("span", {}, [el("i", { style: "background:#e8c24a" }), document.createTextNode("Par (Nm)")]),
                el("span", {}, [el("i", { style: "background:#6aa9e0" }), document.createTextNode("Potencia (CV)")]),
            ]),
        ]),
        el("div", { className: "card" }, [
            el("h2", { textContent: "Caja de cambios" }),
            modeBtn,
            el("div", { className: "grid2", style: "margin-top:8px" }, [downBtn, upBtn]),
            finalCtl.row,
            el("div", { className: "hint", textContent: "G alterna automática/manual · Z y X cambian de marcha" }),
        ]),
        el("div", { className: "card" }, [
            el("h2", { textContent: "Motor (juega con él)" }),
            torqueCtl.row, peakRpmCtl.row, redlineCtl.row,
        ]),
        el("div", { className: "card" }, [
            el("h2", { textContent: "Cronómetro" }),
            kSprint.row, kRun.row, kTrap.row, kDist.row, kPeakG.row,
            resetBtn,
        ]),
        el("div", { className: "card" }, [
            el("div", { className: "hint", style: "margin:0", textContent: "W/↑ acelera · S/↓ frena · R vuelve a la salida" }),
        ]),
    ]);

    document.body.append(el("div", { id: "app" }, [stage, panel]));

    window.raptorDyno = {
        game, engine, gearbox, reset, toggleMode, shift,
        get state() { return { speed, distance, runTime, sprintTime, measureTime, trapSpeed, peakG, throttle, brake }; },
        set throttle(v) { throttle = v; },
        set brake(v) { brake = v; },
    };

    setMode(GEARBOX_MODE.AUTO);
    drawCurve();
    reset();
    game.addUpdater(update);
    game.start();

    // --- Input -----------------------------------------------------------
    const held = new Set();
    const syncPedals = () => {
        throttle = held.has("w") || held.has("ArrowUp") ? 1 : 0;
        brake = held.has("s") || held.has("ArrowDown") ? 1 : 0;
    };
    window.addEventListener("keydown", (e) => {
        const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (["w", "s", "ArrowUp", "ArrowDown"].includes(k)) { e.preventDefault(); held.add(k); syncPedals(); }
        else if (k === "g") toggleMode();
        else if (k === "x") shift(1);
        else if (k === "z") shift(-1);
        else if (k === "r") reset();
    });
    window.addEventListener("keyup", (e) => {
        held.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
        syncPedals();
    });

    // --- Behaviour -------------------------------------------------------

    function kv(label) {
        const v = el("span", { className: "v", textContent: "—" });
        return { row: el("div", { className: "kv" }, [el("span", { className: "k", textContent: label }), v]), v };
    }

    function setMode(mode) {
        gearbox.setMode(mode);
        const auto = mode === GEARBOX_MODE.AUTO;
        modeBtn.textContent = auto ? "Automática ⇄ pasar a manual" : "Manual ⇄ pasar a automática";
        upBtn.disabled = downBtn.disabled = auto;
    }

    // A declaration, not a const arrow: the debug handle above references it
    // before this point, and only declarations hoist.
    function toggleMode() {
        setMode(gearbox.mode === GEARBOX_MODE.AUTO ? GEARBOX_MODE.MANUAL : GEARBOX_MODE.AUTO);
    }

    function shift(dir) {
        if (gearbox.mode !== GEARBOX_MODE.MANUAL) return;
        if (dir > 0) gearbox.shiftUp(); else gearbox.shiftDown();
    }

    function reset() {
        speed = 0;
        distance = 0;
        runTime = 0;
        sprintTime = null;
        measureTime = null;
        trapSpeed = null;
        peakG = 0;
        gearbox.gear = 1;
        gearbox._shiftFor = 0;
        gearbox.speed = 0;
        camera.zoom = 0.42;
        camera.centerOn(0, 0);
    }

    // Draws torque and power against revs, with a marker where the engine is.
    function drawCurve() {
        const ctx = curveCtx;
        const pad = { l: 6, r: 6, t: 8, b: 16 };
        const w = CURVE_W - pad.l - pad.r;
        const h = CURVE_H - pad.t - pad.b;
        ctx.clearRect(0, 0, CURVE_W, CURVE_H);

        const from = engine.idleRpm;
        const to = engine.redlineRpm;
        const maxT = Math.max(engine.peakTorque * 1.05, 1);
        const maxP = Math.max(engine.peakPower.hp * 1.05, 1);
        const px = (rpm) => pad.l + ((rpm - from) / (to - from)) * w;
        const pyT = (t) => pad.t + h - (t / maxT) * h;
        const pyP = (p) => pad.t + h - (p / maxP) * h;

        // Grid every 1000 rpm.
        ctx.strokeStyle = "#242830";
        ctx.lineWidth = 1;
        for (let rpm = Math.ceil(from / 1000) * 1000; rpm <= to; rpm += 1000) {
            ctx.beginPath();
            ctx.moveTo(px(rpm), pad.t);
            ctx.lineTo(px(rpm), pad.t + h);
            ctx.stroke();
        }

        const line = (color, valueAt, toY) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let i = 0; i <= 80; i++) {
                const rpm = from + ((to - from) * i) / 80;
                const y = toY(valueAt(rpm));
                if (i === 0) ctx.moveTo(px(rpm), y); else ctx.lineTo(px(rpm), y);
            }
            ctx.stroke();
        };
        line("#e8c24a", (r) => engine.torqueAt(r), pyT);
        line("#6aa9e0", (r) => engine.powerHpAt(r), pyP);

        // Peak markers.
        const peak = engine.peakPower;
        ctx.fillStyle = "#e8c24a";
        ctx.beginPath(); ctx.arc(px(engine.peakTorqueRpm), pyT(engine.peakTorque), 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#6aa9e0";
        ctx.beginPath(); ctx.arc(px(peak.rpm), pyP(peak.hp), 3, 0, Math.PI * 2); ctx.fill();

        // Where the engine is right now.
        const rpm = Math.max(from, Math.min(to, gearbox.engineRpm));
        ctx.strokeStyle = "rgba(230,230,230,.55)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px(rpm), pad.t);
        ctx.lineTo(px(rpm), pad.t + h);
        ctx.stroke();

        ctx.fillStyle = "#7d838a";
        ctx.font = "10px system-ui, sans-serif";
        ctx.fillText(`${(from / 1000).toFixed(1)}k`, pad.l, CURVE_H - 4);
        ctx.fillText(`${(to / 1000).toFixed(1)}k rpm`, CURVE_W - 52, CURVE_H - 4);
        ctx.fillStyle = "#e8c24a";
        ctx.fillText(`${Math.round(engine.peakTorque)} Nm`, pad.l + 34, CURVE_H - 4);
        ctx.fillStyle = "#6aa9e0";
        ctx.fillText(`${Math.round(peak.hp)} CV`, pad.l + 90, CURVE_H - 4);
    }

    function update(dt) {
        // The gearbox reads road speed and decides the gear; we read back what
        // the drivetrain is putting down.
        gearbox.update(dt, { speed, throttle });

        const tractive = Math.min(gearbox.wheelForce, CAR.grip * CAR.mass * G) * throttle;
        const drag = CAR.dragArea * speed * speed;
        const rolling = speed > 0.05 ? CAR.rollingCrr * CAR.mass * G : 0;
        const braking = brake * CAR.brakeForce * (speed > 0.05 ? 1 : 0);
        const accel = (tractive - drag - rolling - braking) / CAR.mass;

        speed = Math.max(0, speed + accel * dt);
        // The gear's own redline caps it: you cannot out-rev the ratio.
        speed = Math.min(speed, gearbox.speedLimit);
        distance += speed * dt;

        if (speed > 0.1 || distance > 0) runTime += dt;
        if (accel > peakG * G) peakG = accel / G;
        if (sprintTime === null && speed >= SPRINT_TO) sprintTime = runTime;
        if (measureTime === null && distance >= MEASURE_AT) { measureTime = runTime; trapSpeed = speed; }

        // Ran out of strip: hold at the end.
        if (distance > TRACK.length - CAR.length) { distance = TRACK.length - CAR.length; speed = 0; }

        body.setPosition({ x: distance, y: 0 });
        stripe.setPosition({ x: distance, y: 0 });

        // Pull the view back as it gains speed, so there is road ahead to see.
        const wanted = Math.max(0.2, 0.42 - speed * 0.0035);
        camera.zoom += (wanted - camera.zoom) * Math.min(1, dt * 2);
        const { halfW } = camera.viewExtents(game.canvas);
        camera.bounds = { minX: halfW, maxX: TRACK.length - halfW, minY: 0, maxY: 0 };
        camera.follow({ x: distance + halfW * 0.35, y: 0 }, dt);

        drawHud(accel);
        drawCurve();
    }

    function drawHud(accel) {
        const rpm = gearbox.engineRpm;
        const torque = gearbox.shifting ? 0 : engine.torqueAt(rpm);
        const power = gearbox.shifting ? 0 : engine.powerAt(rpm);

        gearBox.textContent = gearbox.label;
        gearBox.classList.toggle("shifting", gearbox.shifting);
        speedNum.firstChild.nodeValue = (speed * 3.6).toFixed(0);

        const frac = rpm / engine.redlineRpm;
        tachFill.style.width = `${frac * 100}%`;
        tachFill.style.background = gearbox.shifting ? "#7d838a" : frac > 0.92 ? "#d84a3a" : frac > 0.78 ? "#d8b13a" : "#6aa9e0";
        redlineMark.style.left = "92%";
        rpmNum.textContent = `${Math.round(rpm)} rpm`;
        redlineNum.textContent = `corte ${engine.redlineRpm}`;

        kTorque.v.textContent = `${torque.toFixed(0)} Nm @ ${Math.round(rpm)}`;
        kWheel.v.textContent = `${(gearbox.wheelForce * throttle / 1000).toFixed(1)} kN`;
        kPower.v.textContent = `${(power / 1000).toFixed(0)} kW · ${(power / 735.5).toFixed(0)} CV`;
        kRatio.v.textContent = gearbox.gear === 0 ? "—" : `${gearbox.gearRatio.toFixed(2)} × ${gearbox.finalDrive.toFixed(1)}`;
        kAccel.v.textContent = `${accel.toFixed(2)} m/s² (${(accel / G).toFixed(2)} g)`;

        kSprint.v.textContent = sprintTime === null ? "—" : `${sprintTime.toFixed(2)} s`;
        kRun.v.textContent = measureTime === null ? "—" : `${measureTime.toFixed(2)} s`;
        kTrap.v.textContent = trapSpeed === null ? "—" : `${(trapSpeed * 3.6).toFixed(0)} km/h`;
        kDist.v.textContent = `${distance.toFixed(0)} m`;
        kPeakG.v.textContent = `${peakG.toFixed(2)} g`;
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startDemo);
} else {
    startDemo();
}
