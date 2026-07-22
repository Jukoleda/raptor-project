// Convex collision detection for the shapes the engine ships with.
//
// collide(bodyA, bodyB) returns null when they are apart, or a manifold
// { normal, penetration } when they overlap. `normal` is a unit vector pointing
// from A toward B, and `penetration` is how deep the overlap is along it.
//
// Physics happens in the flat 2D world plane the shapes live in (their x/y
// before the perspective projection), so colliders are built from each shape's
// local collider outline transformed by position/rotation/scale.

function transformPoint(p, shape) {
    const angle = (shape.rotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = p.x * shape.scale.x;
    const y = p.y * shape.scale.y;
    return {
        x: shape.position.x + x * cos - y * sin,
        y: shape.position.y + x * sin + y * cos,
    };
}

function worldPolygon(shape) {
    return shape.getColliderVertices().map((p) => transformPoint(p, shape));
}

function worldCircle(shape) {
    // Uniform scale is assumed for circles; scale.x drives the radius.
    return { center: { x: shape.position.x, y: shape.position.y }, radius: shape.radius * shape.scale.x };
}

// Largest distance from the shape's origin to its outline, in world units.
export function boundingRadius(shape) {
    if (shape.colliderShape === "circle") {
        return shape.radius * Math.max(shape.scale.x, shape.scale.y);
    }
    let max = 0;
    for (const p of shape.getColliderVertices()) {
        max = Math.max(max, Math.hypot(p.x * shape.scale.x, p.y * shape.scale.y));
    }
    return max;
}

function centroid(poly) {
    let x = 0;
    let y = 0;
    for (const p of poly) {
        x += p.x;
        y += p.y;
    }
    return { x: x / poly.length, y: y / poly.length };
}

function projectOntoAxis(poly, axis) {
    let min = Infinity;
    let max = -Infinity;
    for (const p of poly) {
        const dot = p.x * axis.x + p.y * axis.y;
        min = Math.min(min, dot);
        max = Math.max(max, dot);
    }
    return [min, max];
}

// Separating Axis Theorem for two convex polygons. Returns the minimum
// translation vector as { normal (A->B), penetration } or null if separated.
function satPolygons(a, b) {
    let minOverlap = Infinity;
    let smallestAxis = null;

    for (const poly of [a, b]) {
        for (let i = 0; i < poly.length; i++) {
            const p1 = poly[i];
            const p2 = poly[(i + 1) % poly.length];
            const edge = { x: p2.x - p1.x, y: p2.y - p1.y };
            const len = Math.hypot(edge.x, edge.y) || 1;
            const axis = { x: -edge.y / len, y: edge.x / len };

            const [minA, maxA] = projectOntoAxis(a, axis);
            const [minB, maxB] = projectOntoAxis(b, axis);

            if (maxA < minB || maxB < minA) {
                return null; // found a separating axis
            }

            const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
            if (overlap < minOverlap) {
                minOverlap = overlap;
                smallestAxis = axis;
            }
        }
    }

    // Orient the normal from A toward B.
    const ca = centroid(a);
    const cb = centroid(b);
    if ((cb.x - ca.x) * smallestAxis.x + (cb.y - ca.y) * smallestAxis.y < 0) {
        smallestAxis = { x: -smallestAxis.x, y: -smallestAxis.y };
    }

    return { normal: smallestAxis, penetration: minOverlap };
}

function circleCircle(ca, cb) {
    const dx = cb.center.x - ca.center.x;
    const dy = cb.center.y - ca.center.y;
    const dist = Math.hypot(dx, dy);
    const sum = ca.radius + cb.radius;
    if (dist >= sum) return null;
    const normal = dist > 1e-6 ? { x: dx / dist, y: dy / dist } : { x: 1, y: 0 };
    return { normal, penetration: sum - dist };
}

function closestPointOnSegment(p, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby || 1;
    let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return { x: a.x + abx * t, y: a.y + aby * t };
}

function pointInPolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
    }
    return inside;
}

// Returns manifold with normal pointing from the polygon toward the circle.
function circlePolygon(circle, poly) {
    let closest = null;
    let minDistSq = Infinity;
    for (let i = 0; i < poly.length; i++) {
        const cp = closestPointOnSegment(circle.center, poly[i], poly[(i + 1) % poly.length]);
        const dsq = (cp.x - circle.center.x) ** 2 + (cp.y - circle.center.y) ** 2;
        if (dsq < minDistSq) {
            minDistSq = dsq;
            closest = cp;
        }
    }

    const inside = pointInPolygon(circle.center, poly);
    const dist = Math.sqrt(minDistSq);
    if (!inside && dist >= circle.radius) return null;

    let normal;
    if (dist > 1e-6) {
        normal = { x: (circle.center.x - closest.x) / dist, y: (circle.center.y - closest.y) / dist };
    } else {
        normal = { x: 0, y: 1 };
    }
    if (inside) {
        return { normal, penetration: circle.radius + dist };
    }
    return { normal, penetration: circle.radius - dist };
}

export function collide(bodyA, bodyB) {
    const sa = bodyA.shape;
    const sb = bodyB.shape;
    const aCircle = sa.colliderShape === "circle";
    const bCircle = sb.colliderShape === "circle";

    if (aCircle && bCircle) {
        return circleCircle(worldCircle(sa), worldCircle(sb));
    }
    if (!aCircle && !bCircle) {
        return satPolygons(worldPolygon(sa), worldPolygon(sb));
    }

    // One circle, one polygon.
    const circleShape = aCircle ? sa : sb;
    const polyShape = aCircle ? sb : sa;
    const res = circlePolygon(worldCircle(circleShape), worldPolygon(polyShape));
    if (!res) return null;

    // res.normal points polygon -> circle. Reorient to A -> B.
    const normal = aCircle ? { x: -res.normal.x, y: -res.normal.y } : res.normal;
    return { normal, penetration: res.penetration };
}
