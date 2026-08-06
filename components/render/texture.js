// An image on the GPU.
//
// Three things about WebGL 1 textures trip everyone up, so they are handled
// here once instead of at every call site:
//
// 1. **Y is flipped.** An image's first row is its *top*; a GL texture's first
//    row is its *bottom*. Without UNPACK_FLIP_Y_WEBGL every sprite is upside
//    down, which people usually "fix" by flipping the UVs and then fight
//    forever. Flipped on upload, once.
//
// 2. **Non-power-of-two.** A texture whose sides are not powers of two cannot
//    have mipmaps and cannot REPEAT — it renders black if you ask for either.
//    Since real sprite sheets are rarely 512×512, the size is checked and the
//    parameters are chosen accordingly, rather than leaving a black rectangle
//    and no explanation.
//
// 3. **Loading takes time.** A texture cannot be used the frame you ask for it.
//    Every Texture is therefore usable *immediately*, backed by a 1×1 white
//    pixel, and swaps itself for the real image when it arrives. Nothing has to
//    wait, and nothing crashes in between.
//
// Sources: a URL, an <img>, a <canvas>, or raw pixels. The canvas one matters
// more than it looks — it is how the demos build sprite sheets *procedurally*,
// so the generated pages stay single files that open from file:// with no
// assets next to them, exactly like the synthesised engine sound.

function isPowerOfTwo(value) {
    return (value & (value - 1)) === 0 && value > 0;
}

export default class Texture {
    constructor(gl, { smooth = false, wrap = false, label = "" } = {}) {
        this.gl = gl;
        this.label = label;
        this.smooth = smooth;   // linear filtering; off by default for pixel art
        this.wrap = wrap;       // REPEAT; only possible on power-of-two sizes
        this.width = 1;
        this.height = 1;
        this.ready = false;

        this.handle = gl.createTexture();
        // A single white pixel, so the texture is drawable before its image
        // exists. White because sprites multiply by their tint: an unloaded
        // sprite shows as its tint colour rather than as a black hole.
        this._upload(new Uint8Array([255, 255, 255, 255]), 1, 1);
    }

    // --- Sources ---------------------------------------------------------

    // Kicks off the load and returns the Texture *now*; `texture.loaded` is the
    // promise for code that would rather wait.
    static fromImage(gl, url, options = {}) {
        const texture = new Texture(gl, { label: url, ...options });
        texture.loaded = new Promise((resolve, reject) => {
            const image = new Image();
            // Only set for cross-origin URLs: setting it for a same-origin or
            // data: URL makes some browsers refuse the load outright.
            if (/^https?:/i.test(url) && !url.startsWith(location.origin)) {
                image.crossOrigin = "anonymous";
            }
            image.onload = () => { texture.setSource(image); resolve(texture); };
            image.onerror = () => reject(new Error(`Raptor: no se pudo cargar la textura "${url}"`));
            image.src = url;
        });
        return texture;
    }

    static fromCanvas(gl, canvas, options = {}) {
        const texture = new Texture(gl, { label: "canvas", ...options });
        texture.setSource(canvas);
        texture.loaded = Promise.resolve(texture);
        return texture;
    }

    // Raw RGBA bytes, four per pixel, top row first.
    static fromPixels(gl, pixels, width, height, options = {}) {
        const texture = new Texture(gl, { label: "pixels", ...options });
        texture._upload(pixels instanceof Uint8Array ? pixels : new Uint8Array(pixels), width, height);
        texture.ready = true;
        texture.loaded = Promise.resolve(texture);
        return texture;
    }

    // A flat colour, handy as a placeholder or for solid overlays.
    static solid(gl, { red = 1, green = 1, blue = 1, alpha = 1 } = {}) {
        const byte = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255);
        return Texture.fromPixels(gl, new Uint8Array([byte(red), byte(green), byte(blue), byte(alpha)]), 1, 1);
    }

    // --- Upload ----------------------------------------------------------

    // Replaces the contents with an <img>, <canvas>, ImageBitmap or ImageData.
    setSource(source) {
        const gl = this.gl;
        this.width = source.width;
        this.height = source.height;

        gl.bindTexture(gl.TEXTURE_2D, this.handle);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        this._applyParameters();

        this.ready = true;
        if (this.onLoad) this.onLoad(this);
        return this;
    }

    _upload(pixels, width, height) {
        const gl = this.gl;
        this.width = width;
        this.height = height;
        gl.bindTexture(gl.TEXTURE_2D, this.handle);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        this._applyParameters();
        return this;
    }

    _applyParameters() {
        const gl = this.gl;
        const potential = isPowerOfTwo(this.width) && isPowerOfTwo(this.height);

        // Mipmaps and REPEAT need power-of-two sides. Asking for them anyway is
        // the classic "why is my sprite black" — so they are simply not asked
        // for unless the size allows it.
        if (potential && this.smooth) {
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        } else {
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.smooth ? gl.LINEAR : gl.NEAREST);
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.smooth ? gl.LINEAR : gl.NEAREST);

        const mode = this.wrap && potential ? gl.REPEAT : gl.CLAMP_TO_EDGE;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mode);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, mode);
    }

    // NEAREST keeps pixel art crisp; LINEAR smooths photos and big scales.
    setSmooth(smooth) {
        this.smooth = smooth;
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.handle);
        this._applyParameters();
        return this;
    }

    bind(unit = 0) {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, this.handle);
        return unit;
    }

    dispose() {
        if (this.handle) this.gl.deleteTexture(this.handle);
        this.handle = null;
        this.ready = false;
    }
}
