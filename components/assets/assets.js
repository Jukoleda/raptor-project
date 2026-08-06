// The asset loader: declare what a game needs, load it, then start.
//
// Without one, a game either reaches for an image that has not arrived yet, or
// every call site grows its own `await`. The pattern that works is boring and
// old: declare a manifest, load it with a progress bar, and only then run the
// game — by which point `assets.get("heroe")` is a plain synchronous lookup.
//
//     assets.texture("heroe", "heroe.png");
//     assets.json("nivel", "nivel1.json");
//     assets.sound("salto", "salto.wav");
//     await assets.load({ onProgress: (p) => barra(p.ratio) });
//
//     assets.texture("heroe");   // ya cargada, sin await
//
// The same method declares and reads: with a URL it enqueues, without one it
// looks up. That is deliberate — it keeps the two halves of an asset's life
// spelled the same way.
//
// What it gets right, because these are the ways a loader actually hurts:
//
// - **A failed asset does not hang the game.** Every kind has an error path and
//   a timeout, so a typo'd filename is a message, not a spinner forever.
// - **The same URL loads once.** Two names can point at one file and it is
//   fetched, decoded and uploaded a single time.
// - **Progress is honest.** For images and audio the browser gives no reliable
//   byte count, so progress is counted in *assets*, not bytes, and says so.
// - **Concurrency is capped.** Firing four hundred requests at once is slower
//   than eight at a time, not faster.
// - **Loading twice is safe.** `load()` resolves immediately if nothing is
//   pending, so calling it after adding one more asset does the right thing.

import Texture from "../render/texture.js";

export const ASSET_KIND = {
    TEXTURE: "texture",
    IMAGE: "image",
    JSON: "json",
    TEXT: "text",
    SOUND: "sound",
    FONT: "font",
};

const DEFAULT_TIMEOUT = 20000;

// Rejects if the underlying load has not settled in time. Without this a
// request that never answers leaves the loading screen up forever, which reads
// to a player as "the game is broken" with nothing to go on.
function withTimeout(promise, ms, what) {
    if (!ms) return promise;
    let timer;
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`agotó el tiempo tras ${ms} ms`)), ms);
        }),
    ]).finally(() => clearTimeout(timer));
}

export default class Assets {
    constructor({ gl = null, basePath = "", timeout = DEFAULT_TIMEOUT, concurrency = 8 } = {}) {
        this.gl = gl;
        this.basePath = basePath;
        this.timeout = timeout;
        this.concurrency = concurrency;

        this.entries = new Map();  // key -> { key, kind, url, options, status, value, error, ms }
        this._byUrl = new Map();   // url -> promise, so one file loads once
        this._audioContext = null;
    }

    // The context sounds were decoded into. Playing needs a user gesture;
    // decoding did not, which is why this exists before anyone has clicked.
    get audioContext() {
        return this._audioContext;
    }

    get pending() {
        return [...this.entries.values()].filter((e) => e.status === "pending").length;
    }

    get failed() {
        return [...this.entries.values()].filter((e) => e.status === "error");
    }

    // Everything declared so far, for a progress table or a debug panel.
    get manifest() {
        return [...this.entries.values()].map(({ key, kind, url, status, error, ms }) =>
            ({ key, kind, url, status, error: error?.message ?? null, ms }));
    }

    // --- Declaring and reading -------------------------------------------

    _declare(kind, key, url, options) {
        if (this.entries.has(key)) {
            const existing = this.entries.get(key);
            // Re-declaring the same thing is a no-op; re-declaring a *different*
            // URL under a live key is a mistake worth naming.
            if (existing.url !== this._resolve(url)) {
                throw new Error(`Raptor: el asset "${key}" ya está declarado como ${existing.url}`);
            }
            return existing;
        }
        const entry = {
            key, kind, url: this._resolve(url), options: options || {},
            status: "pending", value: null, error: null, ms: 0,
        };
        this.entries.set(key, entry);
        return entry;
    }

