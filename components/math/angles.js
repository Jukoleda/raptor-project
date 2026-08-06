// Degrees in, radians out.
//
// Every rotation in Raptor's public API is in **degrees**, because that is what
// people type and read; every trigonometric function underneath wants radians.
// That conversion was written inline in a dozen places as `(x * Math.PI) / 180`,
// which is fine until one of them is `/ 180` on the wrong side of the multiply.

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

export const toRadians = (degrees) => degrees * DEG_TO_RAD;
export const toDegrees = (radians) => radians * RAD_TO_DEG;

// Wraps an angle to (−180, 180]. The difference between two headings is only
// meaningful once it is wrapped: 350° and 10° are twenty degrees apart, not
// three hundred and forty.
export function wrapDegrees(degrees) {
    let wrapped = (degrees + 180) % 360;
    if (wrapped < 0) wrapped += 360;
    return wrapped - 180;
}

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
