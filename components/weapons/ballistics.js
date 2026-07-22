// Ballistics: where bullets meet armor.
//
// Bullets are treated as swept segments (raycast from their previous to their
// current position), not as physics bodies. That avoids fast bullets tunnelling
// through thin armor and gives us the exact hit point and, crucially, the
// surface normal — which is what the angle-based penetration model needs.
//
// Penetration model (arcade, à la World of Tanks):
//   effectiveArmor = nominalArmor / cos(theta)
//   theta = angle between the shell's path and the surface normal
//   - ricochet if theta >= ricochetAngle (too steep, shell skips off)
//   - penetration if shellPenetration >= effectiveArmor
//   - block otherwise (shell stops, no damage)

// Transforms a shape's local collider outline into world space. Mirrors the
// transform used by Shape.draw and the physics layer (rotation is CCW degrees).
function worldPolygon(shape) {
    const angle = (shape.rotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return shape.getColliderVertices().map((p) => {
        const x = p.x * shape.scale.x;
        const y = p.y * shape.scale.y;
        return {
            x: shape.position.x + x * cos - y * sin,
            y: shape.position.y + x * sin + y * cos,
        };
    });
}

// Intersection of segment A->B with segment P->Q. Returns { t, point } where t
// is the position along A->B in [0, 1], or null when they do not cross.
function segmentIntersect(a, b, p, q) {
    const r = { x: b.x - a.x, y: b.y - a.y };
    const s = { x: q.x - p.x, y: q.y - p.y };
    const denom = r.x * s.y - r.y * s.x;
    if (Math.abs(denom) < 1e-9) return null; // parallel

    const t = ((p.x - a.x) * s.y - (p.y - a.y) * s.x) / denom;
    const u = ((p.x - a.x) * r.y - (p.y - a.y) * r.x) / denom;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;

    return { t, point: { x: a.x + r.x * t, y: a.y + r.y * t } };
}

// Casts the segment a->b against a polygon shape. Returns the first face hit as
// { point, normal, edgeIndex, t } (normal points outward), or null.
export function raycastShape(a, b, shape) {
    const poly = worldPolygon(shape);
    let best = null;

    for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        const hit = segmentIntersect(a, b, p, q);
        if (hit && (!best || hit.t < best.t)) {
            const dx = q.x - p.x;
            const dy = q.y - p.y;
            const len = Math.hypot(dx, dy) || 1;
            // Outward normal for a counter-clockwise winding.
            const normal = { x: dy / len, y: -dx / len };
            best = { point: hit.point, normal, edgeIndex: i, t: hit.t };
        }
    }
    return best;
}

// Decides what happens when a shell of `penetration` mm hits `armor` mm of plate
// whose outward `normal` is hit head-on by a shell travelling along `direction`.
// Returns { result: "penetration" | "ricochet" | "block", angle, effectiveArmor }.
export function evaluateImpact({ direction, normal, penetration, armor, ricochetAngle = 70 }) {
    // cos of the impact angle measured from the surface normal.
    const cos = -(direction.x * normal.x + direction.y * normal.y);
    const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;

    if (cos <= 1e-4) {
        // Grazing or hitting the inside of a face — treat as a ricochet.
        return { result: "ricochet", angle, effectiveArmor: Infinity };
    }

    const effectiveArmor = armor / cos;
    if (angle >= ricochetAngle) {
        return { result: "ricochet", angle, effectiveArmor };
    }
    if (penetration >= effectiveArmor) {
        return { result: "penetration", angle, effectiveArmor };
    }
    return { result: "block", angle, effectiveArmor };
}

// Reflects a velocity vector off a surface with the given unit normal.
export function reflect(velocity, normal) {
    const dot = velocity.x * normal.x + velocity.y * normal.y;
    return { x: velocity.x - 2 * dot * normal.x, y: velocity.y - 2 * dot * normal.y };
}
