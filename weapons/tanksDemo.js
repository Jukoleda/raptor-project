// Arcade tanks demo: a cannon on the left fires shells at a target hull on the
// right. Rotate the hull to angle its armor and watch the shell PENETRATE,
// RICOCHET or fail to penetrate — driven by the ballistics penetration model
// (effective armor = nominal / cos(angle)).

import App from "../components/app.js";
import { el, kv, slider, card, button, hint } from "../components/ui/index.js";
import { Rectangle, Circle } from "../components/shapes/index.js";
import { Weapon, Armor, raycastShape, resolveShot, reflect, PROJECTILES } from "../components/weapons/index.js";

const MUZZLE = { x: -2.25, y: 0 };
const CULL = { x: 4.2, y: 3.0 };
const HULL_TURN = 90; // degrees per second while an arrow is held

const RESULT_INFO = {
    penetration: { label: "PENETRA", color: [0.2, 0.9, 0.35] },
    ricochet: { label: "REBOTE", color: [0.95, 0.85, 0.2] },
    block: { label: "NO PENETRA", color: [0.9, 0.25, 0.2] },
    splash: { label: "ESQUIRLAS", color: [0.95, 0.55, 0.2] },
};

// Selectable ammo, in the order shown in the panel.
const AMMO = [PROJECTILES.AP, PROJECTILES.APCR, PROJECTILES.HEAT, PROJECTILES.HE];

// Only this page's own chrome: the panel, rows, buttons and readouts come from
// the framework (components/ui/).
const STYLES = `
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    button.fire { border-color: #7a2f2f; background: #5a2626; font-weight: 600; }
    button.fire:hover:not(:disabled) { background: #6d2e2e; }
    .ammo { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    button.shell { text-align: left; line-height: 1.3; }
    button.shell.active { border-color: #4a7fb5; background: #2b3a4a; box-shadow: inset 0 0 0 1px #4a7fb5; }
    button.shell b { display: block; font-size: 13px; }
    button.shell small { color: #9aa0a6; font-size: 11px; }
    .row .bar { flex: 1; min-width: 0; }
    .bar { height: 12px; background: #1b1d21; border-radius: 6px; overflow: hidden; border: 1px solid #3a3f45; }
    .bar > i { display: block; height: 100%; background: #43c06a; transition: width .12s, background .12s; }
    #result { font-size: 20px; font-weight: 700; letter-spacing: .04em; }
    .armorline { font-size: 12px; color: #9aa0a6; margin-top: 8px; }
`;

