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

import Shape from "./shape.js";
import { PROGRAM_TEXTURE } from "../render/shaders.js";

export default class Sprite extends Shape {
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
