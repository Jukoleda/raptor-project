// The front door. `App` is what you reach for to build something with Raptor;
// everything else is a part you can also use on its own.
//
// It exists because four demos had each written the same forty lines: wait for
// the DOM, inject a stylesheet, build a #stage and a #panel, create the canvas
// and the GL context, wire a keyboard, register an update callback, start the
// loop. That is not scene code, it is framework code, so it lives here.
//
//     App.boot({ title: "Mi demo" }, (app) => {
//         app.add(new Rectangle(app.gl, { width: 2, height: 1 }).init());
//         app.onUpdate((dt) => { ... });
//     });
//
// `App.boot` waits for the document, builds the page and starts the loop, so a
// scene never writes that plumbing again.
//
// What it owns: the canvas and its size, the render loop, the camera, the
// entity list, the keyboard, the on-screen pad, the panel, fullscreen. What it
// does not own: your game. Everything is exposed (`app.engine`, `app.gl`,
// `app.stage`) so you can drop to the layer below whenever the shell is in the
// way.

import RaptorEngine from "./raptorEngine.js";
import { el, injectStyles, BASE_STYLES } from "./ui/dom.js";
import { FULLSCREEN_STYLES, toggleFullscreen, isFullscreen, onFullscreenChange } from "./ui/fullscreen.js";
import LoadingScreen, { LOADING_STYLES } from "./ui/loadingScreen.js";
import SceneManager, { SCENE_STYLES } from "./scenes/sceneManager.js";
import Keyboard from "./input/keyboard.js";
import TouchPad, { PAD_STYLES } from "./input/touchpad.js";
import Assets from "./assets/assets.js";

export default class App {
    constructor({
        mount = null,          // where the page goes; defaults to <body>
        width = 800,           // drawing-buffer size, in pixels
        height = 600,
        styles = "",           // scene CSS, appended after the framework's
        baseStyles = true,     // set false to style the page from scratch
        panel = true,          // build the side panel element
        keyboard = true,       // create and attach a Keyboard
        touch = true,          // create a TouchPad over the canvas
        autoResize = false,    // track the CSS box and resize the buffer to it
        assetPath = "",        // prefix for every relative asset URL
    } = {}) {
        injectStyles(
            (baseStyles ? BASE_STYLES + PAD_STYLES + FULLSCREEN_STYLES + LOADING_STYLES + SCENE_STYLES : "") + styles,
            "raptor-styles",
        );

        this.engine = new RaptorEngine();
        this.stage = el("div", { id: "stage" });
        this.panel = panel ? el("div", { id: "panel" }) : null;
        this.root = el("div", { id: "app" }, panel ? [this.stage, this.panel] : [this.stage]);
        (mount || document.body).append(this.root);

        this.engine.createWindow(this.stage, { width, height });
        this.keyboard = keyboard ? new Keyboard().attach(window) : null;
        this.touch = touch ? new TouchPad(this.stage, { keyboard: this.keyboard }) : null;
        // The registry exists from the start, so a scene can `put()` something
        // it generated even if it never loads a file.
        this.assets = new Assets({ gl: this.gl, basePath: assetPath });
        this.plugins = [];

        this._offFullscreen = onFullscreenChange((on) => this._emit("fullscreenchange", on));
        this._listeners = new Map();

        if (autoResize) this.watchResize();
    }

    // Waits for the document, builds the app and hands it to `setup`. `setup`
    // may return a cleanup function; it runs if the app is ever destroyed.
    //
    // The loop starts *after* setup returns, so a scene can add entities and
    // updaters without the first frame catching it half-built.
    // Waits for the document, builds the app, loads whatever `assets` declares
    // and then hands it all to `setup`. `setup` may return a cleanup function;
    // it runs if the app is ever destroyed.
    //
    // The loop starts *after* setup returns, so a scene can add entities and
    // updaters without the first frame catching it half-built — and after the
    // assets are in, so `assets.texture("x")` is a plain synchronous lookup
    // rather than something to await at every call site.
    //
    //     App.boot({
    //         assets: (a) => a.texture("heroe", "heroe.png"),
    //     }, (app) => {
    //         new Sprite(app.gl, { texture: app.assets.texture("heroe") }).init();
    //     });
    static boot(options, setup) {
        if (typeof options === "function") { setup = options; options = {}; }

        const run = async () => {
            const app = new App(options);
            if (options.title) app.title(options.title);

            if (options.assets) {
                // The screen goes up before anything is declared, so a slow
                // manifest never shows a bare canvas first.
                const screen = new LoadingScreen(app.stage, { title: options.loadingTitle || "Cargando…" });
                try {
                    await options.assets(app.assets, app);
                    await app.assets.load({
                        onProgress: (progress) => {
                            screen.update(progress);
                            app._emit("progress", progress);
                        },
                        tolerant: options.tolerantAssets === true,
                    });
                    screen.done();
                } catch (error) {
                    // Stop here and *say so*. Running the scene with half its
                    // assets missing turns one clear message into a pile of
                    // null-reference errors that hide the real cause.
                    screen.fail(error);
                    app._emit("assetserror", error);
                    throw error;
                }
            }

            app._cleanup = (setup ? setup(app) : null) || null;

            // Declaring scenes in the boot options is the shortest path from
            // "a page" to "a game with a menu".
            if (options.scenes) {
                for (const [name, scene] of Object.entries(options.scenes)) app.scenes.add(name, scene);
            }
            app.start();
            // After start(), so the first scene builds against a live loop.
            if (options.startScene) await app.scenes.go(options.startScene);
            return app;
        };

        if (document.readyState === "loading") {
            return new Promise((resolve, reject) => {
                document.addEventListener("DOMContentLoaded", () => run().then(resolve, reject));
            });
        }
        return run();
    }

