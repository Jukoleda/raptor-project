// A drawable solid: geometry on the GPU, a transform, a colour and a material.
//
// `Mesh` is to 3D what `Shape` is to 2D, and it is deliberately the same shape
// of object — `position`, `rotation`, `scale`, `setColor`, `draw(camera)`, a
// `cullRadius` — so the engine draws either without knowing which it has, and a
// scene can mix them.
//
// The differences are the ones the extra dimension forces:
//
// - **Rotation is three numbers, not one.** Applied Y then X then Z, which is
//   the order that makes "turn, then look up, then roll" behave the way people
//   expect when they type it.
// - **Indexed drawing.** A cube's corners are shared between triangles, so the
//   geometry ships an index buffer and draws with `drawElements`.
// - **A normal matrix.** Normals cannot ride the model-view matrix: under a
//   non-uniform scale they come out tilted and the lighting slides off the
//   surface. The inverse-transpose of the upper 3×3 fixes it.

import { getProgram3D, PROGRAM_LIT, PROGRAM_FLAT, PROGRAM_TEXTURED } from "./shaders3d.js";
import { DEG_TO_RAD } from "../math/angles.js";

// The default light, in world space. Scenes override it through `Mesh.light`.
export const DEFAULT_LIGHT = {
    direction: { x: 0.45, y: 0.8, z: 0.35 },   // hacia la luz
    color: { red: 1, green: 0.97, blue: 0.9 },
    ambient: { red: 0.22, green: 0.23, blue: 0.26 },
    sky: { red: 0.38, green: 0.44, blue: 0.52 },
};

export default class Mesh {
    constructor(context, geometry = null, { lit = true, texture = null, textureRepeat = { x: 1, y: 1 } } = {}) {
        this.context = context;
        this.geometry = geometry;

        this.position = { x: 0, y: 0, z: 0 };
        this.rotation = { x: 0, y: 0, z: 0 };   // grados
        this.scale = { x: 1, y: 1, z: 1 };
        this.color = { red: 0.8, green: 0.8, blue: 0.85, alpha: 1 };
        this.shininess = 0;
        this.visible = true;

        // Backface culling assumes a mesh is a closed solid with an inside
        // nobody sees. A billboard, a leaf card or a flag is a *sheet*: it has
        // two outsides, and culling makes it vanish from one of them.
        this.doubleSided = false;
        this.layer = 0;

        this.texture = texture;
        this.textureRepeat = textureRepeat;
        this.program = texture ? PROGRAM_TEXTURED : (lit ? PROGRAM_LIT : PROGRAM_FLAT);
        this.light = DEFAULT_LIGHT;

        this.programInfo = null;
        this.buffers = null;
        this.indexCount = 0;
        this._localRadius = null;

        const { mat4, mat3, vec3 } = glMatrix;
        this._model = mat4.create();
        this._modelView = mat4.create();
        this._normalMatrix = mat3.create();
        this._viewRotation = mat3.create();
        this._lightView = vec3.create();
    }

    // Same contract as Shape: a radius that is guaranteed to contain the mesh,
    // so the engine can skip it when it cannot be on screen.
    get cullRadius() {
        if (this._localRadius === null) return null;
        return this._localRadius * Math.max(
            Math.abs(this.scale.x), Math.abs(this.scale.y), Math.abs(this.scale.z),
        );
    }

    init() {
        const gl = this.context;
        if (!this.geometry) throw new Error("Raptor 3D: un Mesh necesita geometría");
        this.programInfo = getProgram3D(gl, this.program);

        const { positions, normals, uvs, indices } = this.geometry;

        let furthest = 0;
        for (let i = 0; i < positions.length; i += 3) {
            const d = positions[i] ** 2 + positions[i + 1] ** 2 + positions[i + 2] ** 2;
            if (d > furthest) furthest = d;
        }
        this._localRadius = Math.sqrt(furthest);

        const position = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, position);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

