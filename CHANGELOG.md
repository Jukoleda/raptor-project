# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/).

## [Sin publicar] - 2026-07-22

### Añadido (Armas y balística)
- **Módulo de armas** (`components/weapons/`):
  - `ballistics.js` — balas como **raycast** (segmento barrido) contra las aristas
    del blanco: da punto de impacto y normal de la cara, evitando *tunneling*.
    Modelo de penetración `blindajeEfectivo = nominal / cos(θ)` con resultado
    **penetra / rebota (≥70°) / no penetra**.
  - `bullet.js` — proyectil con posición previa para colisión continua.
  - `weapon.js` — arma con penetración, velocidad de boca, recarga y daño.
  - `armor.js` — blindaje por cara (frontal/lateral/trasera) e integridad (HP);
    helper `Armor.rectangle`.
- **Demo `tanks.html`** (fuente `weapons/tanksDemo.js`): cañón que dispara contra
  un blanco cuyo blindaje se puede **rotar** para ver PENETRA / REBOTE / NO PENETRA
  según el ángulo, con HUD (cara, ángulo, blindaje efectivo, penetración) y barra
  de integridad. Controles: Espacio / clic disparan, ←/→ rotan, sliders de
  penetración, ángulo y blindaje frontal. Handle `window.raptorTanks`.
- **Build:** `tools/build-standalone.mjs` genera también `tanks.html`; entrada de
  desarrollo `tanks-dev.html`.
- **Alcance:** balas rectas (sin gravedad) y respuesta binaria por cara plana;
  penetración por ángulo/blindaje. Sin fragmentación ni sobrepenetración.

### Añadido (Física — Fase A: colisiones)
- **Módulo de física** (`components/physics/`):
  - `Body` — componente que se adjunta a una forma: tipo (`static` / `dynamic`),
    velocidad, masa/`invMass`, restitución (rebote) y filtrado de colisión
    (`groupIndex` estilo Box2D + `category`/`mask`).
  - `collision.js` — detección convexa: círculo-círculo, **SAT** polígono-polígono
    y círculo-polígono; devuelve normal + penetración. Aprovecha que todas las
    formas son convexas.
  - `World` — `step(dt)`: integra, detecta y resuelve (corrección posicional +
    impulso con restitución), con **grupos de colisión** y **límites** (bounds)
    del mundo. Escala O(n²), suficiente para el tamaño actual.
- **Colliders en las formas:** `getColliderVertices()` en rectángulo, cuadrado,
  triángulo y polígonos; `Circle` se trata como círculo real (`colliderShape`).
- **`RaptorEngine`:** el `renderLoop` calcula **delta-time** y ejecuta *updaters*
  (`addUpdater(fn)`) antes de dibujar. Base para física/animación/input.
- **Editor con física:** controles de **cuerpo** (dinámico / estático / sin física),
  **grupo** de colisión y **rebote** por forma, más **Play/Pausa**, **Gravedad**
  y **Reiniciar** (restaura posiciones y velocidades). Handle de depuración
  `window.raptorEditor`.
- **Nota de alcance:** Fase A es rigid-body **lineal** (sin respuesta angular) y no
  incluye soft body, que queda para una fase posterior (PBD + geometría dinámica).

### Añadido (Editor visual)
- **Editor básico de escena** (`editor.html`, fuente en `editor/editor.js`):
  canvas del motor + panel para **añadir** formas, **listarlas** y **seleccionarlas**,
  y **editar en vivo** color, posición, rotación y escala de la seleccionada, más
  **eliminar**. La edición es directa porque el motor lee el transform de cada
  entidad en `draw()`. Se genera autocontenido igual que `index.html`.
- **`RaptorEngine`**: `createWindow(mount)` admite montar el canvas en un
  contenedor (por defecto `document.body`) y expone `engine.canvas`; nuevo
  `remove(entity)` para quitar entidades.
- **`tools/build-standalone.mjs`** ahora genera varias páginas (`index.html` y
  `editor.html`) desde un mismo pipeline. Entrada de desarrollo `editor-dev.html`.

