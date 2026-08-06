// Geometry builders: positions, normals and indices for the usual solids.
//
// Every builder returns the same shape of data —
//
//     { positions: [...], normals: [...], indices: [...] }
//
// — so `Mesh` never has to know which primitive it is drawing, and a hand-built
// mesh is exactly as first-class as a box.
//
// Two things worth saying about normals, because they are what makes 3D look
// like 3D:
//
// - **A box has 24 vertices, not 8.** Each corner belongs to three faces that
//   point in three different directions, and a vertex carries one normal. Share
//   the corners and the cube shades like a badly inflated ball.
// - **A sphere shares its vertices**, because its normal really is continuous:
//   the normal at a point on a unit sphere is the point itself.
//
// Indices exist so a face's four corners are stored once and referenced twice,
// which is both less memory and fewer vertices for the GPU to transform.

// --- Box -----------------------------------------------------------------

export function boxGeometry({ width = 1, height = 1, depth = 1 } = {}) {
    const x = width / 2, y = height / 2, z = depth / 2;
    const positions = [];
    const normals = [];
    const indices = [];

    // Each face: four corners in counter-clockwise order seen from outside,
    // which is what backface culling relies on to know what to throw away.
    const uvs = [];
    const face = (corners, normal) => {
        const base = positions.length / 3;
        for (const [px, py, pz] of corners) {
            positions.push(px, py, pz);
            normals.push(...normal);
        }
        // Each face gets the whole texture, which is what you want for a crate
        // and easy to override with `textureRepeat` when you want a tiling.
        uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    face([[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]], [0, 0, 1]);    // frente
    face([[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]], [0, 0, -1]); // fondo
    face([[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]], [0, 1, 0]);    // arriba
    face([[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]], [0, -1, 0]); // abajo
    face([[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]], [1, 0, 0]);    // derecha
    face([[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]], [-1, 0, 0]); // izquierda

    return { positions, normals, uvs, indices };
}

// --- Sphere --------------------------------------------------------------

export function sphereGeometry({ radius = 0.5, segments = 24, rings = 16 } = {}) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    for (let ring = 0; ring <= rings; ring++) {
        const v = ring / rings;
        const phi = v * Math.PI;            // 0 arriba, π abajo
        const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);

        for (let segment = 0; segment <= segments; segment++) {
            const u = segment / segments;
            const theta = u * Math.PI * 2;
            const nx = sinPhi * Math.cos(theta);
            const ny = cosPhi;
            const nz = sinPhi * Math.sin(theta);
            // On a unit sphere the normal *is* the position, which is why these
            // two lines look redundant and are not.
            positions.push(nx * radius, ny * radius, nz * radius);
            normals.push(nx, ny, nz);
            uvs.push(u, 1 - v);
        }
    }

    const stride = segments + 1;
    for (let ring = 0; ring < rings; ring++) {
        for (let segment = 0; segment < segments; segment++) {
            const a = ring * stride + segment;
            const b = a + stride;
            indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }

    return { positions, normals, uvs, indices };
}

// --- Cylinder, and the cone it becomes when the top radius is zero --------

export function cylinderGeometry({
    radiusTop = 0.5, radiusBottom = 0.5, height = 1, segments = 24, caps = true,
} = {}) {
    const positions = [];
    const normals = [];
    const indices = [];
    const halfHeight = height / 2;

    // The side normal is not horizontal unless the two radii match: on a cone it
    // tilts by the slope, and getting that wrong makes the lighting look painted
    // on rather than lit.
    const slope = (radiusBottom - radiusTop) / height;
    const normalScale = 1 / Math.hypot(1, slope);

    for (let ring = 0; ring <= 1; ring++) {
        const radius = ring === 0 ? radiusBottom : radiusTop;
        const y = ring === 0 ? -halfHeight : halfHeight;
        for (let segment = 0; segment <= segments; segment++) {
            const theta = (segment / segments) * Math.PI * 2;
            const cos = Math.cos(theta), sin = Math.sin(theta);
            positions.push(cos * radius, y, sin * radius);
            normals.push(cos * normalScale, slope * normalScale, sin * normalScale);
        }
    }

    const stride = segments + 1;
    for (let segment = 0; segment < segments; segment++) {
        const a = segment, b = segment + stride;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
    }

    if (caps) {
        for (const [radius, y, normal] of [[radiusBottom, -halfHeight, -1], [radiusTop, halfHeight, 1]]) {
            if (radius <= 0) continue;         // un cono no tiene tapa arriba
            const centre = positions.length / 3;
            positions.push(0, y, 0);
            normals.push(0, normal, 0);
            for (let segment = 0; segment <= segments; segment++) {
                const theta = (segment / segments) * Math.PI * 2;
                positions.push(Math.cos(theta) * radius, y, Math.sin(theta) * radius);
                normals.push(0, normal, 0);
            }
            for (let segment = 0; segment < segments; segment++) {
                const a = centre + 1 + segment;
                // The winding flips between the two caps, or one of them faces
                // inwards and vanishes under backface culling. Seen from above,
                // increasing theta with x = cos and z = sin runs *clockwise*,
                // so the top cap is the one that needs reversing — the opposite
                // of what it looks like written down.
                if (normal > 0) indices.push(centre, a + 1, a);
                else indices.push(centre, a, a + 1);
            }
        }
    }

    return { positions, normals, indices };
}

