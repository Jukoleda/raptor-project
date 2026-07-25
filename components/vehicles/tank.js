// A tank built out of engine shapes: a hull that drives, plus a turret and a
// barrel that rotate on top of it *independently* of the hull. That split is
// the point — a real tank can keep its aim while the hull turns away.
//
// Angles follow the engine convention: degrees, counter-clockwise, and local
// +Y is "forward", so 0° faces up the screen. The turret stores an absolute
// world angle (not one relative to the hull), which is what you want for
// aiming: the gun keeps pointing at a target while the hull manoeuvres.
//
// Designs (TANK_DESIGNS) vary the *shape* of the hull and turret — rectangle,
// triangle, hexagon, wedge — along with the driving and traverse stats, so each
// one handles differently. Feed `design.drive` straight into a TankController.

import Rectangle from "../shapes/rectangle.js";
import Square from "../shapes/square.js";
import Triangle from "../shapes/triangle.js";
import Circle from "../shapes/circle.js";
import { Polygon, RegularPolygon } from "../shapes/polygon.js";

// Every design: hull/turret shape factories, a collision radius, the barrel
// geometry, driving stats (for TankController) and the turret traverse rate.
export const TANK_DESIGNS = {
    medium: {
        id: "medium",
        name: "Medio",
        hint: "Equilibrado. Casco rectangular.",
        radius: 0.42,
        hull: (gl) => new Rectangle(gl, { width: 0.55, height: 0.8 }),
        turret: (gl) => new Circle(gl, { radius: 0.22 }),
        barrel: { width: 0.1, length: 0.5, offset: 0.42 },
        colors: {
            hull: { red: 0.27, green: 0.5, blue: 0.32 },
            turret: { red: 0.22, green: 0.42, blue: 0.28 },
            barrel: { red: 0.16, green: 0.3, blue: 0.2 },
        },
        drive: { accel: 5, maxSpeed: 3, turnSpeed: 140, friction: 5 },
        traverse: 120,
    },

    light: {
        id: "light",
        name: "Ligero",
        hint: "Rápido y ágil. Casco triangular.",
        radius: 0.34,
        hull: (gl) => new Triangle(gl, { width: 0.6, height: 0.85 }),
        turret: (gl) => new RegularPolygon(gl, { sides: 5, radius: 0.17 }),
        barrel: { width: 0.08, length: 0.42, offset: 0.36 },
        colors: {
            hull: { red: 0.85, green: 0.66, blue: 0.24 },
            turret: { red: 0.7, green: 0.53, blue: 0.18 },
            barrel: { red: 0.5, green: 0.38, blue: 0.14 },
        },
        drive: { accel: 7.5, maxSpeed: 4.4, turnSpeed: 200, friction: 6 },
        traverse: 180,
    },

    heavy: {
        id: "heavy",
        name: "Pesado",
        hint: "Lento y macizo. Casco hexagonal.",
        radius: 0.52,
        hull: (gl) => new RegularPolygon(gl, { sides: 6, radius: 0.56 }),
        turret: (gl) => new Circle(gl, { radius: 0.3 }),
        barrel: { width: 0.13, length: 0.62, offset: 0.54 },
        colors: {
            hull: { red: 0.42, green: 0.3, blue: 0.34 },
            turret: { red: 0.34, green: 0.24, blue: 0.28 },
            barrel: { red: 0.24, green: 0.17, blue: 0.2 },
        },
        drive: { accel: 3, maxSpeed: 1.9, turnSpeed: 80, friction: 4 },
        traverse: 60,
    },

    hunter: {
        id: "hunter",
        name: "Cazacarros",
        hint: "Nariz en cuña, torreta lenta.",
        radius: 0.44,
        // A convex wedge: pointed nose, wide tail. Drawn as a TRIANGLE_FAN.
        hull: (gl) => new Polygon(gl, {
            points: [
                { x: 0, y: 0.52 },
                { x: 0.36, y: 0.06 },
                { x: 0.3, y: -0.46 },
                { x: -0.3, y: -0.46 },
                { x: -0.36, y: 0.06 },
            ],
        }),
        turret: (gl) => new Square(gl, { size: 0.34 }),
        barrel: { width: 0.11, length: 0.7, offset: 0.5 },
        colors: {
            hull: { red: 0.29, green: 0.38, blue: 0.5 },
            turret: { red: 0.23, green: 0.31, blue: 0.42 },
            barrel: { red: 0.16, green: 0.22, blue: 0.31 },
        },
        drive: { accel: 5.5, maxSpeed: 3.4, turnSpeed: 105, friction: 5 },
        traverse: 45,
    },
};

