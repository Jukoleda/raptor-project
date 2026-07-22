import Shape from "./shape.js";

// An isosceles triangle centered on its origin, apex pointing up.
export default class Triangle extends Shape {
    constructor(context, { width = 1, height = 1 } = {}) {
        super(context);
        this.width = width;
        this.height = height;
        this.drawMode = context.TRIANGLES;
    }

    getVertices() {
        const hw = this.width / 2;
        const hh = this.height / 2;

        return [
              0,  hh, // apex
            -hw, -hh, // bottom-left
             hw, -hh, // bottom-right
        ];
    }

    getColliderVertices() {
        const hw = this.width / 2;
        const hh = this.height / 2;
        // Counter-clockwise outline.
        return [
            { x: -hw, y: -hh },
            { x:  hw, y: -hh },
            { x:   0, y:  hh },
        ];
    }
}
