// RaptorEngine owns the canvas, the WebGL context and the render loop. It is
// shape-agnostic: anything with a `draw()` method can be added as an entity and
// it will be drawn every frame. See components/shapes/ for the built-in shapes.
import Camera from "./camera.js";

function RaptorEngine() {
    this.context = undefined;
    this.canvas = undefined;
    this.entities = [];

    // The view onto the world. Defaults to the origin with zoom 1 (a no-op), so
    // scenes that ignore it render unchanged. Move/replace it to pan or zoom;
    // every entity is drawn through it. See components/camera.js.
    this.camera = new Camera();

    // Creates the canvas and WebGL context. Pass a `mount` element to place the
    // canvas inside it (e.g. an editor layout); defaults to document.body.
    this.createWindow = (mount, { width = 800, height = 600 } = {}) => {
        var gameWindow = document.createElement("canvas");

        gameWindow.id = "gameWindow";
        gameWindow.width = width;
        gameWindow.height = height;

        (mount || document.body).appendChild(gameWindow);

        var context = gameWindow.getContext("webgl");

        if (!context) {
            alert("Unable to initialize WebGL. Your browser or machine may not support it.");
            return;
        }

        this.canvas = gameWindow;
        this.context = context;
    };

    // Entities are drawn in layer order, low to high, and in insertion order
    // within a layer. The sort is lazy: it only happens when something is added
    // or a layer changes, not every frame.
    this._needsSort = false;

    // Registers a drawable entity. Returns it so calls can be chained.
    this.add = (entity) => {
        this.entities.push(entity);
        if (entity.layer) this._needsSort = true;
        // A shape can be re-layered long after it was added, and the engine has
        // to hear about it — otherwise the change would only take effect the
        // next time something else happened to trigger a sort.
        entity._onLayerChange = () => { this._needsSort = true; };
        return entity;
    };

    // Removes a previously added entity. Returns the engine for chaining.
    this.remove = (entity) => {
        const index = this.entities.indexOf(entity);
        if (index !== -1) {
            this.entities.splice(index, 1);
            entity._onLayerChange = null;
        }
        return this;
    };

    // Stable sort by layer: Array.prototype.sort is required to be stable since
    // ES2019, which is what keeps insertion order inside a layer.
    this.sortEntities = () => {
        this.entities.sort((a, b) => (a.layer || 0) - (b.layer || 0));
        this._needsSort = false;
        return this;
    };

    // One-time GL state configuration. Runs once, not per frame.
    this.configure = () => {
        const gl = this.context;

        gl.clearColor(0.0, 0.0, 0.0, 1.0);

        // 2D engine: depth testing is not needed. Enable alpha blending so
        // translucent objects composite correctly.
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    };

    // Clears the framebuffer at the start of each frame.
    this.clearScreen = () => {
        this.context.clear(this.context.COLOR_BUFFER_BIT);
    };

    // Per-frame update callbacks, each called as fn(deltaSeconds). Register
    // physics, animation, input, etc. here — they run before drawing.
    this.updaters = [];
    this.addUpdater = (fn) => {
        this.updaters.push(fn);
        return fn;
    };

    // Scenes come and go, and an updater left behind keeps moving things that
    // no longer exist. Removal iterates a copy in the loop below, so unhooking
    // from inside an update is safe.
    this.removeUpdater = (fn) => {
        const index = this.updaters.indexOf(fn);
        if (index !== -1) this.updaters.splice(index, 1);
        return this;
    };

    this._lastTime = undefined;

    // Whether the loop is scheduling frames. Read it; use start/stop to change.
    this.running = false;

    // Configures GL state and starts the render loop. Calling it twice is safe:
    // a second loop would double every delta-time.
    this.start = () => {
        if (this.running) return this;
        this.configure();
        this.running = true;
        // Dropping the timestamp means the frame after a pause gets dt = 0
        // rather than "everything that happened while you were away".
        this._lastTime = undefined;
        requestAnimationFrame(this.renderLoop);
        return this;
    };

    // Stops scheduling frames. The last one stays on screen — nothing clears.
    this.stop = () => {
        this.running = false;
        return this;
    };

    // Single render loop for the whole engine: update -> clear -> draw every
    // entity -> schedule the next frame, in that order. `now` is the timestamp
    // requestAnimationFrame passes in, used to derive delta-time.
    this.renderLoop = (now) => {
        if (!this.running) return;

        // Delta-time in seconds, clamped so a background tab / long stall does
        // not produce a huge jump that tunnels bodies through each other.
        let dt = this._lastTime === undefined ? 0 : (now - this._lastTime) / 1000;
        this._lastTime = now;
        if (dt > 0.05) dt = 0.05;

        // A copy: an updater is allowed to add or remove updaters — which is
        // exactly what happens when one of them switches scenes.
        for (const update of this.updaters.slice()) {
            update(dt);
        }

        if (this._needsSort) this.sortEntities();

        this.clearScreen();

        for (const entity of this.entities) {
            entity.draw(this.camera);
        }

        requestAnimationFrame(this.renderLoop);
    };
}

export default RaptorEngine;
