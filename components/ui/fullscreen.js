// Fullscreen, with the vendor prefixes Safari still needs.
//
// The Fullscreen API is one of the few places where the unprefixed spec is not
// enough in 2026, and the prefixed names are just different enough (`webkit`
// capitalises the next word) that every call site grows the same four-branch
// dance. This wraps it once and adds the part people forget: a change listener,
// because the user can leave fullscreen with Escape without touching your
// button, and the label has to follow.

export function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
}

export function isFullscreen(element = null) {
    const current = fullscreenElement();
    return element ? current === element : !!current;
}

// Must be called from a user gesture, like any fullscreen request. Returns a
// promise that resolves either way — a rejected request (an iframe without the
// permission, a browser that refuses) is reported as `false`, not thrown.
export function requestFullscreen(element) {
    const request = element.requestFullscreen || element.webkitRequestFullscreen;
    if (!request) return Promise.resolve(false);
    return Promise.resolve(request.call(element)).then(() => true, () => false);
}

export function exitFullscreen() {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (!exit) return Promise.resolve(false);
    return Promise.resolve(exit.call(document)).then(() => true, () => false);
}

export function toggleFullscreen(element) {
    return isFullscreen() ? exitFullscreen() : requestFullscreen(element);
}

// Calls `handler(isFullscreen)` whenever it changes — including when the user
// presses Escape. Returns a function that unsubscribes.
export function onFullscreenChange(handler) {
    const listener = () => handler(isFullscreen());
    const events = ["fullscreenchange", "webkitfullscreenchange"];
    for (const ev of events) document.addEventListener(ev, listener);
    return () => { for (const ev of events) document.removeEventListener(ev, listener); };
}

// The layout a fullscreen stage wants: the canvas takes the height it can get
// and the panel keeps its own scroll beside it, instead of the page flow that
// assumes a document. Scoped to `#app` because that is what Raptor makes
// fullscreen.
export const FULLSCREEN_STYLES = `
    #app:fullscreen { height: 100vh; padding: 10px; flex-wrap: nowrap; align-items: stretch; }
    #app:fullscreen #stage { flex: 1 1 auto; display: flex; align-items: center; justify-content: center; min-width: 0; }
    #app:fullscreen #stage canvas { width: 100%; height: auto; max-height: 100%; max-width: 100%; }
    #app:fullscreen #panel { overflow-y: auto; flex: none; }
    @media (max-width: 720px) {
        #app:fullscreen { flex-direction: column; }
        #app:fullscreen #stage { flex: 0 0 auto; }
    }
`;
