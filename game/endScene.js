// The screen after a run: what happened, and what to do next.
//
// It keeps the last frame of the forest behind it rather than clearing to
// black — you should be able to see where you ran out of time. That falls out
// of how scenes work: the forest tore its own entities down on the way out, so
// what is left is whatever this scene draws plus the overlay on top.

import Scene from "../components/scenes/scene.js";
import { el, button } from "../components/ui/index.js";
import { Rectangle } from "../components/shapes/index.js";

export const END_STYLES = `
    .end {
        position: absolute; inset: 0; z-index: 3;
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
        text-align: center; padding: 24px; background: rgba(8, 14, 10, .8);
    }
    .end .verdict { font-size: clamp(26px, 5vw, 40px); font-weight: 800; margin: 0; }
    .end .verdict.won { color: #7fe0a0; }
    .end .verdict.lost { color: #f0a094; }
    .end .line { color: #b9c9bb; font-size: 15px; margin-top: 6px; }
    .end .stats { display: flex; gap: 22px; margin: 18px 0 22px; }
    .end .stat { min-width: 84px; }
    .end .stat b { display: block; font-size: 26px; font-variant-numeric: tabular-nums; }
    .end .stat small { font-size: 11px; color: #8fa891; letter-spacing: .06em; }
    .end .actions { display: flex; flex-direction: column; gap: 10px; width: min(250px, 70%); }
    .end button { padding: 11px 14px; font-size: 14px; font-weight: 600; }
    .end button.again { background: #2f7a45; border-color: #43a15e; }
    .end button.again:hover { background: #38a05a; }
    .end .record { margin-top: 14px; color: #e8c24a; font-weight: 600; font-size: 13px; }
`;

export default class EndScene extends Scene {
    constructor() {
        super("fin");
        this.best = null;
    }

    enter({ won = false, acorns = 0, target = 0, time = 0, difficulty = null } = {}) {
        // A run only counts as a record if it was finished.
        const record = won && (!this.best || time < this.best.time);
        if (record) this.best = { acorns, time };

        // A dim wash over whatever the forest left on screen, so the text reads
        // without hiding where you ended up.
        this.add(new Rectangle(this.gl, { width: 60, height: 45 })
            .setColor({ red: 0.03, green: 0.06, blue: 0.04, alpha: 0.55 })
            .setLayer(100).init());

        const stat = (value, label) => el("div", { className: "stat" }, [
            el("b", { textContent: value }), el("small", { textContent: label }),
        ]);

        const again = button("↻  Otra vez", () => this.go("juego", difficulty || {}), { className: "again" });
        const menu = button("Volver al menú", () => this.go("menu", { best: this.best }));

        const children = [
            el("h1", { className: `verdict ${won ? "won" : "lost"}`, textContent: won ? "¡Bosque recorrido!" : "Se acabó el tiempo" }),
            el("div", { className: "line", textContent: won
                ? "Juntaste todas las bellotas."
                : `Te faltaron ${target - acorns} bellota${target - acorns === 1 ? "" : "s"}.` }),
            el("div", { className: "stats" }, [
                stat(`${acorns}/${target}`, "BELLOTAS"),
                stat(`${time.toFixed(1)}s`, "TIEMPO"),
            ]),
            el("div", { className: "actions" }, [again, menu]),
        ];
        if (record) children.push(el("div", { className: "record", textContent: "¡Nueva mejor marca!" }));

        this.overlay(el("div", { className: "end" }, children));

        this.onKey(["Enter", " ", "Space"], () => this.go("juego", difficulty || {}));
        this.onKey("Escape", () => this.go("menu", { best: this.best }));

        this.result = { won, acorns, target, time, record };
    }
}
