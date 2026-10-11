// El Muro — the result.
//
// The shortest scene in the game: it says how it went, remembers the best run
// of the session, and offers the only two things anyone wants at that moment.

import Scene from "../components/scenes/scene.js";
import { el, button } from "../components/ui/index.js";

export const END_STYLES = `
    .end .stats { display: flex; gap: 26px; margin: 10px 0 22px; }
    .end .stat b { display: block; font-size: 30px; font-variant-numeric: tabular-nums; color: #eaf0ff; }
    .end .stat small { font-size: 11px; color: #7f8aa6; text-transform: uppercase; letter-spacing: .08em; }
    .end .record { color: #e8c24a; font-weight: 600; font-size: 13px; margin-bottom: 14px; }
`;

export default class EndScene extends Scene {
    constructor() {
        super("fin");
        this.best = 0;
    }

    enter({ score = 0, level = 1 } = {}) {
        const record = score > this.best;
        this.best = Math.max(this.best, score);

        this.camera.zoom = 1;
        this.camera.centerOn(0, 0);

        const stat = (value, label) => el("div", { className: "stat" }, [
            el("b", { textContent: String(value) }),
            el("small", { textContent: label }),
        ]);

        this.overlay(el("div", { className: "end" }, [
            el("h1", { textContent: "Se acabó" }),
            el("p", { className: "sub", textContent: `Llegaste al nivel ${level}.` }),
            el("div", { className: "stats" }, [stat(score, "puntos"), stat(level, "nivel")]),
            record && score > 0
                ? el("div", { className: "record", textContent: "¡Récord de la sesión!" })
                : el("span"),
            el("div", { className: "actions" }, [
                button("Otra vez", () => this.go("juego", { level: 1, score: 0 }), { className: "again" }),
                button("Volver al menú", () => this.go("menu", { best: this.best })),
            ]),
        ]));

        this.onKey(["Enter", " ", "Space"], () => this.go("juego", { level: 1, score: 0 }));
        this.onKey("Escape", () => this.go("menu", { best: this.best }));
    }
}
