// Tank battle in three dimensions.
//
// The hull turns on its tracks and the turret turns on the hull — two rotations
// that compose, which is the thing a top-down 2D version can show but never
// quite sell. Here you see the barrel swing independently of where the tank is
// pointing, from behind it.
//
// The ballistics are the 2D weapons layer again, unchanged: shots are resolved
// in the horizontal plane, where an armour plate's angle actually lives.

import App from "../components/app.js";
import { el, kv, card, button, hint } from "../components/ui/index.js";
import { Mesh, boxGeometry, cylinderGeometry, planeGeometry, sphereGeometry } from "../components/render3d/index.js";
import { PROJECTILES, resolveShot } from "../components/weapons/index.js";
import { createRandom, randomRange } from "../components/math/random.js";
import { clamp, wrapDegrees, DEG_TO_RAD, RAD_TO_DEG } from "../components/math/angles.js";

const ARENA = 46;
const DRIVE_SPEED = 7.5;
const TURN_SPEED = 75;         // grados por segundo
const TRAVERSE_SPEED = 95;
const SHELL_SPEED = 40;
const RELOAD = 1.1;
const ENEMIES = 5;

const STYLES = `
    .hud { position: absolute; top: 12px; left: 12px; right: 12px; z-index: 2;
           display: flex; gap: 12px; pointer-events: none; }
    .hud .chip { padding: 7px 12px; border-radius: 10px; background: rgba(10,14,20,.62);
                 border: 1px solid rgba(255,255,255,.14); font-weight: 700; font-size: 16px;
                 font-variant-numeric: tabular-nums; }
    .hud .chip small { font-size: 10px; font-weight: 500; color: #9aa0a6; display: block; }
    .hud .spacer { flex: 1; }
    .tag { position: absolute; transform: translate(-50%, -100%); pointer-events: none;
           font-size: 11px; font-weight: 700; text-align: center; z-index: 2; }
    .tag .bar { width: 46px; height: 5px; border-radius: 3px; background: rgba(0,0,0,.55);
                overflow: hidden; border: 1px solid rgba(255,255,255,.2); }
    .tag .bar > i { display: block; height: 100%; background: #d84a3a; }
    .banner { position: absolute; inset: 0; z-index: 3; display: none; flex-direction: column;
              align-items: center; justify-content: center; gap: 14px;
              background: rgba(8,12,18,.75); font-size: 26px; font-weight: 800; }
`;

