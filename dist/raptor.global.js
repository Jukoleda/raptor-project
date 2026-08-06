// Raptor 0.5.0 — GENERADO por tools/build.mjs, no editar a mano.
// Fuente: raptor.js y sus dependencias (52 módulos).
// Uso: <script src="raptor.global.js"></script> y luego window.Raptor.
(function (root) {
"use strict";

// ===== components/render/projection.js =====
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

const FOV_DEGREES = 45;
const FOV_RADIANS = (FOV_DEGREES * Math.PI) / 180;

// How far shapes sit from the camera along −Z. The sign differs by side: a
// shape translates to −DEFAULT_DEPTH, the camera measures a positive distance.
const DEFAULT_DEPTH = 6;

const NEAR_PLANE = 0.1;
const FAR_PLANE = 100;

// Half-extents of the visible world at a given depth and aspect ratio. Both the
// camera (for map bounds) and anything doing picking need this, and it has to
// match what the projection above actually shows.
function viewHalfExtents(aspect, { depth = DEFAULT_DEPTH, zoom = 1 } = {}) {
    const halfH = (depth * Math.tan(FOV_RADIANS / 2)) / zoom;
    return { halfW: halfH * aspect, halfH };
}

// A canvas that is not laid out yet reports a client size of zero, which would
// make the aspect NaN and render nothing at all — with no error to explain it.
// The drawing buffer is the honest fallback.
function aspectOf(canvas) {
    const width = canvas.clientWidth || canvas.width || 1;
    const height = canvas.clientHeight || canvas.height || 1;
    return width / height;
}

// One projection matrix per canvas, rebuilt only when the aspect changes.
const projections = new WeakMap();

function projectionFor(canvas) {
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
const Z_AXIS = [0, 0, 1];
const translation = [0, 0, 0];
const scaling = [1, 1, 1];
let modelView = null;

// Builds the model-view matrix for one shape and returns the shared scratch
// matrix. The caller must upload it before the next call — which is exactly
// what `Shape.draw` does, one shape at a time.
function modelViewFor({ x, y, depth, rotationDegrees, scaleX, scaleY }) {
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

// ===== components/camera.js =====
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

class Camera {
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
    screenToWorld(clientX, clientY, canvas, opts) {
        const rect = canvas.getBoundingClientRect();
        const { halfW, halfH } = this.viewExtents(canvas, opts);
        const nx = ((clientX - rect.left) / rect.width) * 2 - 1;  // [-1, 1]
        const ny = 1 - ((clientY - rect.top) / rect.height) * 2;   // y grows up
        return { x: this.x + nx * halfW, y: this.y + ny * halfH };
    }

    _clamp() {
        const b = this.bounds;
        if (!b) return;
        // If the map is narrower than the view, min can exceed max; center it.
        this.x = b.minX > b.maxX ? (b.minX + b.maxX) / 2 : Math.max(b.minX, Math.min(b.maxX, this.x));
        this.y = b.minY > b.maxY ? (b.minY + b.maxY) / 2 : Math.max(b.minY, Math.min(b.maxY, this.y));
    }
}

// ===== components/raptorEngine.js =====
// RaptorEngine owns the canvas, the WebGL context and the render loop. It is
// shape-agnostic: anything with a `draw()` method can be added as an entity and
// it will be drawn every frame. See components/shapes/ for the built-in shapes.
//
// A frame, in order: run the updaters, re-sort by layer if anything changed,
// clear, draw what is on screen, schedule the next one.

class RaptorEngine {
    constructor() {
        this.context = undefined;
        this.canvas = undefined;
        this.entities = [];

        // Per-frame update callbacks, each called as fn(deltaSeconds). Register
        // physics, animation, input, etc. here — they run before drawing.
        this.updaters = [];

        // The view onto the world. Defaults to the origin with zoom 1 (a no-op),
        // so scenes that ignore it render unchanged. Move/replace it to pan or
        // zoom; every entity is drawn through it. See components/camera.js.
        this.camera = new Camera();

        // Entities are drawn in layer order, low to high, and in insertion order
        // within a layer. The sort is lazy: it only happens when something is
        // added or a layer changes, not every frame.
        this._needsSort = false;

        // Skip entities that cannot be on screen. A map is usually much larger
        // than the view — the forest holds about 1400 sprites and shows fewer
        // than sixty of them — and the cheapest work is the work not done.
        //
        // Off by default: a scene that does something unusual with the camera,
        // or draws entities without a position, keeps working unchanged.
        this.culling = false;
        this.drawnLastFrame = 0;

        this.running = false;
        this._lastTime = undefined;

        // Bound once, because requestAnimationFrame calls it detached.
        this.renderLoop = this.renderLoop.bind(this);
    }

    // Creates the canvas and WebGL context. Pass a `mount` element to place the
    // canvas inside it (e.g. an editor layout); defaults to document.body.
    createWindow(mount, { width = 800, height = 600 } = {}) {
        const canvas = document.createElement("canvas");
        canvas.id = "gameWindow";
        canvas.width = width;
        canvas.height = height;
        (mount || document.body).appendChild(canvas);

        const context = canvas.getContext("webgl");
        // Throwing beats the old alert(): a framework has no business opening a
        // modal, and returning with no context only moved the failure somewhere
        // less obvious.
        if (!context) throw new Error("Raptor: este navegador o equipo no soporta WebGL");

        this.canvas = canvas;
        this.context = context;
        return this;
    }

    // --- Entities ---------------------------------------------------------

    // Registers a drawable entity. Returns it so calls can be chained.
    add(entity) {
        this.entities.push(entity);
        if (entity.layer) this._needsSort = true;
        // A shape can be re-layered long after it was added, and the engine has
        // to hear about it — otherwise the change would only take effect the
        // next time something else happened to trigger a sort.
        entity._onLayerChange = () => { this._needsSort = true; };
        return entity;
    }

    // Removes a previously added entity. Returns the engine for chaining.
    remove(entity) {
        const index = this.entities.indexOf(entity);
        if (index !== -1) {
            this.entities.splice(index, 1);
            entity._onLayerChange = null;
        }
        return this;
    }

    // Stable sort by layer: Array.prototype.sort is required to be stable since
    // ES2019, which is what keeps insertion order inside a layer.
    sortEntities() {
        this.entities.sort((a, b) => (a.layer || 0) - (b.layer || 0));
        this._needsSort = false;
        return this;
    }

    // Entities without a position or a radius are always drawn: "I do not know
    // where this is" must never mean "so do not draw it". The radius is a circle
    // around the shape that is guaranteed to contain it, so the test errs
    // towards drawing — a wrongly hidden shape pops in at the screen edge, which
    // is far worse than a few extra quads.
    isVisible(entity, bounds) {
        const radius = entity.cullRadius;
        if (radius === null || radius === undefined || !entity.position) return true;
        return entity.position.x + radius >= bounds.minX
            && entity.position.x - radius <= bounds.maxX
            && entity.position.y + radius >= bounds.minY
            && entity.position.y - radius <= bounds.maxY;
    }

    // --- Updaters ---------------------------------------------------------

    addUpdater(fn) {
        this.updaters.push(fn);
        return fn;
    }

    // Scenes come and go, and an updater left behind keeps moving things that
    // no longer exist.
    removeUpdater(fn) {
        const index = this.updaters.indexOf(fn);
        if (index !== -1) this.updaters.splice(index, 1);
        return this;
    }

    // --- GL state ---------------------------------------------------------

    // One-time GL state configuration. Runs once, not per frame.
    configure() {
        const gl = this.context;
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        // 2D engine: depth testing is not needed. Enable alpha blending so
        // translucent objects composite correctly.
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        return this;
    }

    clearScreen() {
        this.context.clear(this.context.COLOR_BUFFER_BIT);
        return this;
    }

    // --- The loop ---------------------------------------------------------

    // Configures GL state and starts the render loop. Calling it twice is safe:
    // a second loop would double every delta-time.
    start() {
        if (this.running) return this;
        this.configure();
        this.running = true;
        // Dropping the timestamp means the frame after a pause gets dt = 0
        // rather than "everything that happened while you were away".
        this._lastTime = undefined;
        requestAnimationFrame(this.renderLoop);
        return this;
    }

    // Stops scheduling frames. The last one stays on screen — nothing clears.
    stop() {
        this.running = false;
        return this;
    }

    // The visible rectangle in world units, or null when culling is off. Worked
    // out once per frame rather than per shape.
    viewBounds() {
        if (!this.culling || !this.canvas) return null;
        const { halfW, halfH } = this.camera.viewExtents(this.canvas);
        return {
            minX: this.camera.x - halfW, maxX: this.camera.x + halfW,
            minY: this.camera.y - halfH, maxY: this.camera.y + halfH,
        };
    }

    // `now` is the timestamp requestAnimationFrame passes in, used to derive
    // delta-time.
    renderLoop(now) {
        if (!this.running) return;

        // Delta-time in seconds, clamped so a background tab / long stall does
        // not produce a huge jump that tunnels bodies through each other.
        let dt = this._lastTime === undefined ? 0 : (now - this._lastTime) / 1000;
        this._lastTime = now;
        if (dt > 0.05) dt = 0.05;

        // A copy: an updater is allowed to add or remove updaters — which is
        // exactly what happens when one of them switches scenes.
        for (const update of this.updaters.slice()) update(dt);

        if (this._needsSort) this.sortEntities();

        this.clearScreen();

        const bounds = this.viewBounds();
        let drawn = 0;
        for (const entity of this.entities) {
            if (bounds && !this.isVisible(entity, bounds)) continue;
            entity.draw(this.camera);
            drawn++;
        }
        this.drawnLastFrame = drawn;

        requestAnimationFrame(this.renderLoop);
    }
}

// ===== components/ui/dom.js =====
// The little DOM layer every demo was rewriting.
//
// Raptor draws the world in WebGL, but a panel, a slider and a readout row are
// still plain HTML — and four demos had each grown their own byte-identical
// copy of `el()`. That is the sort of duplication a framework exists to delete,
// so it lives here now.
//
// Nothing here knows about WebGL: this is deliberately usable on its own.

// Creates an element, assigns properties (not attributes — `className` and
// `textContent` work, and so do `onclick` handlers) and appends children.
//
//     el("div", { className: "card" }, [el("h2", { textContent: "Motor" })])
function el(tag, props = {}, children = []) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children) node.append(child);
    return node;
}

// Appends a <style> to the head. Pass an `id` and it replaces its own previous
// copy instead of stacking, so calling a scene's setup twice is harmless.
function injectStyles(css, id = null) {
    if (id) {
        const previous = document.getElementById(id);
        if (previous) previous.remove();
    }
    const node = el("style", { textContent: css });
    if (id) node.id = id;
    document.head.append(node);
    return node;
}

// A label/value row for a readout panel. `.v` is the element to write into:
//
//     const rpm = kv("Vueltas");
//     panel.append(rpm.row);
//     rpm.set(`${Math.round(engineRpm)} rpm`);
function kv(label, initial = "—") {
    const v = el("span", { className: "v", textContent: initial });
    const row = el("div", { className: "kv" }, [el("span", { className: "k", textContent: label }), v]);
    return { row, v, set: (text) => { v.textContent = text; } };
}

// A labelled range input. `format` controls the printed value only — `apply`
// always receives the number. Returns `set()` so code can move the slider back
// when the underlying value changes elsewhere (a preset, a reset button).
function slider(label, { min, max, step = 1, value = min, apply = () => {}, format = (v) => v } = {}) {
    const input = el("input", { type: "range", min, max, step, value });
    const val = el("span", { className: "val" });
    const render = () => { val.textContent = format(+input.value); };
    input.oninput = () => { render(); apply(+input.value); };
    render();
    const row = el("div", { className: "row" }, [el("label", { textContent: label }), input, val]);
    return {
        row, input, val,
        get value() { return +input.value; },
        set: (v) => { input.value = v; render(); },
    };
}

// A labelled <select>. `options` is a list of [value, text] pairs; `apply` gets
// the raw string value, because that is what the element actually holds.
function select(label, options, { value = null, apply = () => {} } = {}) {
    const node = el("select");
    for (const [optValue, text] of options) node.append(el("option", { value: String(optValue), textContent: text }));
    if (value !== null) node.value = String(value);
    node.onchange = () => apply(node.value);
    const row = el("div", { className: "row" }, [el("label", { textContent: label }), node]);
    return { row, node, set: (v) => { node.value = String(v); } };
}

// A button. Kept as a function purely so call sites read the same as the rest.
function button(label, onclick, props = {}) {
    return el("button", { textContent: label, onclick, ...props });
}

// A titled card — the panel building block. `title` is optional.
function card(title, children = []) {
    const kids = title ? [el("h2", { textContent: title }), ...children] : children;
    return el("div", { className: "card" }, kids);
}

// A muted line of explanatory text, for keyboard hints and the like.
function hint(text, props = {}) {
    return el("div", { className: "hint", textContent: text, ...props });
}

// The stylesheet those helpers assume: the dark panel look every demo had
// pasted into its own `STYLES` string. Scenes add their own CSS on top; this
// only covers the shared chrome (layout, cards, rows, buttons, readouts).
const BASE_STYLES = `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #e6e6e6; background: #1b1d21; }
    #app { display: flex; gap: 16px; padding: 16px; align-items: flex-start; flex-wrap: wrap; }
    #stage { position: relative; background: #0a0d12; border-radius: 8px; overflow: hidden; box-shadow: 0 6px 24px rgba(0,0,0,.4); }
    #stage canvas { display: block; max-width: 100%; height: auto; touch-action: none; }
    #panel { width: 300px; display: flex; flex-direction: column; gap: 16px; }

    h1 { font-size: 17px; margin: 0 0 4px; }
    h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #9aa0a6; margin: 0 0 10px; }
    .card { background: #26292e; border: 1px solid #33373d; border-radius: 8px; padding: 12px; }
    .kv { display: flex; justify-content: space-between; font-size: 13px; margin: 5px 0; }
    .kv .k { color: #9aa0a6; }
    .kv .v { font-variant-numeric: tabular-nums; }
    .hint { font-size: 12px; color: #7d838a; margin-top: 10px; text-align: center; }

    button { cursor: pointer; border: 1px solid #3a3f45; background: #2f343a; color: #e6e6e6; border-radius: 6px; padding: 9px 10px; font-size: 13px; width: 100%; }
    button:hover { background: #3a4047; }
    button:disabled { opacity: .4; cursor: default; }

    .row { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
    .row label { width: 104px; font-size: 12px; color: #b9bfc6; }
    .row input[type=range] { flex: 1; min-width: 0; }
    .row select { flex: 1; min-width: 0; background: #2f343a; color: #e6e6e6; border: 1px solid #3a3f45; border-radius: 6px; padding: 6px; }
    .row .val { width: 60px; text-align: right; font-variant-numeric: tabular-nums; font-size: 12px; color: #9aa0a6; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

    @media (max-width: 720px) {
        #app { flex-direction: column; padding: 10px; gap: 10px; }
        #panel { width: 100%; }
    }
`;

// ===== components/ui/fullscreen.js =====
// Fullscreen, with the vendor prefixes Safari still needs.
//
// The Fullscreen API is one of the few places where the unprefixed spec is not
// enough in 2026, and the prefixed names are just different enough (`webkit`
// capitalises the next word) that every call site grows the same four-branch
// dance. This wraps it once and adds the part people forget: a change listener,
// because the user can leave fullscreen with Escape without touching your
// button, and the label has to follow.

function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function isFullscreen(element = null) {
    const current = fullscreenElement();
    return element ? current === element : !!current;
}

// Must be called from a user gesture, like any fullscreen request. Returns a
// promise that resolves either way — a rejected request (an iframe without the
// permission, a browser that refuses) is reported as `false`, not thrown.
function requestFullscreen(element) {
    const request = element.requestFullscreen || element.webkitRequestFullscreen;
    if (!request) return Promise.resolve(false);
    return Promise.resolve(request.call(element)).then(() => true, () => false);
}

function exitFullscreen() {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (!exit) return Promise.resolve(false);
    return Promise.resolve(exit.call(document)).then(() => true, () => false);
}

function toggleFullscreen(element) {
    return isFullscreen() ? exitFullscreen() : requestFullscreen(element);
}

// Calls `handler(isFullscreen)` whenever it changes — including when the user
// presses Escape. Returns a function that unsubscribes.
function onFullscreenChange(handler) {
    const listener = () => handler(isFullscreen());
    const events = ["fullscreenchange", "webkitfullscreenchange"];
    for (const ev of events) document.addEventListener(ev, listener);
    return () => { for (const ev of events) document.removeEventListener(ev, listener); };
}

// The layout a fullscreen stage wants: the canvas takes the height it can get
// and the panel keeps its own scroll beside it, instead of the page flow that
// assumes a document. Scoped to `#app` because that is what Raptor makes
// fullscreen.
const FULLSCREEN_STYLES = `
    #app:fullscreen { height: 100vh; padding: 10px; flex-wrap: nowrap; align-items: stretch; }
    #app:fullscreen #stage { flex: 1 1 auto; display: flex; align-items: center; justify-content: center; min-width: 0; }
    #app:fullscreen #stage canvas { width: 100%; height: auto; max-height: 100%; max-width: 100%; }
    #app:fullscreen #panel { overflow-y: auto; flex: none; }
    @media (max-width: 720px) {
        #app:fullscreen { flex-direction: column; }
        #app:fullscreen #stage { flex: 0 0 auto; }
    }
`;

// ===== components/ui/loadingScreen.js =====
// The screen that covers the canvas while the assets arrive.
//
// Two rules it follows, because both are easy to get wrong:
//
// 1. **It needs no assets of its own.** A loading screen built from an image is
//    a loading screen that cannot appear until something has loaded.
// 2. **A failure has to be visible.** The worst outcome is a bar that stops at
//    73% and never says why, so a failed load turns the screen red and prints
//    which asset broke and what the error was.
//
// It is a plain DOM overlay rather than something drawn in WebGL: it has to
// work before the first frame is rendered.

const LOADING_STYLES = `
    .loading {
        position: absolute; inset: 0; z-index: 5;
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
        background: #0a0d12; color: #e6e6e6; padding: 24px; text-align: center;
        transition: opacity .25s ease;
    }
    .loading.done { opacity: 0; pointer-events: none; }
    .loading .title { font-size: 15px; font-weight: 600; letter-spacing: .02em; }
    .loading .bar {
        width: min(320px, 70%); height: 8px; border-radius: 4px; overflow: hidden;
        background: #1b1d21; border: 1px solid #3a3f45;
    }
    .loading .bar > i { display: block; height: 100%; width: 0; background: #6aa9e0; transition: width .18s ease; }
    .loading .status { font-size: 12px; color: #9aa0a6; font-variant-numeric: tabular-nums; min-height: 1.2em; }
    .loading.failed .bar > i { background: #d84a3a; }
    .loading.failed .title { color: #f0a094; }
    .loading .error {
        font-size: 12px; color: #f0a094; text-align: left; max-width: min(460px, 90%);
        white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
`;

class LoadingScreen {
    constructor(mount, { title = "Cargando…" } = {}) {
        this.fill = el("i");
        this.status = el("div", { className: "status", textContent: "preparando…" });
        this.title = el("div", { className: "title", textContent: title });
        this.node = el("div", { className: "loading" }, [
            this.title,
            el("div", { className: "bar" }, [this.fill]),
            this.status,
        ]);
        mount.append(this.node);
    }

    // Takes the progress object Assets hands out.
    update({ loaded, total, ratio, key }) {
        this.fill.style.width = `${Math.round(ratio * 100)}%`;
        // Counted in assets, not bytes: neither an <img> nor decodeAudioData
        // reports progress, so pretending to know the byte count would be a lie
        // that stalls at odd percentages.
        this.status.textContent = `${loaded} de ${total} · ${key}`;
        return this;
    }

    fail(error) {
        this.node.classList.add("failed");
        this.title.textContent = "No se pudo cargar";
        this.status.textContent = "";
        this.node.append(el("div", { className: "error", textContent: String(error.message || error) }));
        return this;
    }

    // Fades out, then removes itself once the transition has actually run.
    done() {
        this.node.classList.add("done");
        setTimeout(() => this.node.remove(), 300);
        return this;
    }

    remove() {
        this.node.remove();
        return this;
    }
}

// ===== components/scenes/sceneManager.js =====
// Holds the scenes and moves between them.
//
//     const scenes = new SceneManager(app);
//     scenes.add("menu", new Menu()).add("juego", new Bosque());
//     await scenes.go("menu");
//
// Three things it does that a bare `currentScene = next` does not:
//
// 1. **It loads on the way in.** A scene declares its assets in `preload()`,
//    and the first time you enter it, anything still pending is loaded behind a
//    loading screen. So a menu appears instantly and the level's art arrives
//    while the player is reading it, instead of everything waiting on everything.
//
// 2. **It fades.** A hard cut between two screens reads as a glitch. The fade is
//    a DOM overlay rather than something drawn in WebGL, so it also covers the
//    frames where the old scene is gone and the new one is not built yet.
//
// 3. **It cannot overlap with itself.** Two `go()` calls landing together — a
//    key and a click on the same button — would otherwise run two teardowns and
//    two builds interleaved. The second one waits.

const SCENE_STYLES = `
    .scene-fade {
        position: absolute; inset: 0; z-index: 4; background: #0a0d12;
        opacity: 0; pointer-events: none; transition: opacity var(--scene-fade, .22s) ease;
    }
    .scene-fade.on { opacity: 1; }
`;

class SceneManager {
    constructor(app, { fadeMs = 220 } = {}) {
        this.app = app;
        this.scenes = new Map();
        this.current = null;
        this.fadeMs = fadeMs;
        this._busy = null;
        this._preloaded = new Set();

        this.fade = document.createElement("div");
        this.fade.className = "scene-fade";
        this.fade.style.setProperty("--scene-fade", `${fadeMs}ms`);
        app.stage.append(this.fade);
    }

    add(name, scene) {
        scene.name = scene.name === "escena" ? name : scene.name;
        this.scenes.set(name, scene);
        return this;
    }

    get(name) {
        return this.scenes.get(name) || null;
    }

    get name() {
        return this.current ? [...this.scenes].find(([, s]) => s === this.current)?.[0] ?? null : null;
    }

    // Switches scenes. Returns a promise that resolves once the new one is
    // built, so a test — or a cutscene — can wait for it.
    go(name, data) {
        // Serialised: a second call queues behind the first instead of
        // interleaving a teardown with a build.
        this._busy = (this._busy || Promise.resolve()).then(() => this._go(name, data));
        return this._busy;
    }

    async _go(name, data) {
        const next = this.scenes.get(name);
        if (!next) throw new Error(`Raptor: no hay ninguna escena llamada "${name}"`);

        if (this.current) await this._setFade(true);

        if (this.current) {
            this.current._exit();
            this.current = null;
        }

        // First entry: give the scene a chance to declare what it needs, and
        // load whatever is still pending.
        if (!this._preloaded.has(name)) {
            this._preloaded.add(name);
            next.app = this.app;
            next.manager = this;
            next.preload(this.app.assets);
            if (this.app.assets.pending > 0) {
                const screen = new LoadingScreen(this.app.stage, { title: `Cargando ${name}…` });
                try {
                    await this.app.assets.load({ onProgress: (p) => screen.update(p) });
                    screen.remove();
                } catch (error) {
                    screen.fail(error);
                    throw error;
                }
            }
        }

        this.current = next;
        next._enter(this.app, this, data);
        this.app._emit("scene", { name, scene: next, data });

        await this._setFade(false);
        return next;
    }

    _setFade(on) {
        this.fade.classList.toggle("on", on);
        // Waiting out the transition is what keeps the swap hidden; without it
        // the new scene pops in while the screen is still black.
        return new Promise((resolve) => setTimeout(resolve, this.fadeMs));
    }

    destroy() {
        if (this.current) this.current._exit();
        this.current = null;
        this.fade.remove();
        return this;
    }
}

// ===== components/input/keyboard.js =====
// Keyboard input as state, not as a pile of event handlers.
//
// Every demo had grown the same shape by hand: a `held` Set filled by keydown
// and drained by keyup, an `if / else if` ladder for one-shot actions, and a
// list of keys that need `preventDefault` so the arrows do not scroll the page.
// This is that, once.
//
// Two kinds of input, because games need both:
//
//   held    — "is W down right now", read every frame:  kb.isDown("w")
//   actions — "the user pressed R", fired once per press: kb.on("r", reset)
//
// Keys are normalised: single characters are lower-cased ("W" → "w"), anything
// longer is left alone ("ArrowUp", "Space"), so bindings do not care about
// shift or caps lock.

const SCROLLERS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Space"];

function normalizeKey(key) {
    return key.length === 1 ? key.toLowerCase() : key;
}

class Keyboard {
    // `preventDefault` takes a list of keys to swallow, or `true` for the usual
    // page-scrolling suspects, or `false` to never interfere.
    constructor({ target = null, preventDefault = true } = {}) {
        this.held = new Set();
        this.actions = new Map();
        this.target = null;
        this._prevent = preventDefault === true ? new Set(SCROLLERS)
            : preventDefault ? new Set(preventDefault) : new Set();

        this._onDown = (e) => {
            const key = normalizeKey(e.key);
            if (this._prevent.has(key) || this._prevent.has(e.code)) e.preventDefault();
            // Ignore auto-repeat for actions: holding R should reset once, not
            // thirty times a second. The held set does not care either way.
            const first = !this.held.has(key);
            this.held.add(key);
            if (first) this._fire(key, e);
        };
        this._onUp = (e) => {
            this.held.delete(normalizeKey(e.key));
        };
        // A tab-out never delivers the keyup, which would leave the key stuck
        // down. Dropping everything on blur is the standard cure.
        this._onBlur = () => this.held.clear();

        if (target) this.attach(target);
    }

    attach(target = window) {
        if (this.target) this.detach();
        this.target = target;
        target.addEventListener("keydown", this._onDown);
        target.addEventListener("keyup", this._onUp);
        (target.defaultView || target).addEventListener?.("blur", this._onBlur);
        return this;
    }

    detach() {
        if (!this.target) return this;
        this.target.removeEventListener("keydown", this._onDown);
        this.target.removeEventListener("keyup", this._onUp);
        (this.target.defaultView || this.target).removeEventListener?.("blur", this._onBlur);
        this.target = null;
        return this;
    }

    // Binds a one-shot action. Several keys can share a handler:
    //
    //     kb.on(["r", "Backspace"], reset);
    on(keys, handler) {
        for (const key of [].concat(keys)) {
            const list = this.actions.get(normalizeKey(key)) || [];
            list.push(handler);
            this.actions.set(normalizeKey(key), list);
        }
        return this;
    }

    off(key, handler = null) {
        const k = normalizeKey(key);
        if (!handler) this.actions.delete(k);
        else this.actions.set(k, (this.actions.get(k) || []).filter((h) => h !== handler));
        return this;
    }

    _fire(key, event) {
        for (const handler of this.actions.get(key) || []) handler(event);
    }

    // True while any of the given keys is down — so "w or up arrow" is one call.
    isDown(...keys) {
        for (const key of keys.flat()) if (this.held.has(normalizeKey(key))) return true;
        return false;
    }

    // −1, 0 or +1 from a pair of opposed key groups. This is what turns keys
    // into something a physics step can use:
    //
    //     const steer = kb.axis(["a", "ArrowLeft"], ["d", "ArrowRight"]);
    axis(negative, positive) {
        return (this.isDown(positive) ? 1 : 0) - (this.isDown(negative) ? 1 : 0);
    }

    // Lets code inject a virtual key press — the on-screen pad uses this so
    // touch and keyboard feed exactly the same state instead of racing.
    press(key) {
        const k = normalizeKey(key);
        if (!this.held.has(k)) { this.held.add(k); this._fire(k, null); }
        return this;
    }

    release(key) {
        this.held.delete(normalizeKey(key));
        return this;
    }

    clear() {
        this.held.clear();
        return this;
    }
}

// ===== components/input/touchpad.js =====
// On-screen controls overlaid on the canvas, so a demo is playable on a phone.
//
// Two kinds of button, and the difference matters:
//
//   pedal — held down. Presses on pointerdown, releases on up/cancel/leave, and
//           grabs the pointer so sliding a finger off the button still counts
//           as released rather than sticking forever.
//   tap   — fires once on pointerdown. Deliberately not `click`: on touch that
//           waits ~300 ms, which feels broken on a fire button.
//
// A pedal writes into a `Keyboard`, so touch and keys land in the same held
// set and neither can fight the other — that bug (finger says go, key says
// stop) is exactly what this avoids.

const PAD_STYLES = `
    .pad { position: absolute; display: flex; gap: 10px; align-items: flex-end; }
    .pad.left { left: 14px; bottom: 14px; }
    .pad.right { right: 14px; bottom: 14px; }
    .pad.top-left { left: 12px; top: 12px; align-items: flex-start; }
    .pad.top-right { right: 12px; top: 12px; align-items: flex-start; }
    .pad .col { display: flex; flex-direction: column; gap: 10px; }
    .tbtn {
        min-width: 62px; height: 62px; padding: 0 12px; border-radius: 12px;
        display: flex; align-items: center; justify-content: center;
        font-size: 20px; line-height: 1; color: #e6e6e6;
        background: rgba(38, 43, 51, .6); border: 1px solid rgba(255, 255, 255, .26);
        -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
        touch-action: none; user-select: none; -webkit-user-select: none;
        -webkit-tap-highlight-color: transparent; cursor: pointer;
    }
    .tbtn.round { width: 60px; min-width: 0; padding: 0; border-radius: 50%; font-size: 22px; }
    .tbtn.small { min-width: 52px; height: 52px; font-size: 17px; border-radius: 10px; }
    .tbtn.label { font-size: 13px; font-weight: 700; letter-spacing: .04em; }
    .tbtn.on, .tbtn.round:active { background: rgba(74, 127, 181, .8); border-color: #7fb2e6; }
    .tbtn.off { opacity: .35; }

    @media (max-width: 720px) {
        .pad { gap: 8px; }
        .pad.left { left: 10px; bottom: 10px; }
        .pad.right { right: 10px; bottom: 10px; }
        .pad .col { gap: 8px; }
        .tbtn { min-width: 66px; height: 56px; font-size: 19px; padding: 0 8px; }
        .tbtn.round { width: 64px; min-width: 0; height: 64px; padding: 0; }
        .tbtn.small { min-width: 44px; height: 40px; font-size: 16px; }
    }
`;

class TouchPad {
    // `mount` is the positioned element the pads sit on (the #stage wrapper).
    // `keyboard` is optional: without one, pedals still report through `held`.
    constructor(mount, { keyboard = null } = {}) {
        this.mount = mount;
        this.keyboard = keyboard;
        this.held = keyboard ? keyboard.held : new Set();
        this.buttons = new Map();
    }

    // Creates a button element. `name` is how you look it up later.
    button(name, label, className = "") {
        const node = el("div", { className: `tbtn ${className}`.trim(), textContent: label });
        this.buttons.set(name, node);
        return node;
    }

    get(name) {
        return this.buttons.get(name);
    }

    // Places children into a pad anchored to a corner: "left", "right",
    // "top-left" or "top-right". Nested arrays become vertical columns.
    pad(where, children) {
        const nodes = children.map((child) =>
            Array.isArray(child) ? el("div", { className: "col" }, child) : child);
        const node = el("div", { className: `pad ${where}` }, nodes);
        this.mount.append(node);
        return node;
    }

    // Held button. `key` is what lands in the keyboard's held set; the button
    // gets the `on` class while pressed so it lights up.
    pedal(node, key, { onChange = null } = {}) {
        const set = (down) => {
            if (down) this.held.add(key); else this.held.delete(key);
            node.classList.toggle("on", down);
            if (onChange) onChange(down);
        };
        node.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            // Capture so a finger sliding off the button still releases it.
            if (node.setPointerCapture && e.pointerId != null) {
                try { node.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
            }
            set(true);
        });
        for (const ev of ["pointerup", "pointercancel", "pointerleave"]) {
            node.addEventListener(ev, () => set(false));
        }
        return node;
    }

    // One-shot button. Fires on pointerdown, not click — touch delays click.
    tap(node, handler) {
        node.addEventListener("pointerdown", (e) => { e.preventDefault(); handler(e); });
        return node;
    }

    // Reflects state back onto a button: lit, or dimmed when unavailable.
    setActive(name, active) {
        this.get(name)?.classList.toggle("on", !!active);
        return this;
    }

    setEnabled(name, enabled) {
        this.get(name)?.classList.toggle("off", !enabled);
        return this;
    }

    setLabel(name, label) {
        const node = this.get(name);
        if (node) node.textContent = label;
        return this;
    }
}

// ===== components/render/texture.js =====
// An image on the GPU.
//
// Three things about WebGL 1 textures trip everyone up, so they are handled
// here once instead of at every call site:
//
// 1. **Y is flipped.** An image's first row is its *top*; a GL texture's first
//    row is its *bottom*. Without UNPACK_FLIP_Y_WEBGL every sprite is upside
//    down, which people usually "fix" by flipping the UVs and then fight
//    forever. Flipped on upload, once.
//
// 2. **Non-power-of-two.** A texture whose sides are not powers of two cannot
//    have mipmaps and cannot REPEAT — it renders black if you ask for either.
//    Since real sprite sheets are rarely 512×512, the size is checked and the
//    parameters are chosen accordingly, rather than leaving a black rectangle
//    and no explanation.
//
// 3. **Loading takes time.** A texture cannot be used the frame you ask for it.
//    Every Texture is therefore usable *immediately*, backed by a 1×1 white
//    pixel, and swaps itself for the real image when it arrives. Nothing has to
//    wait, and nothing crashes in between.
//
// Sources: a URL, an <img>, a <canvas>, or raw pixels. The canvas one matters
// more than it looks — it is how the demos build sprite sheets *procedurally*,
// so the generated pages stay single files that open from file:// with no
// assets next to them, exactly like the synthesised engine sound.

function isPowerOfTwo(value) {
    return (value & (value - 1)) === 0 && value > 0;
}

class Texture {
    constructor(gl, { smooth = false, wrap = false, label = "" } = {}) {
        this.gl = gl;
        this.label = label;
        this.smooth = smooth;   // linear filtering; off by default for pixel art
        this.wrap = wrap;       // REPEAT; only possible on power-of-two sizes
        this.width = 1;
        this.height = 1;
        this.ready = false;

        this.handle = gl.createTexture();
        // A single white pixel, so the texture is drawable before its image
        // exists. White because sprites multiply by their tint: an unloaded
        // sprite shows as its tint colour rather than as a black hole.
        this._upload(new Uint8Array([255, 255, 255, 255]), 1, 1);
    }

    // --- Sources ---------------------------------------------------------

    // Kicks off the load and returns the Texture *now*; `texture.loaded` is the
    // promise for code that would rather wait.
    static fromImage(gl, url, options = {}) {
        const texture = new Texture(gl, { label: url, ...options });
        texture.loaded = new Promise((resolve, reject) => {
            const image = new Image();
            // Only set for cross-origin URLs: setting it for a same-origin or
            // data: URL makes some browsers refuse the load outright.
            if (/^https?:/i.test(url) && !url.startsWith(location.origin)) {
                image.crossOrigin = "anonymous";
            }
            image.onload = () => { texture.setSource(image); resolve(texture); };
            image.onerror = () => reject(new Error(`Raptor: no se pudo cargar la textura "${url}"`));
            image.src = url;
        });
        return texture;
    }

    static fromCanvas(gl, canvas, options = {}) {
        const texture = new Texture(gl, { label: "canvas", ...options });
        texture.setSource(canvas);
        texture.loaded = Promise.resolve(texture);
        return texture;
    }

    // Raw RGBA bytes, four per pixel, top row first.
    static fromPixels(gl, pixels, width, height, options = {}) {
        const texture = new Texture(gl, { label: "pixels", ...options });
        texture._upload(pixels instanceof Uint8Array ? pixels : new Uint8Array(pixels), width, height);
        texture.ready = true;
        texture.loaded = Promise.resolve(texture);
        return texture;
    }

    // A flat colour, handy as a placeholder or for solid overlays.
    static solid(gl, { red = 1, green = 1, blue = 1, alpha = 1 } = {}) {
        const byte = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255);
        return Texture.fromPixels(gl, new Uint8Array([byte(red), byte(green), byte(blue), byte(alpha)]), 1, 1);
    }

    // --- Upload ----------------------------------------------------------

    // Replaces the contents with an <img>, <canvas>, ImageBitmap or ImageData.
    setSource(source) {
        const gl = this.gl;
        this.width = source.width;
        this.height = source.height;

        gl.bindTexture(gl.TEXTURE_2D, this.handle);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        this._applyParameters();

        this.ready = true;
        if (this.onLoad) this.onLoad(this);
        return this;
    }

    _upload(pixels, width, height) {
        const gl = this.gl;
        this.width = width;
        this.height = height;
        gl.bindTexture(gl.TEXTURE_2D, this.handle);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        this._applyParameters();
        return this;
    }

    _applyParameters() {
        const gl = this.gl;
        const potential = isPowerOfTwo(this.width) && isPowerOfTwo(this.height);

        // Mipmaps and REPEAT need power-of-two sides. Asking for them anyway is
        // the classic "why is my sprite black" — so they are simply not asked
        // for unless the size allows it.
        if (potential && this.smooth) {
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        } else {
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.smooth ? gl.LINEAR : gl.NEAREST);
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.smooth ? gl.LINEAR : gl.NEAREST);

        const mode = this.wrap && potential ? gl.REPEAT : gl.CLAMP_TO_EDGE;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mode);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, mode);
    }

    // NEAREST keeps pixel art crisp; LINEAR smooths photos and big scales.
    setSmooth(smooth) {
        this.smooth = smooth;
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.handle);
        this._applyParameters();
        return this;
    }

    bind(unit = 0) {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, this.handle);
        return unit;
    }

    dispose() {
        if (this.handle) this.gl.deleteTexture(this.handle);
        this.handle = null;
        this.ready = false;
    }
}

