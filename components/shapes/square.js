import Rectangle from "./rectangle.js";

// A square is just a rectangle with equal sides.
export default class Square extends Rectangle {
    constructor(context, { size = 1 } = {}) {
        super(context, { width: size, height: size });
    }
}
