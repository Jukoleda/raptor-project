// A 2D camera: a movable window onto the world.
//
// The camera has a world-space center (x, y) and a zoom. Shapes subtract the
// camera center and multiply by zoom when they draw, so moving the camera pans
// the whole scene and raising the zoom magnifies it — the world stays put, the
// view moves. A fresh camera sits at the origin with zoom 1, which is a no-op,
// so scenes that never touch the camera render exactly as before.
//
// `follow()` eases the center toward a target (the player) instead of snapping,
// and optional `bounds` keep the center from revealing past the edges of a map.

export default class Camera {
    constructor({ x = 0, y = 0, zoom = 1, smoothing = 8, bounds = null } = {}) {
        this.x = x;
        this.y = y;
        this.zoom = zoom;
        this.smoothing = smoothing; // higher = the camera catches up faster
        this.bounds = bounds;       // { minX, maxX, minY, maxY } for the center
    }

    // Jumps the center straight to (x, y) — no easing.
    centerOn(x, y) {
        this.x = x;
        this.y = y;
        this._clamp();
        return this;
    }

    // Eases the center toward `target` over dt seconds. The exponential factor
    // makes the smoothing frame-rate independent (same feel at 30 or 144 fps).
    follow(target, dt) {
        const t = 1 - Math.exp(-this.smoothing * dt);
        this.x += (target.x - this.x) * t;
        this.y += (target.y - this.y) * t;
        this._clamp();
        return this;
    }

    _clamp() {
        const b = this.bounds;
        if (!b) return;
        // If the map is narrower than the view, min can exceed max; center it.
        this.x = b.minX > b.maxX ? (b.minX + b.maxX) / 2 : Math.max(b.minX, Math.min(b.maxX, this.x));
        this.y = b.minY > b.maxY ? (b.minY + b.maxY) / 2 : Math.max(b.minY, Math.min(b.maxY, this.y));
    }
}
