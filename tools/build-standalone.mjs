// Builds a single, self-contained index.html that opens in any browser by
// double-clicking it (no server, no internet). It inlines gl-matrix and the
// engine source, so index.html is a GENERATED file — edit the modules under
// components/ and re-run this script:
//
//     node tools/build-standalone.mjs
//
// For module-based development (with real ES imports) use dev.html + a static
// server instead.

import { readFile, writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Source modules, in dependency order (base classes first). The barrel
// components/shapes/index.js is intentionally skipped: it only re-exports.
const MODULES = [
    "components/shapes/shape.js",
    "components/shapes/rectangle.js",
    "components/shapes/square.js",
    "components/shapes/triangle.js",
    "components/shapes/polygon.js",
    "components/shapes/circle.js",
    "components/raptorEngine.js",
    "components/main.js",
];

// Turns an ES module into plain script text: drops import lines and unwraps
// export statements so every class/function becomes a top-level global.
function stripModuleSyntax(code) {
    return code
        .split("\n")
        .filter((line) => !/^\s*import\s.+$/.test(line))
        .filter((line) => !/^\s*export\s*\{[^}]*\}\s*;?\s*$/.test(line))
        .map((line) => line.replace(/^\s*export\s+default\s+/, ""))
        .map((line) => line.replace(/^(\s*)export\s+(class|function|const|let|var)\b/, "$1$2"))
        .join("\n");
}

const glMatrix = await readFile(join(root, "vendor/gl-matrix-min.js"), "utf8");

const parts = [];
for (const rel of MODULES) {
    const code = await readFile(join(root, rel), "utf8");
    parts.push(`// ===== ${rel} =====\n${stripModuleSyntax(code).trim()}`);
}
const engine = parts.join("\n\n");

const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Raptor Engine</title>
    <!--
        GENERATED FILE — do not edit by hand.
        Source: components/ + vendor/gl-matrix-min.js
        Regenerate with: node tools/build-standalone.mjs
        This file is fully self-contained: open it directly in any browser.
    -->
    <style>
        html, body { margin: 0; height: 100%; background: #111; }
        body { display: flex; align-items: center; justify-content: center; }
        #gameWindow { max-width: 100%; height: auto; }
    </style>
</head>
<body>
    <script>${glMatrix}</script>
    <script>
${engine}
    </script>
</body>
</html>
`;

await writeFile(join(root, "index.html"), html, "utf8");
console.log("Wrote index.html (%d KB, %d modules inlined)", Math.round(html.length / 1024), MODULES.length);
