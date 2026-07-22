// RaptorEngine owns the canvas, the WebGL context and the render loop. It is
// shape-agnostic: anything with a `draw()` method can be added as an entity and
// it will be drawn every frame. See components/shapes/ for the built-in shapes.
function RaptorEngine() {
    this.context = undefined;
    this.entities = [];

    this.createWindow = () => {
        var gameWindow = document.createElement("canvas");

        gameWindow.id = "gameWindow";
        gameWindow.width = 800;
        gameWindow.height = 600;

        document.body.appendChild(gameWindow);

        var context = gameWindow.getContext("webgl");

        if (!context) {
            alert("Unable to initialize WebGL. Your browser or machine may not support it.");
            return;
        }

        this.context = context;
    };

    // Registers a drawable entity. Returns it so calls can be chained.
    this.add = (entity) => {
        this.entities.push(entity);
        return entity;
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

    // Configures GL state and starts the render loop.
    this.start = () => {
        this.configure();
        requestAnimationFrame(this.renderLoop);
    };

    // Single render loop for the whole engine: clear -> draw every entity ->
    // schedule the next frame, in that order.
    this.renderLoop = () => {
        this.clearScreen();

        for (const entity of this.entities) {
            entity.draw();
        }

        requestAnimationFrame(this.renderLoop);
    };
}

export default RaptorEngine;
