// Raptor's build. Two outputs from one module graph:
//
//   dist/       the framework as a library — raptor.js (ESM) and
//               raptor.global.js (a classic <script> that sets window.Raptor)
//   *.html      the demos, each a single self-contained file you can open by
//               double-clicking: no server, no network, no build on the user's
//               side
//
//     node tools/build.mjs           build everything
//     node tools/build.mjs --check   validate without writing anything
//
// How it works, and why it is written this way:
//
// The generated pages are plain <script> — no modules — so every declaration
// lands in one shared global scope. That has a sharp edge: two files declaring
// the same top-level `const` is a SyntaxError that blanks the whole page, and
// two declaring the same `function` silently shadow each other. The old build
// listed each page's modules by hand, in dependency order, which meant both
// failure modes were one forgotten edit away — and both happened, more than
// once.
//
// So this build does not take a list. It reads the `import` statements, walks
// the graph from each entry point, and emits the modules in dependency order.
// Then it checks every top-level name across each bundle and *fails* if two
// files collide. Adding a module to a demo is now: import it.

import { readFile, writeFile, mkdir } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join, resolve as resolvePath, relative } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK_ONLY = process.argv.includes("--check");

// --- Pages ---------------------------------------------------------------
// Each entry is a module; its imports decide what goes in the bundle.

const PAGES = [
    { out: "engine.html", title: "Raptor Engine — Formas", entry: "components/main.js" },
    { out: "editor.html", title: "Raptor Editor", entry: "editor/editor.js" },
    { out: "tanks.html", title: "Raptor — Cañón vs Blindaje", entry: "weapons/tanksDemo.js" },
    { out: "dyno.html", title: "Raptor — Banco de pruebas: motor y caja", entry: "vehicles/dynoDemo.js" },
    { out: "drive.html", title: "Raptor — Batalla de tanques", entry: "controls/driveDemo.js" },
    { out: "sprites.html", title: "Raptor — Sprites y animación", entry: "sprites/spritesDemo.js" },
    { out: "assets.html", title: "Raptor — Carga de assets", entry: "assets/assetsDemo.js" },
];

// The library build. Its entry is the framework's public surface.
const LIBRARY = { entry: "raptor.js", name: "Raptor" };

// --- Module graph --------------------------------------------------------

const IMPORT_RE = /^\s*import\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']\s*;?\s*$/gm;
const REEXPORT_RE = /^\s*export\s+(\*|\{[^}]*\})\s*from\s*["']([^"']+)["']\s*;?\s*$/gm;

// Only relative specifiers are part of the graph — a bare "gl-matrix" would be
// a vendor script, and there are none in the source.
function isLocal(spec) {
    return spec.startsWith("./") || spec.startsWith("../");
}

function resolveSpec(fromFile, spec) {
    return relative(root, resolvePath(dirname(join(root, fromFile)), spec)).split("\\").join("/");
}

async function readModule(rel, cache) {
    if (!cache.has(rel)) cache.set(rel, await readFile(join(root, rel), "utf8"));
    return cache.get(rel);
}

function dependenciesOf(code, rel) {
    const deps = [];
    for (const re of [IMPORT_RE, REEXPORT_RE]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(code)) !== null) {
            const spec = re === IMPORT_RE ? m[1] : m[2];
            if (isLocal(spec)) deps.push(resolveSpec(rel, spec));
        }
    }
    return deps;
}

// Post-order depth-first walk: a module is emitted only after everything it
// imports, which is exactly the order a flat script needs. Cycles are reported
// rather than hung on — with `class B extends A` across files, a cycle is a
// real bug, not a style choice.
async function moduleOrder(entry, cache) {
    const order = [];
    const state = new Map(); // rel -> "visiting" | "done"
    const cycles = [];

    async function visit(rel, stack) {
        if (state.get(rel) === "done") return;
        if (state.get(rel) === "visiting") {
            cycles.push([...stack.slice(stack.indexOf(rel)), rel].join(" → "));
            return;
        }
        state.set(rel, "visiting");
        const code = await readModule(rel, cache);
        for (const dep of dependenciesOf(code, rel)) await visit(dep, [...stack, rel]);
        state.set(rel, "done");
        order.push(rel);
    }

    await visit(entry, []);
    return { order, cycles };
}