// ===== components/assets/assets.js =====
// The asset loader: declare what a game needs, load it, then start.
//
// Without one, a game either reaches for an image that has not arrived yet, or
// every call site grows its own `await`. The pattern that works is boring and
// old: declare a manifest, load it with a progress bar, and only then run the
// game — by which point `assets.get("heroe")` is a plain synchronous lookup.
//
//     assets.texture("heroe", "heroe.png");
//     assets.json("nivel", "nivel1.json");
//     assets.sound("salto", "salto.wav");
//     await assets.load({ onProgress: (p) => barra(p.ratio) });
//
//     assets.texture("heroe");   // ya cargada, sin await
//
// The same method declares and reads: with a URL it enqueues, without one it
// looks up. That is deliberate — it keeps the two halves of an asset's life
// spelled the same way.
//
// What it gets right, because these are the ways a loader actually hurts:
//
// - **A failed asset does not hang the game.** Every kind has an error path and
//   a timeout, so a typo'd filename is a message, not a spinner forever.
// - **The same URL loads once.** Two names can point at one file and it is
//   fetched, decoded and uploaded a single time.
// - **Progress is honest.** For images and audio the browser gives no reliable
//   byte count, so progress is counted in *assets*, not bytes, and says so.
// - **Concurrency is capped.** Firing four hundred requests at once is slower
//   than eight at a time, not faster.
// - **Loading twice is safe.** `load()` resolves immediately if nothing is
//   pending, so calling it after adding one more asset does the right thing.

const ASSET_KIND = {
    TEXTURE: "texture",
    IMAGE: "image",
    JSON: "json",
    TEXT: "text",
    SOUND: "sound",
    FONT: "font",
};

const DEFAULT_TIMEOUT = 20000;

// Rejects if the underlying load has not settled in time. Without this a
// request that never answers leaves the loading screen up forever, which reads
// to a player as "the game is broken" with nothing to go on.
function withTimeout(promise, ms) {
    if (!ms) return promise;
    let timer;
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`agotó el tiempo tras ${ms} ms`)), ms);
        }),
    ]).finally(() => clearTimeout(timer));
}

// How each kind is fetched. A registry rather than a switch inside the class,
// so a new kind is an *addition* and never an edit: `Assets.register` drops one
// in and gives it a declaring method, without this file knowing it exists.
//
//     Assets.register("video", async (entry) => cargarVideo(entry.url));
//     assets.video("intro", "intro.mp4");
const LOADERS = new Map();

class Assets {
    constructor({ gl = null, basePath = "", timeout = DEFAULT_TIMEOUT, concurrency = 8 } = {}) {
        this.gl = gl;
        this.basePath = basePath;
        this.timeout = timeout;
        this.concurrency = concurrency;

        this.entries = new Map();  // key -> { key, kind, url, options, status, value, error, ms }
        this._byUrl = new Map();   // url -> promise, so one file loads once
        this._audioContext = null;
    }

    // The context sounds were decoded into. Playing needs a user gesture;
    // decoding did not, which is why this exists before anyone has clicked.
    get audioContext() {
        return this._audioContext;
    }

    get pending() {
        return [...this.entries.values()].filter((e) => e.status === "pending").length;
    }

    get failed() {
        return [...this.entries.values()].filter((e) => e.status === "error");
    }

    // Everything declared so far, for a progress table or a debug panel.
    get manifest() {
        return [...this.entries.values()].map(({ key, kind, url, status, error, ms }) =>
            ({ key, kind, url, status, error: error?.message ?? null, ms }));
    }

    // --- Declaring and reading -------------------------------------------

    _declare(kind, key, url, options) {
        if (this.entries.has(key)) {
            const existing = this.entries.get(key);
            // Re-declaring the same thing is a no-op; re-declaring a *different*
            // URL under a live key is a mistake worth naming.
            if (existing.url !== this._resolve(url)) {
                throw new Error(`Raptor: el asset "${key}" ya está declarado como ${existing.url}`);
            }
            return existing;
        }
        const entry = {
            key, kind, url: this._resolve(url), options: options || {},
            status: "pending", value: null, error: null, ms: 0,
        };
        this.entries.set(key, entry);
        return entry;
    }

