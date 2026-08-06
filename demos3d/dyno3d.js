// The engine test bed, seen from behind the car.
//
// The drivetrain is the same code as the 2D page: `Engine` for the torque
// curve, `Gearbox` in mechanical mode for the ratios, and the same longitudinal
// integration. Nothing about a torque curve changes with a third axis.
//
// What the third axis buys is the thing the flat version could not give you:
// speed you can feel. A chase camera that drops back and lowers as the car
// gains speed, and kerb markers rushing past, read as velocity in a way a
// number on a panel does not.

import App from "../components/app.js";
import { el, kv, slider, card, button, hint } from "../components/ui/index.js";
import { Mesh, boxGeometry, cylinderGeometry, planeGeometry } from "../components/render3d/index.js";
import { Gearbox, GEARBOX_MODE } from "../components/controls/index.js";
import { Engine } from "../components/vehicles/index.js";
import { clamp } from "../components/math/angles.js";

const TRACK = { length: 420, width: 10 };
const MEASURE_AT = 400;
const SPRINT_TO = 100 / 3.6;
const CAR = { mass: 1500, dragArea: 0.42, rollingCrr: 0.015, grip: 1.05, brakeForce: 12000 };
const G = 9.81;
const GEAR_RATIOS = [3.6, 2.1, 1.4, 1.0, 0.8];

const STYLES = `
    .dash { display: flex; align-items: center; gap: 14px; }
    .dash .gear {
        width: 58px; height: 58px; flex: none; border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums;
        background: #1b1d21; border: 1px solid #3a3f45;
    }
    .dash .gear.shifting { color: #7d838a; border-color: #4a7fb5; }
    .dash .speed { font-size: 30px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; }
    .dash .speed small { display: block; font-size: 11px; font-weight: 400; color: #9aa0a6; }
    .tach { height: 14px; background: #1b1d21; border-radius: 7px; overflow: hidden; border: 1px solid #3a3f45; margin-top: 10px; }
    .tach > i { display: block; height: 100%; width: 0; background: #6aa9e0; }
    .tbtn.gas { background: rgba(38,110,60,.62); border-color: rgba(120,220,150,.45); font-size: 13px; font-weight: 700; }
    .tbtn.gas.on { background: rgba(56,170,90,.88); }
    .tbtn.brake { background: rgba(120,44,38,.62); border-color: rgba(230,140,130,.45); font-size: 13px; font-weight: 700; }
    .tbtn.brake.on { background: rgba(185,62,50,.9); }
`;

