// The smallest thing Raptor can do: put every built-in shape on screen.
//
// This doubles as the framework's hello-world, so it is deliberately the whole
// program — no panel, no input, no physics. `App.boot` waits for the document,
// builds the page, creates the canvas and starts the loop; everything below is
// scene code.

import App from "./app.js";
import { Rectangle, Square, Triangle, Circle, RegularPolygon, Polygon } from "./shapes/index.js";

App.boot({ title: "Raptor Engine — Formas", panel: false, keyboard: false, touch: false }, (app) => {
    const gl = app.gl;

    // Top row: rectangle, triangle, circle.
    app.add(
        new Rectangle(gl, { width: 1.4, height: 0.9 })
            .setColor({ red: 0.9, green: 0.3, blue: 0.2 })
            .setPosition({ x: -1.8, y: 1.1 })
            .init()
    );

    app.add(
        new Triangle(gl, { width: 1.2, height: 1.2 })
            .setColor({ green: 0.8, blue: 0.4 })
            .setPosition({ x: 0, y: 1.1 })
            .init()
    );

    app.add(
        new Circle(gl, { radius: 0.6 })
            .setColor({ red: 0.2, green: 0.5, blue: 0.95 })
            .setPosition({ x: 1.8, y: 1.1 })
            .init()
    );

    // Bottom row: rotated square, hexagon, custom polygon.
    const square = app.add(
        new Square(gl, { size: 1 })
            .setColor({ red: 0.95, green: 0.8, blue: 0.2 })
            .setPosition({ x: -1.8, y: -1.1 })
            .setRotation(45)
            .init()
    );

    app.add(
        new RegularPolygon(gl, { sides: 6, radius: 0.7 })
            .setColor({ red: 0.6, green: 0.3, blue: 0.9 })
            .setPosition({ x: 0, y: -1.1 })
            .init()
    );

    app.add(
        new Polygon(gl, {
            points: [
                { x: 0.0, y: 0.7 },
                { x: 0.66, y: 0.2 },
                { x: 0.4, y: -0.6 },
                { x: -0.4, y: -0.6 },
                { x: -0.66, y: 0.2 },
            ],
        })
            .setColor({ red: 0.2, green: 0.8, blue: 0.6 })
            .setPosition({ x: 1.8, y: -1.1 })
            .init()
    );

    // One updater, to show what the loop hands a scene: seconds since the last
    // frame. Turning by degrees *per second* is what makes it frame-rate
    // independent — the square spins at the same speed at 30 fps and at 144.
    app.onUpdate((dt) => square.setRotation(square.rotation + 30 * dt));

    window.raptorDemo = { app, square };
});
