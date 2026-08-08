// A camera that can be somewhere and look somewhere else.
//
// The 2D camera is a pan and a zoom: it has a centre and that is the whole
// story. In 3D a camera has a *position*, a *target* and an *up*, and the
// difference between those is the difference between moving the world and
// moving yourself through it.
//
// Two ways to drive it, which cover almost everything:
//
//     camera.orbit({ yaw, pitch, distance })   // gira alrededor del objetivo
//     camera.lookFrom(pos, target)             // colocada a mano
//
// Orbiting is what an editor or a model viewer wants; `follow` on top of it is
// what a third-person game wants.

import { aspectOf } from "../render/projection.js";
import { clientToNdc, ndcToCanvasPixels } from "../render/screen.js";
import { DEG_TO_RAD, clamp } from "../math/angles.js";

export default class Camera3D {
    constructor({
        position = { x: 0, y: 4, z: 8 },
        target = { x: 0, y: 0, z: 0 },
        up = { x: 0, y: 1, z: 0 },
        fov = 55,
        near = 0.1,
        far = 500,
        smoothing = 8,
    } = {}) {
        this.position = { ...position };
        this.target = { ...target };
        this.up = { ...up };
        this.fov = fov;
        this.near = near;
        this.far = far;
        this.smoothing = smoothing;

        // Spherical placement around the target, in degrees and world units.
        this.yaw = 0;
        this.pitch = 25;
        this.distance = 8;

        const { mat4 } = glMatrix;
        this._view = mat4.create();
        this._projection = mat4.create();
        this._aspect = null;
    }

    // Places the camera on a sphere around its target. Pitch is clamped just
    // short of straight up and straight down, because at exactly 90° the view
    // direction becomes parallel to `up` and the matrix collapses — the classic
    // gimbal flip where the world spins for one frame.
    orbit({ yaw = this.yaw, pitch = this.pitch, distance = this.distance, target = null } = {}) {
        if (target) this.target = { ...target };
        this.yaw = yaw;
        this.pitch = clamp(pitch, -89, 89);
        this.distance = Math.max(0.2, distance);

        const pitchRad = this.pitch * DEG_TO_RAD;
        const yawRad = this.yaw * DEG_TO_RAD;
        const horizontal = Math.cos(pitchRad) * this.distance;

        this.position.x = this.target.x + Math.sin(yawRad) * horizontal;
        this.position.y = this.target.y + Math.sin(pitchRad) * this.distance;
        this.position.z = this.target.z + Math.cos(yawRad) * horizontal;
        return this;
    }

    lookFrom(position, target = this.target) {
        this.position = { ...position };
        this.target = { ...target };
        return this;
    }

    // Eases the *target* toward a point and re-derives the position from the
    // current orbit. Following the target rather than the camera is what keeps
    // a chase camera from swinging wide on every corner.
    follow(point, dt) {
        const t = 1 - Math.exp(-this.smoothing * dt);
        this.target.x += (point.x - this.target.x) * t;
        this.target.y += ((point.y ?? 0) - this.target.y) * t;
        this.target.z += (point.z - this.target.z) * t;
        return this.orbit({});
    }

    // Straight from where it is to where it looks, normalised.
    get forward() {
        const dx = this.target.x - this.position.x;
        const dy = this.target.y - this.position.y;
        const dz = this.target.z - this.position.z;
        const length = Math.hypot(dx, dy, dz) || 1;
        return { x: dx / length, y: dy / length, z: dz / length };
    }

    viewMatrix() {
        const { mat4 } = glMatrix;
        mat4.lookAt(
            this._view,
            [this.position.x, this.position.y, this.position.z],
            [this.target.x, this.target.y, this.target.z],
            [this.up.x, this.up.y, this.up.z],
        );
        return this._view;
    }

    // Rebuilt only when the aspect or the lens changes — it is the same matrix
    // for every mesh in the frame.
    projectionMatrix(canvas) {
        const { mat4 } = glMatrix;
        const aspect = aspectOf(canvas);
        const key = `${aspect}|${this.fov}|${this.near}|${this.far}`;
        if (this._aspect !== key) {
            mat4.perspective(this._projection, this.fov * DEG_TO_RAD, aspect, this.near, this.far);
            this._aspect = key;
        }
        return this._projection;
    }

    // The other direction: a pixel back out into the world, as a ray leaving
    // the camera. `project` answers "where on screen is this thing"; this one
    // answers "what did I just click on", which is the question a mouse asks.
    //
    // Takes client pixels, straight from a pointer event — see
    // components/render/screen.js for why that is the framework's rule.
    rayFromScreen(clientX, clientY, canvas) {
        const { mat4, vec4 } = glMatrix;
        const { x: ndcX, y: ndcY } = clientToNdc(clientX, clientY, canvas);

        const inverse = mat4.invert(
            mat4.create(),
            mat4.multiply(mat4.create(), this.projectionMatrix(canvas), this.viewMatrix()),
        );
        if (!inverse) return null; // degenerate lens (near === far, zero aspect)

        // The same pixel on the near and far planes: the line between them is
        // the ray. Both come back homogeneous, so both need the perspective
        // divide before they mean anything.
        const unproject = (ndcZ) => {
            const v = vec4.transformMat4(vec4.create(), vec4.fromValues(ndcX, ndcY, ndcZ, 1), inverse);
            if (!v[3]) return null;
            return { x: v[0] / v[3], y: v[1] / v[3], z: v[2] / v[3] };
        };
        const near = unproject(-1);
        const far = unproject(1);
        if (!near || !far) return null;

        const dx = far.x - near.x, dy = far.y - near.y, dz = far.z - near.z;
        const length = Math.hypot(dx, dy, dz) || 1;
        return { origin: near, direction: { x: dx / length, y: dy / length, z: dz / length } };
    }

    // Where that ray meets a horizontal plane — the ground, in other words. A
    // game played on a floor wants the floor point under the cursor, and that is
    // the same question `Camera.screenToWorld` answers in two dimensions, so it
    // carries the same name and the same arguments. A scene can hand either
    // camera a pointer event and get back "where in the world is this".
    //
    // Null when the ray runs parallel to the plane, or only meets it behind the
    // camera — which is what pointing at the sky looks like. The 2D camera never
    // returns null, so code written for both should check.
    screenToWorld(clientX, clientY, canvas, { height = 0 } = {}) {
        const ray = this.rayFromScreen(clientX, clientY, canvas);
        if (!ray || Math.abs(ray.direction.y) < 1e-6) return null;
        const t = (height - ray.origin.y) / ray.direction.y;
        if (t < 0) return null;
        return {
            x: ray.origin.x + ray.direction.x * t,
            y: height,
            z: ray.origin.z + ray.direction.z * t,
        };
    }

    // Projects a world point to canvas pixels, or null if it is behind the
    // camera. Used to hang a DOM label over a mesh.
    project(point, canvas) {
        const { mat4, vec4 } = glMatrix;
        const clip = vec4.fromValues(point.x, point.y ?? 0, point.z, 1);
        const viewProjection = mat4.multiply(mat4.create(), this.projectionMatrix(canvas), this.viewMatrix());
        vec4.transformMat4(clip, clip, viewProjection);
        if (clip[3] <= 0) return null;
        const pixels = ndcToCanvasPixels(clip[0] / clip[3], clip[1] / clip[3], canvas);
        // `depth` is the w of the clip-space point: distance along the view
        // direction, handy for sorting labels or fading distant ones.
        return { ...pixels, depth: clip[3] };
    }
}