    _resolve(url) {
        // A data: URI is already absolute, and so is anything with a scheme.
        if (!this.basePath || /^([a-z]+:|\/)/i.test(url)) return url;
        return this.basePath.replace(/\/$/, "") + "/" + url.replace(/^\//, "");
    }

    _read(key, kind) {
        const entry = this.entries.get(key);
        if (!entry) throw new Error(`Raptor: no hay ningún asset llamado "${key}"`);
        if (entry.status === "pending") {
            throw new Error(`Raptor: el asset "${key}" todavía no se ha cargado — falta un await assets.load()`);
        }
        if (entry.status === "error") throw entry.error;
        if (kind && entry.kind !== kind) {
            throw new Error(`Raptor: "${key}" es ${entry.kind}, no ${kind}`);
        }
        return entry.value;
    }

    // Declares and returns the registry, so declarations chain. Separate from
    // `_declare` — which returns the entry — because the two callers want
    // different things and hiding that behind `&& this` only looked clever.
    _declareAndReturn(kind, key, url, options) {
        this._declare(kind, key, url, options);
        return this;
    }

    // With a URL these declare; without one they read. Same name, both halves.
    // Every kind's method is generated by `Assets.register` below, including the
    // built-in ones — there is no separate path for them.

    // Untyped read, when the caller knows what it asked for.
    get(key) { return this._read(key); }
    has(key) { return this.entries.has(key) && this.entries.get(key).status === "ready"; }
    status(key) { return this.entries.get(key)?.status ?? null; }

    // Registers something already in hand — a canvas you drew, a texture you
    // built — so generated and loaded assets are reached the same way. A
    // registry is useful even for things that never travelled over a network.
    put(key, value, kind = "custom") {
        this.entries.set(key, { key, kind, url: null, options: {}, status: "ready", value, error: null, ms: 0 });
        return this;
    }

    // Declares a whole manifest at once:
    //   assets.manifest({ texture: { heroe: "heroe.png" }, json: { nivel: "n1.json" } })
    add(manifest) {
        for (const [kind, group] of Object.entries(manifest)) {
            if (typeof this[kind] !== "function") throw new Error(`Raptor: tipo de asset desconocido "${kind}"`);
            for (const [key, url] of Object.entries(group)) {
                Array.isArray(url) ? this[kind](key, url[0], url[1]) : this[kind](key, url);
            }
        }
        return this;
    }

    // --- Loading -----------------------------------------------------------

    // `onProgress` receives { loaded, total, ratio, key, entry } after each one.
    // `tolerant` keeps going and reports failures in `assets.failed` instead of
    // rejecting — for assets a game can live without (a decorative sound).
    async load({ onProgress = null, tolerant = false } = {}) {
        const queue = [...this.entries.values()].filter((e) => e.status === "pending");
        const total = queue.length;
        if (total === 0) return this;

        let loaded = 0;
        const report = (entry) => {
            loaded++;
            if (onProgress) onProgress({ loaded, total, ratio: loaded / total, key: entry.key, entry });
        };

        // A fixed pool of workers pulling from one queue: simpler than batching,
        // and it keeps exactly `concurrency` requests in flight the whole time
        // instead of stalling at the end of each batch.
        let next = 0;
        const worker = async () => {
            while (next < queue.length) {
                const entry = queue[next++];
                const started = (typeof performance !== "undefined" ? performance : Date).now();
                try {
                    entry.status = "loading";
                    entry.value = await this._loadOne(entry);
                    entry.status = "ready";
                } catch (error) {
                    entry.status = "error";
                    entry.error = error instanceof Error ? error : new Error(String(error));
                }
                entry.ms = Math.round((typeof performance !== "undefined" ? performance : Date).now() - started);
                report(entry);
            }
        };
        await Promise.all(Array.from({ length: Math.min(this.concurrency, total) }, worker));

        const failed = this.failed;
        if (failed.length && !tolerant) {
            throw new Error(
                `Raptor: fallaron ${failed.length} de ${total} assets:\n  ` +
                failed.map((e) => `${e.key} (${e.url}): ${e.error.message}`).join("\n  "),
            );
        }
        return this;
    }

    _loadOne(entry) {
        // One promise per URL: two keys pointing at the same file share the
        // fetch, the decode and — for a texture — the GPU upload.
        const cacheKey = `${entry.kind}:${entry.url}`;
        if (!this._byUrl.has(cacheKey)) {
            this._byUrl.set(cacheKey, withTimeout(this._fetchByKind(entry), entry.options.timeout ?? this.timeout, entry.url));
        }
        return this._byUrl.get(cacheKey);
    }

    _fetchByKind(entry) {
        const loader = LOADERS.get(entry.kind);
        if (!loader) throw new Error(`Raptor: tipo de asset desconocido "${entry.kind}"`);
        return loader(entry, this);
    }

    // Teaches Assets a new kind. The loader receives (entry, assets) and returns
    // a promise for the value; a same-named method is added for declaring and
    // reading it, so a custom kind looks exactly like a built-in one.
    static register(kind, loader) {
        LOADERS.set(kind, loader);
        if (!Object.prototype.hasOwnProperty.call(Assets.prototype, kind)) {
            Assets.prototype[kind] = function (key, url = null, options) {
                return url === null ? this._read(key, kind) : this._declareAndReturn(kind, key, url, options);
            };
        }
        return Assets;
    }

    async _loadTexture(entry) {
        if (!this.gl) throw new Error("Raptor: para cargar texturas hace falta un contexto WebGL (new Assets({ gl }))");
        const image = await this._loadImage(entry.url);
        const texture = new Texture(this.gl, { label: entry.url, ...entry.options });
        texture.setSource(image);
        return texture;
    }

    _loadImage(url) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            if (/^https?:/i.test(url) && !url.startsWith(location.origin)) image.crossOrigin = "anonymous";
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error("no se pudo cargar la imagen"));
            image.src = url;
        });
    }

    async _loadFetch(url, as) {
        // A network-level failure throws a bare "Failed to fetch" with no clue
        // which URL it was, so it gets named here.
        let response;
        try {
            response = await fetch(url);
        } catch (cause) {
            throw new Error(`no se pudo alcanzar el recurso (${cause.message})`);
        }
        // fetch only rejects on network failure: a 404 arrives as a perfectly
        // successful response, which is how missing files quietly become
        // "undefined is not an object" three frames later.
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return as === "json" ? response.json() : response.text();
    }

    // Decoded into an AudioBuffer, ready for a source node. Decoding is allowed
    // before any user gesture — only *playing* needs one — so the context is
    // created here and left suspended.
    async _loadSound(entry) {
        const AudioCtx = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
        if (!AudioCtx) throw new Error("este navegador no trae Web Audio");
        if (!this._audioContext) this._audioContext = entry.options.context || new AudioCtx();
        const response = await fetch(entry.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        // The callback form is the one old Safari understands; the promise form
        // is not universal even now.
        return new Promise((resolve, reject) => {
            this._audioContext.decodeAudioData(bytes, resolve, () => reject(new Error("no se pudo decodificar el audio")));
        });
    }

    async _loadFont(entry) {
        if (typeof FontFace === "undefined") throw new Error("este navegador no trae FontFace");
        const face = new FontFace(entry.options.family || entry.key, `url(${entry.url})`, entry.options.descriptors);
        await face.load();
        document.fonts.add(face);
        return face;
    }

    // Frees the GPU side of every texture. The registry stays, so a scene can
    // be torn down and rebuilt without leaking.
    dispose() {
        for (const entry of this.entries.values()) {
            if (entry.kind === ASSET_KIND.TEXTURE && entry.value) entry.value.dispose();
        }
        this.entries.clear();
        this._byUrl.clear();
        return this;
    }
}

// The kinds Raptor ships with, declared through the very same door a custom one
// would use. Nothing above this line knows the list.
Assets.register(ASSET_KIND.TEXTURE, (entry, assets) => assets._loadTexture(entry));
Assets.register(ASSET_KIND.IMAGE, (entry, assets) => assets._loadImage(entry.url));
Assets.register(ASSET_KIND.JSON, (entry, assets) => assets._loadFetch(entry.url, "json"));
Assets.register(ASSET_KIND.TEXT, (entry, assets) => assets._loadFetch(entry.url, "text"));
Assets.register(ASSET_KIND.SOUND, (entry, assets) => assets._loadSound(entry));
Assets.register(ASSET_KIND.FONT, (entry, assets) => assets._loadFont(entry));

// ===== components/app.js =====
// The front door. `App` is what you reach for to build something with Raptor;
// everything else is a part you can also use on its own.
//
// It exists because four demos had each written the same forty lines: wait for
// the DOM, inject a stylesheet, build a #stage and a #panel, create the canvas
// and the GL context, wire a keyboard, register an update callback, start the
// loop. That is not scene code, it is framework code, so it lives here.
//
//     App.boot({ title: "Mi demo" }, (app) => {
//         app.add(new Rectangle(app.gl, { width: 2, height: 1 }).init());
//         app.onUpdate((dt) => { ... });
//     });
//
// `App.boot` waits for the document, builds the page and starts the loop, so a
// scene never writes that plumbing again.
//
// What it owns: the canvas and its size, the render loop, the camera, the
// entity list, the keyboard, the on-screen pad, the panel, fullscreen. What it
// does not own: your game. Everything is exposed (`app.engine`, `app.gl`,
// `app.stage`) so you can drop to the layer below whenever the shell is in the
// way.








class App {
    constructor({
        mount = null,          // where the page goes; defaults to <body>
        width = 800,           // drawing-buffer size, in pixels
        height = 600,
        styles = "",           // scene CSS, appended after the framework's
        baseStyles = true,     // set false to style the page from scratch
        panel = true,          // build the side panel element
        keyboard = true,       // create and attach a Keyboard
        touch = true,          // create a TouchPad over the canvas
        autoResize = false,    // track the CSS box and resize the buffer to it
        assetPath = "",        // prefix for every relative asset URL
    } = {}) {
        injectStyles(
            (baseStyles ? BASE_STYLES + PAD_STYLES + FULLSCREEN_STYLES + LOADING_STYLES + SCENE_STYLES : "") + styles,
            "raptor-styles",
        );

        this.engine = new RaptorEngine();
        this.stage = el("div", { id: "stage" });
        this.panel = panel ? el("div", { id: "panel" }) : null;
        this.root = el("div", { id: "app" }, panel ? [this.stage, this.panel] : [this.stage]);
        (mount || document.body).append(this.root);

        this.engine.createWindow(this.stage, { width, height });
        this.keyboard = keyboard ? new Keyboard().attach(window) : null;
        this.touch = touch ? new TouchPad(this.stage, { keyboard: this.keyboard }) : null;
        // The registry exists from the start, so a scene can `put()` something
        // it generated even if it never loads a file.
        this.assets = new Assets({ gl: this.gl, basePath: assetPath });
        this.plugins = [];

        this._offFullscreen = onFullscreenChange((on) => this._emit("fullscreenchange", on));
        this._listeners = new Map();

        if (autoResize) this.watchResize();
    }

    // Waits for the document, builds the app and hands it to `setup`. `setup`
    // may return a cleanup function; it runs if the app is ever destroyed.
    //
    // The loop starts *after* setup returns, so a scene can add entities and
    // updaters without the first frame catching it half-built.
    // Waits for the document, builds the app, loads whatever `assets` declares
    // and then hands it all to `setup`. `setup` may return a cleanup function;
    // it runs if the app is ever destroyed.
    //
    // The loop starts *after* setup returns, so a scene can add entities and
    // updaters without the first frame catching it half-built — and after the
    // assets are in, so `assets.texture("x")` is a plain synchronous lookup
    // rather than something to await at every call site.
    //
    //     App.boot({
    //         assets: (a) => a.texture("heroe", "heroe.png"),
    //     }, (app) => {
    //         new Sprite(app.gl, { texture: app.assets.texture("heroe") }).init();
    //     });
    static boot(options, setup) {
        if (typeof options === "function") { setup = options; options = {}; }

        const run = async () => {
            const app = new App(options);
            if (options.title) app.title(options.title);

            if (options.assets) {
                // The screen goes up before anything is declared, so a slow
                // manifest never shows a bare canvas first.
                const screen = new LoadingScreen(app.stage, { title: options.loadingTitle || "Cargando…" });
                try {
                    await options.assets(app.assets, app);
                    await app.assets.load({
                        onProgress: (progress) => {
                            screen.update(progress);
                            app._emit("progress", progress);
                        },
                        tolerant: options.tolerantAssets === true,
                    });
                    screen.done();
                } catch (error) {
                    // Stop here and *say so*. Running the scene with half its
                    // assets missing turns one clear message into a pile of
                    // null-reference errors that hide the real cause.
                    screen.fail(error);
                    app._emit("assetserror", error);
                    throw error;
                }
            }

            app._cleanup = (setup ? setup(app) : null) || null;

            // Declaring scenes in the boot options is the shortest path from
            // "a page" to "a game with a menu".
            if (options.scenes) {
                for (const [name, scene] of Object.entries(options.scenes)) app.scenes.add(name, scene);
            }
            app.start();
            // After start(), so the first scene builds against a live loop.
            if (options.startScene) await app.scenes.go(options.startScene);
            return app;
        };

        if (document.readyState === "loading") {
            return new Promise((resolve, reject) => {
                document.addEventListener("DOMContentLoaded", () => run().then(resolve, reject));
            });
        }
        return run();
    }

    // --- The bits scenes reach for most ---------------------------------

    get gl() { return this.engine.context; }
    get canvas() { return this.engine.canvas; }
    get camera() { return this.engine.camera; }
    set camera(camera) { this.engine.camera = camera; }
    get entities() { return this.engine.entities; }
    get running() { return this.engine.running; }

    // Skipping off-screen entities. Worth it as soon as the world is bigger
    // than the view; pointless when everything fits on screen anyway.
    get culling() { return this.engine.culling; }
    set culling(on) { this.engine.culling = on; }
    get drawnLastFrame() { return this.engine.drawnLastFrame; }

    add(entity) { return this.engine.add(entity); }
    remove(entity) { this.engine.remove(entity); return this; }
    onUpdate(fn) { this.engine.addUpdater(fn); return fn; }
    removeUpdate(fn) { this.engine.removeUpdater(fn); return this; }

    // Created on first use, so pages that never use scenes pay nothing.
    get scenes() {
        if (!this._scenes) this._scenes = new SceneManager(this);
        return this._scenes;
    }

    start() { this.engine.start(); return this; }
    stop() { this.engine.stop(); return this; }
    // Pausing keeps the last frame on screen: the loop stops, nothing is
    // cleared. Resuming does not replay the elapsed time as one huge dt.
    pause() { this.engine.stop(); return this; }
    resume() { if (!this.engine.running) this.engine.start(); return this; }

    // Registers a plugin. Anything with `step(dt)` (a physics World, say) is
    // wired straight into the loop; anything with `install(app)` gets to set
    // itself up. That is the whole extension contract.
    use(plugin) {
        this.plugins.push(plugin);
        if (typeof plugin.install === "function") plugin.install(this);
        else if (typeof plugin.step === "function") this.onUpdate((dt) => plugin.step(dt));
        else if (typeof plugin.update === "function") this.onUpdate((dt) => plugin.update(dt));
        return plugin;
    }

    // --- Page furniture --------------------------------------------------

    title(text) {
        document.title = text;
        if (this.panel) this.panel.prepend(el("h1", { textContent: text }));
        return this;
    }

    // Appends cards (or any nodes) to the side panel.
    addPanel(...nodes) {
        if (this.panel) this.panel.append(...nodes.flat());
        return this;
    }

    // Anything absolutely positioned over the canvas: a HUD, a banner, a pad.
    addOverlay(...nodes) {
        this.stage.append(...nodes.flat());
        return this;
    }

    // --- Screen ----------------------------------------------------------

    toggleFullscreen() { return toggleFullscreen(this.root); }
    get isFullscreen() { return isFullscreen(this.root); }

    // Sets the drawing buffer size and the GL viewport together — forgetting
    // the viewport is the classic way to get a stretched or clipped scene.
    resize(width, height) {
        const canvas = this.canvas;
        if (!canvas) return this;
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        this.gl.viewport(0, 0, canvas.width, canvas.height);
        this._emit("resize", { width: canvas.width, height: canvas.height });
        return this;
    }

    // Keeps the drawing buffer matched to the canvas's CSS box, at device pixel
    // density so it is not blurry on a phone or in fullscreen. Off by default:
    // a fixed buffer is the simpler thing when a scene is sized by hand.
    watchResize({ maxPixelRatio = 2 } = {}) {
        const fit = () => {
            const canvas = this.canvas;
            if (!canvas) return;
            const ratio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
            const w = canvas.clientWidth * ratio;
            const h = canvas.clientHeight * ratio;
            if (w > 0 && h > 0 && (canvas.width !== Math.round(w) || canvas.height !== Math.round(h))) {
                this.resize(w, h);
            }
        };
        if (typeof ResizeObserver !== "undefined") {
            this._resizeObserver = new ResizeObserver(fit);
            this._resizeObserver.observe(this.canvas);
        } else {
            window.addEventListener("resize", fit);
        }
        fit();
        return this;
    }

    // --- Events ----------------------------------------------------------
    // "resize", "fullscreenchange", "progress" and "assetserror", so a scene
    // can react without hunting down the prefixed DOM events itself.

    on(event, handler) {
        const list = this._listeners.get(event) || [];
        list.push(handler);
        this._listeners.set(event, list);
        return this;
    }

    _emit(event, payload) {
        for (const handler of this._listeners.get(event) || []) handler(payload);
    }

    // Tears everything down: loop, listeners, DOM. Mostly for tests and for
    // pages that swap one scene for another.
    destroy() {
        this.stop();
        if (typeof this._cleanup === "function") this._cleanup();
        this._scenes?.destroy();
        this.keyboard?.detach();
        this.assets?.dispose();
        this._resizeObserver?.disconnect();
        this._offFullscreen?.();
        this.root.remove();
        return this;
    }
}

// ===== components/render/shaders.js =====
// The shader programs, compiled once per WebGL context and shared.
//
// Raptor started with a single program — position + per-vertex colour — because
// every shape was a flat polygon. Textures need a second one, so the cache is
// keyed by (context, kind) instead of by context alone. Adding a third (a glow,
// a mask) is now a matter of adding an entry to PROGRAMS.
//
// Both programs take the same two matrices and a per-vertex colour, which is
// what lets a sprite be *tinted*: the fragment shader multiplies the texel by
// that colour, so white leaves the image alone, a colour tints it and alpha
// fades it. One uniform less to think about, and no separate "tinted sprite".

const COLOR_VS = `
    attribute vec4 aVertexPosition;
    attribute vec4 aVertexColor;

    uniform mat4 uModelViewMatrix;
    uniform mat4 uProjectionMatrix;

    varying lowp vec4 vColor;

    void main() {
        gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
        vColor = aVertexColor;
    }
`;

const COLOR_FS = `
    varying lowp vec4 vColor;

    void main() {
        gl_FragColor = vColor;
    }
`;

const TEXTURE_VS = `
    attribute vec4 aVertexPosition;
    attribute vec4 aVertexColor;
    attribute vec2 aTextureCoord;

    uniform mat4 uModelViewMatrix;
    uniform mat4 uProjectionMatrix;

    varying lowp vec4 vTint;
    varying highp vec2 vTextureCoord;

    void main() {
        gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
        vTint = aVertexColor;
        vTextureCoord = aTextureCoord;
    }
`;

// The texel is multiplied by the tint, so a white tint is a no-op. Fully
// transparent fragments are discarded rather than blended: without a depth
// buffer to sort by, a transparent border would otherwise still write and
// darken whatever is behind it at the edges.
const TEXTURE_FS = `
    precision mediump float;

    varying lowp vec4 vTint;
    varying highp vec2 vTextureCoord;

    uniform sampler2D uSampler;

    void main() {
        vec4 texel = texture2D(uSampler, vTextureCoord);
        if (texel.a < 0.01) discard;
        gl_FragColor = texel * vTint;
    }
`;

const PROGRAM_COLOR = "color";
const PROGRAM_TEXTURE = "texture";

const PROGRAMS = {
    [PROGRAM_COLOR]: {
        vertex: COLOR_VS,
        fragment: COLOR_FS,
        attributes: { vertexPosition: "aVertexPosition", vertexColor: "aVertexColor" },
        uniforms: { projectionMatrix: "uProjectionMatrix", modelViewMatrix: "uModelViewMatrix" },
    },
    [PROGRAM_TEXTURE]: {
        vertex: TEXTURE_VS,
        fragment: TEXTURE_FS,
        attributes: {
            vertexPosition: "aVertexPosition",
            vertexColor: "aVertexColor",
            textureCoord: "aTextureCoord",
        },
        uniforms: {
            projectionMatrix: "uProjectionMatrix",
            modelViewMatrix: "uModelViewMatrix",
            sampler: "uSampler",
        },
    },
};

function compile(gl, type, source, kind) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        // Throwing beats the old alert(): a framework has no business opening a
        // modal, and a stack trace says which shape asked for the program.
        throw new Error(`Raptor: no compila el shader "${kind}": ${log}`);
    }
    return shader;
}

