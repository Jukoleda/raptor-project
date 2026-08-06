// Cannon versus armour, in three dimensions.
//
// The ballistics are not reimplemented: `resolveShot` and the projectile table
// come straight from `components/weapons/`, unchanged. That is the point worth
// making — penetration, ricochet and the slope rule are *simulation*, and
// simulation does not care how many dimensions you draw it in. Only the drawing
// and the angle measurement changed.
//
// What 3D adds that the flat version could not show: you can walk around the
// target and see the plate you are actually hitting.

import App from "../components/app.js";
import { el, kv, slider, card, button, hint } from "../components/ui/index.js";
import {
    Mesh, boxGeometry, cylinderGeometry, sphereGeometry, planeGeometry,
} from "../components/render3d/index.js";
import { PROJECTILES, resolveShot } from "../components/weapons/index.js";
import { clamp, DEG_TO_RAD } from "../components/math/angles.js";

const MUZZLE = { x: -7, y: 1.1, z: 0 };
const TARGET = { x: 3.2, y: 1.1, z: 0 };
const SHELL_SPEED = 22;

const RESULTS = {
    penetration: { label: "PENETRA", color: { red: 0.2, green: 0.9, blue: 0.35 } },
    ricochet: { label: "REBOTE", color: { red: 0.95, green: 0.85, blue: 0.2 } },
    block: { label: "NO PENETRA", color: { red: 0.9, green: 0.25, blue: 0.2 } },
    splash: { label: "ESQUIRLAS", color: { red: 0.95, green: 0.55, blue: 0.2 } },
};

const AMMO = [PROJECTILES.AP, PROJECTILES.APCR, PROJECTILES.HEAT, PROJECTILES.HE];

const STYLES = `
    .ammo { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    button.shell { text-align: left; line-height: 1.3; }
    button.shell.active { border-color: #4a7fb5; background: #2b3a4a; box-shadow: inset 0 0 0 1px #4a7fb5; }
    button.shell b { display: block; font-size: 13px; }
    button.shell small { color: #9aa0a6; font-size: 11px; }
    button.fire { border-color: #7a2f2f; background: #5a2626; font-weight: 600; }
    #result { font-size: 20px; font-weight: 700; letter-spacing: .04em; }
    .bar { height: 12px; background: #1b1d21; border-radius: 6px; overflow: hidden; border: 1px solid #3a3f45; flex: 1; }
    .bar > i { display: block; height: 100%; background: #43c06a; transition: width .15s; }
`;

