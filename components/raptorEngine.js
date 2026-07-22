// RaptorEngine owns the canvas, the WebGL context and the render loop. It is
// shape-agnostic: anything with a `draw()` method can be added as an entity and
// it will be drawn every frame. See components/shapes/ for the built-in shapes.
function RaptorEngine() {
    this.context = undefined;
    this.canvas = undefined;
    this.entities = [];

    // Creates the canvas and WebGL context. Pass a `mount` element to place the
    // canvas inside it (e.g. an editor layout); defaults to document.body.
    this.createWindow = (mount) => {
        var gameWindow = document.createElement("canvas");

        gameWindow.id = "gameWindow";
        gameWindow.width = 800;
        gameWindow.height = 600;

        (mount || document.body).appendChild(gameWindow);

        var context = gameWindow.getContext("webgl");

        if (!context) {
            alert("Unable to initialize WebGL. Your browser or machine may not support it.");
            return;
        }

        this.canvas = gameWindow;
        this.context = context;
    };

    // Registers a drawable entity. Returns it so calls can be chained.
    this.add = (entity) => {
        this.entities.push(entity);
        return entity;
    };

    // Removes a previously added entity. Returns the engine for chaining.
    this.remove = (entity) => {
        const index = this.entities.indexOf(entity);
        if (index !== -1) {
            this.entities.splice(index, 1);
        }
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

    this._lastTime = undefined;

    // Configures GL state and starts the render loop.
    this.start = () => {
        this.configure();
        requestAnimationFrame(this.renderLoop);
    };

    // Single render loop for the whole engine: update -> clear -> draw every
    // entity -> schedule the next frame, in that order. `now` is the timestamp
    // requestAnimationFrame passes in, used to derive delta-time.
    this.renderLoop = (now) => {
        // Delta-time in seconds, clamped so a background tab / long stall does
        // not produce a huge jump that tunnels bodies through each other.
        let dt = this._lastTime === undefined ? 0 : (now - this._lastTime) / 1000;
        this._lastTime = now;
        if (dt > 0.05) dt = 0.05;

        for (const update of this.updaters) {
            update(dt);
        }

        this.clearScreen();

        for (const entity of this.entities) {
            entity.draw();
        }

        requestAnimationFrame(this.renderLoop);
    };
}

export default RaptorEngine;