function build(gl, kind) {
    const spec = PROGRAMS[kind];
    if (!spec) throw new Error(`Raptor: programa de shader desconocido "${kind}"`);

    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, spec.vertex, kind));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, spec.fragment, kind));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`Raptor: no enlaza el programa "${kind}": ${gl.getProgramInfoLog(program)}`);
    }

    const attribLocations = {};
    for (const [name, glslName] of Object.entries(spec.attributes)) {
        attribLocations[name] = gl.getAttribLocation(program, glslName);
    }
    const uniformLocations = {};
    for (const [name, glslName] of Object.entries(spec.uniforms)) {
        uniformLocations[name] = gl.getUniformLocation(program, glslName);
    }
    return { kind, program, attribLocations, uniformLocations };
}

// Keyed by context so several canvases stay independent, then by kind.
const cache = new WeakMap();

function getProgramInfo(gl, kind = PROGRAM_COLOR) {
    let byKind = cache.get(gl);
    if (!byKind) { byKind = new Map(); cache.set(gl, byKind); }
    if (!byKind.has(kind)) byKind.set(kind, build(gl, kind));
    return byKind.get(kind);
}

// ===== components/shapes/shape.js =====
// Base class for every 2D shape the engine can draw.
//
// Shapes share the draw pipeline — the same matrices, the same transform, the
// same loop — and differ in three things a subclass can override:
//
//   getVertices()   the local-space geometry
//   drawMode        TRIANGLES, TRIANGLE_STRIP, TRIANGLE_FAN…
//   program         which shader to use (see components/render/shaders.js)
//
// Anything needing extra vertex data (a sprite's texture coordinates) adds it
// in `initBuffers` and binds it in `bindAttributes`, without touching the
// matrix maths. See components/shapes/sprite.js for the one that does.


// Used when draw() is called without a camera: pan 0, zoom 1 (world == screen).
const IDENTITY_CAMERA = { x: 0, y: 0, zoom: 1 };

class Shape {
    constructor(context) {
        this.context = context;

        // Transform, in world space. Position/scale are 2D; depth is how far the
        // shape sits from the perspective camera along -Z.
        this.position = { x: 0, y: 0 };
        this.rotation = 0; // degrees, counter-clockwise
        this.scale = { x: 1, y: 1 };
        this.depth = -DEFAULT_DEPTH;

        this.color = { red: 1, green: 1, blue: 1, alpha: 1 };

        // Subclasses override this (e.g. TRIANGLE_STRIP, TRIANGLE_FAN, TRIANGLES).
        this.drawMode = context.TRIANGLES;

        // How the physics layer should treat this shape: "polygon" (convex
        // outline from getColliderVertices) or "circle" (uses this.radius).
        this.colliderShape = "polygon";

        // Which shader program to draw with. Subclasses override it; the
        // default is flat per-vertex colour.
        this.program = PROGRAM_COLOR;

        // Draw order. Lower layers are drawn first, so higher ones land on top;
        // within a layer, insertion order decides. Without this the only way to
        // put a background behind a player is to add it first and never change
        // your mind.
        this.layer = 0;

        this.programInfo = null;
        this.buffers = null;
        this.vCount = 0;

        // Radius of the shape's own geometry, in local units. Filled in by
        // initBuffers, and used by the engine to skip shapes that cannot be on
        // screen. Null means "no idea" — such a shape is always drawn.
        this._localRadius = null;
    }

    // A circle around the shape that is guaranteed to contain it, in world
    // units. Conservative on purpose: culling something that *is* visible shows
    // up as things popping in at the edge of the screen, which is far worse
    // than drawing a few extra quads.
    get cullRadius() {
        if (this._localRadius === null) return null;
        return this._localRadius * Math.max(Math.abs(this.scale.x), Math.abs(this.scale.y));
    }

    // Must be implemented by subclasses. Returns a flat array of local-space
    // vertex positions: [x0, y0, x1, y1, ...].
    getVertices() {
        throw new Error(`${this.constructor.name} must implement getVertices()`);
    }

    // Convex outline used for collision, as an ordered list of local-space
    // points [{x, y}, ...] (no fan center, no duplicated closing vertex).
    // Polygon shapes override this; circle shapes set colliderShape = "circle".
    getColliderVertices() {
        throw new Error(`${this.constructor.name} must implement getColliderVertices()`);
    }

    // Uploads geometry to the GPU. Call once, after configuring the shape.
    init() {
        this.programInfo = getProgramInfo(this.context, this.program);
        this.initBuffers();
        return this;
    }

    initBuffers() {
        const gl = this.context;

        const vertices = this.getVertices();
        this.vCount = vertices.length / 2;

        // The furthest vertex from the origin. Computed here because the
        // geometry is already in hand — asking for it again later would mean
        // rebuilding it.
        let furthest = 0;
        for (let i = 0; i < vertices.length; i += 2) {
            const distance = vertices[i] * vertices[i] + vertices[i + 1] * vertices[i + 1];
            if (distance > furthest) furthest = distance;
        }
        this._localRadius = Math.sqrt(furthest);

        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

        const colorBuffer = gl.createBuffer();

        this.buffers = { position: positionBuffer, color: colorBuffer };

        this.uploadColors();
    }

    // (Re)fills the per-vertex color buffer with the current color. Safe to call
    // after init() to recolor a shape without rebuilding its geometry.
    uploadColors() {
        const gl = this.context;
        const { red, green, blue, alpha } = this.color;

        const colors = [];
        for (let i = 0; i < this.vCount; i++) {
            colors.push(red, green, blue, alpha);
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
    }

    // `camera` is an optional { x, y, zoom }; omitted (or the identity default)
    // means "no camera", i.e. world space maps straight to the screen as before.
    draw(camera = IDENTITY_CAMERA) {
        const gl = this.context;

        // View transform: pan by the camera center, then zoom about it. Depth is
        // constant, so scaling the world coordinates scales the screen linearly.
        const zoom = camera.zoom ?? 1;

        // Both matrices come from shared, reused storage — see the note in
        // components/render/projection.js on why that is safe and why it
        // matters at a thousand-odd shapes a frame.
        const projectionMatrix = projectionFor(gl.canvas);
        const modelViewMatrix = modelViewFor({
            x: (this.position.x - (camera.x ?? 0)) * zoom,
            y: (this.position.y - (camera.y ?? 0)) * zoom,
            depth: this.depth,
            rotationDegrees: this.rotation,
            scaleX: this.scale.x * zoom,
            scaleY: this.scale.y * zoom,
        });

        const { uniformLocations, program } = this.programInfo;

        gl.useProgram(program);
        gl.uniformMatrix4fv(uniformLocations.projectionMatrix, false, projectionMatrix);
        gl.uniformMatrix4fv(uniformLocations.modelViewMatrix, false, modelViewMatrix);

        const enabled = this.bindAttributes(gl);
        gl.drawArrays(this.drawMode, 0, this.vCount);

        // Attribute arrays are global state, not part of the program: leaving
        // one enabled makes the *next* shape read a buffer its shader never
        // asked for. Now that there is more than one program, they have to be
        // turned off again.
        for (const location of enabled) gl.disableVertexAttribArray(location);
    }

    // Binds this shape's vertex data and returns the attribute locations it
    // switched on, so draw() can switch them back off.
    bindAttributes(gl) {
        const { attribLocations } = this.programInfo;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.vertexAttribPointer(attribLocations.vertexPosition, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(attribLocations.vertexPosition);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
        gl.vertexAttribPointer(attribLocations.vertexColor, 4, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(attribLocations.vertexColor);

        return [attribLocations.vertexPosition, attribLocations.vertexColor];
    }

    // --- Fluent configuration helpers (chainable) ---

    setColor({ red, green, blue, alpha } = {}) {
        this.color = {
            red: red ?? 0.0,
            green: green ?? 0.0,
            blue: blue ?? 0.0,
            alpha: alpha ?? 1.0,
        };
        if (this.buffers) {
            this.uploadColors();
        }
        return this;
    }

    setPosition({ x, y } = {}) {
        this.position = { x: x ?? this.position.x, y: y ?? this.position.y };
        return this;
    }

    setScale({ x, y } = {}) {
        this.scale = { x: x ?? 1.0, y: y ?? 1.0 };
        return this;
    }

    setRotation(degrees) {
        this.rotation = degrees;
        return this;
    }

    setDepth(depth) {
        this.depth = depth;
        return this;
    }

    // Draw order. The engine re-sorts when this changes, so it is safe to call
    // at any time — not just before the shape is added.
    setLayer(layer) {
        if (layer !== this.layer) {
            this.layer = layer;
            if (this._onLayerChange) this._onLayerChange(this);
        }
        return this;
    }
}

// ===== components/shapes/rectangle.js =====
// An axis-aligned rectangle centered on its origin.
class Rectangle extends Shape {
    constructor(context, { width = 1, height = 1 } = {}) {
        super(context);
        this.width = width;
        this.height = height;
        this.drawMode = context.TRIANGLE_STRIP;
    }

    getVertices() {
        const hw = this.width / 2;
        const hh = this.height / 2;

        // Order matters for TRIANGLE_STRIP: two triangles sharing an edge.
        return [
             hw,  hh,
            -hw,  hh,
             hw, -hh,
            -hw, -hh,
        ];
    }

    getColliderVertices() {
        const hw = this.width / 2;
        const hh = this.height / 2;
        // Counter-clockwise outline.
        return [
            { x: -hw, y: -hh },
            { x:  hw, y: -hh },
            { x:  hw, y:  hh },
            { x: -hw, y:  hh },
        ];
    }
}

// ===== components/shapes/square.js =====
// A square is just a rectangle with equal sides.
class Square extends Rectangle {
    constructor(context, { size = 1 } = {}) {
        super(context, { width: size, height: size });
    }
}

// ===== components/shapes/triangle.js =====
// An isosceles triangle centered on its origin, apex pointing up.
class Triangle extends Shape {
    constructor(context, { width = 1, height = 1 } = {}) {
        super(context);
        this.width = width;
        this.height = height;
        this.drawMode = context.TRIANGLES;
    }

    getVertices() {
        const hw = this.width / 2;
        const hh = this.height / 2;

        return [
              0,  hh, // apex
            -hw, -hh, // bottom-left
             hw, -hh, // bottom-right
        ];
    }

    getColliderVertices() {
        const hw = this.width / 2;
        const hh = this.height / 2;
        // Counter-clockwise outline.
        return [
            { x: -hw, y: -hh },
            { x:  hw, y: -hh },
            { x:   0, y:  hh },
        ];
    }
}

// ===== components/shapes/polygon.js =====
// A filled convex polygon defined by an explicit list of points, e.g.
//   new Polygon(gl, { points: [ {x:0,y:0.6}, {x:0.6,y:0}, {x:-0.6,y:0} ] })
//
// Rendered as a TRIANGLE_FAN, which correctly fills any convex polygon. For
// concave polygons a real triangulation (ear clipping) would be needed.
class Polygon extends Shape {
    constructor(context, { points = [] } = {}) {
        super(context);
        this.points = points;
        this.drawMode = context.TRIANGLE_FAN;
    }

    getVertices() {
        const vertices = [];
        for (const p of this.points) {
            vertices.push(p.x, p.y);
        }
        return vertices;
    }

    getColliderVertices() {
        return this.points.map((p) => ({ x: p.x, y: p.y }));
    }
}

// A regular N-sided polygon (equilateral triangle, pentagon, hexagon, ...).
// Built as a TRIANGLE_FAN around a center vertex so any side count fills solidly.
class RegularPolygon extends Shape {
    constructor(context, { sides = 6, radius = 0.5 } = {}) {
        super(context);
        this.sides = Math.max(3, sides);
        this.radius = radius;
        this.drawMode = context.TRIANGLE_FAN;
    }

    getVertices() {
        const vertices = [0, 0]; // center of the fan

        // Start at the top (-90°) and go around once, repeating the first rim
        // point at the end to close the shape.
        for (let i = 0; i <= this.sides; i++) {
            const angle = (i / this.sides) * Math.PI * 2 - Math.PI / 2;
            vertices.push(Math.cos(angle) * this.radius, Math.sin(angle) * this.radius);
        }

        return vertices;
    }

    getColliderVertices() {
        const points = [];
        // The rim points only (no center, no duplicated closing vertex).
        for (let i = 0; i < this.sides; i++) {
            const angle = (i / this.sides) * Math.PI * 2 - Math.PI / 2;
            points.push({ x: Math.cos(angle) * this.radius, y: Math.sin(angle) * this.radius });
        }
        return points;
    }
}

// ===== components/shapes/circle.js =====
// A circle is a regular polygon with enough sides to look round. Increase
// `segments` for a smoother edge on large circles.
class Circle extends RegularPolygon {
    constructor(context, { radius = 0.5, segments = 48 } = {}) {
        super(context, { sides: segments, radius });
        // Treated as a true circle by the physics layer (uses this.radius),
        // not as a 48-gon.
        this.colliderShape = "circle";
    }
}

// ===== components/shapes/sprite.js =====
// A textured quad: the shape you make a game out of.
//
// A Sprite is a rectangle that draws part of a Texture instead of a flat
// colour. "Part of" is the important bit — real games keep every frame of every
// animation in one image (an *atlas*, or a sprite sheet) and draw sub-rectangles
// of it, because switching textures is the expensive thing in a renderer.
// `setFrame({ x, y, width, height })` takes that rectangle **in pixels**, which
// is how a sheet is actually measured, and converts it to the 0..1 texture
// coordinates the GPU wants.
//
//     const sheet = Texture.fromImage(gl, "hero.png");
//     const hero = new Sprite(gl, { texture: sheet, frame: { x: 0, y: 0, width: 16, height: 16 } })
//         .setPosition({ x: 0, y: 0 })
//         .init();
//
// Size: give `width`/`height` in world units, or let it derive them from the
// frame's pixel size divided by `pixelsPerUnit`. The default of 32 means a
// 32×32 frame is one world unit — pick whatever suits your art and stay
// consistent, because that ratio *is* your game's scale.
//
// The colour set by `setColor` acts as a **tint**: the shader multiplies the
// texel by it, so white draws the image untouched, a colour tints it, and
// alpha < 1 fades it. That is how you flash a sprite red on a hit without a
// second image.


class Sprite extends Shape {
    constructor(context, {
        texture = null,
        frame = null,              // { x, y, width, height } in texture pixels
        width = null,              // world units; derived from the frame if null
        height = null,
        pixelsPerUnit = 32,
        flipX = false,
        flipY = false,
    } = {}) {
        super(context);
        this.program = PROGRAM_TEXTURE;
        this.drawMode = context.TRIANGLE_STRIP;

        this.texture = texture;
        this.frame = frame;
        this.pixelsPerUnit = pixelsPerUnit;
        this.flipX = flipX;
        this.flipY = flipY;
        this._width = width;
        this._height = height;

        // A sprite is white by default so the texture comes through unchanged —
        // the inherited default would be opaque black, which multiplies the
        // image away to nothing.
        this.color = { red: 1, green: 1, blue: 1, alpha: 1 };

        // A texture that is still loading has no size yet, so a sprite sized
        // from its frame has to rebuild once the image lands.
        if (texture && !texture.ready) {
            texture.onLoad = () => { if (this.buffers) this.refresh(); };
        }
    }

    // Size in world units, derived from the frame (or the whole texture) when
    // not given explicitly.
    get width() {
        if (this._width !== null) return this._width;
        const px = this.frame ? this.frame.width : (this.texture?.width ?? this.pixelsPerUnit);
        return px / this.pixelsPerUnit;
    }

    get height() {
        if (this._height !== null) return this._height;
        const px = this.frame ? this.frame.height : (this.texture?.height ?? this.pixelsPerUnit);
        return px / this.pixelsPerUnit;
    }

    // TRIANGLE_STRIP order: top-left, bottom-left, top-right, bottom-right.
    getVertices() {
        const hw = this.width / 2;
        const hh = this.height / 2;
        return [-hw, hh, -hw, -hh, hw, hh, hw, -hh];
    }

    getColliderVertices() {
        const hw = this.width / 2;
        const hh = this.height / 2;
        // Counter-clockwise, which is what the collision and ballistics code
        // assumes when it derives outward normals.
        return [
            { x: -hw, y: -hh },
            { x: hw, y: -hh },
            { x: hw, y: hh },
            { x: -hw, y: hh },
        ];
    }

    // The frame's pixel rectangle as 0..1 texture coordinates. The texture was
    // uploaded Y-flipped, so a frame's `y` counts from the *top* of the image —
    // the way a sprite sheet is laid out and the way anyone reading it counts.
    getTextureCoords() {
        const texture = this.texture;
        const tw = texture?.width || 1;
        const th = texture?.height || 1;
        const frame = this.frame || { x: 0, y: 0, width: tw, height: th };

        let u0 = frame.x / tw;
        let u1 = (frame.x + frame.width) / tw;
        let v1 = 1 - frame.y / th;
        let v0 = 1 - (frame.y + frame.height) / th;

        if (this.flipX) [u0, u1] = [u1, u0];
        if (this.flipY) [v0, v1] = [v1, v0];

        // Same order as getVertices().
        return [u0, v1, u0, v0, u1, v1, u1, v0];
    }

    initBuffers() {
        super.initBuffers();
        const gl = this.context;
        this.buffers.texCoord = gl.createBuffer();
        this.uploadTextureCoords();
    }

    uploadTextureCoords() {
        const gl = this.context;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.getTextureCoords()), gl.DYNAMIC_DRAW);
        return this;
    }

    // Rebuilds geometry and texture coordinates. Called for you when the frame,
    // the texture or a flip changes — animation goes through here every frame it
    // advances, which is why the buffers are DYNAMIC_DRAW.
    refresh() {
        if (!this.buffers) return this;
        const gl = this.context;
        const vertices = this.getVertices();
        this.vCount = vertices.length / 2;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
        this.uploadColors();
        this.uploadTextureCoords();
        return this;
    }

    bindAttributes(gl) {
        const enabled = super.bindAttributes(gl);
        const { attribLocations, uniformLocations } = this.programInfo;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
        gl.vertexAttribPointer(attribLocations.textureCoord, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(attribLocations.textureCoord);
        enabled.push(attribLocations.textureCoord);

        // Unit 0 for everything: one texture per sprite is the whole point of
        // an atlas.
        if (this.texture) this.texture.bind(0);
        gl.uniform1i(uniformLocations.sampler, 0);

        return enabled;
    }

    // --- Fluent configuration (chainable) --------------------------------

    setTexture(texture, { frame = null } = {}) {
        this.texture = texture;
        if (frame) this.frame = frame;
        if (texture && !texture.ready) texture.onLoad = () => { if (this.buffers) this.refresh(); };
        return this.refresh();
    }

    // The sub-rectangle to draw, in texture pixels. Passing a frame of a
    // different size resizes the sprite too, unless width/height were pinned.
    setFrame(frame) {
        const resized = !this.frame || frame.width !== this.frame.width || frame.height !== this.frame.height;
        this.frame = frame;
        if (!this.buffers) return this;
        // Only the vertices need rebuilding when the frame *size* changes;
        // otherwise the texture coordinates are enough, which is the common case
        // for an animation stepping through same-sized frames.
        return resized ? this.refresh() : this.uploadTextureCoords();
    }

    setSize({ width, height } = {}) {
        if (width !== undefined) this._width = width;
        if (height !== undefined) this._height = height;
        return this.refresh();
    }

    // Mirrors the image without touching the transform — which is what you want
    // for a character turning around, because rotating would flip it over.
    setFlip({ x = this.flipX, y = this.flipY } = {}) {
        if (x === this.flipX && y === this.flipY) return this;
        this.flipX = x;
        this.flipY = y;
        return this.buffers ? this.uploadTextureCoords() : this;
    }

    // Alias for setColor, because on a sprite that is what it does.
    setTint(color) {
        return this.setColor(color);
    }
}

// ===== components/shapes/index.js =====
// Convenience barrel for every shape primitive the engine ships with.

// ===== components/render/spriteSheet.js =====
// Slicing a texture into frames, and playing them back.
//
// A sheet is a grid: every frame the same size, optionally with a margin around
// the edge and spacing between cells (exporters add those to stop neighbouring
// frames bleeding into each other when filtering is on).
//
//     const sheet = new SpriteSheet(texture, { frameWidth: 16, frameHeight: 16 });
//     sheet.frame(0)            // by index, left to right then down
//     sheet.frame(2, 1)         // by column and row
//     sheet.range(0, 3)         // [0,1,2,3] as frame rectangles
//
// An Animation is a list of those rectangles plus a frame rate. It holds *time*,
// not a frame counter, so playback speed does not depend on the refresh rate:
// at 8 fps a walk cycle takes the same wall-clock time at 30 Hz and at 144 Hz.

class SpriteSheet {
    constructor(texture, { frameWidth, frameHeight, margin = 0, spacing = 0 } = {}) {
        this.texture = texture;
        this.frameWidth = frameWidth;
        this.frameHeight = frameHeight;
        this.margin = margin;
        this.spacing = spacing;
    }

    get columns() {
        const usable = (this.texture.width - this.margin * 2) + this.spacing;
        return Math.max(1, Math.floor(usable / (this.frameWidth + this.spacing)));
    }

    get rows() {
        const usable = (this.texture.height - this.margin * 2) + this.spacing;
        return Math.max(1, Math.floor(usable / (this.frameHeight + this.spacing)));
    }

    get count() {
        return this.columns * this.rows;
    }

    // `frame(i)` walks the grid in reading order; `frame(col, row)` is explicit.
    frame(a, b = null) {
        const [col, row] = b === null ? [a % this.columns, Math.floor(a / this.columns)] : [a, b];
        return {
            x: this.margin + col * (this.frameWidth + this.spacing),
            y: this.margin + row * (this.frameHeight + this.spacing),
            width: this.frameWidth,
            height: this.frameHeight,
        };
    }

    // Inclusive range of indices, as frame rectangles — the usual way to say
    // "frames 4 through 7 are the walk cycle".
    range(from, to) {
        const frames = [];
        for (let i = from; i <= to; i++) frames.push(this.frame(i));
        return frames;
    }

    // Convenience: build an Animation straight from indices.
    animation(from, to, options = {}) {
        return new Animation(this.range(from, to), options);
    }
}

class Animation {
    constructor(frames, { fps = 8, loop = true, onEnd = null } = {}) {
        this.frames = frames;
        this.fps = fps;
        this.loop = loop;
        this.onEnd = onEnd;
        this.time = 0;
        this.index = 0;
        this.finished = false;
    }

    get frame() {
        return this.frames[this.index];
    }

    reset() {
        this.time = 0;
        this.index = 0;
        this.finished = false;
        return this;
    }

    // Advances by dt seconds and returns true if the frame changed, so callers
    // only touch the GPU when there is something new to show.
    update(dt) {
        if (this.finished || this.frames.length < 2) return false;
        const previous = this.index;
        this.time += dt;

        const step = 1 / this.fps;
        while (this.time >= step) {
            this.time -= step;
            if (this.index + 1 < this.frames.length) {
                this.index++;
            } else if (this.loop) {
                this.index = 0;
            } else {
                this.finished = true;
                if (this.onEnd) this.onEnd(this);
                break;
            }
        }
        return this.index !== previous;
    }
}

// Drives a Sprite from named animations, which is the shape gameplay code
// actually wants: `animator.play("walk")`, not a frame index.
class Animator {
    constructor(sprite, animations = {}, { initial = null } = {}) {
        this.sprite = sprite;
        this.animations = animations;
        this.current = null;
        this.name = null;
        const first = initial || Object.keys(animations)[0];
        if (first) this.play(first);
    }

    // Replaying the animation that is already running is a no-op, so calling
    // `play("walk")` every frame while a key is held does not reset it to frame
    // zero forever — the mistake that makes a character look frozen mid-stride.
    play(name, { restart = false } = {}) {
        if (this.name === name && !restart) return this;
        const animation = this.animations[name];
        if (!animation) return this;
        this.name = name;
        this.current = animation.reset();
        this.sprite.setFrame(animation.frame);
        return this;
    }

    update(dt) {
        if (this.current && this.current.update(dt)) {
            this.sprite.setFrame(this.current.frame);
        }
        return this;
    }
}

// ===== components/render/index.js =====
// Barrel for the render layer.

// ===== components/physics/body.js =====
// A physics body attached to a shape. The shape remains the source of truth for
// the transform (position/rotation/scale); the body adds the dynamics on top:
// type, velocity, mass and collision filtering.
//
// Body types:
//   - "static":  never moves, infinite mass. Walls, ground.
//   - "dynamic": integrated every step and pushed by collisions (rigid body).
//
// Collision filtering (see World.shouldCollide):
//   - groupIndex: bodies sharing the same non-zero group always collide (>0) or
//     never collide (<0), overriding category/mask. 0 means "use category/mask".
//   - category/mask: bitmasks; A and B collide only if
//     (A.mask & B.category) && (B.mask & A.category).

const STATIC = "static";
const DYNAMIC = "dynamic";

class Body {
    constructor(shape, {
        type = DYNAMIC,
        mass = 1,
        restitution = 0.4,
        velocity = { x: 0, y: 0 },
        groupIndex = 0,
        category = 0x0001,
        mask = 0xffff,
    } = {}) {
        this.shape = shape;
        this.type = type;
        this.velocity = { x: velocity.x, y: velocity.y };
        this.restitution = restitution;
        this.groupIndex = groupIndex;
        this.category = category;
        this.mask = mask;
        this._mass = mass;
        this._recomputeMass();
    }

    get isDynamic() {
        return this.type === DYNAMIC;
    }

    // Convenience access to the shape transform.
    get position() {
        return this.shape.position;
    }

    _recomputeMass() {
        this.invMass = this.type === DYNAMIC && this._mass > 0 ? 1 / this._mass : 0;
    }

    setType(type) {
        this.type = type;
        if (type === STATIC) {
            this.velocity.x = 0;
            this.velocity.y = 0;
        }
        this._recomputeMass();
        return this;
    }

    setMass(mass) {
        this._mass = mass;
        this._recomputeMass();
        return this;
    }

    setVelocity(x, y) {
        this.velocity.x = x;
        this.velocity.y = y;
        return this;
    }
}

// ===== components/physics/collision.js =====
// Convex collision detection for the shapes the engine ships with.
//
// collide(bodyA, bodyB) returns null when they are apart, or a manifold
// { normal, penetration } when they overlap. `normal` is a unit vector pointing
// from A toward B, and `penetration` is how deep the overlap is along it.
//
// Physics happens in the flat 2D world plane the shapes live in (their x/y
// before the perspective projection), so colliders are built from each shape's
// local collider outline transformed by position/rotation/scale.

function transformPoint(p, shape) {
    const angle = (shape.rotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = p.x * shape.scale.x;
    const y = p.y * shape.scale.y;
    return {
        x: shape.position.x + x * cos - y * sin,
        y: shape.position.y + x * sin + y * cos,
    };
}

function worldPolygon(shape) {
    return shape.getColliderVertices().map((p) => transformPoint(p, shape));
}

function worldCircle(shape) {
    // Uniform scale is assumed for circles; scale.x drives the radius.
    return { center: { x: shape.position.x, y: shape.position.y }, radius: shape.radius * shape.scale.x };
}

// Largest distance from the shape's origin to its outline, in world units.
function boundingRadius(shape) {
    if (shape.colliderShape === "circle") {
        return shape.radius * Math.max(shape.scale.x, shape.scale.y);
    }
    let max = 0;
    for (const p of shape.getColliderVertices()) {
        max = Math.max(max, Math.hypot(p.x * shape.scale.x, p.y * shape.scale.y));
    }
    return max;
}

function centroid(poly) {
    let x = 0;
    let y = 0;
    for (const p of poly) {
        x += p.x;
        y += p.y;
    }
    return { x: x / poly.length, y: y / poly.length };
}

function projectOntoAxis(poly, axis) {
    let min = Infinity;
    let max = -Infinity;
    for (const p of poly) {
        const dot = p.x * axis.x + p.y * axis.y;
        min = Math.min(min, dot);
        max = Math.max(max, dot);
    }
    return [min, max];
}

// Separating Axis Theorem for two convex polygons. Returns the minimum
// translation vector as { normal (A->B), penetration } or null if separated.
function satPolygons(a, b) {
    let minOverlap = Infinity;
    let smallestAxis = null;

    for (const poly of [a, b]) {
        for (let i = 0; i < poly.length; i++) {
            const p1 = poly[i];
            const p2 = poly[(i + 1) % poly.length];
            const edge = { x: p2.x - p1.x, y: p2.y - p1.y };
            const len = Math.hypot(edge.x, edge.y) || 1;
            const axis = { x: -edge.y / len, y: edge.x / len };

            const [minA, maxA] = projectOntoAxis(a, axis);
            const [minB, maxB] = projectOntoAxis(b, axis);

            if (maxA < minB || maxB < minA) {
                return null; // found a separating axis
            }

            const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
            if (overlap < minOverlap) {
                minOverlap = overlap;
                smallestAxis = axis;
            }
        }
    }

    // Orient the normal from A toward B.
    const ca = centroid(a);
    const cb = centroid(b);
    if ((cb.x - ca.x) * smallestAxis.x + (cb.y - ca.y) * smallestAxis.y < 0) {
        smallestAxis = { x: -smallestAxis.x, y: -smallestAxis.y };
    }

    return { normal: smallestAxis, penetration: minOverlap };
}

function circleCircle(ca, cb) {
    const dx = cb.center.x - ca.center.x;
    const dy = cb.center.y - ca.center.y;
    const dist = Math.hypot(dx, dy);
    const sum = ca.radius + cb.radius;
    if (dist >= sum) return null;
    const normal = dist > 1e-6 ? { x: dx / dist, y: dy / dist } : { x: 1, y: 0 };
    return { normal, penetration: sum - dist };
}

function closestPointOnSegment(p, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby || 1;
    let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return { x: a.x + abx * t, y: a.y + aby * t };
}

function pointInPolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
    }
    return inside;
}

// Returns manifold with normal pointing from the polygon toward the circle.
function circlePolygon(circle, poly) {
    let closest = null;
    let minDistSq = Infinity;
    for (let i = 0; i < poly.length; i++) {
        const cp = closestPointOnSegment(circle.center, poly[i], poly[(i + 1) % poly.length]);
        const dsq = (cp.x - circle.center.x) ** 2 + (cp.y - circle.center.y) ** 2;
        if (dsq < minDistSq) {
            minDistSq = dsq;
            closest = cp;
        }
    }

    const inside = pointInPolygon(circle.center, poly);
    const dist = Math.sqrt(minDistSq);
    if (!inside && dist >= circle.radius) return null;

    let normal;
    if (dist > 1e-6) {
        normal = { x: (circle.center.x - closest.x) / dist, y: (circle.center.y - closest.y) / dist };
    } else {
        normal = { x: 0, y: 1 };
    }
    if (inside) {
        return { normal, penetration: circle.radius + dist };
    }
    return { normal, penetration: circle.radius - dist };
}

function collide(bodyA, bodyB) {
    const sa = bodyA.shape;
    const sb = bodyB.shape;
    const aCircle = sa.colliderShape === "circle";
    const bCircle = sb.colliderShape === "circle";

    if (aCircle && bCircle) {
        return circleCircle(worldCircle(sa), worldCircle(sb));
    }
    if (!aCircle && !bCircle) {
        return satPolygons(worldPolygon(sa), worldPolygon(sb));
    }

    // One circle, one polygon.
    const circleShape = aCircle ? sa : sb;
    const polyShape = aCircle ? sb : sa;
    const res = circlePolygon(worldCircle(circleShape), worldPolygon(polyShape));
    if (!res) return null;

    // res.normal points polygon -> circle. Reorient to A -> B.
    const normal = aCircle ? { x: -res.normal.x, y: -res.normal.y } : res.normal;
    return { normal, penetration: res.penetration };
}

// ===== components/physics/world.js =====
// The physics world: holds the bodies, integrates them and resolves collisions.
// Call step(dt) once per frame (register it as an engine updater).
//
// Scope (Fase A): linear rigid-body dynamics. Bodies translate and bounce along
// the collision normal; angular response (spin from off-center hits) is not
// simulated yet.


// Positional correction keeps overlapping bodies from sinking into each other.
const CORRECTION_PERCENT = 0.8;
const CORRECTION_SLOP = 0.001;
const SOLVER_ITERATIONS = 2;

class World {
    constructor({ gravity = { x: 0, y: 0 }, bounds = null, linearDamping = 0 } = {}) {
        this.bodies = [];
        this.gravity = gravity;
        this.bounds = bounds; // { minX, maxX, minY, maxY } or null
        this.linearDamping = linearDamping;
    }

