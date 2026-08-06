// The 3D shader programs.
//
// Two, and the difference matters more than it sounds: **without shading, 3D
// looks like 2D**. A sphere lit by nothing is a flat circle; a cube is a
// hexagon. What tells you a shape has volume is that its faces catch the light
// differently, so the lit program is the default and the unlit one is only for
// things that should not pretend to be solid — helper lines, a sky dome.
//
// Lighting is computed per fragment rather than per vertex. On a cube it makes
// no difference, but on a sphere with few segments, per-vertex shading shows
// the triangles as bands; per-fragment does not, and this is a framework where
// low-poly spheres are the norm.
//
// The model is deliberately simple: one directional light, plus ambient, plus a
// touch of hemisphere tint so faces pointing away from the light are coloured
// by the "sky" instead of going flat black. That last part is what stops the
// unlit side of everything from looking like a hole.

const LIT_VS = `
    attribute vec4 aVertexPosition;
    attribute vec3 aVertexNormal;

    uniform mat4 uModelViewMatrix;
    uniform mat4 uProjectionMatrix;
    uniform mat3 uNormalMatrix;

    varying highp vec3 vNormal;
    varying highp vec3 vViewPosition;

    void main() {
        vec4 viewPosition = uModelViewMatrix * aVertexPosition;
        gl_Position = uProjectionMatrix * viewPosition;
        // Normals need the inverse-transpose, not the model-view: a non-uniform
        // scale would otherwise tilt them and the lighting would slide off the
        // geometry.
        vNormal = normalize(uNormalMatrix * aVertexNormal);
        vViewPosition = viewPosition.xyz;
    }
`;

const LIT_FS = `
    precision mediump float;

    varying highp vec3 vNormal;
    varying highp vec3 vViewPosition;

    uniform vec4 uColor;
    uniform vec3 uLightDirection;   // hacia la luz, en espacio de vista
    uniform vec3 uLightColor;
    uniform vec3 uAmbientColor;
    uniform vec3 uSkyColor;
    uniform float uShininess;       // 0 = mate

    void main() {
        vec3 normal = normalize(vNormal);
        vec3 toLight = normalize(uLightDirection);

        float lambert = max(dot(normal, toLight), 0.0);

        // Hemisphere ambient: the side facing up picks up the sky colour, the
        // side facing down stays with the ambient. Cheap, and it keeps the
        // shadowed half readable instead of black.
        float upness = normal.y * 0.5 + 0.5;
        vec3 ambient = mix(uAmbientColor, uSkyColor, upness);

        vec3 lit = uColor.rgb * (ambient + uLightColor * lambert);

        if (uShininess > 0.0) {
            vec3 toEye = normalize(-vViewPosition);
            vec3 halfway = normalize(toLight + toEye);
            float specular = pow(max(dot(normal, halfway), 0.0), uShininess);
            lit += uLightColor * specular * 0.35;
        }

        gl_FragColor = vec4(lit, uColor.a);
    }
`;

// The lit shader again, with a texture multiplied in. Kept as a separate
// program rather than a branch on a uniform: a shader that samples a texture it
// was told to ignore still pays for the sample on some hardware.
const TEXTURED_VS = `
    attribute vec4 aVertexPosition;
    attribute vec3 aVertexNormal;
    attribute vec2 aTextureCoord;

    uniform mat4 uModelViewMatrix;
    uniform mat4 uProjectionMatrix;
    uniform mat3 uNormalMatrix;

    varying highp vec3 vNormal;
    varying highp vec2 vTextureCoord;

    void main() {
        vec4 viewPosition = uModelViewMatrix * aVertexPosition;
        gl_Position = uProjectionMatrix * viewPosition;
        vNormal = normalize(uNormalMatrix * aVertexNormal);
        vTextureCoord = aTextureCoord;
    }
`;