        let uv = null;
        if (uvs && this.program === PROGRAM_TEXTURED) {
            uv = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, uv);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
        }

        let normal = null;
        if (normals && this.program !== PROGRAM_FLAT) {
            normal = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, normal);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
        }

        const index = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
        // Unsigned short caps a mesh at 65 536 vertices. Past that you want
        // several meshes anyway, and the extension is not universal.
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
        this.indexCount = indices.length;

        this.buffers = { position, normal, uv, index };
        return this;
    }

    // World transform. Y first so `rotation.y` reads as "which way is it
    // facing", which is the one people set most.
    modelMatrix() {
        const { mat4 } = glMatrix;
        const m = this._model;
        mat4.identity(m);
        mat4.translate(m, m, [this.position.x, this.position.y, this.position.z]);
        if (this.rotation.y) mat4.rotateY(m, m, this.rotation.y * DEG_TO_RAD);
        if (this.rotation.x) mat4.rotateX(m, m, this.rotation.x * DEG_TO_RAD);
        if (this.rotation.z) mat4.rotateZ(m, m, this.rotation.z * DEG_TO_RAD);
        mat4.scale(m, m, [this.scale.x, this.scale.y, this.scale.z]);
        return m;
    }

    draw(camera) {
        if (!this.visible || !this.buffers) return;
        const gl = this.context;
        const { mat4, mat3, vec3 } = glMatrix;
        const { program, attribLocations, uniformLocations } = this.programInfo;

        mat4.multiply(this._modelView, camera.viewMatrix(), this.modelMatrix());

        gl.useProgram(program);
        gl.uniformMatrix4fv(uniformLocations.projectionMatrix, false, camera.projectionMatrix(gl.canvas));
        gl.uniformMatrix4fv(uniformLocations.modelViewMatrix, false, this._modelView);
        gl.uniform4f(uniformLocations.color, this.color.red, this.color.green, this.color.blue, this.color.alpha);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.vertexAttribPointer(attribLocations.vertexPosition, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(attribLocations.vertexPosition);
        const enabled = [attribLocations.vertexPosition];

        if (this.buffers.normal) {
            mat3.normalFromMat4(this._normalMatrix, this._modelView);
            gl.uniformMatrix3fv(uniformLocations.normalMatrix, false, this._normalMatrix);

            // The light is given in world space but the shader works in view
            // space, so it has to be rotated into it. Only *rotated*: a
            // direction has no position, so the view matrix's translation must
            // not touch it — which is why this goes through the upper-left 3×3
            // and not through `transformMat4`.
            const { direction, color, ambient, sky } = this.light;
            mat3.fromMat4(this._viewRotation, camera.viewMatrix());
            vec3.set(this._lightView, direction.x, direction.y, direction.z);
            vec3.transformMat3(this._lightView, this._lightView, this._viewRotation);
            vec3.normalize(this._lightView, this._lightView);
            gl.uniform3f(uniformLocations.lightDirection,
                this._lightView[0], this._lightView[1], this._lightView[2]);
            gl.uniform3f(uniformLocations.lightColor, color.red, color.green, color.blue);
            gl.uniform3f(uniformLocations.ambientColor, ambient.red, ambient.green, ambient.blue);
            gl.uniform3f(uniformLocations.skyColor, sky.red, sky.green, sky.blue);
            gl.uniform1f(uniformLocations.shininess, this.shininess);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.normal);
            gl.vertexAttribPointer(attribLocations.vertexNormal, 3, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(attribLocations.vertexNormal);
            enabled.push(attribLocations.vertexNormal);
        }

        if (this.buffers.uv && this.texture) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.uv);
            gl.vertexAttribPointer(attribLocations.textureCoord, 2, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(attribLocations.textureCoord);
            enabled.push(attribLocations.textureCoord);

            this.texture.bind(0);
            gl.uniform1i(uniformLocations.sampler, 0);
            gl.uniform2f(uniformLocations.textureRepeat, this.textureRepeat.x, this.textureRepeat.y);
        }

        // Lighting a sheet from behind would leave the back face black, so a
        // double-sided mesh flips its normal towards the viewer instead.
        const wasCulling = this.doubleSided && gl.isEnabled(gl.CULL_FACE);
        if (wasCulling) gl.disable(gl.CULL_FACE);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);
        gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);

        if (wasCulling) gl.enable(gl.CULL_FACE);
        for (const location of enabled) gl.disableVertexAttribArray(location);
    }

    // --- Fluent configuration --------------------------------------------

    setPosition({ x, y, z } = {}) {
        this.position = {
            x: x ?? this.position.x, y: y ?? this.position.y, z: z ?? this.position.z,
        };
        return this;
    }

    setRotation({ x, y, z } = {}) {
        this.rotation = {
            x: x ?? this.rotation.x, y: y ?? this.rotation.y, z: z ?? this.rotation.z,
        };
        return this;
    }

    setScale(scale) {
        const s = typeof scale === "number" ? { x: scale, y: scale, z: scale } : scale;
        this.scale = { x: s.x ?? 1, y: s.y ?? 1, z: s.z ?? 1 };
        return this;
    }

    setColor({ red, green, blue, alpha } = {}) {
        this.color = {
            red: red ?? 0, green: green ?? 0, blue: blue ?? 0, alpha: alpha ?? 1,
        };
        return this;
    }

    setShininess(value) {
        this.shininess = value;
        return this;
    }

    setTexture(texture, { repeat = this.textureRepeat } = {}) {
        this.texture = texture;
        this.textureRepeat = repeat;
        this.program = texture ? PROGRAM_TEXTURED : PROGRAM_LIT;
        if (this.buffers) { this.buffers = null; this.init(); }
        return this;
    }

    setLight(light) {
        this.light = { ...DEFAULT_LIGHT, ...light };
        return this;
    }

    // For sheets: visible from both sides, and lit from both.
    setDoubleSided(doubleSided) {
        this.doubleSided = doubleSided;
        return this;
    }

    setVisible(visible) {
        this.visible = visible;
        return this;
    }

    setLayer(layer) {
        if (layer !== this.layer) {
            this.layer = layer;
            if (this._onLayerChange) this._onLayerChange(this);
        }
        return this;
    }
}