    add(body) {
        this.bodies.push(body);
        return body;
    }

    remove(body) {
        const i = this.bodies.indexOf(body);
        if (i !== -1) this.bodies.splice(i, 1);
        return this;
    }

    // Whether two bodies are allowed to collide, per group/category/mask rules.
    static shouldCollide(a, b) {
        if (a.type === STATIC && b.type === STATIC) return false;
        if (a.groupIndex !== 0 && a.groupIndex === b.groupIndex) {
            return a.groupIndex > 0;
        }
        return (a.mask & b.category) !== 0 && (b.mask & a.category) !== 0;
    }

    step(dt) {
        if (dt <= 0) return;
        this.integrate(dt);

        for (let iter = 0; iter < SOLVER_ITERATIONS; iter++) {
            for (let i = 0; i < this.bodies.length; i++) {
                for (let j = i + 1; j < this.bodies.length; j++) {
                    const a = this.bodies[i];
                    const b = this.bodies[j];
                    if (!World.shouldCollide(a, b)) continue;

                    const manifold = collide(a, b);
                    if (manifold && manifold.penetration > 0) {
                        this.resolve(a, b, manifold);
                    }
                }
            }
        }

        if (this.bounds) this.applyBounds();
    }

    integrate(dt) {
        const damp = Math.max(0, 1 - this.linearDamping * dt);
        for (const body of this.bodies) {
            if (!body.isDynamic) continue;
            body.velocity.x += this.gravity.x * dt;
            body.velocity.y += this.gravity.y * dt;
            body.velocity.x *= damp;
            body.velocity.y *= damp;
            body.shape.position.x += body.velocity.x * dt;
            body.shape.position.y += body.velocity.y * dt;
        }
    }

    resolve(a, b, { normal, penetration }) {
        const invSum = a.invMass + b.invMass;
        if (invSum === 0) return;

        // Positional correction so bodies stop overlapping.
        const correction = (Math.max(penetration - CORRECTION_SLOP, 0) / invSum) * CORRECTION_PERCENT;
        a.shape.position.x -= normal.x * correction * a.invMass;
        a.shape.position.y -= normal.y * correction * a.invMass;
        b.shape.position.x += normal.x * correction * b.invMass;
        b.shape.position.y += normal.y * correction * b.invMass;

        // Impulse along the normal (relative velocity is B - A).
        const rvx = b.velocity.x - a.velocity.x;
        const rvy = b.velocity.y - a.velocity.y;
        const velAlongNormal = rvx * normal.x + rvy * normal.y;
        if (velAlongNormal > 0) return; // already separating

        const e = Math.min(a.restitution, b.restitution);
        const jImpulse = (-(1 + e) * velAlongNormal) / invSum;
        const ix = jImpulse * normal.x;
        const iy = jImpulse * normal.y;

        a.velocity.x -= ix * a.invMass;
        a.velocity.y -= iy * a.invMass;
        b.velocity.x += ix * b.invMass;
        b.velocity.y += iy * b.invMass;
    }

    applyBounds() {
        const { minX, maxX, minY, maxY } = this.bounds;
        for (const body of this.bodies) {
            if (!body.isDynamic) continue;
            const r = boundingRadius(body.shape);
            const pos = body.shape.position;

            if (pos.x - r < minX) {
                pos.x = minX + r;
                if (body.velocity.x < 0) body.velocity.x = -body.velocity.x * body.restitution;
            } else if (pos.x + r > maxX) {
                pos.x = maxX - r;
                if (body.velocity.x > 0) body.velocity.x = -body.velocity.x * body.restitution;
            }

            if (pos.y - r < minY) {
                pos.y = minY + r;
                if (body.velocity.y < 0) body.velocity.y = -body.velocity.y * body.restitution;
            } else if (pos.y + r > maxY) {
                pos.y = maxY - r;
                if (body.velocity.y > 0) body.velocity.y = -body.velocity.y * body.restitution;
            }
        }
    }
}

// ===== components/physics/index.js =====
// Barrel for the physics layer.

// ===== components/input/index.js =====
// Barrel for the input layer.

// ===== components/ui/index.js =====
// Barrel for the UI layer.

// ===== components/audio/engineSound.js =====
// Engine note, synthesised from revs. No audio files: the pages are
// self-contained and open from file://, so everything is built with Web Audio.
//
// An engine's pitch is its *firing frequency* — how often a cylinder fires:
//
//   f = rpm / 60 · cilindros / 2        (four-stroke: one bang every two turns)
//
// For a four-cylinder that is rpm/30, so 800 rpm ≈ 27 Hz and 6800 rpm ≈ 227 Hz.
// Those fundamentals are too low for a phone speaker on their own, which is why
// the note is stacked from several sawtooth partials — the harmonics are what
// you actually hear. A touch of filtered noise adds the intake/exhaust rasp, and
// a lowpass that opens with load is what makes the difference between a distant
// hum and something under full throttle.
//
// Browsers refuse to start audio without a user gesture, so `start()` has to be
// called from a click or a tap. Everything degrades to a no-op if Web Audio is
// missing, so callers never need to guard.

const PARTIALS = [
    { mul: 1, gain: 0.55, type: "sawtooth" },
    { mul: 2, gain: 0.32, type: "sawtooth", detune: 6 },
    { mul: 3, gain: 0.18, type: "sawtooth", detune: -8 },
    { mul: 0.5, gain: 0.30, type: "square" }, // the rumble underneath
];

const SMOOTH = 0.05; // seconds — how fast parameters chase their target

class EngineSound {
    constructor({ cylinders = 4, strokes = 4, volume = 0.5 } = {}) {
        this.cylinders = cylinders;
        this.strokes = strokes;
        this.volume = volume;
        this.muted = false;
        this.ctx = null;
        this.nodes = null;
    }

    get running() {
        return !!this.ctx && this.ctx.state === "running";
    }

    // Firing frequency for a given engine speed, in Hz.
    firingHz(rpm) {
        return (rpm / 60) * (this.cylinders / (this.strokes / 2));
    }

    // Must be called from a user gesture. Safe to call again: it just resumes.
    start() {
        const AudioCtx = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
        if (!AudioCtx) return false;
        if (!this.ctx) {
            try { this.ctx = new AudioCtx(); } catch { return false; }
            this._build();
        }
        if (this.ctx.state === "suspended") this.ctx.resume();
        return true;
    }

    _build() {
        const ctx = this.ctx;

        const master = ctx.createGain();
        master.gain.value = 0;
        master.connect(ctx.destination);

        // One lowpass for the lot: opening it with load is most of the "effort".
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 500;
        filter.Q.value = 0.9;
        filter.connect(master);

        const oscillators = PARTIALS.map((p) => {
            const osc = ctx.createOscillator();
            osc.type = p.type;
            osc.frequency.value = 40;
            if (p.detune) osc.detune.value = p.detune;
            const gain = ctx.createGain();
            gain.gain.value = p.gain;
            osc.connect(gain).connect(filter);
            osc.start();
            return { osc, gain, mul: p.mul };
        });

        // Two seconds of white noise on a loop, band-passed into a rasp.
        const frames = ctx.sampleRate * 2;
        const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        noise.loop = true;
        const noiseBand = ctx.createBiquadFilter();
        noiseBand.type = "bandpass";
        noiseBand.frequency.value = 900;
        noiseBand.Q.value = 0.7;
        const noiseGain = ctx.createGain();
        noiseGain.gain.value = 0;
        noise.connect(noiseBand).connect(noiseGain).connect(filter);
        noise.start();

        this.nodes = { master, filter, oscillators, noiseGain };
    }

    // Feed it the drivetrain each frame. `load` is 0..1 (throttle); `cut` mutes
    // the drive for a moment, which is what a gearshift sounds like.
    update({ rpm = 0, redlineRpm = 7000, load = 0, cut = false } = {}) {
        if (!this.nodes || !this.ctx) return;
        const { master, filter, oscillators, noiseGain } = this.nodes;
        const now = this.ctx.currentTime;
        const revs = Math.max(0, Math.min(1, rpm / redlineRpm));
        const base = Math.max(12, this.firingHz(rpm));

        for (const { osc, mul } of oscillators) {
            osc.frequency.setTargetAtTime(base * mul, now, SMOOTH);
        }

        // Louder with revs and throttle; a shift drops it out entirely.
        const level = this.muted || cut ? 0 : this.volume * (0.09 + 0.16 * load + 0.1 * revs);
        master.gain.setTargetAtTime(level, now, SMOOTH);

        // The filter opening under load is what sells the effort.
        filter.frequency.setTargetAtTime(320 + 2600 * revs * (0.45 + 0.55 * load), now, SMOOTH);
        noiseGain.gain.setTargetAtTime(this.muted || cut ? 0 : 0.05 + 0.12 * load * revs, now, SMOOTH);
    }

    // Muting takes effect at once; unmuting is left to the next `update()`,
    // which is the only thing that knows what the level should be.
    setMuted(muted) {
        this.muted = muted;
        if (muted && this.nodes && this.ctx) {
            this.nodes.master.gain.setTargetAtTime(0, this.ctx.currentTime, SMOOTH);
            this.nodes.noiseGain.gain.setTargetAtTime(0, this.ctx.currentTime, SMOOTH);
        }
        return this;
    }

    toggleMuted() {
        return this.setMuted(!this.muted);
    }

