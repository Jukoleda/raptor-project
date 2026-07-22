// Builds self-contained HTML pages that open in any browser by double-clicking
// them (no server, no internet). Each page inlines gl-matrix and the engine
// source, so the generated .html files are GENERATED — edit the modules under
// components/ (and editor/) and re-run this script:
//
//     node tools/build-standalone.mjs
//
// For module-based development (with real ES imports) use the *-dev.html pages
// plus a static server instead.

import { readFile, writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Engine modules, in dependency order (base classes first). Barrel files
// (shapes/index.js, physics/index.js) are skipped: they only re-export.
const ENGINE = [
    "components/shapes/shape.js",
    "components/shapes/rectangle.js",
    "components/shapes/square.js",
    "components/shapes/triangle.js",
    "components/shapes/polygon.js",
    "components/shapes/circle.js",
    "components/raptorEngine.js",
];

// Physics modules, in dependency order (body + collision before world).
const PHYSICS = [
    "components/physics/body.js",
    "components/physics/collision.js",
    "components/physics/world.js",
];

// Weapons / ballistics modules. Order: ballistics before projectiles (uses
// evaluateImpact), projectiles before bullet/weapon (they default to a type),
// bullet before weapon.
const WEAPONS = [
    "components/weapons/ballistics.js",
    "components/weapons/projectiles.js",
    "components/weapons/bullet.js",
    "components/weapons/weapon.js",
    "components/weapons/armor.js",
];

// One entry per generated page: an explicit module list ending in a bootstrap.
const PAGES = [
    {
        out: "engine.html",
        title: "Raptor Engine — Formas",
        modules: [...ENGINE, "components/main.js"],
        headStyle: `
        html, body { margin: 0; height: 100%; background: #111; }
        body { display: flex; align-items: center; justify-content: center; }
        #gameWindow { max-width: 100%; height: auto; }`,
    },
    {
        out: "editor.html",
        title: "Raptor Editor",
        modules: [...ENGINE, ...PHYSICS, "editor/editor.js"],
        // The editor injects its own styles from JS; the body starts empty.
        headStyle: "",
    },
    {
        out: "tanks.html",
        title: "Raptor — Cañón vs Blindaje",
        modules: [...ENGINE, ...WEAPONS, "weapons/tanksDemo.js"],
        // The demo injects its own styles from JS; the body starts empty.
        headStyle: "",
    },
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

async function inline(rel) {
    const code = await readFile(join(root, rel), "utf8");
    return `// ===== ${rel} =====\n${stripModuleSyntax(code).trim()}`;
}

const glMatrix = await readFile(join(root, "vendor/gl-matrix-min.js"), "utf8");

for (const page of PAGES) {
    const bundle = [];
    for (const rel of page.modules) bundle.push(await inline(rel));
    const engine = bundle.join("\n\n");

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${page.title}</title>
    <!--
        GENERATED FILE — do not edit by hand.
        Source: ${page.modules.join(", ")} + vendor/gl-matrix-min.js
        Regenerate with: node tools/build-standalone.mjs
        This file is fully self-contained: open it directly in any browser.
    -->
    <style>${page.headStyle}
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

    await writeFile(join(root, page.out), html, "utf8");
    console.log("Wrote %s (%d KB)", page.out, Math.round(html.length / 1024));
}
