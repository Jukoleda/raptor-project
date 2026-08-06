// The projection, in one place.
//
// It used to live in two: `Shape.draw` hard-coded a 45° field of view and a
// depth of −6, and `Camera.viewExtents` re-derived the visible area from its
// *own* copy of those numbers. They had to agree, and nothing said so — change
// the depth of a shape and the camera's map bounds go quietly wrong, letting
// the view slide off the edge of the world. Same numbers, one definition.
//
// It is also where the per-frame allocation went. `Shape.draw` built a fresh
// projection matrix for every shape, every frame — identical work, 1400 times
// over in the forest — plus a model-view matrix and three little arrays for the
// translate/rotate/scale arguments. That is roughly seven thousand throwaway
// objects per frame at 60 Hz, which the garbage collector then has to sweep.
//
// Drawing is synchronous and never re-entrant, so a shared scratch buffer is
// safe: nothing can be halfway through using one when the next draw starts.

export const FOV_DEGREES = 45;
export const FOV_RADIANS = (FOV_DEGREES * Math.PI) / 180;

// How far shapes sit from the camera along −Z. The sign differs by side: a
// shape translates to −DEFAULT_DEPTH, the camera measures a positive distance.
export const DEFAULT_DEPTH = 6;

export const NEAR_PLANE = 0.1;
export const FAR_PLANE = 100;

// Half-extents of the visible world at a given depth and aspect ratio. Both the
// camera (for map bounds) and anything doing picking need this, and it has to
// match what the projection above actually shows.
export function viewHalfExtents(aspect, { depth = DEFAULT_DEPTH, zoom = 1 } = {}) {
    const halfH = (depth * Math.tan(FOV_RADIANS / 2)) / zoom;
    return { halfW: halfH * aspect, halfH };
}

// A canvas that is not laid out yet reports a client size of zero, which would
// make the aspect NaN and render nothing at all — with no error to explain it.
// The drawing buffer is the honest fallback.
export function aspectOf(canvas) {
    const width = canvas.clientWidth || canvas.width || 1;
    const height = canvas.clientHeight || canvas.height || 1;
    return width / height;
}

// One projection matrix per canvas, rebuilt only when the aspect changes.
const projections = new WeakMap();

export function projectionFor(canvas) {
    const { mat4 } = glMatrix;
    const aspect = aspectOf(canvas);

    let cached = projections.get(canvas);
    if (!cached) {
        cached = { aspect: null, matrix: mat4.create() };
        projections.set(canvas, cached);
    }
    if (cached.aspect !== aspect) {
        mat4.perspective(cached.matrix, FOV_RADIANS, aspect, NEAR_PLANE, FAR_PLANE);
        cached.aspect = aspect;
    }
    return cached.matrix;
}

// Scratch space for building a model-view matrix, reused across draws.
export const Z_AXIS = [0, 0, 1];
const translation = [0, 0, 0];
const scaling = [1, 1, 1];
let modelView = null;

// Builds the model-view matrix for one shape and returns the shared scratch
// matrix. The caller must upload it before the next call — which is exactly
// what `Shape.draw` does, one shape at a time.
export function modelViewFor({ x, y, depth, rotationDegrees, scaleX, scaleY }) {
    const { mat4 } = glMatrix;
    if (!modelView) modelView = mat4.create();

    translation[0] = x; translation[1] = y; translation[2] = depth;
    scaling[0] = scaleX; scaling[1] = scaleY;

    mat4.identity(modelView);
    mat4.translate(modelView, modelView, translation);
    if (rotationDegrees) mat4.rotate(modelView, modelView, (rotationDegrees * Math.PI) / 180, Z_AXIS);
    mat4.scale(modelView, modelView, scaling);
    return modelView;
}
