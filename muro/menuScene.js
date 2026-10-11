// El Muro — the menu.
//
// It declares no assets, so it is on screen the instant the page opens; the
// match's sounds are built and decoded on the way *in* to the match, while the
// player is still reading this. The backdrop is a wall of plain rectangles for
// the same reason — it cannot wait for anything to load.

import Scene from "../components/scenes/scene.js";
import { el, button } from "../components/ui/index.js";
import { Rectangle } from "../components/shapes/index.js";
import { FIELD, COLS, BRICK, BRICK_COLORS, brickPosition, generateLevel } from "./level.js";

export const MENU_STYLES = `
    .menu, .end {
        position: absolute; inset: 0; z-index: 3;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 6px; text-align: center; padding: 24px;
        background: radial-gradient(120% 90% at 50% 35%, rgba(22, 30, 58, .25) 0%, rgba(6, 9, 18, .82) 70%);
    }
    .menu h1, .end h1 {
        font-size: clamp(32px, 7vw, 58px); margin: 0; font-weight: 800; letter-spacing: -.02em;
        color: #eaf0ff; text-shadow: 0 4px 0 rgba(0, 0, 0, .5);
    }
    .menu .sub, .end .sub { color: #9aa6c0; font-size: 14px; margin: 4px 0 20px; max-width: 36ch; line-height: 1.5; }
    .menu .actions, .end .actions { display: flex; flex-direction: column; gap: 10px; width: min(260px, 72%); }
    .menu button, .end button { padding: 12px 14px; font-size: 15px; font-weight: 600; }
    .menu button.play, .end button.again { background: #2f5aa8; border-color: #4a7fd4; }
    .menu button.play:hover, .end button.again:hover { background: #3a6cc4; }
    .menu .keys { margin-top: 18px; font-size: 12px; color: #7f8aa6; line-height: 1.9; }
    .menu .keys kbd {
        background: #1d2436; border: 1px solid #39425c; border-bottom-width: 2px;
        border-radius: 4px; padding: 1px 6px; font-family: inherit; font-size: 11px; color: #cfd8f0;
    }
    .menu .best { margin-top: 14px; font-size: 13px; color: #e8c24a; font-weight: 600; }
`;

export default class MenuScene extends Scene {
    constructor() {
        super("menu");
    }

    enter(data = {}) {
        this.camera.zoom = 1;
        this.camera.centerOn(0, 0);
        this._backdrop();
        this._screen(data.best);
        this.onKey(["Enter", " ", "Space"], () => this.play());
    }

    // Level one's wall, drifting, as the thing behind the title. It is the real
    // generator rather than a decoration, so the menu is never out of date with
    // the game.
    _backdrop() {
        const grid = generateLevel(1);
        this.drifting = [];

        for (let row = 0; row < grid.length; row++) {
            for (let col = 0; col < COLS; col++) {
                if (grid[row][col] === 0) continue;
                const { x, y } = brickPosition(row, col);
                const shape = this.add(new Rectangle(this.gl, { width: BRICK.width, height: BRICK.height })
                    .setColor(BRICK_COLORS[grid[row][col]])
                    .setPosition({ x, y: y - 0.6 })
                    .init());
                // A whole column drifts together, and by less than half the gap
                // between rows. Drifting each brick on its own phase was the
                // first try and it looked like a bug: neighbouring rows closed
                // the gap and merged into blocks of random height.
                this.drifting.push({ shape, baseY: y - 0.6, phase: col * 0.55 });
            }
        }

        this.add(new Rectangle(this.gl, { width: FIELD.halfW * 2, height: 0.14 })
            .setColor({ red: 0.82, green: 0.86, blue: 0.95 })
            .setPosition({ x: 0, y: -1.9 })
            .init())
            .setScale({ x: 0.14, y: 1 });
    }

    _screen(best) {
        const play = button("Jugar", () => this.play(), { className: "play" });
        this.overlay(el("div", { className: "menu" }, [
            el("h1", { textContent: "El Muro" }),
            el("p", {
                className: "sub",
                textContent: "Tirá el muro sin que se te caiga la bola. Dónde pega en la pala decide hacia dónde sale.",
            }),
            el("div", { className: "actions" }, [play]),
            best ? el("div", { className: "best", textContent: `Tu mejor marca: ${best} puntos` }) : el("span"),
            el("div", { className: "keys" }, [
                el("div", {}, [
                    document.createTextNode("Mové con el ratón, o "),
                    el("kbd", { textContent: "A" }), document.createTextNode(" "),
                    el("kbd", { textContent: "D" }),
                ]),
                el("div", {}, [
                    el("kbd", { textContent: "Espacio" }), document.createTextNode(" lanza · "),
                    el("kbd", { textContent: "P" }), document.createTextNode(" pausa · "),
                    el("kbd", { textContent: "M" }), document.createTextNode(" silencio · "),
                    el("kbd", { textContent: "F" }), document.createTextNode(" pantalla completa"),
                ]),
            ]),
        ]));
    }

    play() {
        this.go("juego", { level: 1, score: 0 });
    }

    update(dt) {
        this.elapsed = (this.elapsed || 0) + dt;
        for (const brick of this.drifting) {
            brick.shape.setPosition({ y: brick.baseY + Math.sin(this.elapsed * 0.9 + brick.phase) * 0.03 });
        }
    }
}
