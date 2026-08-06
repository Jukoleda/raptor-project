// The main menu.
//
// It is a scene like any other: it builds a title over the canvas, listens for
// a couple of keys, and leaves. What makes it worth having as its own scene is
// that it appears **before the game's assets are loaded** — the loader only
// runs on the way into the forest, so the player is reading the menu while the
// art is arriving instead of watching a bar first.
//
// The background is drawn with plain coloured shapes for the same reason: it
// cannot depend on a texture that has not loaded yet.

import Scene from "../components/scenes/scene.js";
import { el, button } from "../components/ui/index.js";
import { Rectangle, Circle, Triangle } from "../components/shapes/index.js";

export const MENU_STYLES = `
    .menu {
        position: absolute; inset: 0; z-index: 3;
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
        text-align: center; padding: 24px;
        background: radial-gradient(120% 90% at 50% 30%, rgba(20,40,26,.25) 0%, rgba(8,14,10,.78) 70%);
    }
    .menu h1 {
        font-size: clamp(30px, 6vw, 52px); margin: 0; font-weight: 800; letter-spacing: -.01em;
        color: #eaf3ea; text-shadow: 0 3px 0 rgba(0,0,0,.45);
    }
    .menu .sub { color: #a9c0ab; font-size: 14px; margin: 2px 0 20px; max-width: 34ch; }
    .menu .actions { display: flex; flex-direction: column; gap: 10px; width: min(260px, 70%); }
    .menu button { padding: 12px 14px; font-size: 15px; font-weight: 600; white-space: nowrap; }
    .menu button.play { background: #2f7a45; border-color: #43a15e; }
    .menu button.play:hover { background: #38a05a; }
    .menu .keys { margin-top: 18px; font-size: 12px; color: #8fa891; line-height: 1.8; }
    .menu .keys kbd {
        background: #26302a; border: 1px solid #3d4f42; border-bottom-width: 2px;
        border-radius: 4px; padding: 1px 6px; font-family: inherit; font-size: 11px; color: #cfe0d0;
    }
    .menu .best { margin-top: 14px; font-size: 13px; color: #e8c24a; font-weight: 600; }
`;

const DIFFICULTIES = [
    { id: "paseo", label: "Paseo", acorns: 6, seconds: 75 },
    { id: "bosque", label: "Bosque", acorns: 10, seconds: 60 },
    { id: "espesura", label: "Espesura", acorns: 14, seconds: 50 },
];

export default class MenuScene extends Scene {
    constructor() {
        super("menu");
        this.difficulty = DIFFICULTIES[1];
    }

    enter(data = {}) {
        this.camera.zoom = 1;
        this.camera.centerOn(0, 0);

        this._backdrop();
        this._panel(data.best);

        this.onKey(["Enter", " ", "Space"], () => this.play());
        this.onKey(["ArrowLeft", "a"], () => this.cycle(-1));
        this.onKey(["ArrowRight", "d"], () => this.cycle(1));
    }

    // A few shapes drifting behind the title. No textures: this scene runs
    // before anything has been loaded.
    _backdrop() {
        const gl = this.gl;
        this.add(new Rectangle(gl, { width: 40, height: 30 })
            .setColor({ red: 0.11, green: 0.22, blue: 0.14 }).setLayer(-30).init());

        this.drifting = [];
        let seed = 4242;
        const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

        for (let i = 0; i < 26; i++) {
            const x = (random() - 0.5) * 9;
            const y = (random() - 0.5) * 6;
            const size = 0.3 + random() * 0.55;
            const green = 0.28 + random() * 0.22;
            const canopy = this.add(new Circle(gl, { radius: size, segments: 12 })
                .setColor({ red: green * 0.35, green, blue: green * 0.45 })
                .setPosition({ x, y }).setLayer(-20).init());
            this.drifting.push({ shape: canopy, base: y, phase: random() * Math.PI * 2, speed: 0.4 + random() * 0.5 });
        }
        for (let i = 0; i < 7; i++) {
            const x = (random() - 0.5) * 8;
            this.add(new Triangle(gl, { width: 0.5, height: 0.7 })
                .setColor({ red: 0.16, green: 0.3, blue: 0.19 })
                .setPosition({ x, y: -2.1 - random() * 0.4 }).setLayer(-19).init());
        }

        this.onUpdate((dt) => {
            this.time = (this.time || 0) + dt;
            for (const item of this.drifting) {
                item.shape.setPosition({ y: item.base + Math.sin(this.time * item.speed + item.phase) * 0.12 });
            }
        });
    }

    _panel(best) {
        this.playBtn = button("▶  Jugar", () => this.play(), { className: "play" });
        this.diffBtn = button("", () => this.cycle(1));

        const keys = el("div", { className: "keys" });
        keys.innerHTML = "<kbd>WASD</kbd> o <kbd>flechas</kbd> para moverte · "
            + "<kbd>Enter</kbd> empieza<br><kbd>P</kbd> pausa · <kbd>Esc</kbd> vuelve al menú";

        const children = [
            el("h1", { textContent: "El Bosque" }),
            el("div", { className: "sub", textContent: "Junta todas las bellotas antes de que se acabe el tiempo. Los árboles no se cruzan." }),
            el("div", { className: "actions" }, [this.playBtn, this.diffBtn]),
            keys,
        ];
        // Only shown once there is one, so a first-time player is not told they
        // scored zero.
        if (best) children.push(el("div", { className: "best", textContent: `Mejor marca: ${best.acorns} bellotas en ${best.time.toFixed(1)} s` }));

        this.node = this.overlay(el("div", { className: "menu" }, children));
        this._renderDifficulty();
    }

    _renderDifficulty() {
        const { label, acorns, seconds } = this.difficulty;
        this.diffBtn.textContent = `◂ ${label} ▸   ${acorns} bellotas · ${seconds}s`;
    }

    cycle(direction) {
        const index = DIFFICULTIES.indexOf(this.difficulty);
        this.difficulty = DIFFICULTIES[(index + direction + DIFFICULTIES.length) % DIFFICULTIES.length];
        this._renderDifficulty();
        return this;
    }

    play() {
        return this.go("juego", { ...this.difficulty });
    }
}

export { DIFFICULTIES };
