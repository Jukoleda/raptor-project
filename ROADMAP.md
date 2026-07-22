# Roadmap

Plan de evolución de **raptor-project**, un motor de render 2D sobre WebGL.

Las Fases 1 y 2 (render loop, limpieza de bugs, gl-matrix) están completadas, y
la Fase 3 está en marcha: el sistema de formas ya existe. Ver el
[CHANGELOG](./CHANGELOG.md) para el detalle. Este documento recoge lo pendiente.

---

## Fase 3 — Arquitectura del motor

Objetivo: dejar de ser un demo de un solo cuadrado y convertirse en un motor
capaz de manejar múltiples objetos.

- [x] **Lista de entidades.** `RaptorEngine` tiene `entities[]`, `add()` y
      `start()`; el `renderLoop` dibuja todas las entidades.
- [x] **Separar archivos.** Las figuras viven en `components/shapes/`; el motor
      quedó independiente de las formas.
- [x] **Reutilizar helpers.** `Shape` centraliza shaders/buffers/draw y cachea el
      programa compilado por contexto.
- [x] **Primitivas básicas.** `Rectangle`, `Square`, `Triangle`, `Circle`,
      `RegularPolygon` y `Polygon`.
- [ ] **Animación con delta-time.** Reactivar la rotación/animación usando el
      tiempo entre frames (`deltaTime`) para que sea independiente del framerate.
- [ ] **Polígonos cóncavos.** `Polygon` sólo rellena convexos (TRIANGLE_FAN);
      añadir triangulación (ear clipping) para formas cóncavas.
- [ ] **Contornos / stroke.** Modo wireframe además del relleno.
- [ ] **Sprites con textura.**

## Fase 4 — Infraestructura del proyecto

Objetivo: preparar el repositorio para desarrollo continuo.

- [ ] **`package.json`** con un servidor de desarrollo estático (p. ej. `vite`).
- [ ] **Linter** (ESLint) con configuración base y script `npm run lint`.
- [ ] **gl-matrix como dependencia npm** (en vez de CDN) una vez haya build,
      importándolo como módulo ES.
- [ ] **Tests** para la lógica no gráfica (transformaciones, utilidades).

## Ideas futuras

- Sistema de input (teclado / ratón).
- Cámara 2D con paneo y zoom.
- Detección de colisiones básica.
- Bucle de juego con estados (update / render separados).

> **Nota sobre 3D:** el pipeline actual ya usa matrices de proyección en
> perspectiva y model-view (gl-matrix), por lo que el salto a 3D es viable en el
> futuro. Por ahora el foco se mantiene en 2D.
