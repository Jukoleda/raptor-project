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
