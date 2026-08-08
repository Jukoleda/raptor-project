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

import { viewHalfExtents, aspectOf, DEFAULT_DEPTH } from "./render/projection.js";
import { clientToNdc, ndcToCanvasPixels } from "./render/screen.js";

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

    // Half-extents of the visible world, in world units. The field of view and
    // the depth come from components/render/projection.js — the same values
    // Shape.draw projects with, so this cannot drift out of sync with what is
    // actually on screen.
    viewExtents(canvas, { depth = DEFAULT_DEPTH } = {}) {
        return viewHalfExtents(aspectOf(canvas), { depth, zoom: this.zoom });
    }

    // Converts a pointer position (clientX/clientY, as given by mouse/touch
    // events) into world coordinates, accounting for the camera pan and zoom.
    // Use it to aim at, pick or place things where the user clicked/tapped.
    //
    // `Camera3D.screenToWorld` takes the same arguments and answers the same
    // question, so a scene can swap one camera for the other without rewriting
    // its input handling. The one difference geometry forces: in 3D a pixel can
    // point at the sky and miss the ground, so that one may return null. This
    // one never does — a flat world has no sky to point at.
    screenToWorld(clientX, clientY, canvas, opts) {
        const { halfW, halfH } = this.viewExtents(canvas, opts);
        const ndc = clientToNdc(clientX, clientY, canvas);
        return { x: this.x + ndc.x * halfW, y: this.y + ndc.y * halfH };
    }

    // The other direction: a world point to canvas pixels, for hanging a DOM
    // label over something. The counterpart of `Camera3D.project`, and named the
    // same for the same reason `screenToWorld` is.
    //
    // Never null: everything in a flat world is in front of the camera. The 3D
    // one returns null for points behind it, so code meant to work with either
    // should still check.
    project(point, canvas, opts) {
        const { halfW, halfH } = this.viewExtents(canvas, opts);
        return ndcToCanvasPixels((point.x - this.x) / halfW, (point.y - this.y) / halfH, canvas);
    }

    _clamp() {
        const b = this.bounds;
        if (!b) return;
        // If the map is narrower than the view, min can exceed max; center it.
        this.x = b.minX > b.maxX ? (b.minX + b.maxX) / 2 : Math.max(b.minX, Math.min(b.maxX, this.x));
        this.y = b.minY > b.maxY ? (b.minY + b.maxY) / 2 : Math.max(b.minY, Math.min(b.maxY, this.y));
    }
}