    stop() {
        if (!this.ctx) return;
        this.ctx.close();
        this.ctx = null;
        this.nodes = null;
    }
}

// ===== components/audio/index.js =====
// Barrel for the audio layer.

// ===== components/assets/index.js =====
// Barrel for the assets layer.

// ===== components/scenes/scene.js =====
// A scene: one self-contained screen of a game.
//
// Until now a Raptor page *was* a game — one setup function, one world, and no
// way to get from a menu to a match to a game-over. A Scene is that missing
// unit: it builds itself when entered and takes itself apart when left.
//
//     class Menu extends Scene {
//         enter() {
//             this.add(new Sprite(this.gl, { texture: this.assets.texture("logo") }).init());
//             this.onKey("Enter", () => this.go("juego"));
//         }
//     }
//
// The part that matters is the taking apart. Everything a scene creates has to
// be undone on the way out — entities, per-frame callbacks, key bindings, DOM
// overlays — and forgetting any one of them is a leak you notice three scene
// changes later, when the menu music is still playing over the boss fight and
// the old update loop is still moving a player who no longer exists.
//
// So a Scene does not let you register those things directly. `this.add`,
// `this.onUpdate`, `this.onKey` and `this.overlay` each record what they did,
// and leaving undoes all of it. If you reach past them to `app.onUpdate`, you
// own the cleanup — which is exactly the trade you should have to make on
// purpose rather than by accident.

class Scene {
    constructor(name = "escena") {
        this.name = name;
        this.app = null;        // set by the SceneManager on the way in
        this.manager = null;
        this.active = false;

        this._entities = [];
        this._updaters = [];
        this._keys = [];
        this._overlays = [];
        this._panels = [];
    }

    // --- Hooks a subclass overrides ---------------------------------------

    // Declare assets this scene needs. Called once, before the first enter, so
    // a menu can start instantly while the level's art loads on the way in.
    preload() {}

    // Build the scene. `data` is whatever the previous scene passed to `go()`.
    enter() {}

    // Per frame, in seconds. Registered and unregistered for you.
    update() {}

    // Extra teardown, for anything the recording helpers do not cover — a timer
    // you started, a sound you are playing.
    exit() {}

    // --- What a scene reaches for ------------------------------------------

    get gl() { return this.app.gl; }
    get assets() { return this.app.assets; }
    get camera() { return this.app.camera; }
    get keyboard() { return this.app.keyboard; }
    get touch() { return this.app.touch; }
    get stage() { return this.app.stage; }

    // Adds a drawable, and remembers to remove it.
    add(entity) {
        this._entities.push(entity);
        return this.app.add(entity);
    }

    remove(entity) {
        const index = this._entities.indexOf(entity);
        if (index !== -1) this._entities.splice(index, 1);
        this.app.remove(entity);
        return this;
    }

    // An extra per-frame callback, on top of `update()`.
    onUpdate(fn) {
        this._updaters.push(fn);
        this.app.onUpdate(fn);
        return fn;
    }

    // A one-shot key action, unbound when the scene leaves.
    onKey(keys, handler) {
        for (const key of [].concat(keys)) {
            this.keyboard.on(key, handler);
            this._keys.push([key, handler]);
        }
        return this;
    }

    // A DOM node over the canvas: a title screen, a HUD, a banner.
    overlay(node) {
        this._overlays.push(node);
        this.app.addOverlay(node);
        return node;
    }

    // A card in the side panel, if the page has one.
    panel(node) {
        this._panels.push(node);
        this.app.addPanel(node);
        return node;
    }

    // Leaves for another scene. `data` is handed to its `enter()`.
    go(name, data) {
        return this.manager.go(name, data);
    }

    // --- Lifecycle, driven by the manager ---------------------------------

    _enter(app, manager, data) {
        this.app = app;
        this.manager = manager;
        this.active = true;
        this._boundUpdate = (dt) => { if (this.active) this.update(dt); };
        this.app.onUpdate(this._boundUpdate);
        this._updaters.push(this._boundUpdate);
        this.enter(data);
        return this;
    }

    _exit() {
        this.active = false;
        // The subclass gets to run first, while its things still exist.
        this.exit();
        for (const entity of this._entities) this.app.remove(entity);
        for (const fn of this._updaters) this.app.removeUpdate(fn);
        for (const [key, handler] of this._keys) this.keyboard.off(key, handler);
        for (const node of this._overlays) node.remove();
        for (const node of this._panels) node.remove();
        this._entities = [];
        this._updaters = [];
        this._keys = [];
        this._overlays = [];
        this._panels = [];
        return this;
    }
}

// ===== components/scenes/index.js =====
// Barrel for the scenes layer.

// ===== components/math/random.js =====
// A seeded random number generator.
//
// `Math.random()` cannot be seeded, and a game that cannot be seeded cannot be
// replayed, cannot be tested and cannot hand a friend the same level. So this
// is a plain linear congruential generator — the same constants as Numerical
// Recipes — which had been copied by hand into five different files before it
// lived here.
//
//     const random = createRandom(20260806);
//     random();                 // 0 ≤ n < 1
//     randomInt(random, 1, 6);  // un dado
//
// It is not cryptographically anything. It is fast, deterministic and short,
// which is what a level generator wants.

const MULTIPLIER = 1664525;
const INCREMENT = 1013904223;
const MODULUS = 4294967296; // 2³²

// Returns a function that yields the next number in [0, 1) each time it is
// called. Two generators built from the same seed produce the same sequence.
function createRandom(seed = 1) {
    let state = seed >>> 0;
    return () => ((state = (state * MULTIPLIER + INCREMENT) >>> 0) / MODULUS);
}

// An integer in [min, max], both ends included — which is what people mean by
// "a number between 1 and 6", and not what a naive floor() gives you.
function randomInt(random, min, max) {
    return min + Math.floor(random() * (max - min + 1));
}

function randomRange(random, min, max) {
    return min + random() * (max - min);
}

// ===== components/math/index.js =====
// Barrel for the maths helpers.

// ===== components/controls/tankController.js =====
// Tank-style movement for any shape.
//
// Drives a shape like a tracked vehicle: throttle accelerates it forward/back
// along the way it is facing, and steering rotates the hull in place (tanks can
// neutral-steer). Coasting bleeds speed off with friction, so it stops shortly
// after you let go — that heavy, planted feel a car controller wouldn't have.
//
// It is input-agnostic. Feed it `setInput({ forward, turn })` each frame from
// whatever you like, or use the built-in bindings that both drive the same set
// of held directions:
//   - `bindKeys()`  — WASD + arrow keys (desktop)
//   - `bindTouch()` — on-screen buttons via pointer events (touch / mouse)
// `update(dt)` moves the shape.
//
// Facing follows the engine's convention: rotation is CCW degrees and local +Y
// is "forward", so at rotation 0 the shape drives up the screen.

class TankController {
    constructor(shape, {
        accel = 5,           // forward acceleration (world units / s²)
        maxSpeed = 3,        // top forward speed (world units / s)
        reverseFactor = 0.5, // reverse is weaker and slower, like real tracks
        friction = 5,        // how hard it decelerates while coasting
        turnSpeed = 140,     // steering rate (degrees / s)
        bounds = null,       // optional { minX, maxX, minY, maxY } to stay inside
        gearbox = null,      // optional Gearbox; without one the drive is flat
    } = {}) {
        this.shape = shape;
        this.accel = accel;
        this.maxSpeed = maxSpeed;
        this.reverseFactor = reverseFactor;
        this.friction = friction;
        this.turnSpeed = turnSpeed;
        this.bounds = bounds;

        // The gearbox needs to know the vehicle's top speed to size its gears.
        this.gearbox = gearbox;
        if (gearbox) gearbox.maxSpeed = maxSpeed;

        this.speed = 0;                       // signed scalar along the heading
        this.input = { forward: 0, turn: 0 }; // each clamped to [-1, 1]

        // Directions currently held down, from any input source. Keyboard and
        // touch both toggle these, so combining sources "just works".
        this._held = { forward: false, back: false, left: false, right: false };
        this._unbindKeys = null;
        this._unbindTouch = null;
    }

    // Heading in radians (from the shape's rotation).
    get heading() {
        return (this.shape.rotation * Math.PI) / 180;
    }

    // Unit vector the tank is facing (local +Y rotated by the heading).
    get forward() {
        const h = this.heading;
        return { x: -Math.sin(h), y: Math.cos(h) };
    }

    // Current world velocity (forward * speed), handy for cameras or collisions.
    get velocity() {
        const f = this.forward;
        return { x: f.x * this.speed, y: f.y * this.speed };
    }

    // forward/turn in [-1, 1]. Only the given fields change.
    setInput({ forward = this.input.forward, turn = this.input.turn } = {}) {
        this.input.forward = Math.max(-1, Math.min(1, forward));
        this.input.turn = Math.max(-1, Math.min(1, turn));
        return this;
    }

    // Presses/releases a logical direction ("forward" | "back" | "left" |
    // "right"). Any input source can call this; it recomputes setInput.
    hold(dir, on) {
        if (!(dir in this._held)) return this;
        this._held[dir] = !!on;
        const forward = (this._held.forward ? 1 : 0) - (this._held.back ? 1 : 0);
        const turn = (this._held.left ? 1 : 0) - (this._held.right ? 1 : 0);
        return this.setInput({ forward, turn });
    }

    // Bleeds speed toward zero at `rate` without overshooting past it.
    _slow(rate, dt) {
        const drop = rate * dt;
        this.speed = Math.abs(this.speed) <= drop ? 0 : this.speed - Math.sign(this.speed) * drop;
    }

    update(dt) {
        // Steer: rotate the hull. Independent of speed so it can pivot on the spot.
        this.shape.rotation += this.input.turn * this.turnSpeed * dt;

        const throttle = this.input.forward;

        if (this.gearbox) {
            // With a gearbox the drive comes from the selected gear: how hard it
            // pulls (torque) and how fast it can go (the gear's speed limit).
            const gb = this.gearbox;
            gb.update(dt, { speed: this.speed, throttle });
            const dir = gb.direction;

            if (throttle !== 0 && dir !== 0 && Math.sign(throttle) === dir) {
                this.speed += this.accel * gb.torque * dir * dt;
            } else if (throttle !== 0 && dir !== 0) {
                // Asking to go the other way to the selected gear is braking.
                this._slow(this.friction * 2.2, dt);
            } else {
                this._slow(this.friction, dt);
            }

            const limit = gb.speedLimit;
            this.speed = Math.max(-limit, Math.min(limit, this.speed));
        } else if (throttle !== 0) {
            // Flat drive: reverse pulls with less force than forward.
            const gain = throttle > 0 ? 1 : this.reverseFactor;
            this.speed += this.accel * gain * throttle * dt;
            this.speed = Math.max(-this.maxSpeed * this.reverseFactor, Math.min(this.maxSpeed, this.speed));
        } else {
            this._slow(this.friction, dt);
            this.speed = Math.max(-this.maxSpeed * this.reverseFactor, Math.min(this.maxSpeed, this.speed));
        }

        // Advance along the heading.
        const f = this.forward;
        let x = this.shape.position.x + f.x * this.speed * dt;
        let y = this.shape.position.y + f.y * this.speed * dt;

        if (this.bounds) {
            const b = this.bounds;
            const cx = Math.max(b.minX, Math.min(b.maxX, x));
            const cy = Math.max(b.minY, Math.min(b.maxY, y));
            // Bumping a wall scrubs off most of the speed instead of gluing to it.
            if (cx !== x || cy !== y) this.speed *= 0.3;
            x = cx;
            y = cy;
        }

        this.shape.setPosition({ x, y });
        return this;
    }

    // Binds WASD + arrow keys on `target` (default: window). W/↑ and S/↓ drive,
    // A/← and D/→ steer. Returns an unbind function; also stored for unbind().
    bindKeys(target = window) {
        const map = {
            w: "forward", ArrowUp: "forward",
            s: "back", ArrowDown: "back",
            a: "left", ArrowLeft: "left",
            d: "right", ArrowRight: "right",
        };
        const keyOf = (e) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
        const onDown = (e) => {
            const dir = map[keyOf(e)];
            if (!dir) return;
            e.preventDefault();
            this.hold(dir, true);
        };
        const onUp = (e) => {
            const dir = map[keyOf(e)];
            if (dir) this.hold(dir, false);
        };

        target.addEventListener("keydown", onDown);
        target.addEventListener("keyup", onUp);
        if (this._unbindKeys) this._unbindKeys();
        this._unbindKeys = () => {
            target.removeEventListener("keydown", onDown);
            target.removeEventListener("keyup", onUp);
            this._unbindKeys = null;
        };
        return this._unbindKeys;
    }

    // Binds on-screen buttons for touch (and mouse) via pointer events. `buttons`
    // maps a direction to a DOM element: { forward, back, left, right }; any
    // subset is fine. Multi-touch works — hold two buttons to drive and turn at
    // once. Returns an unbind function; also stored for unbind().
    bindTouch(buttons = {}) {
        const teardown = [];
        for (const dir of Object.keys(buttons)) {
            const node = buttons[dir];
            if (!node || !(dir in this._held)) continue;

            const press = (e) => {
                e.preventDefault();
                if (node.setPointerCapture && e.pointerId != null) {
                    try { node.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
                }
                this.hold(dir, true);
            };
            const release = () => this.hold(dir, false);

            node.addEventListener("pointerdown", press);
            node.addEventListener("pointerup", release);
            node.addEventListener("pointercancel", release);
            node.addEventListener("pointerleave", release);
            // Keep touches from scrolling / selecting / zooming the page.
            node.style.touchAction = "none";
            node.style.userSelect = "none";

            teardown.push(() => {
                node.removeEventListener("pointerdown", press);
                node.removeEventListener("pointerup", release);
                node.removeEventListener("pointercancel", release);
                node.removeEventListener("pointerleave", release);
            });
        }

        if (this._unbindTouch) this._unbindTouch();
        this._unbindTouch = () => {
            for (const fn of teardown) fn();
            this._unbindTouch = null;
        };
        return this._unbindTouch;
    }

    // Removes any keyboard and touch bindings installed above.
    unbind() {
        if (this._unbindKeys) this._unbindKeys();
        if (this._unbindTouch) this._unbindTouch();
        return this;
    }
}

// ===== components/controls/tankAI.js =====
// A finite state machine that drives an enemy tank.
//
// The AI never touches the engine or the weapons module: it reads the world,
// writes throttle/steering into a TankController, aims the tank's turret, and
// raises `wantsToFire` when it has a shot. Whoever owns the tank decides what
// firing actually means, which keeps this file about behaviour only.
//
//   PATROL  wander between random waypoints, gun forward
//   ADVANCE take the ground it was given (`objective`) and hold it — this is
//           what replaces aimless patrolling once there is something to contest
//     │  target within sight
//     ▼
//   CHASE   drive at the target, gun tracking it
//     │  target within attack range          ▲ target slips out of range
//     ▼                                      │
//   ATTACK  hold the range, aim, fire when lined up
//     │  health drops below the retreat threshold
//     ▼
//   RETREAT back away while still facing the threat, until it is far behind
//
// A tank that cannot make progress (nose against a wall) briefly reverses and
// turns — without that, a stuck tank grinds forever and the FSM looks broken.

const AI_STATE = {
    PATROL: "patrol",
    ADVANCE: "advance",
    CHASE: "chase",
    ATTACK: "attack",
    RETREAT: "retreat",
    DEAD: "dead",
};

// Readable Spanish labels, handy for HUDs.
const AI_STATE_LABEL = {
    patrol: "Patrulla",
    advance: "Avanza",
    chase: "Persigue",
    attack: "Ataca",
    retreat: "Se retira",
    dead: "Destruido",
};

const DEG = 180 / Math.PI;

// Shortest signed difference between two angles, in degrees, within (-180, 180].
function angleDiff(from, to) {
    return (((to - from + 180) % 360) + 360) % 360 - 180;
}

// Engine convention: local +Y is forward, so the angle whose (-sin, cos) points
// from `a` to `b`.
function angleToward(a, b) {
    return Math.atan2(-(b.x - a.x), b.y - a.y) * DEG;
}

function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

class TankAI {
    constructor(tank, driver, {
        bounds,                 // { minX, maxX, minY, maxY } to wander inside
        sightRange = 6.5,       // starts chasing a target this close
        attackRange = 4.5,      // stops and shoots inside this
        keepDistance = 0.55,    // backs off below attackRange * this
        retreatAt = 0.3,        // retreats under this fraction of health
        fireArc = 7,            // degrees of aim error it will still fire within
        isBlocked = null,       // optional (from, to) => bool line-of-sight test
        objective = null,       // optional ground to take and hold: { x, y }
        objectiveRadius = 1.2,  // how close counts as "holding" it
    } = {}) {
        this.tank = tank;
        this.driver = driver;
        this.bounds = bounds;
        this.sightRange = sightRange;
        this.attackRange = attackRange;
        this.keepDistance = keepDistance;
        this.retreatAt = retreatAt;
        this.fireArc = fireArc;
        this.isBlocked = isBlocked;
        this.objective = objective;
        this.objectiveRadius = objectiveRadius;

        this.state = AI_STATE.PATROL;
        this.wantsToFire = false;
        this.waypoint = this._randomWaypoint();

        // Stuck detection.
        this._lastPos = { x: tank.position.x, y: tank.position.y };
        this._stuckFor = 0;
        this._unstickFor = 0;
    }

    _randomWaypoint() {
        const b = this.bounds;
        if (!b) return { x: this.tank.position.x, y: this.tank.position.y };
        return {
            x: b.minX + Math.random() * (b.maxX - b.minX),
            y: b.minY + Math.random() * (b.maxY - b.minY),
        };
    }

    // Steering that turns the hull toward `heading` (degrees). It pivots on the
    // spot when badly misaligned instead of driving a wide arc.
    _turnToward(heading, forwardWhenAligned = 1) {
        const diff = angleDiff(this.tank.rotation, heading);
        return {
            turn: Math.abs(diff) < 3 ? 0 : Math.sign(diff),
            forward: Math.abs(diff) < 55 ? forwardWhenAligned : 0,
        };
    }

    // Head for a point, nose first.
    _driveTo(point) {
        return this._turnToward(angleToward(this.tank.position, point));
    }

    // Give ground without turning your back: keep the hull facing the threat and
    // reverse. Slower than fleeing, but it stays covered — used to hold range.
    _backAwayFrom(point) {
        const diff = angleDiff(this.tank.rotation, angleToward(this.tank.position, point));
        return { turn: Math.abs(diff) < 3 ? 0 : Math.sign(diff), forward: -1 };
    }

    // Run: turn the hull away and drive forward (faster than reverse). The
    // turret is independent, so the gun can still cover the retreat.
    _fleeFrom(point) {
        return this._turnToward(angleToward(point, this.tank.position));
    }

    // True when the gun is lined up on `point` closely enough to shoot.
    _onTarget(point) {
        return this.tank.aimErrorTo(point) <= this.fireArc;
    }

    _canSee(target) {
        if (!this.isBlocked) return true;
        return !this.isBlocked(this.tank.position, target.position);
    }

    // What it does with nobody to shoot at: take the ground it was given, or
    // wander if it was given none.
    get _idleState() {
        return this.objective ? AI_STATE.ADVANCE : AI_STATE.PATROL;
    }

    // Picks the state for this frame from distance, health and visibility.
    _transition(target, dist) {
        if (!this.tank.alive) return AI_STATE.DEAD;
        const idle = this._idleState;
        if (!target || !target.alive) return idle;

        // Wounded tanks disengage, whatever else is going on.
        if (this.tank.hpRatio < this.retreatAt) {
            return dist > this.sightRange ? idle : AI_STATE.RETREAT;
        }

        switch (this.state) {
            case AI_STATE.PATROL:
            case AI_STATE.ADVANCE:
                return dist <= this.sightRange && this._canSee(target) ? AI_STATE.CHASE : idle;
            case AI_STATE.CHASE:
                if (dist > this.sightRange * 1.35) return idle;
                return dist <= this.attackRange ? AI_STATE.ATTACK : AI_STATE.CHASE;
            case AI_STATE.ATTACK:
                return dist > this.attackRange * 1.25 ? AI_STATE.CHASE : AI_STATE.ATTACK;
            case AI_STATE.RETREAT:
                // Recovered range (health cannot go back up) — back to the job.
                return dist > this.sightRange ? idle : AI_STATE.RETREAT;
            default:
                return idle;
        }
    }