export const coneGeometry = ({ radius = 0.5, height = 1, segments = 24 } = {}) =>
    cylinderGeometry({ radiusTop: 0, radiusBottom: radius, height, segments });

// --- Plane, lying in XZ so it works as ground ----------------------------

export function planeGeometry({ width = 1, depth = 1, segmentsX = 1, segmentsZ = 1 } = {}) {
    const positions = [];
    const normals = [];
    const indices = [];

    const uvs = [];
    for (let z = 0; z <= segmentsZ; z++) {
        for (let x = 0; x <= segmentsX; x++) {
            positions.push(
                (x / segmentsX - 0.5) * width,
                0,
                (z / segmentsZ - 0.5) * depth,
            );
            normals.push(0, 1, 0);
            uvs.push(x / segmentsX, z / segmentsZ);
        }
    }
    const stride = segmentsX + 1;
    for (let z = 0; z < segmentsZ; z++) {
        for (let x = 0; x < segmentsX; x++) {
            const a = z * stride + x;
            indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
        }
    }
    return { positions, normals, uvs, indices };
}

// --- Torus ---------------------------------------------------------------

export function torusGeometry({ radius = 0.5, tube = 0.2, segments = 32, sides = 16 } = {}) {
    const positions = [];
    const normals = [];
    const indices = [];

    for (let i = 0; i <= segments; i++) {
        const u = (i / segments) * Math.PI * 2;
        const cosU = Math.cos(u), sinU = Math.sin(u);
        for (let j = 0; j <= sides; j++) {
            const v = (j / sides) * Math.PI * 2;
            const cosV = Math.cos(v), sinV = Math.sin(v);
            // The normal points away from the centre of the tube, not from the
            // centre of the torus.
            const nx = cosV * cosU, ny = sinV, nz = cosV * sinU;
            positions.push((radius + tube * cosV) * cosU, tube * sinV, (radius + tube * cosV) * sinU);
            normals.push(nx, ny, nz);
        }
    }
    const stride = sides + 1;
    for (let i = 0; i < segments; i++) {
        for (let j = 0; j < sides; j++) {
            const a = i * stride + j;
            const b = a + stride;
            indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }
    return { positions, normals, indices };
}

// --- Extrusion, for anything the primitives do not cover ------------------

// Takes a flat outline in XZ and gives it height: walls plus a flat top and
// bottom. It is how the tank hulls and the editor's odd shapes get made without
// a modelling tool.
export function prismGeometry({ points = [], height = 1 } = {}) {
    const positions = [];
    const normals = [];
    const indices = [];
    const halfHeight = height / 2;
    const count = points.length;
    if (count < 3) return { positions, normals, indices };

    // Walls: one quad per edge, each with its own normal, so the corners stay
    // sharp instead of smearing into a cylinder.
    for (let i = 0; i < count; i++) {
        const current = points[i];
        const next = points[(i + 1) % count];
        const dx = next.x - current.x;
        const dz = next.z - current.z;
        const length = Math.hypot(dx, dz) || 1;
        const nx = dz / length, nz = -dx / length;

        const base = positions.length / 3;
        positions.push(
            current.x, -halfHeight, current.z,
            next.x, -halfHeight, next.z,
            next.x, halfHeight, next.z,
            current.x, halfHeight, current.z,
        );
        for (let k = 0; k < 4; k++) normals.push(nx, 0, nz);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    // Caps, as a triangle fan from the first point. Fine for convex outlines,
    // which is all the physics layer accepts anyway.
    for (const [y, normal] of [[halfHeight, 1], [-halfHeight, -1]]) {
        const base = positions.length / 3;
        for (const point of points) {
            positions.push(point.x, y, point.z);
            normals.push(0, normal, 0);
        }
        // Same handedness trap as the cylinder caps: the top fan runs clockwise
        // when seen from above unless it is reversed.
        for (let i = 1; i < count - 1; i++) {
            if (normal > 0) indices.push(base, base + i + 1, base + i);
            else indices.push(base, base + i, base + i + 1);
        }
    }

    return { positions, normals, indices };
}
