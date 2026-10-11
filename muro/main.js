// El Muro — a brick breaker built with Raptor.
//
// The second complete game in the repo, and deliberately a different shape from
// El Bosque: no sprite sheet, no scrolling camera, no tile map. What it leans on
// instead are the parts a top-down collect-the-acorns game never touches —
// `collide` against real outlines for the bouncing, `app.audio` for six sounds
// with varying pitch, and `camera.screenToWorld` for a paddle that follows the
// pointer.
//
// It is also the page that uses two things the framework had and nothing did:
// `app.watchResize()`, so the drawing buffer matches the CSS box at device
// pixel density instead of being a fixed 800×600 stretched by the browser, and
// `app.toggleFullscreen()`. The playfield is a fixed size in world units and
// the scene zooms the camera to fit whatever aspect the window turns out to
// have, so resizing changes how much you see around the field and never how
// much of the field you see.

import App from "../components/app.js";
import SceneManager from "../components/scenes/sceneManager.js";
import MenuScene, { MENU_STYLES } from "./menuScene.js";
import PlayScene, { GAME_STYLES } from "./playScene.js";
import EndScene, { END_STYLES } from "./endScene.js";

// Full-bleed, which the rest of the site is not: the demos sit in a card next
// to a panel, and a game wants the window. Note `#stage canvas` rather than
// plain `canvas` — the framework's own rule is `#stage canvas { height: auto }`,
// an id plus an element, and a bare `canvas` selector loses to it however late
// it is injected. That is how the canvas stayed a 4:3 letterbox in the top
// third of a phone screen while the overlays spread over the whole stage.
const PAGE_STYLES = `
    html, body { height: 100%; overflow: hidden; }
    #app { height: 100vh; padding: 0; gap: 0; align-items: stretch; flex-wrap: nowrap; }
    #stage { flex: 1; width: 100%; height: 100%; border-radius: 0; box-shadow: none; }
    #stage canvas { width: 100%; height: 100%; max-width: none; }
`;

App.boot({
    title: "El Muro",
    styles: PAGE_STYLES + MENU_STYLES + GAME_STYLES + END_STYLES,
    panel: false,
}, (app) => {
    // Track the CSS box at device pixel density, capped at 2× — past that you
    // are rendering four times the pixels for a difference nobody can see.
    app.watchResize({ maxPixelRatio: 2 });

    const scenes = new SceneManager(app, { fadeMs: 180 });
    scenes.add("menu", new MenuScene());
    scenes.add("juego", new PlayScene());
    scenes.add("fin", new EndScene());
    scenes.go("menu");

    // Debug handle for the console and the test suite.
    window.raptorMuro = {
        app, scenes,
        get scene() { return scenes.name; },
        get game() { return scenes.get("juego"); },
        get state() {
            const game = scenes.get("juego");
            if (!game || !game.active) return null;
            return {
                level: game.level, score: game.score, lives: game.lives,
                remaining: game.remaining, stuck: game.stuck, paused: game.paused,
                ball: { ...game.ball.position }, velocity: { ...game.velocity },
                paddle: game.paddle.position.x,
            };
        },
        go: (name, data) => scenes.go(name, data),
    };
});
