// Holds the scenes and moves between them.
//
//     const scenes = new SceneManager(app);
//     scenes.add("menu", new Menu()).add("juego", new Bosque());
//     await scenes.go("menu");
//
// Three things it does that a bare `currentScene = next` does not:
//
// 1. **It loads on the way in.** A scene declares its assets in `preload()`,
//    and the first time you enter it, anything still pending is loaded behind a
//    loading screen. So a menu appears instantly and the level's art arrives
//    while the player is reading it, instead of everything waiting on everything.
//
// 2. **It fades.** A hard cut between two screens reads as a glitch. The fade is
//    a DOM overlay rather than something drawn in WebGL, so it also covers the
//    frames where the old scene is gone and the new one is not built yet.
//
// 3. **It cannot overlap with itself.** Two `go()` calls landing together — a
//    key and a click on the same button — would otherwise run two teardowns and
//    two builds interleaved. The second one waits.

import LoadingScreen from "../ui/loadingScreen.js";

export const SCENE_STYLES = `
    .scene-fade {
        position: absolute; inset: 0; z-index: 4; background: #0a0d12;
        opacity: 0; pointer-events: none; transition: opacity var(--scene-fade, .22s) ease;
    }
    .scene-fade.on { opacity: 1; }
`;

export default class SceneManager {
    constructor(app, { fadeMs = 220 } = {}) {
        this.app = app;
        this.scenes = new Map();
        this.current = null;
        this.fadeMs = fadeMs;
        this._busy = null;
        this._preloaded = new Set();

        this.fade = document.createElement("div");
        this.fade.className = "scene-fade";
        this.fade.style.setProperty("--scene-fade", `${fadeMs}ms`);
        app.stage.append(this.fade);
    }

    add(name, scene) {
        scene.name = scene.name === "escena" ? name : scene.name;
        this.scenes.set(name, scene);
        return this;
    }

    get(name) {
        return this.scenes.get(name) || null;
    }

    get name() {
        return this.current ? [...this.scenes].find(([, s]) => s === this.current)?.[0] ?? null : null;
    }

    // Switches scenes. Returns a promise that resolves once the new one is
    // built, so a test — or a cutscene — can wait for it.
    go(name, data) {
        // Serialised: a second call queues behind the first instead of
        // interleaving a teardown with a build.
        this._busy = (this._busy || Promise.resolve()).then(() => this._go(name, data));
        return this._busy;
    }

    async _go(name, data) {
        const next = this.scenes.get(name);
        if (!next) throw new Error(`Raptor: no hay ninguna escena llamada "${name}"`);

        if (this.current) await this._setFade(true);

        if (this.current) {
            this.current._exit();
            this.current = null;
        }

        // First entry: give the scene a chance to declare what it needs, and
        // load whatever is still pending.
        if (!this._preloaded.has(name)) {
            this._preloaded.add(name);
            next.app = this.app;
            next.manager = this;
            next.preload(this.app.assets);
            if (this.app.assets.pending > 0) {
                const screen = new LoadingScreen(this.app.stage, { title: `Cargando ${name}…` });
                try {
                    await this.app.assets.load({ onProgress: (p) => screen.update(p) });
                    screen.remove();
                } catch (error) {
                    screen.fail(error);
                    throw error;
                }
            }
        }

        this.current = next;
        next._enter(this.app, this, data);
        this.app._emit("scene", { name, scene: next, data });

        await this._setFade(false);
        return next;
    }

    _setFade(on) {
        this.fade.classList.toggle("on", on);
        // Waiting out the transition is what keeps the swap hidden; without it
        // the new scene pops in while the screen is still black.
        return new Promise((resolve) => setTimeout(resolve, this.fadeMs));
    }

    destroy() {
        if (this.current) this.current._exit();
        this.current = null;
        this.fade.remove();
        return this;
    }
}
