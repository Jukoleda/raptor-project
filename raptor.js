// Raptor — a small 2D WebGL framework, written by hand.
//
//     import { App, Rectangle } from "./raptor.js";
//
//     App.boot({ title: "Hola" }, (app) => {
//         const box = app.add(new Rectangle(app.gl, { width: 2, height: 1 })
//             .setColor({ red: 0.9, green: 0.4, blue: 0.2 }).init());
//         app.onUpdate((dt) => box.setRotation(box.rotation + 90 * dt));
//     });
//
// The layers, from the bottom up:
//
//   shapes    geometry that knows how to draw itself through a camera
//   render    textures, sprite sheets, animation and the shader programs
//   camera    the movable window onto the world (pan, zoom, follow, bounds)
//   engine    canvas, GL context and the one render loop
//   physics   bodies, convex collision (SAT) and a solver
//   input     keyboard state and on-screen controls that agree with each other
//   ui        the DOM chrome: panels, sliders, readouts, fullscreen
//   audio     synthesised sound, so a build stays a single file
//   assets    declare what a game needs, load it with progress, then start
//   scenes    menu, match, result — each one mounts and unmounts itself
//   app       the shell that wires all of the above together
//
// On top of those sits a gameplay kit — controls, weapons, vehicles — which is
// where the tank demos come from. It is ordinary Raptor code: nothing in the
// engine depends on it, and deleting it would leave the framework intact.
//
// There is no build step to use this: it is ES modules, served over HTTP. The
// generated single-file pages (engine.html, dyno.html, …) come from
// `node tools/build.mjs`, which also emits dist/raptor.js for consumers.

export * from "./components/index.js";

export const VERSION = "0.5.0";
