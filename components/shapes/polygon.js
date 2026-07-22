import Shape from "./shape.js";

// A filled convex polygon defined by an explicit list of points, e.g.
//   new Polygon(gl, { points: [ {x:0,y:0.6}, {x:0.6,y:0}, {x:-0.6,y:0} ] })
//
// Rendered as a TRIANGLE_FAN, which correctly fills any convex polygon. For
// concave polygons a real triangulation (ear clipping) would be needed.
export class Polygon extends Shape {
    constructor(context, { points = [] } = {}) {
        super(context);
        this.points = points;
        this.drawMode = context.TRIANGLE_FAN;
    }

    getVertices() {
        const vertices = [];
        for (const p of this.points) {
            vertices.push(p.x, p.y);
        }
        return vertices;
    }
}

// A regular N-sided polygon (equilateral triangle, pentagon, hexagon, ...).
// Built as a TRIANGLE_FAN around a center vertex so any side count fills solidly.
export class RegularPolygon extends Shape {
    constructor(context, { sides = 6, radius = 0.5 } = {}) {
        super(context);
        this.sides = Math.max(3, sides);
        this.radius = radius;
        this.drawMode = context.TRIANGLE_FAN;
    }

    getVertices() {
        const vertices = [0, 0]; // center of the fan

        // Start at the top (-90°) and go around once, repeating the first rim
        // point at the end to close the shape.
        for (let i = 0; i <= this.sides; i++) {
            const angle = (i / this.sides) * Math.PI * 2 - Math.PI / 2;
            vertices.push(Math.cos(angle) * this.radius, Math.sin(angle) * this.radius);
        }

        return vertices;
    }
}