    // Runs one frame of behaviour. `target` is the tank it hunts (the player).
    update(dt, target = null) {
        this.wantsToFire = false;

        if (!this.tank.alive) {
            this.state = AI_STATE.DEAD;
            this.driver.setInput({ forward: 0, turn: 0 });
            return this;
        }

        const pos = this.tank.position;
        const dist = target && target.alive ? distance(pos, target.position) : Infinity;
        this.state = this._transition(target, dist);

        // --- Nudge out of whatever it is grinding against. ---
        const moved = distance(pos, this._lastPos);
        this._lastPos = { x: pos.x, y: pos.y };
        if (this._unstickFor > 0) {
            this._unstickFor -= dt;
            this.driver.setInput({ forward: -1, turn: 1 });
            const idling = this.state === AI_STATE.PATROL || this.state === AI_STATE.ADVANCE;
            if (!idling && target) this.tank.aimAt(target.position, dt);
            return this;
        }
        if (this.driver.input.forward !== 0 && moved < 0.004) {
            this._stuckFor += dt;
            if (this._stuckFor > 0.7) {
                this._stuckFor = 0;
                this._unstickFor = 0.6;
                this.waypoint = this._randomWaypoint();
            }
        } else {
            this._stuckFor = 0;
        }

        // --- Act on the current state. ---
        switch (this.state) {
            case AI_STATE.PATROL: {
                if (distance(pos, this.waypoint) < 0.6) this.waypoint = this._randomWaypoint();
                this.driver.setInput(this._driveTo(this.waypoint));
                // Gun rests forward while nothing is in sight.
                this.tank.turnTurretTo(this.tank.rotation, dt);
                break;
            }

            case AI_STATE.ADVANCE: {
                // Head for the ground it was sent to, then sit on it and watch.
                if (distance(pos, this.objective) > this.objectiveRadius) {
                    this.driver.setInput(this._driveTo(this.objective));
                } else {
                    this.driver.setInput({ forward: 0, turn: 0 });
                }
                this.tank.turnTurretTo(this.tank.rotation, dt);
                break;
            }

            case AI_STATE.CHASE: {
                this.driver.setInput(this._driveTo(target.position));
                this.tank.aimAt(target.position, dt);
                break;
            }

            case AI_STATE.ATTACK: {
                // Hold a firing distance: give ground when the target crowds it,
                // otherwise stand still, face it and let the turret do the work.
                const tooClose = dist < this.attackRange * this.keepDistance;
                const steer = tooClose ? this._backAwayFrom(target.position) : this._driveTo(target.position);
                this.driver.setInput({ forward: tooClose ? steer.forward : 0, turn: steer.turn });
                this.tank.aimAt(target.position, dt);
                this.wantsToFire = this._onTarget(target.position) && this._canSee(target);
                break;
            }

            case AI_STATE.RETREAT: {
                // Break contact, gun still trained on the threat.
                this.driver.setInput(this._fleeFrom(target.position));
                this.tank.aimAt(target.position, dt);
                break;
            }
        }

        return this;
    }
}

// ===== components/controls/gearbox.js =====
// A gearbox for the drivetrain: what turns a flat "hold W to accelerate" into
// something that feels mechanical.
//
// Each forward gear reaches a fraction of the vehicle's top speed (`ratios`).
// Short gears pull hard but run out of revs early; the top gear barely pulls but
// is the only way to reach full speed. Engine revs (`rpm`, normalised 0..1) come
// from how far into the current gear's speed band you are, and a torque curve
// makes the engine bog down under load and taper off near the redline. Changing
// gear cuts the drive for `shiftTime`, which is what you actually feel.
//
// Two modes:
//   AUTO    shifts by itself on revs (with hysteresis so it does not hunt), and
//           picks reverse when you ask to back up from a standstill.
//   MANUAL  you pick the gear: R · N · 1 · 2 · … Leave it in too high a gear and
//           it bogs; hold it too long and you bounce off the limiter.
//
// It knows nothing about input — a TankController feeds it the current speed and
// throttle, and reads back `torque` and `speedLimit`.
//
// Given real gear ratios and an Engine it switches to a *mechanical* mode: revs
// come from road speed through the drivetrain (`engineRpm`), and `wheelTorque` /
// `wheelForce` say what actually reaches the ground, so a caller can integrate
// real vehicle physics. Without them it keeps the light normalised model above.

const GEARBOX_MODE = { AUTO: "auto", MANUAL: "manual" };

// Revs below this count as "about to stall", above as "into the limiter".
const TORQUE_PEAK = 0.65;   // revs where the engine pulls hardest
const TORQUE_SPREAD = 1.7;  // how quickly torque falls away from the peak
const TORQUE_FLOOR = 0.45;  // never less than this fraction of the gear's pull
const STOPPED = 0.15;       // speed under which the vehicle counts as stopped
// Inverse of the engine module's rad/s conversion, named apart from it: both
// become globals in the standalone build and a clash there is fatal.
const RPM_PER_RAD = 60 / (2 * Math.PI);

class Gearbox {
    constructor({
        ratios = [0.3, 0.52, 0.75, 1.0], // fraction of top speed per forward gear
        reverseRatio = 0.4,
        maxSpeed = 3,          // vehicle top speed; the controller keeps this in sync
        shiftTime = 0.25,      // seconds of cut drive while changing gear
        upshiftAt = 0.88,      // revs that trigger an automatic upshift
        downshiftAt = 0.35,    // revs that trigger an automatic downshift
        mode = GEARBOX_MODE.AUTO,

        // --- Mechanical mode (optional) -------------------------------------
        // Give it real gear ratios and an Engine and it stops guessing: revs
        // come from road speed through the drivetrain, and `wheelTorque` is what
        // actually reaches the ground. `ratios` above is then unused.
        engine = null,
        gearRatios = null,     // e.g. [3.6, 2.1, 1.4, 1.0, 0.8]
        reverseGearRatio = 3.2,
        finalDrive = 3.9,
        wheelRadius = 0.34,    // metres
    } = {}) {
        this.ratios = ratios;
        this.reverseRatio = reverseRatio;
        this.maxSpeed = maxSpeed;
        this.engine = engine;
        this.gearRatios = gearRatios;
        this.reverseGearRatio = reverseGearRatio;
        this.finalDrive = finalDrive;
        this.wheelRadius = wheelRadius;
        this.shiftTime = shiftTime;
        this.upshiftAt = upshiftAt;
        this.downshiftAt = downshiftAt;
        this.mode = mode;

        this.gear = 1;      // -1 reverse · 0 neutral · 1..N forward
        this.speed = 0;     // last speed the controller reported
        this._shiftFor = 0; // seconds left of the current gear change
        this.shifts = 0;    // how many changes so far (handy for HUDs/tests)
    }

    // True when it is driven by a real engine and real ratios.
    get mechanical() {
        return !!(this.engine && this.gearRatios);
    }

    // Selectable gears in order, so manual shifting can walk the list.
    get sequence() {
        return [-1, 0, ...Array.from({ length: this.topGear }, (_, i) => i + 1)];
    }

    get topGear() {
        return (this.mechanical ? this.gearRatios : this.ratios).length;
    }

    // Gear ratio actually turning the driveshaft (mechanical mode only).
    get gearRatio() {
        if (!this.mechanical || this.gear === 0) return 0;
        return this.gear === -1 ? this.reverseGearRatio : this.gearRatios[this.gear - 1];
    }

    // Total reduction from crank to wheel.
    get driveRatio() {
        return this.gearRatio * this.finalDrive;
    }

    // Engine revs for the current road speed and gear. Idles when the clutch is
    // out (neutral or mid-shift) or when the wheels are barely turning.
    get engineRpm() {
        if (!this.mechanical) return 0;
        const { idleRpm, redlineRpm } = this.engine;
        if (this.gear === 0) return idleRpm;
        const wheelRadPerSec = Math.abs(this.speed) / this.wheelRadius;
        const rpm = wheelRadPerSec * Math.abs(this.driveRatio) * RPM_PER_RAD;
        return Math.max(idleRpm, Math.min(redlineRpm, rpm));
    }

    // Torque reaching the wheels, in N·m. Zero with the drive cut.
    get wheelTorque() {
        if (!this.mechanical || this.shifting || this.gear === 0) return 0;
        return this.engine.torqueAt(this.engineRpm) * Math.abs(this.driveRatio);
    }

    // Tractive force at the contact patch, in newtons.
    get wheelForce() {
        return this.wheelTorque / this.wheelRadius;
    }

    // What the engine is making right now, for a readout.
    get power() {
        return this.mechanical ? this.engine.powerAt(this.engineRpm) : 0;
    }

    // Road speed the current gear tops out at (redline in that gear).
    get gearTopSpeed() {
        if (!this.mechanical || this.gear === 0) return Infinity;
        return (this.engine.redlineRpm / RPM_PER_RAD) * this.wheelRadius / Math.abs(this.driveRatio);
    }

    get inReverse() {
        return this.gear === -1;
    }

    get inNeutral() {
        return this.gear === 0;
    }

    // Which way the current gear drives: +1 forward, -1 reverse, 0 in neutral.
    get direction() {
        return this.gear === 0 ? 0 : Math.sign(this.gear);
    }

    // Fraction of top speed the current gear can reach.
    get ratio() {
        if (this.gear === -1) return this.reverseRatio;
        if (this.gear === 0) return 0;
        return this.ratios[this.gear - 1];
    }

    // Fastest the vehicle can go in this gear. Neutral does not drive, but it
    // must not brake either — coasting keeps whatever speed it had.
    get speedLimit() {
        if (this.mechanical) return this.gear === 0 ? Infinity : this.gearTopSpeed;
        return this.gear === 0 ? this.maxSpeed : this.maxSpeed * this.ratio;
    }

    // Revs as a 0..1 fraction of the redline — what the shift logic and the
    // tachometer both read, in either mode.
    get rpm() {
        if (this.mechanical) return this.engineRpm / this.engine.redlineRpm;
        const limit = this.maxSpeed * this.ratio;
        if (limit <= 0) return 0;
        return Math.min(1, Math.abs(this.speed) / limit);
    }

    get shifting() {
        return this._shiftFor > 0;
    }

    // Multiplier the controller applies to its acceleration. Zero while the
    // drive is cut (mid-shift or in neutral).
    get torque() {
        if (this.shifting || this.gear === 0) return 0;
        // Short gears multiply the pull; the top gear barely does.
        const gearPull = 0.5 / this.ratio;
        const off = this.rpm - TORQUE_PEAK;
        const curve = Math.max(TORQUE_FLOOR, 1 - TORQUE_SPREAD * off * off);
        return gearPull * curve;
    }

    // Readable gear for a HUD: "R", "N", "1", "2", ...
    get label() {
        if (this.gear === -1) return "R";
        if (this.gear === 0) return "N";
        return String(this.gear);
    }

    setMode(mode) {
        this.mode = mode;
        return this;
    }

    toggleMode() {
        return this.setMode(this.mode === GEARBOX_MODE.AUTO ? GEARBOX_MODE.MANUAL : GEARBOX_MODE.AUTO);
    }

    // Engages a gear, cutting the drive while the change happens.
    shiftTo(gear) {
        const target = Math.max(-1, Math.min(this.topGear, gear));
        if (target === this.gear || this.shifting) return this;
        this.gear = target;
        this._shiftFor = this.shiftTime;
        this.shifts++;
        return this;
    }

    // Manual shifting: step through R · N · 1 · 2 · …
    shiftUp() {
        const seq = this.sequence;
        const i = seq.indexOf(this.gear);
        return i < seq.length - 1 ? this.shiftTo(seq[i + 1]) : this;
    }

    shiftDown() {
        const seq = this.sequence;
        const i = seq.indexOf(this.gear);
        return i > 0 ? this.shiftTo(seq[i - 1]) : this;
    }

    // Called once per frame by the controller with the current drivetrain state.
    // `throttle` is the driver's demand in [-1, 1].
    update(dt, { speed = 0, throttle = 0 } = {}) {
        this.speed = speed;
        if (this._shiftFor > 0) {
            this._shiftFor = Math.max(0, this._shiftFor - dt);
            return this;
        }
        if (this.mode === GEARBOX_MODE.AUTO) this._autoShift(throttle);
        return this;
    }

    // Automatic logic: pick reverse/forward from a standstill, then ride the
    // revs. The gap between upshiftAt and downshiftAt stops it hunting.
    _autoShift(throttle) {
        const stopped = Math.abs(this.speed) < STOPPED;

        if (throttle < 0 && stopped && !this.inReverse) return void this.shiftTo(-1);
        if (throttle >= 0 && this.inReverse && stopped) return void this.shiftTo(1);
        if (this.inReverse || this.inNeutral) return;

        const revs = this.rpm;
        if (revs > this.upshiftAt && this.gear < this.topGear) this.shiftTo(this.gear + 1);
        else if (revs < this.downshiftAt && this.gear > 1) this.shiftTo(this.gear - 1);
    }
}

// ===== components/controls/autoAim.js =====
// Auto-aim: hands the turret over to a target-picking policy.
//
// One button cycles through the policies, so the driver can go from "point at
// whatever is closest" to "finish off the wounded one" to "deal with the big
// one" without ever letting go of the wheel:
//
//   OFF → NEAREST → WEAKEST → TOUGHEST → STRONGEST → OFF …
//
//   NEAREST    the closest target — the one most likely to be shooting at you
//   WEAKEST    the least health left — finish it off
//   TOUGHEST   the most health left — chip away at the one that will last
//   STRONGEST  the biggest threat by design (durability × damage per second),
//              regardless of how hurt it currently is
//
// It only picks the target and points the gun; it never fires. Ties break by
// distance, and the current target wins an exact tie so the gun does not
// twitch between two equal candidates.

const AIM_MODE = {
    OFF: "off",
    NEAREST: "nearest",
    WEAKEST: "weakest",
    TOUGHEST: "toughest",
    STRONGEST: "strongest",
};

// Order the button walks through.
const AIM_CYCLE = [AIM_MODE.OFF, AIM_MODE.NEAREST, AIM_MODE.WEAKEST, AIM_MODE.TOUGHEST, AIM_MODE.STRONGEST];

const AIM_MODE_LABEL = {
    off: "Desactivado",
    nearest: "Más cercano",
    weakest: "Menos vida",
    toughest: "Más vida",
    strongest: "Más fuerte",
};

// How each mode scores a candidate. Higher score wins; distance is passed in so
// modes can use it directly or just as a tie-breaker.
const SCORES = {
    [AIM_MODE.NEAREST]: (tank, dist) => -dist,
    [AIM_MODE.WEAKEST]: (tank) => -tank.hp,
    [AIM_MODE.TOUGHEST]: (tank) => tank.hp,
    [AIM_MODE.STRONGEST]: (tank) => tank.power,
};

class AutoAim {
    constructor(tank, { mode = AIM_MODE.OFF, cycle = AIM_CYCLE } = {}) {
        this.tank = tank;
        this.cycleOrder = cycle;
        this.mode = mode;
        this.target = null;
    }

    get enabled() {
        return this.mode !== AIM_MODE.OFF;
    }

    get label() {
        return AIM_MODE_LABEL[this.mode];
    }

    setMode(mode) {
        this.mode = mode;
        if (!this.enabled) this.target = null;
        return this;
    }

    // Advances to the next policy — this is what the button is wired to.
    cycle() {
        const i = this.cycleOrder.indexOf(this.mode);
        return this.setMode(this.cycleOrder[(i + 1) % this.cycleOrder.length]);
    }

    // Best candidate under the current policy, or null when off / none alive.
    pick(candidates = []) {
        const score = SCORES[this.mode];
        if (!score) return null;

        const from = this.tank.position;
        let best = null;
        let bestScore = -Infinity;
        let bestDist = Infinity;

        for (const candidate of candidates) {
            if (!candidate || !candidate.alive || candidate === this.tank) continue;
            const dist = Math.hypot(candidate.position.x - from.x, candidate.position.y - from.y);
            const value = score(candidate, dist);
            // Break ties by distance, then keep the current target so the gun
            // does not flick between two identical candidates.
            const better = value > bestScore
                || (value === bestScore && dist < bestDist)
                || (value === bestScore && dist === bestDist && candidate === this.target);
            if (better) {
                best = candidate;
                bestScore = value;
                bestDist = dist;
            }
        }
        return best;
    }

