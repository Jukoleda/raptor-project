import RaptorEngine from "./raptorEngine.js";
import { Rectangle, Square, Triangle, Circle, RegularPolygon, Polygon } from "./shapes/index.js";

const game = new RaptorEngine();
game.createWindow();

const gl = game.context;

// Top row: rectangle, triangle, circle.
game.add(
    new Rectangle(gl, { width: 1.4, height: 0.9 })
        .setColor({ red: 0.9, green: 0.3, blue: 0.2 })
        .setPosition({ x: -1.8, y: 1.1 })
        .init()
);

game.add(
    new Triangle(gl, { width: 1.2, height: 1.2 })
        .setColor({ green: 0.8, blue: 0.4 })
        .setPosition({ x: 0, y: 1.1 })
        .init()
);

game.add(
    new Circle(gl, { radius: 0.6 })
        .setColor({ red: 0.2, green: 0.5, blue: 0.95 })
        .setPosition({ x: 1.8, y: 1.1 })
        .init()
);

// Bottom row: rotated square, hexagon, custom polygon.
game.add(
    new Square(gl, { size: 1 })
        .setColor({ red: 0.95, green: 0.8, blue: 0.2 })
        .setPosition({ x: -1.8, y: -1.1 })
        .setRotation(45)
        .init()
);

game.add(
    new RegularPolygon(gl, { sides: 6, radius: 0.7 })
        .setColor({ red: 0.6, green: 0.3, blue: 0.9 })
        .setPosition({ x: 0, y: -1.1 })
        .init()
);

game.add(
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

game.start();