App.boot({ title: "Batalla de tanques 3D", styles: STYLES }, (app) => {
    const gl = app.gl;
    const { keyboard, touch } = app;
    const camera = app.use3D({ clearColor: { red: 0.42, green: 0.5, blue: 0.6 } });
    camera.fov = 60;
    camera.far = 400;

    app.add(new Mesh(gl, planeGeometry({ width: 400, depth: 400 }))
        .setColor({ red: 0.35, green: 0.38, blue: 0.3 }).init());

    // Walls, so the arena has an edge you can see.
    for (const [x, z, w, d] of [[0, -ARENA, ARENA * 2, 2], [0, ARENA, ARENA * 2, 2],
                                [-ARENA, 0, 2, ARENA * 2], [ARENA, 0, 2, ARENA * 2]]) {
        app.add(new Mesh(gl, boxGeometry({ width: w, height: 3, depth: d }))
            .setPosition({ x, y: 1.5, z }).setColor({ red: 0.42, green: 0.38, blue: 0.31 }).init());
    }

    // Scattered cover: something to hide behind and to shoot at.
    const random = createRandom(20260806);
    const blocks = [];
    for (let i = 0; i < 26; i++) {
        const w = randomRange(random, 2, 5), d = randomRange(random, 2, 5), h = randomRange(random, 1.5, 3.5);
        const x = randomRange(random, -ARENA + 6, ARENA - 6);
        const z = randomRange(random, -ARENA + 6, ARENA - 6);
        if (Math.hypot(x, z) < 9) continue;      // deja libre el punto de partida
        blocks.push({ x, z, w, d });
        app.add(new Mesh(gl, boxGeometry({ width: w, height: h, depth: d }))
            .setPosition({ x, y: h / 2, z }).setColor({ red: 0.46, green: 0.44, blue: 0.4 }).init());
    }

    // --- Building a tank ---------------------------------------------------
    // A tank is four meshes that have to move together: the turret rides the
    // hull, and the barrel rides the turret. Rather than a scene graph, each
    // part is placed from the hull's transform every frame — fewer moving
    // pieces for four parts, and it makes the composition explicit.
    function makeTank(color, isPlayer) {
        const hull = app.add(new Mesh(gl, boxGeometry({ width: 2.4, height: 0.9, depth: 3.8 }))
            .setColor(color).setShininess(20).init());
        const tracks = [-1, 1].map((side) => app.add(new Mesh(gl, boxGeometry({ width: 0.55, height: 0.7, depth: 4 }))
            .setColor({ red: 0.13, green: 0.13, blue: 0.15 }).init()));
        const turret = app.add(new Mesh(gl, cylinderGeometry({ radiusTop: 0.85, radiusBottom: 1, height: 0.7, segments: 18 }))
            .setColor({ red: color.red * 0.85, green: color.green * 0.85, blue: color.blue * 0.85 }).init());
        const barrel = app.add(new Mesh(gl, cylinderGeometry({ radiusTop: 0.1, radiusBottom: 0.13, height: 2.8, segments: 12 }))
            .setColor({ red: 0.3, green: 0.31, blue: 0.34 }).setShininess(40).init());

        return {
            hull, turret, barrel, tracks, isPlayer,
            x: 0, z: 0, heading: 0, turretAngle: 0,
            hp: 100, alive: true, reload: 0, color,
            tag: null, ai: null,
        };
    }

    // Places every part from the tank's state. Called once per frame per tank.
    function placeTank(tank) {
        const rad = tank.heading * DEG_TO_RAD;
        const sin = Math.sin(rad), cos = Math.cos(rad);
        tank.hull.setPosition({ x: tank.x, y: 0.85, z: tank.z }).setRotation({ y: tank.heading });
        tank.tracks.forEach((track, i) => {
            const side = i === 0 ? -1.35 : 1.35;
            track.setPosition({ x: tank.x + cos * side, y: 0.4, z: tank.z - sin * side })
                .setRotation({ y: tank.heading });
        });
        tank.turret.setPosition({ x: tank.x, y: 1.6, z: tank.z }).setRotation({ y: tank.turretAngle });
        // The barrel sticks out of the turret along the turret's own facing —
        // this is where the two rotations actually compose.
        const trad = tank.turretAngle * DEG_TO_RAD;
        tank.barrel
            .setPosition({ x: tank.x + Math.sin(trad) * 1.6, y: 1.65, z: tank.z + Math.cos(trad) * 1.6 })
            .setRotation({ y: tank.turretAngle, x: 90 });
    }

    const player = makeTank({ red: 0.28, green: 0.6, blue: 0.38 }, true);
    const enemies = [];
    const shells = [];
    const marks = [];
    let over = false;
    let kills = 0;
    let ammo = PROJECTILES.AP;

    function spawnEnemies() {
        for (const enemy of enemies) removeTank(enemy);
        enemies.length = 0;
        for (let i = 0; i < ENEMIES; i++) {
            const enemy = makeTank({ red: 0.72, green: 0.3, blue: 0.26 }, false);
            const angle = (i / ENEMIES) * Math.PI * 2;
            enemy.x = Math.cos(angle) * (ARENA - 12);
            enemy.z = Math.sin(angle) * (ARENA - 12);
            enemy.heading = -angle * RAD_TO_DEG;
            enemy.tag = makeTag();
            enemies.push(enemy);
        }
    }

    function removeTank(tank) {
        for (const part of [tank.hull, tank.turret, tank.barrel, ...tank.tracks]) app.remove(part);
        tank.tag?.node.remove();
    }

    function makeTag() {
        const fill = el("i");
        const node = el("div", { className: "tag" }, [el("div", { className: "bar" }, [fill])]);
        app.addOverlay(node);
        return { node, fill };
    }

    // --- HUD ----------------------------------------------------------------
    const hpLabel = el("span", { textContent: "100" });
    const killLabel = el("span", { textContent: `0/${ENEMIES}` });
    const ammoLabel = el("span", { textContent: ammo.name });
    app.addOverlay(el("div", { className: "hud" }, [
        el("div", { className: "chip" }, [el("small", { textContent: "BLINDAJE" }), hpLabel]),
        el("div", { className: "chip" }, [el("small", { textContent: "BAJAS" }), killLabel]),
        el("div", { className: "spacer" }),
        el("div", { className: "chip" }, [el("small", { textContent: "MUNICIÓN" }), ammoLabel]),
    ]));
    const bannerText = el("b");
    const banner = el("div", { className: "banner" }, [bannerText, button("Nueva batalla", () => restart())]);
    app.addOverlay(banner);

    const kPos = kv("Posición"), kHeading = kv("Rumbo"), kTurret = kv("Torreta"), kLast = kv("Último impacto");
    app.addPanel(
        card("Controles", [
            hint("W/S avanzan · A/D giran el casco · Q/E giran la torreta · espacio dispara · 1-4 cambian munición"),
        ]),
        card("Tu tanque", [kPos.row, kHeading.row, kTurret.row, kLast.row]),
        card("Qué mirar", [
            hint("El casco y la torreta giran por separado: puedes retroceder apuntando al frente. Eso es lo que la vista cenital de la versión 2D nunca terminaba de mostrar."),
        ]),
    );

    // --- Controls ------------------------------------------------------------
    touch.pedal(touch.button("up", "▲", "round"), "w");
    touch.pedal(touch.button("down", "▼", "round"), "s");
    touch.pedal(touch.button("left", "◀", "round"), "a");
    touch.pedal(touch.button("right", "▶", "round"), "d");
    touch.tap(touch.button("fire", "🔥", "round"), () => fire(player));
    touch.pad("left", [touch.get("left"), touch.get("right")]);
    touch.pad("right", [touch.get("fire"), [touch.get("up"), touch.get("down")]]);

    keyboard.on([" ", "Space"], () => fire(player));
    [PROJECTILES.AP, PROJECTILES.APCR, PROJECTILES.HEAT, PROJECTILES.HE].forEach((type, i) => {
        keyboard.on(String(i + 1), () => { ammo = type; ammoLabel.textContent = type.name; });
    });

    restart();

    window.raptorDrive3D = {
        app, camera, player, enemies, shells,
        get over() { return over; },
        get kills() { return kills; },
        get ammo() { return ammo; },
        fire, restart,
        get state() { return { x: player.x, z: player.z, heading: player.heading, turret: player.turretAngle, hp: player.hp }; },
    };

    app.onUpdate((dt) => {
        if (!over) {
            drivePlayer(dt);
            for (const enemy of enemies) if (enemy.alive) driveEnemy(enemy, dt);
        }
        updateShells(dt);
        updateMarks(dt);

        placeTank(player);
        for (const enemy of enemies) if (enemy.alive) placeTank(enemy);
        updateTags();

        // Chase camera: behind the hull, looking a little ahead of it.
        const rad = player.heading * DEG_TO_RAD;
        camera.lookFrom(
            { x: player.x - Math.sin(rad) * 11, y: 6.5, z: player.z - Math.cos(rad) * 11 },
            { x: player.x + Math.sin(rad) * 4, y: 1.5, z: player.z + Math.cos(rad) * 4 },
        );

        hpLabel.textContent = String(Math.round(player.hp));
        killLabel.textContent = `${kills}/${ENEMIES}`;
        kPos.set(`${player.x.toFixed(1)}, ${player.z.toFixed(1)}`);
        kHeading.set(`${Math.round(wrapDegrees(player.heading))}°`);
        kTurret.set(`${Math.round(wrapDegrees(player.turretAngle - player.heading))}° respecto al casco`);
    });

    // --- Behaviour ------------------------------------------------------------

    function drivePlayer(dt) {
        const drive = keyboard.axis(["s", "ArrowDown"], ["w", "ArrowUp"]);
        const turn = keyboard.axis(["d", "ArrowRight"], ["a", "ArrowLeft"]);
        player.heading += turn * TURN_SPEED * dt;
        player.turretAngle += keyboard.axis("e", "q") * TRAVERSE_SPEED * dt;
        if (drive) moveTank(player, drive * DRIVE_SPEED * dt);
        player.reload = Math.max(0, player.reload - dt);
    }

    function driveEnemy(enemy, dt) {
        const dx = player.x - enemy.x, dz = player.z - enemy.z;
        const distance = Math.hypot(dx, dz);
        const bearing = Math.atan2(dx, dz) * RAD_TO_DEG;

        // Turret tracks the player; the hull turns more slowly, so an enemy can
        // be shooting at you while still swinging round to face you.
        enemy.turretAngle += clamp(wrapDegrees(bearing - enemy.turretAngle), -TRAVERSE_SPEED * dt, TRAVERSE_SPEED * dt);
        enemy.heading += clamp(wrapDegrees(bearing - enemy.heading), -TURN_SPEED * 0.6 * dt, TURN_SPEED * 0.6 * dt);
        if (distance > 16) moveTank(enemy, DRIVE_SPEED * 0.55 * dt);

        enemy.reload = Math.max(0, enemy.reload - dt);
        if (distance < 34 && Math.abs(wrapDegrees(bearing - enemy.turretAngle)) < 6) fire(enemy);
    }

    function moveTank(tank, distance) {
        const rad = tank.heading * DEG_TO_RAD;
        const nx = tank.x + Math.sin(rad) * distance;
        const nz = tank.z + Math.cos(rad) * distance;
        // One axis at a time, the same reason as the 2D forest: it slides along
        // a wall instead of sticking to it.
        if (!blocked(nx, tank.z)) tank.x = nx;
        if (!blocked(tank.x, nz)) tank.z = nz;
    }

    function blocked(x, z) {
        if (Math.abs(x) > ARENA - 2.5 || Math.abs(z) > ARENA - 2.5) return true;
        for (const block of blocks) {
            if (Math.abs(x - block.x) < block.w / 2 + 1.5 && Math.abs(z - block.z) < block.d / 2 + 1.5) return true;
        }
        return false;
    }

    function fire(tank) {
        if (!tank.alive || tank.reload > 0 || over) return false;
        tank.reload = RELOAD;
        const rad = tank.turretAngle * DEG_TO_RAD;
        const mesh = app.add(new Mesh(gl, sphereGeometry({ radius: 0.16, segments: 8, rings: 6 }))
            .setPosition({ x: tank.x + Math.sin(rad) * 3, y: 1.65, z: tank.z + Math.cos(rad) * 3 })
            .setColor({ red: 1, green: 0.85, blue: 0.4 }).init());
        shells.push({
            mesh, from: tank, life: 2.2,
            dx: Math.sin(rad), dz: Math.cos(rad),
            type: tank.isPlayer ? ammo : PROJECTILES.AP,
        });
        return true;
    }

    function updateShells(dt) {
        for (const shell of shells.slice()) {
            shell.life -= dt;
            shell.mesh.setPosition({
                x: shell.mesh.position.x + shell.dx * SHELL_SPEED * dt,
                z: shell.mesh.position.z + shell.dz * SHELL_SPEED * dt,
            });
            const { x, z } = shell.mesh.position;

            const targets = shell.from.isPlayer ? enemies : [player];
            let done = shell.life <= 0 || Math.abs(x) > ARENA || Math.abs(z) > ARENA || blocked(x, z);

            for (const target of targets) {
                if (!target.alive || Math.hypot(target.x - x, target.z - z) > 2.2) continue;
                hit(target, shell);
                done = true;
                break;
            }
            if (done) { app.remove(shell.mesh); shells.splice(shells.indexOf(shell), 1); }
        }
    }

    function hit(target, shell) {
        // The plate that got hit is the one facing the shell, and its normal is
        // the hull's facing — so the impact angle falls straight out of the two
        // headings. Then the 2D weapons model does the rest.
        const rad = target.heading * DEG_TO_RAD;
        const shot = resolveShot({
            type: shell.type,
            penetration: 150 * shell.type.penMultiplier,
            damage: 26 * shell.type.damageMultiplier,
            direction: { x: shell.dx, y: shell.dz },
            normal: { x: -Math.sin(rad), y: -Math.cos(rad) },
            armor: 95,
        });

        if (shot.damage > 0) {
            target.hp -= shot.damage;
            if (target.hp <= 0) {
                target.alive = false;
                for (const part of [target.hull, target.turret, target.barrel, ...target.tracks]) app.remove(part);
                target.tag?.node.remove();
                if (!target.isPlayer) kills++;
            }
        }

        if (shell.from.isPlayer) {
            kLast.set(`${shot.result === "penetration" ? "PENETRA" : shot.result === "ricochet" ? "REBOTE" : "NO PENETRA"} · ${shot.angle.toFixed(0)}° · ${Math.round(shot.effectiveArmor)} mm`);
        }

        const color = shot.result === "penetration" ? { red: 0.25, green: 0.9, blue: 0.4 }
            : shot.result === "ricochet" ? { red: 0.95, green: 0.85, blue: 0.25 }
            : { red: 0.9, green: 0.3, blue: 0.25 };
        const mark = app.add(new Mesh(gl, sphereGeometry({ radius: 0.7, segments: 10, rings: 8 }))
            .setPosition({ x: shell.mesh.position.x, y: 1.6, z: shell.mesh.position.z })
            .setColor({ ...color, alpha: 1 }).init());
        marks.push({ mesh: mark, life: 0.4, total: 0.4 });

        if (!player.alive) finish(false);
        else if (kills >= ENEMIES) finish(true);
    }

    function updateMarks(dt) {
        for (const mark of marks.slice()) {
            mark.life -= dt;
            mark.mesh.setScale(0.4 + (1 - mark.life / mark.total));
            mark.mesh.color.alpha = Math.max(0, mark.life / mark.total);
            if (mark.life <= 0) { app.remove(mark.mesh); marks.splice(marks.indexOf(mark), 1); }
        }
    }

    // Health bars are DOM, positioned by projecting each tank to screen pixels.
    // Drawing text in WebGL is a project of its own; this is three lines.
    function updateTags() {
        for (const enemy of enemies) {
            if (!enemy.alive || !enemy.tag) continue;
            const screen = camera.project({ x: enemy.x, y: 3.2, z: enemy.z }, app.canvas);
            if (!screen) { enemy.tag.node.style.display = "none"; continue; }
            enemy.tag.node.style.display = "block";
            enemy.tag.node.style.left = `${screen.x}px`;
            enemy.tag.node.style.top = `${screen.y}px`;
            enemy.tag.fill.style.width = `${Math.max(0, enemy.hp)}%`;
        }
    }

    function finish(won) {
        over = true;
        bannerText.textContent = won ? "¡Arena despejada!" : "Tanque destruido";
        bannerText.style.color = won ? "#7fe0a0" : "#f0a094";
        banner.style.display = "flex";
    }

    function restart() {
        over = false;
        kills = 0;
        banner.style.display = "none";
        player.x = 0; player.z = 0; player.heading = 0; player.turretAngle = 0;
        player.hp = 100; player.alive = true; player.reload = 0;
        for (const part of [player.hull, player.turret, player.barrel, ...player.tracks]) {
            if (!app.entities.includes(part)) app.add(part);
        }
        for (const shell of shells.slice()) app.remove(shell.mesh);
        shells.length = 0;
        spawnEnemies();
        kLast.set("—");
    }
});