    // Picks a target and swings the turret onto it. Returns the target (or null),
    // so the caller can draw a reticle on it. Does not fire.
    update(dt, candidates = []) {
        if (!this.enabled) {
            this.target = null;
            return null;
        }
        this.target = this.pick(candidates);
        if (this.target) this.tank.aimAt(this.target.position, dt);
        return this.target;
    }
}

// ===== components/controls/index.js =====
// Barrel for the controls layer.

// ===== components/weapons/ballistics.js =====
// Ballistics: where bullets meet armor.
//
// Bullets are treated as swept segments (raycast from their previous to their
// current position), not as physics bodies. That avoids fast bullets tunnelling
// through thin armor and gives us the exact hit point and, crucially, the
// surface normal — which is what the angle-based penetration model needs.
//
// Penetration model (arcade, à la World of Tanks):
//   effectiveArmor = nominalArmor / cos(theta)
//   theta = angle between the shell's path and the surface normal
//   - ricochet if theta >= ricochetAngle (too steep, shell skips off)
//   - penetration if shellPenetration >= effectiveArmor
//   - block otherwise (shell stops, no damage)

// Transforms a shape's local collider outline into world space. Mirrors the
// transform used by Shape.draw and the physics layer (rotation is CCW degrees).
// Named apart from the physics layer's equivalent: both end up as globals in the
// standalone build, and one silently overwriting the other is a trap.
function hullOutline(shape) {
    const angle = (shape.rotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return shape.getColliderVertices().map((p) => {
        const x = p.x * shape.scale.x;
        const y = p.y * shape.scale.y;
        return {
            x: shape.position.x + x * cos - y * sin,
            y: shape.position.y + x * sin + y * cos,
        };
    });
}

// Intersection of segment A->B with segment P->Q. Returns { t, point } where t
// is the position along A->B in [0, 1], or null when they do not cross.
function segmentIntersect(a, b, p, q) {
    const r = { x: b.x - a.x, y: b.y - a.y };
    const s = { x: q.x - p.x, y: q.y - p.y };
    const denom = r.x * s.y - r.y * s.x;
    if (Math.abs(denom) < 1e-9) return null; // parallel

    const t = ((p.x - a.x) * s.y - (p.y - a.y) * s.x) / denom;
    const u = ((p.x - a.x) * r.y - (p.y - a.y) * r.x) / denom;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;

    return { t, point: { x: a.x + r.x * t, y: a.y + r.y * t } };
}

// Casts the segment a->b against a polygon shape. Returns the first face hit as
// { point, normal, edgeIndex, t } (normal points outward), or null.
function raycastShape(a, b, shape) {
    const poly = hullOutline(shape);
    let best = null;

    for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        const hit = segmentIntersect(a, b, p, q);
        if (hit && (!best || hit.t < best.t)) {
            const dx = q.x - p.x;
            const dy = q.y - p.y;
            const len = Math.hypot(dx, dy) || 1;
            // Outward normal for a counter-clockwise winding.
            const normal = { x: dy / len, y: -dx / len };
            best = { point: hit.point, normal, edgeIndex: i, t: hit.t };
        }
    }
    return best;
}

// Decides what happens when a shell of `penetration` mm hits `armor` mm of plate
// whose outward `normal` is hit head-on by a shell travelling along `direction`.
// `normalizes` controls the slope model: true (solid shot) makes sloped armor
// count more (effective = nominal / cosθ); false (shaped charge / HE) defeats the
// nominal thickness regardless of slope.
// Returns { result: "penetration" | "ricochet" | "block", angle, effectiveArmor }.
function evaluateImpact({ direction, normal, penetration, armor, ricochetAngle = 70, normalizes = true }) {
    // cos of the impact angle measured from the surface normal.
    const cos = -(direction.x * normal.x + direction.y * normal.y);
    const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;

    if (cos <= 1e-4) {
        // Grazing or hitting the inside of a face — treat as a ricochet.
        return { result: "ricochet", angle, effectiveArmor: Infinity };
    }

    const effectiveArmor = normalizes ? armor / cos : armor;
    if (angle >= ricochetAngle) {
        return { result: "ricochet", angle, effectiveArmor };
    }
    if (penetration >= effectiveArmor) {
        return { result: "penetration", angle, effectiveArmor };
    }
    return { result: "block", angle, effectiveArmor };
}

// Reflects a velocity vector off a surface with the given unit normal.
function reflect(velocity, normal) {
    const dot = velocity.x * normal.x + velocity.y * normal.y;
    return { x: velocity.x - 2 * dot * normal.x, y: velocity.y - 2 * dot * normal.y };
}

// ===== components/weapons/projectiles.js =====
// Basic projectile (shell) types and the damage scheme that turns a ballistics
// result into hit points.
//
// Every type bends the shared penetration model (see ballistics.js) and decides
// how a hit becomes damage. The fields:
//
//   id / name         identifier and readable Spanish label
//   penMultiplier     scales the gun's nominal penetration (mm)
//   damageMultiplier  scales the gun's nominal damage on a clean penetration
//   ricochetAngle     impact angle from the surface normal beyond which the
//                     shell skips off (90 = never ricochets)
//   normalizes        true  -> sloped armor counts more (effective = nominal/cosθ)
//                     false -> the shell defeats the nominal thickness regardless
//                              of slope (shaped charge / surface burst)
//   splash            fraction of damage that still leaks through on a non-pen,
//                     i.e. fragments spraying past un-breached plate (HE)
//
// The four staples of arcade tank games:
//   AP    Perforante     — the all-rounder: solid shot, slope matters, skips off
//                          steep plates.
//   APCR  Subcalibre     — more penetration, less damage, ricochets sooner.
//   HEAT  Carga hueca    — shaped charge: ignores slope, never ricochets, steady
//                          damage; the answer to angled armor.
//   HE    Alto explosivo — little penetration but a big punch, and even a non-pen
//                          chips the target with fragments.

const PROJECTILES = {
    AP:   { id: "AP",   name: "Perforante",     penMultiplier: 1.0,  damageMultiplier: 1.0, ricochetAngle: 70, normalizes: true,  splash: 0 },
    APCR: { id: "APCR", name: "Subcalibre",     penMultiplier: 1.4,  damageMultiplier: 0.7, ricochetAngle: 68, normalizes: true,  splash: 0 },
    HEAT: { id: "HEAT", name: "Carga hueca",    penMultiplier: 1.2,  damageMultiplier: 1.1, ricochetAngle: 90, normalizes: false, splash: 0 },
    HE:   { id: "HE",   name: "Alto explosivo", penMultiplier: 0.35, damageMultiplier: 1.8, ricochetAngle: 90, normalizes: false, splash: 0.25 },
};

// Default type when a weapon / bullet does not name one.
const DEFAULT_PROJECTILE = PROJECTILES.AP;

// Resolves a shot end to end: runs the penetration model tuned for the shell
// `type`, then applies its damage scheme. Returns the ballistics result extended
// with `damage` (hit points actually dealt to the plate):
//   penetration -> full damage
//   block       -> splash * damage (HE fragments; 0 for solid shot)
//   ricochet    -> no damage
function resolveShot({ type = DEFAULT_PROJECTILE, penetration, damage, direction, normal, armor }) {
    const impact = evaluateImpact({
        direction,
        normal,
        penetration,
        armor,
        ricochetAngle: type.ricochetAngle,
        normalizes: type.normalizes,
    });

    let dealt = 0;
    if (impact.result === "penetration") {
        dealt = damage;
    } else if (impact.result === "block") {
        dealt = Math.round(damage * type.splash);
    }

    return { ...impact, type, damage: dealt };
}

// ===== components/weapons/bullet.js =====
// A shell in flight. It stores its previous position so the ballistics layer can
// raycast the segment travelled during the last frame (continuous collision).

class Bullet {
    constructor({ x, y, vx, vy, penetration, damage = 100, owner = null, life = 3, type = DEFAULT_PROJECTILE }) {
        this.position = { x, y };
        this.prev = { x, y };
        this.velocity = { x: vx, y: vy };
        this.penetration = penetration;
        this.damage = damage;
        this.type = type; // projectile type (AP / APCR / HEAT / HE), drives the damage scheme
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

// ===== components/weapons/weapon.js =====
// A gun that fires shells. Tracks its own reload cooldown; call update(dt) each
// frame and fire(...) to shoot when ready. `penetration` and `damage` are the
// gun's nominal values; each projectile type scales them by its own multipliers.

class Weapon {
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

// ===== components/weapons/armor.js =====
// Per-face armor for a target shape. Each collider edge (in getColliderVertices
// order) has a nominal armor thickness in mm and a readable face name. The armor
// travels with the shape's rotation, so angling the hull changes which value a
// shell meets — exactly what drives the penetration model.

class Armor {
    // faces: array aligned to the shape's collider edges, each { armor, name }.
    constructor(shape, faces, { hp = 100 } = {}) {
        this.shape = shape;
        this.faces = faces;
        this.maxHp = hp;
        this.hp = hp;
        this.alive = true;
    }

    faceForEdge(index) {
        return this.faces[index];
    }

    takeDamage(amount) {
        this.hp = Math.max(0, this.hp - amount);
        if (this.hp === 0) this.alive = false;
        return this.hp;
    }

    // Builds per-face armor for any convex hull by looking at where each face
    // actually points in the shape's local space: faces within `frontArc` of
    // local +Y (forward) are frontal, those as far from it are the rear, and the
    // rest are sides. Works for a rectangle, a wedge, a hexagon — anything with
    // a counter-clockwise collider outline, which is what the raycast assumes.
    static forHull(shape, { front, side, rear, hp = 100, frontArc = 75 } = {}) {
        const points = shape.getColliderVertices();
        const faces = points.map((p, i) => {
            const q = points[(i + 1) % points.length];
            const dx = q.x - p.x;
            const dy = q.y - p.y;
            const len = Math.hypot(dx, dy) || 1;
            // Outward normal of a CCW edge is (dy, -dx); we only need its Y to
            // know how far the face is turned away from "forward".
            const ny = -dx / len;
            const angle = (Math.acos(Math.max(-1, Math.min(1, ny))) * 180) / Math.PI;
            if (angle <= frontArc) return { armor: front, name: "Frontal" };
            if (angle >= 180 - frontArc) return { armor: rear, name: "Trasera" };
            return { armor: side, name: "Lateral" };
        });
        return new Armor(shape, faces, { hp });
    }

    // Convenience for a rectangular hull. `frontEdge` is the collider edge that
    // faces the enemy; its opposite becomes the rear, the other two the sides.
    static rectangle(shape, { front, side, rear, frontEdge = 3, hp = 100 } = {}) {
        const faces = [];
        for (let i = 0; i < 4; i++) faces.push({ armor: side, name: "Lateral" });
        faces[frontEdge % 4] = { armor: front, name: "Frontal" };
        faces[(frontEdge + 2) % 4] = { armor: rear, name: "Trasera" };
        return new Armor(shape, faces, { hp });
    }
}

// ===== components/weapons/index.js =====
// Barrel for the weapons / ballistics layer.

// ===== components/vehicles/tank.js =====
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






// Every design: hull/turret shape factories, a collision radius, the barrel
// geometry, driving stats (for TankController) and the turret traverse rate.
const TANK_DESIGNS = {
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
        hp: 100,
        gearbox: { ratios: [0.3, 0.52, 0.75, 1.0], reverseRatio: 0.4, shiftTime: 0.25 },
        armor: { front: 65, side: 38, rear: 28 },
        weapon: { damage: 25, reload: 1.1, muzzleSpeed: 11, penetration: 95 },
        ammo: "AP",
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
        hp: 65,
        gearbox: { ratios: [0.26, 0.45, 0.63, 0.82, 1.0], reverseRatio: 0.45, shiftTime: 0.16 },
        armor: { front: 30, side: 18, rear: 14 },
        weapon: { damage: 13, reload: 0.55, muzzleSpeed: 13, penetration: 55 },
        ammo: "APCR",
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
        hp: 170,
        gearbox: { ratios: [0.36, 0.68, 1.0], reverseRatio: 0.32, shiftTime: 0.5 },
        armor: { front: 105, side: 62, rear: 45 },
        weapon: { damage: 42, reload: 2.2, muzzleSpeed: 9, penetration: 145 },
        ammo: "AP",
    },

    hunter: {
        id: "hunter",
        name: "Cazacarros",
        hint: "Nariz en cuña, torreta lenta.",
        radius: 0.44,
        // A convex wedge: pointed nose, wide tail. Wound counter-clockwise so the
        // ballistics layer derives outward face normals (it assumes CCW).
        hull: (gl) => new Polygon(gl, {
            points: [
                { x: -0.36, y: 0.06 },
                { x: -0.3, y: -0.46 },
                { x: 0.3, y: -0.46 },
                { x: 0.36, y: 0.06 },
                { x: 0, y: 0.52 },
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
        hp: 90,
        gearbox: { ratios: [0.28, 0.5, 0.74, 1.0], reverseRatio: 0.4, shiftTime: 0.32 },
        armor: { front: 85, side: 42, rear: 30 },
        weapon: { damage: 36, reload: 1.7, muzzleSpeed: 14, penetration: 125 },
        ammo: "APCR",
    },
};

const DEFAULT_DESIGN = TANK_DESIGNS.medium;

// Shortest signed difference between two angles, in degrees, within (-180, 180].
function angleDelta(from, to) {
    return (((to - from + 180) % 360) + 360) % 360 - 180;
}

// Health bar geometry, in world units. The bar floats above the hull and never
// rotates with it, so it stays readable however the tank is facing.
const BAR_HEIGHT = 0.11;
const BAR_GAP = 0.3;
const BAR_BACK_COLOR = { red: 0.1, green: 0.11, blue: 0.13 };
// Fill color by remaining health: healthy, hurt, critical.
const BAR_FILL_COLORS = [
    { at: 0.5, color: { red: 0.26, green: 0.75, blue: 0.41 } },
    { at: 0.2, color: { red: 0.85, green: 0.69, blue: 0.23 } },
    { at: 0, color: { red: 0.85, green: 0.29, blue: 0.24 } },
];

class Tank {
    constructor(gl, { design = DEFAULT_DESIGN, x = 0, y = 0, rotation = 0, turretAngle = null, colors = design.colors } = {}) {
        this.design = design;

        this.hull = design.hull(gl).setColor(colors.hull)
            .setPosition({ x, y }).setRotation(rotation).init();
        this.barrel = new Rectangle(gl, { width: design.barrel.width, height: design.barrel.length })
            .setColor(colors.barrel).init();
        this.turret = design.turret(gl).setColor(colors.turret).init();

        // Absolute world angle of the gun; starts aligned with the hull.
        this.turretAngle = turretAngle ?? rotation;

        // Health. `maxHp` comes from the design; the bar reflects the ratio.
        this.maxHp = design.hp ?? 100;
        this.hp = this.maxHp;
        this.alive = true;

        // Per-face armor derived from the hull's own outline, so angling the
        // hull changes which plate a shell meets. See Armor.forHull.
        this.armor = design.armor ? Armor.forHull(this.hull, design.armor) : null;

        // Health bar: a dark backing plate with a colored fill on top. The fill
        // is scaled horizontally (and nudged left) so it empties from the right.
        this.barWidth = Math.max(0.62, design.radius * 1.9);
        this.barBack = new Rectangle(gl, { width: this.barWidth + 0.04, height: BAR_HEIGHT + 0.04 })
            .setColor(BAR_BACK_COLOR).init();
        this.barFill = new Rectangle(gl, { width: this.barWidth, height: BAR_HEIGHT })
            .setColor(BAR_FILL_COLORS[0].color).init();
        this._barBucket = 0; // index into BAR_FILL_COLORS, to avoid re-uploading

        // Draw order: hull, barrel, turret, then the bar on top of everything.
        this.parts = [this.hull, this.barrel, this.turret, this.barBack, this.barFill];
        this.sync();
    }

    get hpRatio() {
        return this.maxHp > 0 ? Math.max(0, this.hp) / this.maxHp : 0;
    }

    // Applies damage. Returns true while the tank is still alive.
    takeDamage(amount) {
        if (!this.alive) return false;
        this.hp -= amount;
        if (this.hp <= 0) {
            this.hp = 0;
            this.alive = false;
        }
        return this.alive;
    }

    // How dangerous this design is, regardless of current damage: durability
    // times sustained damage output. Used by auto-aim to rank threats.
    get power() {
        const w = this.design.weapon;
        return w ? (this.maxHp * w.damage) / w.reload : this.maxHp;
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

    // Nominal armor of the hull face a shell came through (by collider edge).
    faceForEdge(index) {
        return this.armor ? this.armor.faceForEdge(index) : null;
    }

    // How far off the gun is from a world point, in degrees (0 = dead on).
    // Lets callers decide whether it is worth pulling the trigger yet.
    aimErrorTo(point) {
        const dx = point.x - this.position.x;
        const dy = point.y - this.position.y;
        if (dx === 0 && dy === 0) return 0;
        const bearing = (Math.atan2(-dx, dy) * 180) / Math.PI;
        return Math.abs(angleDelta(this.turretAngle, bearing));
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

        // Health bar, level above the hull whatever way the tank points.
        const ratio = this.hpRatio;
        const barY = p.y + this.design.radius + BAR_GAP;
        this.barBack.setPosition({ x: p.x, y: barY });
        this.barFill
            .setScale({ x: ratio, y: 1 })
            .setPosition({ x: p.x - (this.barWidth * (1 - ratio)) / 2, y: barY });

        // Recolor only when crossing a threshold — setColor re-uploads a buffer.
        const bucket = BAR_FILL_COLORS.findIndex((b) => ratio > b.at);
        const next = bucket === -1 ? BAR_FILL_COLORS.length - 1 : bucket;
        if (next !== this._barBucket) {
            this._barBucket = next;
            this.barFill.setColor(BAR_FILL_COLORS[next].color);
        }
        return this;
    }
}

// ===== components/vehicles/engine.js =====
// A combustion engine: revs in, torque out, power derived.
//
// Torque is not flat — it climbs off idle, peaks somewhere in the mid range and
// falls away toward the redline. That shape is the whole reason gears exist, so
// the curve here is the thing worth getting right:
//
//   torque(rpm) = peakTorque · (1 − k · offset²)
//
// with a different k below and above the peak, chosen so the curve passes
// exactly through the idle and redline values you specify. Smooth, monotonic on
// each side, and tunable with numbers a person can reason about.
//
// Power is not an independent setting — it *falls out* of torque and revs:
//
//   P [W] = T [N·m] · ω [rad/s],   ω = rpm · 2π / 60
//
// which is why peak power always sits at higher revs than peak torque: torque is
// sagging, but ω is climbing faster. `peakPower` finds that point by sampling.

const RPM_TO_RAD = (2 * Math.PI) / 60;
const W_PER_HP = 735.5; // metric horsepower (CV)

class Engine {
    constructor({
        idleRpm = 800,
        redlineRpm = 6800,
        peakTorque = 340,        // N·m
        peakTorqueRpm = 3400,
        torqueAtIdle = 0.55,     // fraction of peak torque down at idle
        torqueAtRedline = 0.74,  // ... and up at the limiter
    } = {}) {
        this.idleRpm = idleRpm;
        this.redlineRpm = redlineRpm;
        this.peakTorque = peakTorque;
        this.peakTorqueRpm = peakTorqueRpm;
        this.torqueAtIdle = torqueAtIdle;
        this.torqueAtRedline = torqueAtRedline;
    }

    // Torque in N·m at the crank.
    torqueAt(rpm) {
        const r = Math.max(0, Math.min(this.redlineRpm, rpm));
        if (r <= this.peakTorqueRpm) {
            const span = this.peakTorqueRpm - this.idleRpm || 1;
            const off = Math.max(0, (this.peakTorqueRpm - r) / span); // 1 at idle, 0 at peak
            return this.peakTorque * (1 - (1 - this.torqueAtIdle) * off * off);
        }
        const span = this.redlineRpm - this.peakTorqueRpm || 1;
        const off = (r - this.peakTorqueRpm) / span;                   // 0 at peak, 1 at redline
        return this.peakTorque * (1 - (1 - this.torqueAtRedline) * off * off);
    }

    // Power in watts — torque times angular velocity, nothing more.
    powerAt(rpm) {
        return this.torqueAt(rpm) * rpm * RPM_TO_RAD;
    }

    powerHpAt(rpm) {
        return this.powerAt(rpm) / W_PER_HP;
    }

    // Where the engine makes the most power, found by sampling the curve.
    get peakPower() {
        if (this._peak) return this._peak;
        let best = { rpm: this.idleRpm, watts: 0 };
        for (let rpm = this.idleRpm; rpm <= this.redlineRpm; rpm += 10) {
            const watts = this.powerAt(rpm);
            if (watts > best.watts) best = { rpm, watts };
        }
        this._peak = { rpm: best.rpm, watts: best.watts, hp: best.watts / W_PER_HP };
        return this._peak;
    }
}

// ===== components/vehicles/index.js =====
// Barrel for the vehicles layer.

// ===== components/index.js =====
// Everything Raptor exports, in one place.
//
// This is the framework's public surface: if a name is here it is meant to be
// used and will not move without a note in the CHANGELOG; if it is not, it is
// an internal detail. Import from the root (`raptor.js`) in applications, or
// from a single layer (`components/physics/index.js`) when you only want one.

// --- Core: the loop, the view, the shell -------------------------------



// --- Rendering primitives ----------------------------------------------


// --- Simulation ---------------------------------------------------------

// --- Input --------------------------------------------------------------

// --- Interface ----------------------------------------------------------

// --- Audio --------------------------------------------------------------

// --- Assets -------------------------------------------------------------

// --- Scenes -------------------------------------------------------------

// --- Maths --------------------------------------------------------------

// --- Gameplay kit -------------------------------------------------------
// Not part of the engine proper: batteries that happen to ship in the box,
// built on the layers above. Ignore them and nothing below changes.

// ===== raptor.js =====
// Raptor — a small 2D WebGL framework, written by hand.
//
//     import { App, Rectangle } from "./raptor.js";
//
//     App.boot({ title: "Hola" }, (app) => {
//         const box = app.add(new Rectangle(app.gl, { width: 2, height: 1 })
//             .setColor({ red: 0.9, green: 0.4, blue: 0.2 }).init());
//         app.onUpdate((dt) => box.setRotation(box.rotation + 90 * dt));
//     });
//
// The layers, from the bottom up:
//
//   shapes    geometry that knows how to draw itself through a camera
//   render    textures, sprite sheets, animation and the shader programs
//   camera    the movable window onto the world (pan, zoom, follow, bounds)
//   engine    canvas, GL context and the one render loop
//   physics   bodies, convex collision (SAT) and a solver
//   input     keyboard state and on-screen controls that agree with each other
//   ui        the DOM chrome: panels, sliders, readouts, fullscreen
//   audio     synthesised sound, so a build stays a single file
//   assets    declare what a game needs, load it with progress, then start
//   scenes    menu, match, result — each one mounts and unmounts itself
//   app       the shell that wires all of the above together
//
// On top of those sits a gameplay kit — controls, weapons, vehicles — which is
// where the tank demos come from. It is ordinary Raptor code: nothing in the
// engine depends on it, and deleting it would leave the framework intact.
//
// There is no build step to use this: it is ES modules, served over HTTP. The
// generated single-file pages (engine.html, dyno.html, …) come from
// `node tools/build.mjs`, which also emits dist/raptor.js for consumers.

const VERSION = "0.5.0";

root.Raptor = {
    AIM_CYCLE: AIM_CYCLE,
    AIM_MODE: AIM_MODE,
    AIM_MODE_LABEL: AIM_MODE_LABEL,
    AI_STATE: AI_STATE,
    AI_STATE_LABEL: AI_STATE_LABEL,
    ASSET_KIND: ASSET_KIND,
    Animation: Animation,
    Animator: Animator,
    App: App,
    Armor: Armor,
    Assets: Assets,
    AutoAim: AutoAim,
    BASE_STYLES: BASE_STYLES,
    Body: Body,
    Bullet: Bullet,
    Camera: Camera,
    Circle: Circle,
    DEFAULT_DEPTH: DEFAULT_DEPTH,
    DEFAULT_DESIGN: DEFAULT_DESIGN,
    DEFAULT_PROJECTILE: DEFAULT_PROJECTILE,
    DYNAMIC: DYNAMIC,
    Engine: Engine,
    EngineSound: EngineSound,
    FAR_PLANE: FAR_PLANE,
    FOV_DEGREES: FOV_DEGREES,
    FOV_RADIANS: FOV_RADIANS,
    FULLSCREEN_STYLES: FULLSCREEN_STYLES,
    GEARBOX_MODE: GEARBOX_MODE,
    Gearbox: Gearbox,
    Keyboard: Keyboard,
    LOADING_STYLES: LOADING_STYLES,
    LoadingScreen: LoadingScreen,
    NEAR_PLANE: NEAR_PLANE,
    PAD_STYLES: PAD_STYLES,
    PROGRAM_COLOR: PROGRAM_COLOR,
    PROGRAM_TEXTURE: PROGRAM_TEXTURE,
    PROJECTILES: PROJECTILES,
    Polygon: Polygon,
    RaptorEngine: RaptorEngine,
    Rectangle: Rectangle,
    RegularPolygon: RegularPolygon,
    SCENE_STYLES: SCENE_STYLES,
    STATIC: STATIC,
    Scene: Scene,
    SceneManager: SceneManager,
    Shape: Shape,
    Sprite: Sprite,
    SpriteSheet: SpriteSheet,
    Square: Square,
    TANK_DESIGNS: TANK_DESIGNS,
    Tank: Tank,
    TankAI: TankAI,
    TankController: TankController,
    Texture: Texture,
    TouchPad: TouchPad,
    Triangle: Triangle,
    VERSION: VERSION,
    Weapon: Weapon,
    World: World,
    aspectOf: aspectOf,
    boundingRadius: boundingRadius,
    button: button,
    card: card,
    collide: collide,
    createRandom: createRandom,
    el: el,
    evaluateImpact: evaluateImpact,
    exitFullscreen: exitFullscreen,
    fullscreenElement: fullscreenElement,
    getProgramInfo: getProgramInfo,
    hint: hint,
    injectStyles: injectStyles,
    isFullscreen: isFullscreen,
    kv: kv,
    normalizeKey: normalizeKey,
    onFullscreenChange: onFullscreenChange,
    projectionFor: projectionFor,
    randomInt: randomInt,
    randomRange: randomRange,
    raycastShape: raycastShape,
    reflect: reflect,
    requestFullscreen: requestFullscreen,
    resolveShot: resolveShot,
    select: select,
    slider: slider,
    toggleFullscreen: toggleFullscreen,
    viewHalfExtents: viewHalfExtents,
};
})(typeof globalThis !== "undefined" ? globalThis : this);