export const DEFAULT_DESIGN = TANK_DESIGNS.medium;

// Shortest signed difference between two angles, in degrees, within (-180, 180].
function angleDelta(from, to) {
    return (((to - from + 180) % 360) + 360) % 360 - 180;
}

export default class Tank {
    constructor(gl, { design = DEFAULT_DESIGN, x = 0, y = 0, rotation = 0, turretAngle = null } = {}) {
        this.design = design;

        this.hull = design.hull(gl).setColor(design.colors.hull)
            .setPosition({ x, y }).setRotation(rotation).init();
        this.barrel = new Rectangle(gl, { width: design.barrel.width, height: design.barrel.length })
            .setColor(design.colors.barrel).init();
        this.turret = design.turret(gl).setColor(design.colors.turret).init();

        // Absolute world angle of the gun; starts aligned with the hull.
        this.turretAngle = turretAngle ?? rotation;

        // Draw order: hull, then barrel, then turret on top of both.
        this.parts = [this.hull, this.barrel, this.turret];
        this.sync();
    }

    // The hull carries the tank's transform — drive it with a TankController.
    get position() { return this.hull.position; }
    get rotation() { return this.hull.rotation; }
    get radius() { return this.design.radius; }

    // Unit vector the gun points along.
    get turretForward() {
        const a = (this.turretAngle * Math.PI) / 180;
        return { x: -Math.sin(a), y: Math.cos(a) };
    }

    // Where a shell would leave the gun, for wiring up the weapons module.
    get muzzle() {
        const f = this.turretForward;
        const d = this.design.barrel.offset + this.design.barrel.length / 2;
        return { x: this.position.x + f.x * d, y: this.position.y + f.y * d };
    }

    addTo(game) {
        for (const part of this.parts) game.add(part);
        return this;
    }

    removeFrom(game) {
        for (const part of this.parts) game.remove(part);
        return this;
    }

    // Rotates the gun toward an absolute angle, capped by the traverse rate.
    turnTurretTo(angle, dt) {
        const diff = angleDelta(this.turretAngle, angle);
        const max = this.design.traverse * dt;
        this.turretAngle += Math.abs(diff) <= max ? diff : Math.sign(diff) * max;
        return this;
    }

    // Aims the gun at a world point (the mouse, a target, ...).
    aimAt(point, dt) {
        const dx = point.x - this.position.x;
        const dy = point.y - this.position.y;
        if (dx === 0 && dy === 0) return this;
        // Inverse of turretForward: the angle whose (-sin, cos) points at (dx, dy).
        return this.turnTurretTo((Math.atan2(-dx, dy) * 180) / Math.PI, dt);
    }

    // Manual traverse: dir > 0 turns the gun left (CCW), dir < 0 right.
    traverse(dir, dt) {
        this.turretAngle += dir * this.design.traverse * dt;
        return this;
    }

    // Places the turret and barrel on the hull, following the gun's own angle.
    // Call once per frame, after the hull has moved.
    sync() {
        const p = this.position;
        const f = this.turretForward;
        this.turret.setPosition({ x: p.x, y: p.y }).setRotation(this.turretAngle);
        this.barrel
            .setPosition({ x: p.x + f.x * this.design.barrel.offset, y: p.y + f.y * this.design.barrel.offset })
            .setRotation(this.turretAngle);
        return this;
    }
}