### Añadido (Distribución)
- **`index.html` autocontenido.** Nuevo build de un solo archivo con gl-matrix y
  todo el motor embebidos, que se abre en cualquier navegador con doble clic, sin
  servidor ni internet (funciona por `file://`). Es un archivo generado.
- **`tools/build-standalone.mjs`** genera ese `index.html` a partir de los módulos
  de `components/` y `vendor/gl-matrix-min.js` (desenrolla import/export e inlinea
  todo). Regenerar con `node tools/build-standalone.mjs`.
- **`vendor/gl-matrix-min.js`**: copia vendorizada de gl-matrix 3.4.3 para el build.
- La entrada de desarrollo basada en módulos ES se movió a **`dev.html`** (sigue
  usando gl-matrix por CDN y requiere servirse por HTTP).

### Añadido (Fase 3 — Sistema de formas)
- **Clase base `Shape`** (`components/shapes/shape.js`) que encapsula todo el
  pipeline común: shaders, buffers, transform (posición, rotación, escala, color)
  y `draw()`. Cada figura solo implementa `getVertices()` y su modo de dibujo.
- **Programa de shaders compartido y cacheado por contexto** (`WeakMap`): se
  compila y enlaza una sola vez y lo reutilizan todas las figuras, en lugar de
  recompilarlo por objeto.
- **Primitivas nuevas:** `Rectangle`, `Square`, `Triangle`, `Circle`,
  `RegularPolygon` (N lados) y `Polygon` (puntos arbitrarios, convexo).
- **API fluida (encadenable):** `setColor`, `setPosition`, `setScale`,
  `setRotation`, `setDepth` e `init()` devuelven la instancia. Recolorear tras
  `init()` reescribe el buffer de color sin reconstruir la geometría.
- **Barrel `components/shapes/index.js`** para importar todas las figuras de una.
- **Motor basado en entidades.** `RaptorEngine` ahora expone `add(entity)` y
  `start()`, y el `renderLoop` dibuja todas las entidades registradas. Sustituye
  al antiguo `draw()` que tenía un cuadrado cableado. `Square` se movió fuera de
  `raptorEngine.js`.

### Corregido (Fase 1 — Render loop)
- **Bucle de render unificado.** Antes existían tres bucles `requestAnimationFrame`
  independientes y sin orden garantizado (`drawClearColor`, `clearScreen` y
  `Square.draw`), lo que podía provocar parpadeo o que el objeto desapareciera.
  Ahora hay un único `renderLoop` en `RaptorEngine` que ejecuta, en orden y
  dentro del mismo frame: limpiar pantalla → dibujar → agendar el siguiente frame.
- **Configuración de GL movida a inicialización.** `clearColor` y el estado del
  contexto ya no se reconfiguran en cada frame; se establecen una sola vez en el
  nuevo método `configure()`.
- `Square.draw` ya no se auto-agenda con `requestAnimationFrame`; el motor es
  quien controla el frame.

### Corregido (Fase 2 — Bugs y limpieza)
- **Uniform fantasma eliminado.** Se quitó `getUniformLocation(..., "uScale")`,
  que apuntaba a un uniform inexistente en el shader y siempre devolvía `null`.
  El escalado se sigue aplicando correctamente mediante `mat4.scale`.
- **Carga duplicada de script eliminada.** `index.html` cargaba `raptorEngine.js`
  por partida doble (etiqueta `<script>` + `import` en `main.js`). Ahora solo se
  carga `main.js`, que importa el motor.
- **Estado GL adecuado para 2D.** Se desactivó `DEPTH_TEST` (innecesario en 2D) y
  se activó el blending alpha (`BLEND` + `blendFunc`) para soportar transparencias.
- Se eliminó código muerto y bloques comentados (arrays de colores alternativos,
  llamadas `requestAnimationFrame` comentadas, `vertexCount` sin uso).

### Cambiado (Dependencias)
- **gl-matrix actualizado de 2.8.1 a 3.4.3** vía CDN, con su hash SRI actualizado.
  La v3 expone sus módulos bajo el namespace global `glMatrix`, por lo que el
  código ahora accede a `glMatrix.mat4` en lugar del antiguo global suelto `mat4`.

### Otros
- `index.html`: título cambiado de "Document" a "Raptor Engine".
