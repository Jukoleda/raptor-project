// El Bosque — a small complete game, and the point of the scene layer.
//
// Three scenes and a manager is the whole wiring. Each one builds itself when
// entered and takes itself apart when left, so the menu's drifting canopies are
// gone by the time the forest exists, and the forest's four hundred sprites are
// gone by the time the results are on screen.
//
// The interesting sequencing is in the loading: the menu declares nothing, so
// it appears the instant the page opens. The forest declares the sheet and the
// sounds in its `preload`, and they load on the way in — while the player is
// reading the menu, not before it.

import App from "../components/app.js";
import SceneManager from "../components/scenes/sceneManager.js";
import MenuScene, { MENU_STYLES } from "./menuScene.js";
import ForestScene, { GAME_STYLES } from "./forestScene.js";
import EndScene, { END_STYLES } from "./endScene.js";

App.boot({
    title: "El Bosque",
    styles: MENU_STYLES + GAME_STYLES + END_STYLES,
    panel: false,
}, (app) => {
    const scenes = new SceneManager(app, { fadeMs: 200 });
    scenes.add("menu", new MenuScene());
    scenes.add("juego", new ForestScene());
    scenes.add("fin", new EndScene());
    scenes.go("menu");

    // Debug handle for the console and the test suite.
    window.raptorBosque = {
        app, scenes,
        get scene() { return scenes.name; },
        get game() { return scenes.get("juego"); },
        get state() {
            const game = scenes.get("juego");
            return game && game.active
                ? { x: game.position.x, y: game.position.y, collected: game.collected,
                    target: game.target, timeLeft: game.timeLeft, paused: game.paused,
                    animation: game.animator.name, flipX: game.hero.flipX }
                : null;
        },
        go: (name, data) => scenes.go(name, data),
    };
});