    _resolve(url) {
        // A data: URI is already absolute, and so is anything with a scheme.
        if (!this.basePath || /^([a-z]+:|\/)/i.test(url)) return url;
        return this.basePath.replace(/\/$/, "") + "/" + url.replace(/^\//, "");
    }

    _read(key, kind) {
        const entry = this.entries.get(key);
        if (!entry) throw new Error(`Raptor: no hay ningún asset llamado "${key}"`);
        if (entry.status === "pending") {
            throw new Error(`Raptor: el asset "${key}" todavía no se ha cargado — falta un await assets.load()`);
        }
        if (entry.status === "error") throw entry.error;
        if (kind && entry.kind !== kind) {
            throw new Error(`Raptor: "${key}" es ${entry.kind}, no ${kind}`);
        }
        return entry.value;
    }

    // With a URL these declare; without one they read. Same name, both halves.
    texture(key, url = null, options) { return url === null ? this._read(key, ASSET_KIND.TEXTURE) : this._declare(ASSET_KIND.TEXTURE, key, url, options) && this; }
    image(key, url = null, options) { return url === null ? this._read(key, ASSET_KIND.IMAGE) : this._declare(ASSET_KIND.IMAGE, key, url, options) && this; }
    json(key, url = null, options) { return url === null ? this._read(key, ASSET_KIND.JSON) : this._declare(ASSET_KIND.JSON, key, url, options) && this; }
    text(key, url = null, options) { return url === null ? this._read(key, ASSET_KIND.TEXT) : this._declare(ASSET_KIND.TEXT, key, url, options) && this; }
    sound(key, url = null, options) { return url === null ? this._read(key, ASSET_KIND.SOUND) : this._declare(ASSET_KIND.SOUND, key, url, options) && this; }
    font(key, url = null, options) { return url === null ? this._read(key, ASSET_KIND.FONT) : this._declare(ASSET_KIND.FONT, key, url, options) && this; }

    // Untyped read, when the caller knows what it asked for.
    get(key) { return this._read(key); }
    has(key) { return this.entries.has(key) && this.entries.get(key).status === "ready"; }
    status(key) { return this.entries.get(key)?.status ?? null; }

    // Registers something already in hand — a canvas you drew, a texture you
    // built — so generated and loaded assets are reached the same way. A
    // registry is useful even for things that never travelled over a network.
    put(key, value, kind = "custom") {
        this.entries.set(key, { key, kind, url: null, options: {}, status: "ready", value, error: null, ms: 0 });
        return this;
    }

    // Declares a whole manifest at once:
    //   assets.manifest({ texture: { heroe: "heroe.png" }, json: { nivel: "n1.json" } })
    add(manifest) {
        for (const [kind, group] of Object.entries(manifest)) {
            if (typeof this[kind] !== "function") throw new Error(`Raptor: tipo de asset desconocido "${kind}"`);
            for (const [key, url] of Object.entries(group)) {
                Array.isArray(url) ? this[kind](key, url[0], url[1]) : this[kind](key, url);
            }
        }
        return this;
    }

    // --- Loading -----------------------------------------------------------

    // `onProgress` receives { loaded, total, ratio, key, entry } after each one.
    // `tolerant` keeps going and reports failures in `assets.failed` instead of
    // rejecting — for assets a game can live without (a decorative sound).
    async load({ onProgress = null, tolerant = false } = {}) {
        const queue = [...this.entries.values()].filter((e) => e.status === "pending");
        const total = queue.length;
        if (total === 0) return this;

        let loaded = 0;
        const report = (entry) => {
            loaded++;
            if (onProgress) onProgress({ loaded, total, ratio: loaded / total, key: entry.key, entry });
        };

        // A fixed pool of workers pulling from one queue: simpler than batching,
        // and it keeps exactly `concurrency` requests in flight the whole time
        // instead of stalling at the end of each batch.
        let next = 0;
        const worker = async () => {
            while (next < queue.length) {
                const entry = queue[next++];
                const started = (typeof performance !== "undefined" ? performance : Date).now();
                try {
                    entry.status = "loading";
                    entry.value = await this._loadOne(entry);
                    entry.status = "ready";
                } catch (error) {
                    entry.status = "error";
                    entry.error = error instanceof Error ? error : new Error(String(error));
                }
                entry.ms = Math.round((typeof performance !== "undefined" ? performance : Date).now() - started);
                report(entry);
            }
        };
        await Promise.all(Array.from({ length: Math.min(this.concurrency, total) }, worker));

        const failed = this.failed;
        if (failed.length && !tolerant) {
            throw new Error(
                `Raptor: fallaron ${failed.length} de ${total} assets:\n  ` +
                failed.map((e) => `${e.key} (${e.url}): ${e.error.message}`).join("\n  "),
            );
        }
        return this;
    }

    _loadOne(entry) {
        // One promise per URL: two keys pointing at the same file share the
        // fetch, the decode and — for a texture — the GPU upload.
        const cacheKey = `${entry.kind}:${entry.url}`;
        if (!this._byUrl.has(cacheKey)) {
            this._byUrl.set(cacheKey, withTimeout(this._fetchByKind(entry), entry.options.timeout ?? this.timeout, entry.url));
        }
        return this._byUrl.get(cacheKey);
    }

    _fetchByKind(entry) {
        switch (entry.kind) {
            case ASSET_KIND.TEXTURE: return this._loadTexture(entry);
            case ASSET_KIND.IMAGE: return this._loadImage(entry.url);
            case ASSET_KIND.JSON: return this._loadFetch(entry.url, "json");
            case ASSET_KIND.TEXT: return this._loadFetch(entry.url, "text");
            case ASSET_KIND.SOUND: return this._loadSound(entry);
            case ASSET_KIND.FONT: return this._loadFont(entry);
            default: throw new Error(`Raptor: tipo de asset desconocido "${entry.kind}"`);
        }
    }

    async _loadTexture(entry) {
        if (!this.gl) throw new Error("Raptor: para cargar texturas hace falta un contexto WebGL (new Assets({ gl }))");
        const image = await this._loadImage(entry.url);
        const texture = new Texture(this.gl, { label: entry.url, ...entry.options });
        texture.setSource(image);
        return texture;
    }

    _loadImage(url) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            if (/^https?:/i.test(url) && !url.startsWith(location.origin)) image.crossOrigin = "anonymous";
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error("no se pudo cargar la imagen"));
            image.src = url;
        });
    }

    async _loadFetch(url, as) {
        // A network-level failure throws a bare "Failed to fetch" with no clue
        // which URL it was, so it gets named here.
        let response;
        try {
            response = await fetch(url);
        } catch (cause) {
            throw new Error(`no se pudo alcanzar el recurso (${cause.message})`);
        }
        // fetch only rejects on network failure: a 404 arrives as a perfectly
        // successful response, which is how missing files quietly become
        // "undefined is not an object" three frames later.
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return as === "json" ? response.json() : response.text();
    }

    // Decoded into an AudioBuffer, ready for a source node. Decoding is allowed
    // before any user gesture — only *playing* needs one — so the context is
    // created here and left suspended.
    async _loadSound(entry) {
        const AudioCtx = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
        if (!AudioCtx) throw new Error("este navegador no trae Web Audio");
        if (!this._audioContext) this._audioContext = entry.options.context || new AudioCtx();
        const response = await fetch(entry.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        // The callback form is the one old Safari understands; the promise form
        // is not universal even now.
        return new Promise((resolve, reject) => {
            this._audioContext.decodeAudioData(bytes, resolve, () => reject(new Error("no se pudo decodificar el audio")));
        });
    }

    async _loadFont(entry) {
        if (typeof FontFace === "undefined") throw new Error("este navegador no trae FontFace");
        const face = new FontFace(entry.options.family || entry.key, `url(${entry.url})`, entry.options.descriptors);
        await face.load();
        document.fonts.add(face);
        return face;
    }

    // Frees the GPU side of every texture. The registry stays, so a scene can
    // be torn down and rebuilt without leaking.
    dispose() {
        for (const entry of this.entries.values()) {
            if (entry.kind === ASSET_KIND.TEXTURE && entry.value) entry.value.dispose();
        }
        this.entries.clear();
        this._byUrl.clear();
        return this;
    }
}

