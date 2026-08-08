// Pixels — and which kind of pixel.
//
// Two coordinate spaces meet at the edge of the canvas, and mixing them up is an
// afternoon of "why is my aim off by half a screen":
//
//   client pixels   what a pointer event hands you (`e.clientX` / `e.clientY`),
//                   measured from the top-left of the *viewport*
//   canvas pixels   measured from the top-left of the *canvas box*, which is
//                   what a CSS-positioned overlay needs for `left` / `top`
//
// The framework's rule, and it is the same for both cameras:
//
//   pixels going IN  are client pixels — that is what the DOM gives you, so a
//                    call site never has to subtract a bounding rect
//   pixels coming OUT are canvas pixels — that is what you position a label with
//
// So `camera.project()` and `camera.screenToWorld()` are inverses in *world*
// space, not in pixel space; `toClientPixels` below bridges the gap when you
// genuinely need to round-trip.
//
// Both functions live here rather than in either camera because there are two
// cameras and only one right answer.

// The rect, not clientWidth: a pointer event is in viewport coordinates, and
// getBoundingClientRect is the only measurement that agrees with it (it accounts
// for CSS transforms, which clientWidth does not).
export function clientToNdc(clientX, clientY, canvas) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((clientX - rect.left) / (rect.width || 1)) * 2 - 1,   // [-1, 1]
        y: 1 - ((clientY - rect.top) / (rect.height || 1)) * 2,   // [-1, 1], y grows up
    };
}

// clientWidth, not the rect: an overlay is positioned inside the canvas's own
// CSS box, so that is the box its pixels are measured against.
export function ndcToCanvasPixels(ndcX, ndcY, canvas) {
    return {
        x: (ndcX * 0.5 + 0.5) * (canvas.clientWidth || 1),
        y: (1 - (ndcY * 0.5 + 0.5)) * (canvas.clientHeight || 1),
    };
}

// Canvas pixels back to client pixels, for feeding a projected point into
// something that expects pointer coordinates.
export function toClientPixels(x, y, canvas) {
    const rect = canvas.getBoundingClientRect();
    return { x: x + rect.left, y: y + rect.top };
}
