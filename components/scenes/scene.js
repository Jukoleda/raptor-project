// A scene: one self-contained screen of a game.
//
// Until now a Raptor page *was* a game — one setup function, one world, and no
// way to get from a menu to a match to a game-over. A Scene is that missing
// unit: it builds itself when entered and takes itself apart when left.
//
//     class Menu extends Scene {
//         enter() {
//             this.add(new Sprite(this.gl, { texture: this.assets.texture("logo") }).init());
//             this.onKey("Enter", () => this.go("juego"));
//         }
//     }
//
// The part that matters is the taking apart. Everything a scene creates has to
// be undone on the way out — entities, per-frame callbacks, key bindings, DOM
// overlays — and forgetting any one of them is a leak you notice three scene
// changes later, when the menu music is still playing over the boss fight and
// the old update loop is still moving a player who no longer exists.
//
// So a Scene does not let you register those things directly. `this.add`,
// `this.onUpdate`, `this.onKey` and `this.overlay` each record what they did,
// and leaving undoes all of it. If you reach past them to `app.onUpdate`, you
// own the cleanup — which is exactly the trade you should have to make on
// purpose rather than by accident.

export default class Scene {
    constructor(name = "escena") {
        this.name = name;
        this.app = null;        // set by the SceneManager on the way in
        this.manager = null;
        this.active = false;

        this._entities = [];
        this._updaters = [];
        this._keys = [];
        this._overlays = [];
        this._panels = [];
    }

    // --- Hooks a subclass overrides ---------------------------------------

    // Declare assets this scene needs. Called once, before the first enter, so
    // a menu can start instantly while the level's art loads on the way in.
    preload() {}

    // Build the scene. `data` is whatever the previous scene passed to `go()`.
    enter() {}

    // Per frame, in seconds. Registered and unregistered for you.
    update() {}

    // Extra teardown, for anything the recording helpers do not cover — a timer
    // you started, a sound you are playing.
    exit() {}

    // --- What a scene reaches for ------------------------------------------

    get gl() { return this.app.gl; }
    get assets() { return this.app.assets; }
    get camera() { return this.app.camera; }
    get keyboard() { return this.app.keyboard; }
    get touch() { return this.app.touch; }
    get stage() { return this.app.stage; }

    // Adds a drawable, and remembers to remove it.
    add(entity) {
        this._entities.push(entity);
        return this.app.add(entity);
    }

    remove(entity) {
        const index = this._entities.indexOf(entity);
        if (index !== -1) this._entities.splice(index, 1);
        this.app.remove(entity);
        return this;
    }

    // An extra per-frame callback, on top of `update()`.
    onUpdate(fn) {
        this._updaters.push(fn);
        this.app.onUpdate(fn);
        return fn;
    }

    // A one-shot key action, unbound when the scene leaves.
    onKey(keys, handler) {
        for (const key of [].concat(keys)) {
            this.keyboard.on(key, handler);
            this._keys.push([key, handler]);
        }
        return this;
    }

    // A DOM node over the canvas: a title screen, a HUD, a banner.
    overlay(node) {
        this._overlays.push(node);
        this.app.addOverlay(node);
        return node;
    }

    // A card in the side panel, if the page has one.
    panel(node) {
        this._panels.push(node);
        this.app.addPanel(node);
        return node;
    }

    // Leaves for another scene. `data` is handed to its `enter()`.
    go(name, data) {
        return this.manager.go(name, data);
    }

    // --- Lifecycle, driven by the manager ---------------------------------

    _enter(app, manager, data) {
        this.app = app;
        this.manager = manager;
        this.active = true;
        this._boundUpdate = (dt) => { if (this.active) this.update(dt); };
        this.app.onUpdate(this._boundUpdate);
        this._updaters.push(this._boundUpdate);
        this.enter(data);
        return this;
    }

    _exit() {
        this.active = false;
        // The subclass gets to run first, while its things still exist.
        this.exit();
        for (const entity of this._entities) this.app.remove(entity);
        for (const fn of this._updaters) this.app.removeUpdate(fn);
        for (const [key, handler] of this._keys) this.keyboard.off(key, handler);
        for (const node of this._overlays) node.remove();
        for (const node of this._panels) node.remove();
        this._entities = [];
        this._updaters = [];
        this._keys = [];
        this._overlays = [];
        this._panels = [];
        return this;
    }
}