// --- Source transforms ---------------------------------------------------

// Turns a module into plain script text. Imports and re-exports vanish (the
// bundle is one scope, so the bindings are already there); `export` keywords
// are dropped so declarations stay declarations.
function stripModuleSyntax(code) {
    return code
        .replace(IMPORT_RE, "")
        .replace(REEXPORT_RE, "")
        .split("\n")
        .filter((line) => !/^\s*export\s*\{[^}]*\}\s*;?\s*$/.test(line))
        .map((line) => line.replace(/^(\s*)export\s+default\s+(class|function|async\s+function)\b/, "$1$2"))
        .map((line) => line.replace(/^\s*export\s+default\s+([A-Za-z_$][\w$]*)\s*;\s*$/, ""))
        .map((line) => line.replace(/^(\s*)export\s+(class|function|async\s+function|const|let|var)\b/, "$1$2"))
        .join("\n");
}

// Top-level declarations, found by column: everything in this codebase indents
// inside a block, so a declaration starting at column 0 is top-level. That is a
// heuristic, but a checked one — a false positive would only ever *add* a
// collision report, never hide one.
const DECL_RE = /^(?:export\s+(?:default\s+)?)?(const|let|var|class|function|async\s+function)\s+([A-Za-z_$][\w$]*)/gm;

function topLevelNames(code) {
    const names = [];
    DECL_RE.lastIndex = 0;
    let m;
    while ((m = DECL_RE.exec(code)) !== null) names.push({ kind: m[1], name: m[2] });
    return names;
}

// --- Public exports ------------------------------------------------------
// Walks the re-export chain from an entry to work out which global each public
// name refers to. Used to build the library's export list, and to prove every
// advertised name actually exists in the bundle.

async function defaultExportName(rel, cache) {
    const code = await readModule(rel, cache);
    const declared = code.match(/^export\s+default\s+(?:class|function|async\s+function)\s+([A-Za-z_$][\w$]*)/m);
    if (declared) return declared[1];
    const referenced = code.match(/^export\s+default\s+([A-Za-z_$][\w$]*)\s*;/m);
    return referenced ? referenced[1] : null;
}

async function publicExports(rel, cache, seen = new Set()) {
    if (seen.has(rel)) return new Map();
    seen.add(rel);
    const code = await readModule(rel, cache);
    const map = new Map(); // public name -> global name

    // Names this module declares and exports itself.
    for (const m of code.matchAll(/^export\s+(?:const|let|var|class|function|async\s+function)\s+([A-Za-z_$][\w$]*)/gm)) {
        map.set(m[1], m[1]);
    }

    // A local `export { A as B };` — no `from`. The clause is stripped from the
    // bundle, so without this the public name B would point at nothing and the
    // check below would report it as missing with no hint as to why.
    for (const m of code.matchAll(/^export\s*\{([^}]*)\}\s*;?\s*$/gm)) {
        for (const part of m[1].split(",")) {
            const piece = part.trim();
            if (!piece) continue;
            const [local, exported = local] = piece.split(/\s+as\s+/).map((t) => t.trim());
            map.set(exported, local);
        }
    }

    REEXPORT_RE.lastIndex = 0;
    let m;
    while ((m = REEXPORT_RE.exec(code)) !== null) {
        const [, clause, spec] = m;
        if (!isLocal(spec)) continue;
        const target = resolveSpec(rel, spec);
        if (clause === "*") {
            for (const [pub, global] of await publicExports(target, cache, seen)) map.set(pub, global);
            continue;
        }
        for (const part of clause.slice(1, -1).split(",")) {
            const piece = part.trim();
            if (!piece) continue;
            const [local, exported = local] = piece.split(/\s+as\s+/).map((s) => s.trim());
            map.set(exported, local === "default" ? await defaultExportName(target, cache) : local);
        }
    }
    return map;
}

// --- Assembly ------------------------------------------------------------

