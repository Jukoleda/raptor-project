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

export const PROGRAM_COLOR = "color";
export const PROGRAM_TEXTURE = "texture";

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

export function getProgramInfo(gl, kind = PROGRAM_COLOR) {
    let byKind = cache.get(gl);
    if (!byKind) { byKind = new Map(); cache.set(gl, byKind); }
    if (!byKind.has(kind)) byKind.set(kind, build(gl, kind));
    return byKind.get(kind);
}
