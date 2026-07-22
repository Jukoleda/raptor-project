// A shell in flight. It stores its previous position so the ballistics layer can
// raycast the segment travelled during the last frame (continuous collision).

export default class Bullet {
    constructor({ x, y, vx, vy, penetration, damage = 100, owner = null, life = 3 }) {
        this.position = { x, y };
        this.prev = { x, y };
        this.velocity = { x: vx, y: vy };
        this.penetration = penetration;
        this.damage = damage;
        this.owner = owner;
        this.alive = true;
        this.life = life; // seconds before it despawns
    }

    // Unit vector of travel.
    get direction() {
        const speed = Math.hypot(this.velocity.x, this.velocity.y) || 1;
        return { x: this.velocity.x / speed, y: this.velocity.y / speed };
    }

    get speed() {
        return Math.hypot(this.velocity.x, this.velocity.y);
    }

    update(dt) {
        this.prev.x = this.position.x;
        this.prev.y = this.position.y;
        this.position.x += this.velocity.x * dt;
        this.position.y += this.velocity.y * dt;
        this.life -= dt;
        if (this.life <= 0) this.alive = false;
    }
}
