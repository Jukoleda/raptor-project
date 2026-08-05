// Per-face armor for a target shape. Each collider edge (in getColliderVertices
// order) has a nominal armor thickness in mm and a readable face name. The armor
// travels with the shape's rotation, so angling the hull changes which value a
// shell meets — exactly what drives the penetration model.

export default class Armor {
    // faces: array aligned to the shape's collider edges, each { armor, name }.
    constructor(shape, faces, { hp = 100 } = {}) {
        this.shape = shape;
        this.faces = faces;
        this.maxHp = hp;
        this.hp = hp;
        this.alive = true;
    }

    faceForEdge(index) {
        return this.faces[index];
    }

    takeDamage(amount) {
        this.hp = Math.max(0, this.hp - amount);
        if (this.hp === 0) this.alive = false;
        return this.hp;
    }

    // Builds per-face armor for any convex hull by looking at where each face
    // actually points in the shape's local space: faces within `frontArc` of
    // local +Y (forward) are frontal, those as far from it are the rear, and the
    // rest are sides. Works for a rectangle, a wedge, a hexagon — anything with
    // a counter-clockwise collider outline, which is what the raycast assumes.
    static forHull(shape, { front, side, rear, hp = 100, frontArc = 75 } = {}) {
        const points = shape.getColliderVertices();
        const faces = points.map((p, i) => {
            const q = points[(i + 1) % points.length];
            const dx = q.x - p.x;
            const dy = q.y - p.y;
            const len = Math.hypot(dx, dy) || 1;
            // Outward normal of a CCW edge is (dy, -dx); we only need its Y to
            // know how far the face is turned away from "forward".
            const ny = -dx / len;
            const angle = (Math.acos(Math.max(-1, Math.min(1, ny))) * 180) / Math.PI;
            if (angle <= frontArc) return { armor: front, name: "Frontal" };
            if (angle >= 180 - frontArc) return { armor: rear, name: "Trasera" };
            return { armor: side, name: "Lateral" };
        });
        return new Armor(shape, faces, { hp });
    }

    // Convenience for a rectangular hull. `frontEdge` is the collider edge that
    // faces the enemy; its opposite becomes the rear, the other two the sides.
    static rectangle(shape, { front, side, rear, frontEdge = 3, hp = 100 } = {}) {
        const faces = [];
        for (let i = 0; i < 4; i++) faces.push({ armor: side, name: "Lateral" });
        faces[frontEdge % 4] = { armor: front, name: "Frontal" };
        faces[(frontEdge + 2) % 4] = { armor: rear, name: "Trasera" };
        return new Armor(shape, faces, { hp });
    }
}