const TEXTURED_FS = `
    precision mediump float;

    varying highp vec3 vNormal;
    varying highp vec2 vTextureCoord;

    uniform sampler2D uSampler;
    uniform vec4 uColor;
    uniform vec3 uLightDirection;
    uniform vec3 uLightColor;
    uniform vec3 uAmbientColor;
    uniform vec3 uSkyColor;
    uniform vec2 uTextureRepeat;

    void main() {
        vec4 texel = texture2D(uSampler, vTextureCoord * uTextureRepeat);
        if (texel.a < 0.01) discard;

        // gl_FrontFacing tells us we are looking at the back of a sheet; the
        // normal is then pointing away, and using it as-is would paint the back
        // of every billboard black.
        vec3 normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        float lambert = max(dot(normal, normalize(uLightDirection)), 0.0);
        float upness = normal.y * 0.5 + 0.5;
        vec3 ambient = mix(uAmbientColor, uSkyColor, upness);

        gl_FragColor = vec4(texel.rgb * uColor.rgb * (ambient + uLightColor * lambert), texel.a * uColor.a);
    }
`;

const FLAT_VS = `
    attribute vec4 aVertexPosition;

    uniform mat4 uModelViewMatrix;
    uniform mat4 uProjectionMatrix;

    void main() {
        gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
    }
`;

const FLAT_FS = `
    precision mediump float;
    uniform vec4 uColor;

    void main() {
        gl_FragColor = uColor;
    }
`;

export const PROGRAM_LIT = "lit3d";
export const PROGRAM_FLAT = "flat3d";
export const PROGRAM_TEXTURED = "textured3d";

const PROGRAMS_3D = {
    [PROGRAM_LIT]: {
        vertex: LIT_VS,
        fragment: LIT_FS,
        attributes: { vertexPosition: "aVertexPosition", vertexNormal: "aVertexNormal" },
        uniforms: {
            projectionMatrix: "uProjectionMatrix", modelViewMatrix: "uModelViewMatrix",
            normalMatrix: "uNormalMatrix", color: "uColor",
            lightDirection: "uLightDirection", lightColor: "uLightColor",
            ambientColor: "uAmbientColor", skyColor: "uSkyColor", shininess: "uShininess",
        },
    },
    [PROGRAM_TEXTURED]: {
        vertex: TEXTURED_VS,
        fragment: TEXTURED_FS,
        attributes: {
            vertexPosition: "aVertexPosition", vertexNormal: "aVertexNormal",
            textureCoord: "aTextureCoord",
        },
        uniforms: {
            projectionMatrix: "uProjectionMatrix", modelViewMatrix: "uModelViewMatrix",
            normalMatrix: "uNormalMatrix", color: "uColor", sampler: "uSampler",
            lightDirection: "uLightDirection", lightColor: "uLightColor",
            ambientColor: "uAmbientColor", skyColor: "uSkyColor", textureRepeat: "uTextureRepeat",
        },
    },
    [PROGRAM_FLAT]: {
        vertex: FLAT_VS,
        fragment: FLAT_FS,
        attributes: { vertexPosition: "aVertexPosition" },
        uniforms: {
            projectionMatrix: "uProjectionMatrix", modelViewMatrix: "uModelViewMatrix",
            color: "uColor",
        },
    },
};

function compile3D(gl, type, source, kind) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Raptor 3D: no compila el shader "${kind}": ${log}`);
    }
    return shader;
}

function build3D(gl, kind) {
    const spec = PROGRAMS_3D[kind];
    if (!spec) throw new Error(`Raptor 3D: programa desconocido "${kind}"`);

    const program = gl.createProgram();
    gl.attachShader(program, compile3D(gl, gl.VERTEX_SHADER, spec.vertex, kind));
    gl.attachShader(program, compile3D(gl, gl.FRAGMENT_SHADER, spec.fragment, kind));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`Raptor 3D: no enlaza "${kind}": ${gl.getProgramInfoLog(program)}`);
    }

    const attribLocations = {};
    for (const [name, glsl] of Object.entries(spec.attributes)) {
        attribLocations[name] = gl.getAttribLocation(program, glsl);
    }
    const uniformLocations = {};
    for (const [name, glsl] of Object.entries(spec.uniforms)) {
        uniformLocations[name] = gl.getUniformLocation(program, glsl);
    }
    return { kind, program, attribLocations, uniformLocations };
}

const cache3D = new WeakMap();

export function getProgram3D(gl, kind = PROGRAM_LIT) {
    let byKind = cache3D.get(gl);
    if (!byKind) { byKind = new Map(); cache3D.set(gl, byKind); }
    if (!byKind.has(kind)) byKind.set(kind, build3D(gl, kind));
    return byKind.get(kind);
}
