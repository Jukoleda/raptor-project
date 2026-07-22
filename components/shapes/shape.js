// Base class for every 2D shape the engine can draw.
//
// All shapes share the exact same vertex/fragment shaders and draw pipeline;
// the only thing that changes from one shape to another is its geometry (the
// vertices) and the primitive draw mode. Subclasses therefore only need to
// implement `getVertices()` and set `this.drawMode`.

const VS_SOURCE = `
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

const FS_SOURCE = `
    varying lowp vec4 vColor;

    void main() {
        gl_FragColor = vColor;
    }
`;

function loadShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        alert("An error occurred compiling the shaders: " + gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }

    return shader;
}

function buildProgramInfo(gl) {
    const vertexShader = loadShader(gl, gl.VERTEX_SHADER, VS_SOURCE);
    const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, FS_SOURCE);

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        alert("Unable to initialize the shader program: " + gl.getProgramInfoLog(program));
    }

    return {
        program,
        attribLocations: {
            vertexPosition: gl.getAttribLocation(program, "aVertexPosition"),
            vertexColor: gl.getAttribLocation(program, "aVertexColor"),
        },
        uniformLocations: {
            projectionMatrix: gl.getUniformLocation(program, "uProjectionMatrix"),
            modelViewMatrix: gl.getUniformLocation(program, "uModelViewMatrix"),
        },
    };
}

// The shader program is identical for every shape, so compile and link it once
// per WebGL context and share it. Keyed by context so multiple canvases stay
// independent.
const programCache = new WeakMap();

// Used when draw() is called without a camera: pan 0, zoom 1 (world == screen).
const IDENTITY_CAMERA = { x: 0, y: 0, zoom: 1 };

function getProgramInfo(gl) {
    let info = programCache.get(gl);
    if (!info) {
        info = buildProgramInfo(gl);
        programCache.set(gl, info);
    }
    return info;
}

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
        this.programInfo = getProgramInfo(this.context);
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

        const { attribLocations, uniformLocations, program } = this.programInfo;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.vertexAttribPointer(attribLocations.vertexPosition, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(attribLocations.vertexPosition);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
        gl.vertexAttribPointer(attribLocations.vertexColor, 4, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(attribLocations.vertexColor);

        gl.useProgram(program);
        gl.uniformMatrix4fv(uniformLocations.projectionMatrix, false, projectionMatrix);
        gl.uniformMatrix4fv(uniformLocations.modelViewMatrix, false, modelViewMatrix);

        gl.drawArrays(this.drawMode, 0, this.vCount);
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
}
