import { RegularPolygon } from "./polygon.js";

// A circle is a regular polygon with enough sides to look round. Increase
// `segments` for a smoother edge on large circles.
export default class Circle extends RegularPolygon {
    constructor(context, { radius = 0.5, segments = 48 } = {}) {
        super(context, { sides: segments, radius });
        // Treated as a true circle by the physics layer (uses this.radius),
        // not as a 48-gon.
        this.colliderShape = "circle";
    }
}