App.boot({ title: "Cañón vs Blindaje 3D", styles: STYLES, touch: false }, (app) => {
    const gl = app.gl;
    const camera = app.use3D({ clearColor: { red: 0.07, green: 0.08, blue: 0.11 } });
    camera.orbit({ yaw: 18, pitch: 20, distance: 16, target: { x: -1, y: 1, z: 0 } });

    app.add(new Mesh(gl, planeGeometry({ width: 300, depth: 300 }))
        .setColor({ red: 0.14, green: 0.16, blue: 0.19 }).init());

    // --- The gun ----------------------------------------------------------
    app.add(new Mesh(gl, boxGeometry({ width: 1.6, height: 0.8, depth: 1.8 }))
        .setPosition({ x: MUZZLE.x - 0.9, y: 0.4, z: 0 })
        .setColor({ red: 0.32, green: 0.34, blue: 0.38 }).init());
    const barrel = app.add(new Mesh(gl, cylinderGeometry({ radiusTop: 0.13, radiusBottom: 0.16, height: 2.6 }))
        .setPosition({ x: MUZZLE.x, y: MUZZLE.y, z: 0 })
        .setRotation({ z: -90 })
        .setColor({ red: 0.45, green: 0.47, blue: 0.52 })
        .setShininess(40).init());

    // --- The target -------------------------------------------------------
    const hullColor = { red: 0.27, green: 0.55, blue: 0.35 };
    const hull = app.add(new Mesh(gl, boxGeometry({ width: 1.1, height: 1.5, depth: 3.4 }))
        .setPosition(TARGET).setColor(hullColor).init());
    // The plate that actually gets hit, drawn slightly proud of the hull so its
    // angle is visible from any side.
    const plate = app.add(new Mesh(gl, boxGeometry({ width: 0.18, height: 1.5, depth: 3.4 }))
        .setPosition({ x: TARGET.x - 0.62, y: TARGET.y, z: TARGET.z })
        .setColor({ red: 0.34, green: 0.66, blue: 0.42 }).init());
    app.add(new Mesh(gl, cylinderGeometry({ radiusTop: 0.55, radiusBottom: 0.6, height: 0.5 }))
        .setPosition({ x: TARGET.x, y: TARGET.y + 1, z: 0 })
        .setColor({ red: 0.24, green: 0.48, blue: 0.31 }).init());

    let angle = 0;              // grados de inclinación de la placa
    let armorFront = 120;
    let basePenetration = 150;
    let ammo = PROJECTILES.AP;
    let hp = 100;
    let last = null;
    const shells = [];
    const marks = [];

    // --- Panel ------------------------------------------------------------
    const result = el("div", { id: "result", textContent: "—" });
    const kFace = kv("Ángulo de impacto"), kEff = kv("Blindaje efectivo"),
          kPen = kv("Penetración"), kDmg = kv("Daño");
    const hpFill = el("i");
    hpFill.style.width = "100%";

    const fireBtn = button("Disparar (espacio)", () => fire(), { className: "fire" });
    const resetBtn = button("Reiniciar", () => reset());

    const ammoBtns = AMMO.map((type) => button("", () => setAmmo(type), { className: "shell" }));
    const refreshAmmoLabels = () => {
        ammoBtns.forEach((btn, i) => {
            const type = AMMO[i];
            btn.replaceChildren(
                el("b", { textContent: type.name }),
                el("small", { textContent: `${Math.round(basePenetration * type.penMultiplier)} mm · ${Math.round(25 * type.damageMultiplier)} daño` }),
            );
            btn.classList.toggle("active", type === ammo);
        });
    };

    const angleCtl = slider("Inclinación", {
        min: -70, max: 70, value: 0, apply: (v) => setAngle(v), format: (v) => `${v}°`,
    });
    const armorCtl = slider("Blindaje", {
        min: 20, max: 260, step: 5, value: armorFront,
        apply: (v) => { armorFront = v; refreshAmmoLabels(); }, format: (v) => `${v} mm`,
    });
    const penCtl = slider("Penetración base", {
        min: 40, max: 300, step: 5, value: basePenetration,
        apply: (v) => { basePenetration = v; refreshAmmoLabels(); }, format: (v) => `${v} mm`,
    });

    app.addPanel(
        card("Disparo", [
            el("div", { className: "grid2" }, [fireBtn, resetBtn]),
            hint("Espacio dispara · 1-4 cambian munición · arrastra para rodear el blanco"),
        ]),
        card("Munición", [el("div", { className: "ammo" }, ammoBtns), penCtl.row]),
        card("Blanco", [
            angleCtl.row, armorCtl.row,
            el("div", { className: "row" }, [el("label", { textContent: "Integridad" }), el("div", { className: "bar" }, [hpFill])]),
        ]),
        card("Último impacto", [result, kFace.row, kEff.row, kPen.row, kDmg.row]),
    );

    // --- Camera ------------------------------------------------------------
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
        camera.orbit({ distance: clamp(camera.distance + Math.sign(e.deltaY), 7, 34) });
    }, { passive: false });

    app.keyboard.on([" ", "Space"], () => fire());
    AMMO.forEach((type, i) => app.keyboard.on(String(i + 1), () => setAmmo(type)));

    setAmmo(PROJECTILES.AP);
    setAngle(0);

    window.raptorTanks3D = {
        app, camera, hull, plate,
        get last() { return last; },
        get hp() { return hp; },
        get ammo() { return ammo; },
        get angle() { return angle; },
        PROJECTILES, fire, setAngle, setAmmo, reset,
    };

    app.onUpdate((dt) => {
        for (const shell of shells.slice()) {
            shell.mesh.setPosition({ x: shell.mesh.position.x + SHELL_SPEED * dt });
            if (shell.mesh.position.x >= shell.stopAt) {
                app.remove(shell.mesh);
                shells.splice(shells.indexOf(shell), 1);
                shell.onArrive();
            }
        }
        for (const mark of marks.slice()) {
            mark.life -= dt;
            mark.mesh.setScale(0.1 + (1 - mark.life / mark.total) * 0.5);
            mark.mesh.color.alpha = Math.max(0, mark.life / mark.total);
            if (mark.life <= 0) { app.remove(mark.mesh); marks.splice(marks.indexOf(mark), 1); }
        }
    });

    // --- Behaviour ---------------------------------------------------------

    function setAngle(value) {
        angle = clamp(value, -70, 70);
        // Rotating about Y tilts the plate away from the shot: the impact angle
        // measured from the plate's normal is exactly this number.
        plate.setRotation({ y: angle });
        hull.setRotation({ y: angle * 0.25 });
        angleCtl.set(angle);
    }

    function setAmmo(type) {
        ammo = type;
        refreshAmmoLabels();
    }

    function fire() {
        if (shells.length > 0) return;
        const shell = app.add(new Mesh(gl, sphereGeometry({ radius: 0.11, segments: 10, rings: 8 }))
            .setPosition({ x: MUZZLE.x + 1.4, y: MUZZLE.y, z: 0 })
            .setColor({ red: 1, green: 0.85, blue: 0.4 }).init());
        shells.push({ mesh: shell, stopAt: TARGET.x - 0.7, onArrive: resolve });
    }

    function resolve() {
        // The whole physics of it, from the 2D weapons layer, untouched.
        //
        // `evaluateImpact` works on a pair of 2D vectors, and here the geometry
        // lives entirely in the horizontal plane: the shell flies along +X and
        // the plate turns about Y. So the XZ components go in as (x, y) and the
        // model neither knows nor needs to know that a third axis exists.
        const radians = angle * DEG_TO_RAD;
        const shot = resolveShot({
            type: ammo,
            penetration: basePenetration * ammo.penMultiplier,
            damage: 25 * ammo.damageMultiplier,
            direction: { x: 1, y: 0 },
            normal: { x: -Math.cos(radians), y: Math.sin(radians) },
            armor: armorFront,
        });

        last = shot;
        const info = RESULTS[shot.result] || RESULTS.block;
        result.textContent = info.label;
        result.style.color = rgbCss(info.color);
        kFace.set(`${shot.angle.toFixed(0)}° desde la normal`);
        kEff.set(`${Math.round(shot.effectiveArmor)} mm`);
        kPen.set(`${Math.round(shot.penetration)} mm`);
        kDmg.set(shot.damage > 0 ? `${Math.round(shot.damage)}` : "0");

        if (shot.damage > 0) {
            hp = Math.max(0, hp - shot.damage);
            hpFill.style.width = `${hp}%`;
            hpFill.style.background = hp > 50 ? "#43c06a" : hp > 20 ? "#e8c24a" : "#d84a3a";
            const t = 1 - hp / 100;
            hull.setColor({
                red: hullColor.red + (1 - hullColor.red) * t,
                green: hullColor.green * (1 - t * 0.6),
                blue: hullColor.blue * (1 - t * 0.6),
            });
        }

        // A flash at the point of impact, coloured by what happened — the same
        // legend as the panel, so the two agree without reading.
        const mark = app.add(new Mesh(gl, sphereGeometry({ radius: 0.5, segments: 12, rings: 8 }))
            .setPosition({ x: TARGET.x - 0.75, y: TARGET.y, z: 0 })
            .setColor({ ...info.color, alpha: 1 }).init());
        marks.push({ mesh: mark, life: 0.55, total: 0.55 });

        // A ricochet is the one case where the shell keeps going, so it gets to.
        if (shot.result === "ricochet") {
            const bounced = app.add(new Mesh(gl, sphereGeometry({ radius: 0.09, segments: 8, rings: 6 }))
                .setPosition({ x: TARGET.x - 0.8, y: TARGET.y, z: 0 })
                .setColor({ red: 1, green: 0.9, blue: 0.5 }).init());
            marks.push({ mesh: bounced, life: 0.8, total: 0.8 });
        }
    }

    function reset() {
        hp = 100;
        hpFill.style.width = "100%";
        hpFill.style.background = "#43c06a";
        hull.setColor(hullColor);
        result.textContent = "—";
        result.style.color = "";
        for (const k of [kFace, kEff, kPen, kDmg]) k.set("—");
        last = null;
    }

    const rgbCss = ({ red, green, blue }) =>
        `rgb(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(blue * 255)})`;
});