    // --- The bits scenes reach for most ---------------------------------

    get gl() { return this.engine.context; }
    get canvas() { return this.engine.canvas; }
    get camera() { return this.engine.camera; }
    set camera(camera) { this.engine.camera = camera; }
    get entities() { return this.engine.entities; }
    get running() { return this.engine.running; }

    add(entity) { return this.engine.add(entity); }
    remove(entity) { this.engine.remove(entity); return this; }
    onUpdate(fn) { this.engine.addUpdater(fn); return fn; }
    removeUpdate(fn) { this.engine.removeUpdater(fn); return this; }

    // Created on first use, so pages that never use scenes pay nothing.
    get scenes() {
        if (!this._scenes) this._scenes = new SceneManager(this);
        return this._scenes;
    }

    start() { this.engine.start(); return this; }
    stop() { this.engine.stop(); return this; }
    // Pausing keeps the last frame on screen: the loop stops, nothing is
    // cleared. Resuming does not replay the elapsed time as one huge dt.
    pause() { this.engine.stop(); return this; }
    resume() { if (!this.engine.running) this.engine.start(); return this; }

    // Registers a plugin. Anything with `step(dt)` (a physics World, say) is
    // wired straight into the loop; anything with `install(app)` gets to set
    // itself up. That is the whole extension contract.
    use(plugin) {
        this.plugins.push(plugin);
        if (typeof plugin.install === "function") plugin.install(this);
        else if (typeof plugin.step === "function") this.onUpdate((dt) => plugin.step(dt));
        else if (typeof plugin.update === "function") this.onUpdate((dt) => plugin.update(dt));
        return plugin;
    }

    // --- Page furniture --------------------------------------------------

    title(text) {
        document.title = text;
        if (this.panel) this.panel.prepend(el("h1", { textContent: text }));
        return this;
    }

    // Appends cards (or any nodes) to the side panel.
    addPanel(...nodes) {
        if (this.panel) this.panel.append(...nodes.flat());
        return this;
    }

    // Anything absolutely positioned over the canvas: a HUD, a banner, a pad.
    addOverlay(...nodes) {
        this.stage.append(...nodes.flat());
        return this;
    }

    // --- Screen ----------------------------------------------------------

    toggleFullscreen() { return toggleFullscreen(this.root); }
    get isFullscreen() { return isFullscreen(this.root); }

    // Sets the drawing buffer size and the GL viewport together — forgetting
    // the viewport is the classic way to get a stretched or clipped scene.
    resize(width, height) {
        const canvas = this.canvas;
        if (!canvas) return this;
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        this.gl.viewport(0, 0, canvas.width, canvas.height);
        this._emit("resize", { width: canvas.width, height: canvas.height });
        return this;
    }

    // Keeps the drawing buffer matched to the canvas's CSS box, at device pixel
    // density so it is not blurry on a phone or in fullscreen. Off by default:
    // a fixed buffer is the simpler thing when a scene is sized by hand.
    watchResize({ maxPixelRatio = 2 } = {}) {
        const fit = () => {
            const canvas = this.canvas;
            if (!canvas) return;
            const ratio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
            const w = canvas.clientWidth * ratio;
            const h = canvas.clientHeight * ratio;
            if (w > 0 && h > 0 && (canvas.width !== Math.round(w) || canvas.height !== Math.round(h))) {
                this.resize(w, h);
            }
        };
        if (typeof ResizeObserver !== "undefined") {
            this._resizeObserver = new ResizeObserver(fit);
            this._resizeObserver.observe(this.canvas);
        } else {
            window.addEventListener("resize", fit);
        }
        fit();
        return this;
    }

    // --- Events ----------------------------------------------------------
    // "resize", "fullscreenchange", "progress" and "assetserror", so a scene
    // can react without hunting down the prefixed DOM events itself.

    on(event, handler) {
        const list = this._listeners.get(event) || [];
        list.push(handler);
        this._listeners.set(event, list);
        return this;
    }

    _emit(event, payload) {
        for (const handler of this._listeners.get(event) || []) handler(payload);
    }

    // Tears everything down: loop, listeners, DOM. Mostly for tests and for
    // pages that swap one scene for another.
    destroy() {
        this.stop();
        if (typeof this._cleanup === "function") this._cleanup();
        this._scenes?.destroy();
        this.keyboard?.detach();
        this.assets?.dispose();
        this._resizeObserver?.disconnect();
        this._offFullscreen?.();
        this.root.remove();
        return this;
    }
}
