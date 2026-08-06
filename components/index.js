// Everything Raptor exports, in one place.
//
// This is the framework's public surface: if a name is here it is meant to be
// used and will not move without a note in the CHANGELOG; if it is not, it is
// an internal detail. Import from the root (`raptor.js`) in applications, or
// from a single layer (`components/physics/index.js`) when you only want one.

// --- Core: the loop, the view, the shell -------------------------------
export { default as App } from "./app.js";
export { default as RaptorEngine } from "./raptorEngine.js";
export { default as Camera } from "./camera.js";

// --- Rendering primitives ----------------------------------------------
export * from "./shapes/index.js";
export * from "./render/index.js";

// --- Simulation ---------------------------------------------------------
export * from "./physics/index.js";

// --- Input --------------------------------------------------------------
export * from "./input/index.js";

// --- Interface ----------------------------------------------------------
export * from "./ui/index.js";

// --- Audio --------------------------------------------------------------
export * from "./audio/index.js";

// --- Gameplay kit -------------------------------------------------------
// Not part of the engine proper: batteries that happen to ship in the box,
// built on the layers above. Ignore them and nothing below changes.
export * from "./controls/index.js";
export * from "./weapons/index.js";
export * from "./vehicles/index.js";
