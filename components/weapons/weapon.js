import Bullet from "./bullet.js";
import { DEFAULT_PROJECTILE } from "./projectiles.js";

// A gun that fires shells. Tracks its own reload cooldown; call update(dt) each
// frame and fire(...) to shoot when ready. `penetration` and `damage` are the
// gun's nominal values; each projectile type scales them by its own multipliers.

export default class Weapon {
    constructor({ penetration = 100, muzzleSpeed = 12, reload = 1.0, damage = 34, type = DEFAULT_PROJECTILE } = {}) {
        this.penetration = penetration; // mm the shell can defeat head-on
        this.muzzleSpeed = muzzleSpeed; // world units / second
        this.reload = reload;           // seconds between shots
        this.damage = damage;           // hit points on penetration
        this.type = type;               // loaded projectile type (AP / APCR / HEAT / HE)
        this.cooldown = 0;
    }

    update(dt) {
        if (this.cooldown > 0) this.cooldown -= dt;
    }

    get ready() {
        return this.cooldown <= 0;
    }

    // Progress of the current reload in [0, 1] (1 = ready).
    get reloadProgress() {
        return this.reload <= 0 ? 1 : Math.min(1, 1 - this.cooldown / this.reload);
    }

    // Fires a shell from (x, y) toward (dirX, dirY) using projectile `type`
    // (defaults to the loaded one). The type's multipliers scale the gun's
    // nominal penetration and damage. Returns a Bullet, or null if reloading.
    fire(x, y, dirX, dirY, owner = null, type = this.type) {
        if (!this.ready) return null;
        this.cooldown = this.reload;
        const len = Math.hypot(dirX, dirY) || 1;
        return new Bullet({
            x,
            y,
            vx: (dirX / len) * this.muzzleSpeed,
            vy: (dirY / len) * this.muzzleSpeed,
            penetration: this.penetration * type.penMultiplier,
            damage: this.damage * type.damageMultiplier,
            type,
            owner,
        });
    }
}