App.boot({ title: "Cañón vs Blindaje", styles: STYLES, touch: false }, (app) => {
    const { gl, stage, keyboard } = app;
    const game = app;

    // --- Scene ---
    const cannon = new Rectangle(gl, { width: 0.7, height: 0.28 })
        .setColor({ red: 0.5, green: 0.5, blue: 0.56 }).setPosition({ x: -2.6, y: 0 }).init();
    game.add(cannon);

    const tankColor = { red: 0.27, green: 0.55, blue: 0.35 };
    const tank = new Rectangle(gl, { width: 0.5, height: 2.1 })
        .setColor(tankColor).setPosition({ x: 1.6, y: 0 }).init();
    game.add(tank);

    // Front armor is the hull's left face (edge 3), the one facing the cannon.
    const armor = Armor.rectangle(tank, { front: 120, side: 50, rear: 30, frontEdge: 3, hp: 100 });

    const weapon = new Weapon({ penetration: 150, muzzleSpeed: 10, reload: 0.6, damage: 25 });

    const bullets = [];
    const markers = [];
    let flash = 0;
    let angle = 0;
    let ammo = PROJECTILES.AP; // currently loaded projectile type

    // --- Panel ---
    const fireBtn = button("Disparar", fire, { className: "fire" });
    const resetBtn = button("Reiniciar", reset);

    const penCtl = slider("Penetración base", { min: 40, max: 260, step: 5, value: weapon.penetration,
        apply: (v) => { weapon.penetration = v; refreshAmmo(); } });

    // One button per projectile type; clicking loads it and highlights it.
    const ammoBtns = AMMO.map((type) =>
        el("button", {
            className: "shell",
            onclick: () => setAmmo(type),
        }, [
            el("b", { textContent: type.name }),
            el("small", { textContent: ammoStats(type) }),
        ]),
    );
    const ammoBox = el("div", { className: "ammo" }, ammoBtns);
    const angleCtl = slider("Ángulo hull", { min: -80, max: 80, value: 0, apply: (v) => setAngle(v) });
    const frontCtl = slider("Blindaje frontal", { min: 20, max: 220, step: 5, value: armor.faces[3].armor,
        apply: (v) => { armor.faces[3].armor = v; refreshArmorLine(); } });

    const armorLine = el("div", { className: "armorline" });
    const hpFill = el("i");
    hpFill.style.width = "100%";
    const hpBar = el("div", { className: "bar" }, [hpFill]);

    const result = el("div", { id: "result", textContent: "—" });
    const kFace = kv("Cara"), kAngle = kv("Ángulo impacto"), kEff = kv("Blindaje efectivo"), kPen = kv("Penetración"), kDmg = kv("Daño");

    app.addPanel(
        card("Disparo", [
            el("div", { className: "grid" }, [fireBtn, resetBtn]),
            hint("Espacio dispara · ←/→ giran el hull · 1-4 cambian munición"),
        ]),
        card("Munición", [ammoBox, penCtl.row]),
        card("Blanco", [
            angleCtl.row, frontCtl.row, armorLine,
            el("div", { className: "row" }, [el("label", { textContent: "Integridad" }), hpBar]),
        ]),
        card("Último impacto", [result, kFace.row, kAngle.row, kEff.row, kPen.row, kDmg.row]),
    );
    refreshArmorLine();
    refreshAmmo();
    updateHp();

    // Debug handle for the console / automated tests.
    const api = { game, weapon, armor, bullets, fire, setAngle, setAmmo, PROJECTILES, get ammo() { return ammo; }, last: null };
    window.raptorTanks = api;

    app.onUpdate(update);

    // --- Input ---
    // Firing and loading are one-shot; the arrows are *held*, so they are read
    // per frame in update() instead — that keeps the hull turning at the same
    // rate whatever the key-repeat setting is.
    keyboard.on([" ", "Space"], () => fire());
    for (let i = 0; i < AMMO.length; i++) keyboard.on(String(i + 1), () => setAmmo(AMMO[i]));
    stage.addEventListener("click", fire);

    // --- Behaviour ---

    function refreshArmorLine() {
        // Faces: [0]=side, [1]=rear, [2]=side, [3]=front (frontEdge = 3).
        armorLine.textContent = `Frontal ${armor.faces[3].armor} · Lateral ${armor.faces[0].armor} · Trasera ${armor.faces[1].armor} mm`;
    }

    function setAngle(v) {
        angle = Math.max(-80, Math.min(80, v));
        tank.setRotation(angle);
        angleCtl.set(angle);
    }

    // Short one-line summary of what a shell does, for its button label.
    function ammoStats(type) {
        const pen = Math.round(weapon.penetration * type.penMultiplier);
        const dmg = Math.round(weapon.damage * type.damageMultiplier);
        return `${pen} mm · ${dmg} daño`;
    }

    function setAmmo(type) {
        ammo = type;
        weapon.type = type;
        refreshAmmo();
    }

    // Reflect the loaded type in the selector (highlight + fresh stats).
    function refreshAmmo() {
        AMMO.forEach((type, i) => {
            ammoBtns[i].classList.toggle("active", type === ammo);
            ammoBtns[i].querySelector("small").textContent = ammoStats(type);
        });
    }

    function fire() {
        const bullet = weapon.fire(MUZZLE.x, MUZZLE.y, 1, 0, null, ammo);
        if (!bullet) return;
        bullet._entity = new Circle(gl, { radius: 0.05 })
            .setColor({ red: 1, green: 0.8, blue: 0.2 }).setPosition({ x: MUZZLE.x, y: MUZZLE.y }).init();
        game.add(bullet._entity);
        bullets.push(bullet);
    }

    function spawnMarker(point, resultKey) {
        const [r, g, b] = RESULT_INFO[resultKey].color;
        const marker = new Circle(gl, { radius: 0.09 })
            .setColor({ red: r, green: g, blue: b }).setPosition(point).init();
        game.add(marker);
        markers.push({ shape: marker, life: 0.5 });
    }

    function showImpact(shot, face, penetration) {
        // A blocked hit that still chips the target (HE fragments) reads as
        // "ESQUIRLAS" rather than a flat "NO PENETRA".
        const key = shot.result === "block" && shot.damage > 0 ? "splash" : shot.result;
        const info = RESULT_INFO[key];
        api.last = { type: shot.type.id, result: shot.result, dealt: shot.damage, face: face.name, armor: face.armor, angle: shot.angle, effectiveArmor: shot.effectiveArmor, penetration };
        result.textContent = `${info.label} · ${shot.type.name}`;
        result.style.color = `rgb(${info.color.map((c) => Math.round(c * 255)).join(",")})`;
        kFace.v.textContent = `${face.name} (${face.armor} mm)`;
        kAngle.v.textContent = `${shot.angle.toFixed(0)}°`;
        kEff.v.textContent = Number.isFinite(shot.effectiveArmor) ? `${shot.effectiveArmor.toFixed(0)} mm` : "∞";
        kPen.v.textContent = `${Math.round(penetration)} mm`;
        kDmg.v.textContent = shot.damage > 0 ? `${Math.round(shot.damage)} HP` : "—";
    }

    function killBullet(bullet, at) {
        bullet.alive = false;
        if (at) bullet._entity.setPosition(at);
    }

    function destroyTank() {
        tank.setColor({ red: 0.25, green: 0.25, blue: 0.28 });
    }

    function reset() {
        for (const b of bullets) game.remove(b._entity);
        bullets.length = 0;
        for (const m of markers) game.remove(m.shape);
        markers.length = 0;
        armor.hp = armor.maxHp;
        armor.alive = true;
        tank.setColor(tankColor);
        setAngle(0);
        result.textContent = "—";
        result.style.color = "";
        kFace.v.textContent = kAngle.v.textContent = kEff.v.textContent = kPen.v.textContent = kDmg.v.textContent = "—";
        updateHp();
    }

    function updateHp() {
        const pct = (armor.hp / armor.maxHp) * 100;
        hpFill.style.width = `${pct}%`;
        hpFill.style.background = pct > 50 ? "#43c06a" : pct > 20 ? "#d8b13a" : "#d84a3a";
    }

    function update(dt) {
        const spin = keyboard.axis("ArrowLeft", "ArrowRight");
        if (spin) setAngle(angle + spin * HULL_TURN * dt);

        weapon.update(dt);
        fireBtn.disabled = !weapon.ready;
        fireBtn.textContent = weapon.ready ? "Disparar" : "Recargando…";

        for (const bullet of bullets.slice()) {
            bullet.update(dt);

            if (armor.alive) {
                const hit = raycastShape(bullet.prev, bullet.position, tank);
                if (hit) {
                    const face = armor.faceForEdge(hit.edgeIndex);
                    const shot = resolveShot({
                        type: bullet.type,
                        penetration: bullet.penetration,
                        damage: bullet.damage,
                        direction: bullet.direction,
                        normal: hit.normal,
                        armor: face.armor,
                    });
                    const markerKey = shot.result === "block" && shot.damage > 0 ? "splash" : shot.result;
                    spawnMarker(hit.point, markerKey);
                    showImpact(shot, face, bullet.penetration);

                    if (shot.result === "ricochet") {
                        bullet.velocity = reflect(bullet.velocity, hit.normal);
                        bullet.velocity.x *= 0.7;
                        bullet.velocity.y *= 0.7;
                        bullet.penetration *= 0.8;
                        bullet.position = { x: hit.point.x + hit.normal.x * 0.04, y: hit.point.y + hit.normal.y * 0.04 };
                        bullet.prev = { x: bullet.position.x, y: bullet.position.y };
                    } else {
                        // Penetration deals full damage; a blocked HE shell still
                        // sprays fragments (shot.damage > 0). Either way the shell stops.
                        if (shot.damage > 0) {
                            armor.takeDamage(shot.damage);
                            updateHp();
                            flash = 0.12;
                            if (!armor.alive) destroyTank();
                        }
                        killBullet(bullet, hit.point);
                    }
                }
            }

            if (Math.abs(bullet.position.x) > CULL.x || Math.abs(bullet.position.y) > CULL.y) {
                bullet.alive = false;
            }

            if (!bullet.alive) {
                game.remove(bullet._entity);
                bullets.splice(bullets.indexOf(bullet), 1);
            } else {
                bullet._entity.setPosition(bullet.position);
            }
        }

        // Fade the tank flash back to its base color.
        if (flash > 0) {
            flash -= dt;
            const t = Math.max(0, flash / 0.12);
            if (armor.alive) {
                tank.setColor({
                    red: tankColor.red + (1 - tankColor.red) * t,
                    green: tankColor.green + (1 - tankColor.green) * t,
                    blue: tankColor.blue + (1 - tankColor.blue) * t,
                });
            }
        }

        // Expire impact markers.
        for (const marker of markers.slice()) {
            marker.life -= dt;
            if (marker.life <= 0) {
                game.remove(marker.shape);
                markers.splice(markers.indexOf(marker), 1);
            }
        }
    }
});
