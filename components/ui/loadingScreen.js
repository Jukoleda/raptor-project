// The screen that covers the canvas while the assets arrive.
//
// Two rules it follows, because both are easy to get wrong:
//
// 1. **It needs no assets of its own.** A loading screen built from an image is
//    a loading screen that cannot appear until something has loaded.
// 2. **A failure has to be visible.** The worst outcome is a bar that stops at
//    73% and never says why, so a failed load turns the screen red and prints
//    which asset broke and what the error was.
//
// It is a plain DOM overlay rather than something drawn in WebGL: it has to
// work before the first frame is rendered.

import { el } from "./dom.js";

export const LOADING_STYLES = `
    .loading {
        position: absolute; inset: 0; z-index: 5;
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
        background: #0a0d12; color: #e6e6e6; padding: 24px; text-align: center;
        transition: opacity .25s ease;
    }
    .loading.done { opacity: 0; pointer-events: none; }
    .loading .title { font-size: 15px; font-weight: 600; letter-spacing: .02em; }
    .loading .bar {
        width: min(320px, 70%); height: 8px; border-radius: 4px; overflow: hidden;
        background: #1b1d21; border: 1px solid #3a3f45;
    }
    .loading .bar > i { display: block; height: 100%; width: 0; background: #6aa9e0; transition: width .18s ease; }
    .loading .status { font-size: 12px; color: #9aa0a6; font-variant-numeric: tabular-nums; min-height: 1.2em; }
    .loading.failed .bar > i { background: #d84a3a; }
    .loading.failed .title { color: #f0a094; }
    .loading .error {
        font-size: 12px; color: #f0a094; text-align: left; max-width: min(460px, 90%);
        white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
`;

export default class LoadingScreen {
    constructor(mount, { title = "Cargando…" } = {}) {
        this.fill = el("i");
        this.status = el("div", { className: "status", textContent: "preparando…" });
        this.title = el("div", { className: "title", textContent: title });
        this.node = el("div", { className: "loading" }, [
            this.title,
            el("div", { className: "bar" }, [this.fill]),
            this.status,
        ]);
        mount.append(this.node);
    }

    // Takes the progress object Assets hands out.
    update({ loaded, total, ratio, key }) {
        this.fill.style.width = `${Math.round(ratio * 100)}%`;
        // Counted in assets, not bytes: neither an <img> nor decodeAudioData
        // reports progress, so pretending to know the byte count would be a lie
        // that stalls at odd percentages.
        this.status.textContent = `${loaded} de ${total} · ${key}`;
        return this;
    }

    fail(error) {
        this.node.classList.add("failed");
        this.title.textContent = "No se pudo cargar";
        this.status.textContent = "";
        this.node.append(el("div", { className: "error", textContent: String(error.message || error) }));
        return this;
    }

    // Fades out, then removes itself once the transition has actually run.
    done() {
        this.node.classList.add("done");
        setTimeout(() => this.node.remove(), 300);
        return this;
    }

    remove() {
        this.node.remove();
        return this;
    }
}
