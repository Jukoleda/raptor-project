import Bullet from "./bullet.js";

// A gun that fires shells. Tracks its own reload cooldown; call update(dt) each
// frame and fire(...) to shoot when ready.

export default class Weapon {
    constructor({ penetration = 100, muzzleSpeed = 12, reload = 1.0, damage = 34 } = {}) {
        this.penetration = penetration; // mm the shell can defeat head-on
        this.muzzleSpeed = muzzleSpeed; // world units / second
        this.reload = reload;           // seconds between shots
        this.damage = damage;           // hit points on penetration
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

    // Fires a shell from (x, y) toward (dirX, dirY). Returns a Bullet, or null if
    // still reloading.
    fire(x, y, dirX, dirY, owner = null) {
        if (!this.ready) return null;
        this.cooldown = this.reload;
        const len = Math.hypot(dirX, dirY) || 1;
        return new Bullet({
            x,
            y,
            vx: (dirX / len) * this.muzzleSpeed,
            vy: (dirY / len) * this.muzzleSpeed,
            penetration: this.penetration,
            damage: this.damage,
            owner,
        });
    }
}
