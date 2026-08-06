// RaptorEngine owns the canvas, the WebGL context and the render loop. It is
// shape-agnostic: anything with a `draw()` method can be added as an entity and
// it will be drawn every frame. See components/shapes/ for the built-in shapes.
//
// A frame, in order: run the updaters, re-sort by layer if anything changed,
// clear, draw what is on screen, schedule the next one.

import Camera from "./camera.js";

export default class RaptorEngine {
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
