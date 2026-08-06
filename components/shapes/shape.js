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

import { getProgramInfo, PROGRAM_COLOR } from "../render/shaders.js";

// Used when draw() is called without a camera: pan 0, zoom 1 (world == screen).
const IDENTITY_CAMERA = { x: 0, y: 0, zoom: 1 };

export default class Shape {
    constructor(context) {
        this.context = context;

        // Transform, in world space. Position/scale are 2D; depth is how far the
        // shape sits from the perspective camera along -Z.
        this.position = { x: 0, y: 0 };
        this.rotation = 0; // degrees, counter-clockwise
        this.scale = { x: 1, y: 1 };
        this.depth = -6;

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
        // gl-matrix 3.x exposes its modules under the global `glMatrix` namespace.
        const { mat4 } = glMatrix;

        const fieldOfView = (45 * Math.PI) / 180;
        const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
        const projectionMatrix = mat4.create();
        mat4.perspective(projectionMatrix, fieldOfView, aspect, 0.1, 100.0);

        // View transform: pan by the camera center, then zoom about it. Depth is
        // constant, so scaling the world coordinates scales the screen linearly.
        const zoom = camera.zoom ?? 1;
        const viewX = (this.position.x - (camera.x ?? 0)) * zoom;
        const viewY = (this.position.y - (camera.y ?? 0)) * zoom;

        const modelViewMatrix = mat4.create();
        mat4.translate(modelViewMatrix, modelViewMatrix, [viewX, viewY, this.depth]);
        mat4.rotate(modelViewMatrix, modelViewMatrix, (this.rotation * Math.PI) / 180, [0, 0, 1]);
        mat4.scale(modelViewMatrix, modelViewMatrix, [this.scale.x * zoom, this.scale.y * zoom, 1]);

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