App.boot({ title: "Banco de pruebas 3D", styles: STYLES }, (app) => {
    const gl = app.gl;
    const { keyboard, touch } = app;
    const camera = app.use3D({ clearColor: { red: 0.16, green: 0.2, blue: 0.28 } });
    camera.fov = 62;
    camera.far = 900;

    // --- The strip ---------------------------------------------------------
    app.add(new Mesh(gl, planeGeometry({ width: 600, depth: 600 }))
        .setColor({ red: 0.13, green: 0.19, blue: 0.13 }).init());
    app.add(new Mesh(gl, boxGeometry({ width: TRACK.width, height: 0.06, depth: TRACK.length + 40 }))
        .setPosition({ y: 0.03, z: TRACK.length / 2 })
        .setColor({ red: 0.15, green: 0.16, blue: 0.18 }).init());

    // Kerb blocks every four metres. They are what actually convey speed: the
    // asphalt on its own is featureless, so at 200 km/h nothing appears to move.
    for (let z = 0; z <= TRACK.length; z += 4) {
        const major = z % 100 === 0;
        for (const side of [-1, 1]) {
            app.add(new Mesh(gl, boxGeometry({ width: 0.7, height: major ? 1.4 : 0.24, depth: 2 }))
                .setPosition({ x: side * (TRACK.width / 2 + 0.6), y: major ? 0.7 : 0.12, z })
                .setColor(major
                    ? { red: 0.85, green: 0.72, blue: 0.25 }
                    : (z % 8 === 0 ? { red: 0.8, green: 0.28, blue: 0.24 } : { red: 0.85, green: 0.85, blue: 0.87 }))
                .init());
        }
    }
    // Lane dashes and the two gates.
    for (let z = 4; z < TRACK.length; z += 12) {
        app.add(new Mesh(gl, boxGeometry({ width: 0.22, height: 0.02, depth: 4 }))
            .setPosition({ y: 0.07, z }).setColor({ red: 0.42, green: 0.44, blue: 0.48 }).init());
    }
    for (const [z, color] of [[0, { red: 0.9, green: 0.9, blue: 0.95 }], [MEASURE_AT, { red: 0.9, green: 0.75, blue: 0.25 }]]) {
        app.add(new Mesh(gl, boxGeometry({ width: TRACK.width, height: 0.03, depth: 0.5 }))
            .setPosition({ y: 0.08, z }).setColor(color).init());
    }

    // --- The car -----------------------------------------------------------
    const body = app.add(new Mesh(gl, boxGeometry({ width: 1.9, height: 0.7, depth: 4.2 }))
        .setPosition({ y: 0.72 }).setColor({ red: 0.82, green: 0.28, blue: 0.2 }).setShininess(45).init());
    const cabin = app.add(new Mesh(gl, boxGeometry({ width: 1.6, height: 0.6, depth: 2 }))
        .setPosition({ y: 1.32, z: -0.2 }).setColor({ red: 0.2, green: 0.24, blue: 0.3 }).setShininess(70).init());
    const stripe = app.add(new Mesh(gl, boxGeometry({ width: 0.5, height: 0.02, depth: 4.1 }))
        .setPosition({ y: 1.08 }).setColor({ red: 0.95, green: 0.85, blue: 0.4 }).init());
    const wheels = [[-1, 1.4], [1, 1.4], [-1, -1.4], [1, -1.4]].map(([sx, sz]) =>
        app.add(new Mesh(gl, cylinderGeometry({ radiusTop: 0.36, radiusBottom: 0.36, height: 0.3, segments: 16 }))
            .setRotation({ z: 90 })
            .setPosition({ x: sx * 0.98, y: 0.36, z: sz })
            .setColor({ red: 0.11, green: 0.11, blue: 0.13 }).init()));
    const carParts = [body, cabin, stripe, ...wheels];
    const carOffsets = carParts.map((m) => ({ ...m.position }));

    // --- Drivetrain --------------------------------------------------------
    const engine = new Engine();
    const gearbox = new Gearbox({
        engine, gearRatios: GEAR_RATIOS, finalDrive: 3.9, wheelRadius: 0.34,
        shiftTime: 0.22, upshiftAt: 0.94, downshiftAt: 0.45, mode: GEARBOX_MODE.AUTO,
    });

    let speed = 0, distance = 0, throttle = 0, brake = 0, runTime = 0;
    let sprintTime = null, measureTime = null, trapSpeed = null, wheelSpin = 0;

    // --- Panel -------------------------------------------------------------
    const gearBox = el("div", { className: "gear", textContent: "1" });
    const speedNum = el("div", { className: "speed" }, [document.createTextNode("0"), el("small", { textContent: "KM/H" })]);
    const tachFill = el("i");
    const kRpm = kv("Vueltas"), kTorque = kv("Par"), kPower = kv("Potencia"),
          kSprint = kv("0 → 100 km/h"), kRun = kv(`${MEASURE_AT} m`), kTrap = kv("Velocidad de paso"), kDist = kv("Distancia");

    const modeBtn = button("", () => toggleMode());
    const resetBtn = button("Volver a la salida (R)", () => reset());
    const finalCtl = slider("Grupo final", {
        min: 2.5, max: 5.5, step: 0.1, value: 3.9,
        apply: (v) => { gearbox.finalDrive = v; }, format: (v) => v.toFixed(1),
    });

    app.addPanel(
        card(null, [
            el("div", { className: "dash" }, [gearBox, speedNum]),
            el("div", { className: "tach" }, [tachFill]),
            kRpm.row, kTorque.row, kPower.row,
        ]),
        card("Caja de cambios", [modeBtn, finalCtl.row, hint("G automática/manual · Z y X cambian de marcha")]),
        card("Cronómetro", [kSprint.row, kRun.row, kTrap.row, kDist.row, resetBtn]),
        card(null, [hint("W/↑ acelera · S/↓ frena · R vuelve a la salida · o los botones sobre la pista")]),
    );

    // --- Controls ----------------------------------------------------------
    touch.pedal(touch.button("gas", "GAS", "gas"), "gas");
    touch.pedal(touch.button("brake", "FRENO", "brake"), "brake");
    touch.tap(touch.button("up", "▲", "small"), () => shift(1));
    touch.tap(touch.button("down", "▼", "small"), () => shift(-1));
    touch.pad("left", [[touch.get("up"), touch.get("down")]]);
    touch.pad("right", [touch.get("brake"), touch.get("gas")]);

    keyboard.on("g", () => toggleMode()).on("x", () => shift(1)).on("z", () => shift(-1)).on("r", () => reset());

    setMode(GEARBOX_MODE.AUTO);
    reset();

    window.raptorDyno3D = {
        app, camera, engine, gearbox,
        get state() { return { speed, distance, runTime, sprintTime, measureTime, trapSpeed, throttle }; },
        set throttle(v) { v ? keyboard.press("gas") : keyboard.release("gas"); },
        toggleMode, shift, reset,
    };

    app.onUpdate((dt) => {
        throttle = keyboard.isDown("w", "ArrowUp", "gas") ? 1 : 0;
        brake = keyboard.isDown("s", "ArrowDown", "brake") ? 1 : 0;
        touch.setActive("gas", throttle > 0).setActive("brake", brake > 0);

        gearbox.update(dt, { speed, throttle });
        const tractive = Math.min(gearbox.wheelForce, CAR.grip * CAR.mass * G) * throttle;
        const drag = CAR.dragArea * speed * speed;
        const rolling = speed > 0.05 ? CAR.rollingCrr * CAR.mass * G : 0;
        const braking = brake * CAR.brakeForce * (speed > 0.05 ? 1 : 0);
        const accel = (tractive - drag - rolling - braking) / CAR.mass;

        speed = Math.max(0, Math.min(speed + accel * dt, gearbox.speedLimit));
        distance += speed * dt;
        if (speed > 0.1 || distance > 0) runTime += dt;
        if (sprintTime === null && speed >= SPRINT_TO) sprintTime = runTime;
        if (measureTime === null && distance >= MEASURE_AT) { measureTime = runTime; trapSpeed = speed; }
        if (distance > TRACK.length - 6) { distance = TRACK.length - 6; speed = 0; }

        // Move the whole car by moving every part from its own offset.
        carParts.forEach((mesh, i) => mesh.setPosition({ z: carOffsets[i].z + distance }));
        // Wheels turn at the speed the road is passing underneath.
        wheelSpin = (wheelSpin + (speed / 0.36) * dt * (180 / Math.PI)) % 360;
        for (const wheel of wheels) wheel.setRotation({ x: wheelSpin, z: 90 });
        // A little squat under power and dive under braking, which sells weight.
        body.setRotation({ x: clamp(-accel * 0.12, -2.5, 2.5) });

        // The camera drops back and gets lower with speed — the cheapest and
        // most effective speed cue there is.
        const back = 8 + speed * 0.16;
        const height = 3.4 - Math.min(1.4, speed * 0.02);
        camera.lookFrom(
            { x: 0, y: height, z: distance - back },
            { x: 0, y: 1.1, z: distance + 7 },
        );

        drawPanel(accel);
    });

    function drawPanel(accel) {
        const rpm = gearbox.engineRpm;
        const torque = gearbox.shifting ? 0 : engine.torqueAt(rpm);
        const power = gearbox.shifting ? 0 : engine.powerAt(rpm);
        const frac = rpm / engine.redlineRpm;

        gearBox.textContent = gearbox.label;
        gearBox.classList.toggle("shifting", gearbox.shifting);
        speedNum.firstChild.nodeValue = (speed * 3.6).toFixed(0);
        tachFill.style.width = `${Math.min(1, frac) * 100}%`;
        tachFill.style.background = gearbox.shifting ? "#7d838a" : frac > 0.92 ? "#d84a3a" : frac > 0.78 ? "#d8b13a" : "#6aa9e0";

        kRpm.set(`${Math.round(rpm)} rpm`);
        kTorque.set(`${torque.toFixed(0)} Nm`);
        kPower.set(`${(power / 735.5).toFixed(0)} CV · ${accel.toFixed(2)} m/s²`);
        kSprint.set(sprintTime === null ? "—" : `${sprintTime.toFixed(2)} s`);
        kRun.set(measureTime === null ? "—" : `${measureTime.toFixed(2)} s`);
        kTrap.set(trapSpeed === null ? "—" : `${(trapSpeed * 3.6).toFixed(0)} km/h`);
        kDist.set(`${distance.toFixed(0)} m`);
    }

    function setMode(mode) {
        gearbox.setMode(mode);
        modeBtn.textContent = mode === GEARBOX_MODE.AUTO ? "Automática ⇄ pasar a manual" : "Manual ⇄ pasar a automática";
    }
    function toggleMode() {
        setMode(gearbox.mode === GEARBOX_MODE.AUTO ? GEARBOX_MODE.MANUAL : GEARBOX_MODE.AUTO);
    }
    function shift(dir) {
        if (gearbox.mode !== GEARBOX_MODE.MANUAL) return;
        if (dir > 0) gearbox.shiftUp(); else gearbox.shiftDown();
    }
    function reset() {
        speed = 0; distance = 0; runTime = 0;
        sprintTime = null; measureTime = null; trapSpeed = null;
        gearbox.gear = 1; gearbox._shiftFor = 0; gearbox.speed = 0;
    }
});
