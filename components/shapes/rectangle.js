import Shape from "./shape.js";

// An axis-aligned rectangle centered on its origin.
export default class Rectangle extends Shape {
    constructor(context, { width = 1, height = 1 } = {}) {
        super(context);
        this.width = width;
        this.height = height;
        this.drawMode = context.TRIANGLE_STRIP;
    }

    getVertices() {
        const hw = this.width / 2;
        const hh = this.height / 2;

        // Order matters for TRIANGLE_STRIP: two triangles sharing an edge.
        return [
             hw,  hh,
            -hw,  hh,
             hw, -hh,
            -hw, -hh,
        ];
    }

    getColliderVertices() {
        const hw = this.width / 2;
        const hh = this.height / 2;
        // Counter-clockwise outline.
        return [
            { x: -hw, y: -hh },
            { x:  hw, y: -hh },
            { x:  hw, y:  hh },
            { x: -hw, y:  hh },
        ];
    }
}