async function bundle(entry, cache, label) {
    const { order, cycles } = await moduleOrder(entry, cache);
    if (cycles.length) {
        throw new Error(`${label}: ciclo de imports\n  ${cycles.join("\n  ")}`);
    }

    const seen = new Map(); // name -> file that declared it
    const problems = [];
    const parts = [];

    for (const rel of order) {
        const stripped = stripModuleSyntax(await readModule(rel, cache));
        for (const { kind, name } of topLevelNames(stripped)) {
            if (seen.has(name)) {
                problems.push(`${name} (${kind}) — ${rel} y ${seen.get(name)}`);
            } else {
                seen.set(name, rel);
            }
        }
        const body = stripped.trim();
        if (body) parts.push(`// ===== ${rel} =====\n${body}`);
    }

    if (problems.length) {
        throw new Error(
            `${label}: nombres duplicados en el ámbito global del bundle.\n` +
            `En un <script> plano dos declaraciones con el mismo nombre son un\n` +
            `SyntaxError (const/class) o un solapamiento silencioso (function).\n\n  ` +
            problems.join("\n  "),
        );
    }

    return { code: parts.join("\n\n"), modules: order, names: seen };
}

function page({ title, modules, code, glMatrix }) {
    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <!--
        GENERATED FILE — do not edit by hand.
        Source: ${modules.join(", ")} + vendor/gl-matrix-min.js
        Regenerate with: node tools/build.mjs
        This file is fully self-contained: open it directly in any browser.
    -->
</head>
<body>
    <script>${glMatrix}</script>
    <script>
${code}
    </script>
</body>
</html>
`;
}

// --- Run -----------------------------------------------------------------

const cache = new Map();
const glMatrix = await readFile(join(root, "vendor/gl-matrix-min.js"), "utf8");
const written = [];

async function emit(rel, contents) {
    if (CHECK_ONLY) return;
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), contents, "utf8");
    written.push([rel, Math.round(contents.length / 1024)]);
}

// The library, first: if the public surface is broken every page is suspect.
{
    const { code, modules, names } = await bundle(LIBRARY.entry, cache, "dist/raptor.js");
    const exports = await publicExports(LIBRARY.entry, cache);

    const missing = [...exports].filter(([, global]) => !global || !names.has(global));
    if (missing.length) {
        throw new Error(
            "La API pública anuncia nombres que el bundle no declara:\n  " +
            missing.map(([pub, global]) => `${pub} → ${global || "(export default sin nombre)"}`).join("\n  "),
        );
    }

    const clause = [...exports]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([pub, global]) => (pub === global ? pub : `${global} as ${pub}`))
        .join(",\n    ");

    const banner = `// Raptor ${JSON.parse(await readFile(join(root, "package.json"), "utf8")).version} — GENERADO por tools/build.mjs, no editar a mano.\n` +
        `// Fuente: ${LIBRARY.entry} y sus dependencias (${modules.length} módulos).\n`;

    await emit("dist/raptor.js", `${banner}\n${code}\n\nexport {\n    ${clause},\n};\n`);

    // The same bundle for a plain <script src>: no modules, one global.
    await emit("dist/raptor.global.js",
        `${banner}// Uso: <script src="raptor.global.js"></script> y luego window.${LIBRARY.name}.\n` +
        `(function (root) {\n"use strict";\n\n${code}\n\n` +
        `root.${LIBRARY.name} = {\n    ${[...exports.keys()].sort().map((k) => `${k}: ${exports.get(k)}`).join(",\n    ")},\n};\n` +
        `})(typeof globalThis !== "undefined" ? globalThis : this);\n`);

    console.log(`API pública: ${exports.size} nombres desde ${modules.length} módulos`);
}

for (const spec of PAGES) {
    const { code, modules } = await bundle(spec.entry, cache, spec.out);
    await emit(spec.out, page({ ...spec, modules, code, glMatrix }));
    if (CHECK_ONLY) console.log(`ok ${spec.out.padEnd(12)} ${modules.length} módulos`);
}

if (CHECK_ONLY) {
    console.log("\nSin duplicados ni ciclos. Nada escrito (--check).");
} else {
    for (const [rel, kb] of written) console.log("Wrote %s (%d KB)", rel, kb);
}
