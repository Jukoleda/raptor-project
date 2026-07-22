# Roadmap

Plan de evolución de **raptor-project**, un motor de render 2D sobre WebGL.

Las Fases 1 y 2 (arreglo del render loop, limpieza de bugs y actualización de
gl-matrix) ya están completadas — ver el [CHANGELOG](./CHANGELOG.md). Este
documento recoge el trabajo pendiente.

---

## Fase 3 — Arquitectura del motor

Objetivo: dejar de ser un demo de un solo cuadrado y convertirse en un motor
capaz de manejar múltiples objetos.

- [ ] **Lista de entidades.** Introducir un array `entities[]` que el `renderLoop`
      recorra y dibuje, en lugar de tener el cuadrado cableado en el motor.
- [ ] **Separar archivos.** Mover `Square` a su propio módulo (p. ej.
      `components/shapes/square.js`) y dejar `raptorEngine.js` solo con el motor.
- [ ] **Reutilizar helpers.** Extraer `loadShader` y la compilación/enlace del
      programa a un módulo común, para no duplicarlos en cada figura.
- [ ] **Animación con delta-time.** Reactivar la rotación/animación usando el
      tiempo entre frames (`deltaTime`) para que sea independiente del framerate.
- [ ] **Más primitivas.** Triángulo, círculo y sprites con textura.

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
