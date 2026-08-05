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
- [x] **Delta-time.** El `renderLoop` calcula `dt` y ejecuta *updaters* antes de
      dibujar (`addUpdater`). Base para física/animación/input.
- [ ] **Animación con delta-time.** Usar `dt` para animar transformaciones
      (rotación continua, tweens) además de la física.
- [ ] **Polígonos cóncavos.** `Polygon` sólo rellena convexos (TRIANGLE_FAN);
      añadir triangulación (ear clipping) para formas cóncavas.
- [ ] **Contornos / stroke.** Modo wireframe además del relleno.
- [ ] **Sprites con textura.**

## Editor visual

Existe un editor básico (`editor.html`): añadir/seleccionar formas y editar
color, posición, rotación y escala en vivo. Mejoras posibles:

- [ ] **Selección por clic** en el canvas (picking), no sólo desde la lista.
- [ ] **Manipuladores** (mover/rotar/escalar arrastrando sobre el canvas).
- [ ] **Guardar / cargar** la escena (export a JSON).
- [ ] **Deshacer / rehacer**.
- [ ] **Reordenar** (z-order) y duplicar formas.

## Física (colisiones)

**Fase A — completada:** módulo `components/physics/` con `Body` (static /
dynamic), `World` (integración + colisiones), detección convexa (círculo y SAT
para polígonos), corrección posicional + impulso, **grupos de colisión** y
límites del mundo. Integrado en el editor (tipo de cuerpo, grupo, rebote,
play/pausa, gravedad). Es rigid-body **lineal**.

- [ ] **Fase B — Soft body.** Cuerpos deformables con Position-Based Dynamics
      (malla de masas + constraints) y geometría dinámica (buffer por frame).
      Es un módulo aparte porque cambia el pipeline de render.
- [ ] **Respuesta angular.** Torque e inercia para que los cuerpos giren al
      chocar (rigid-body completo).
- [ ] **Fricción** tangencial en el contacto.
- [ ] **Broadphase espacial** (grid / quadtree) si crece el número de cuerpos
      (hoy es O(n²), suficiente para pocas formas).

## Armas y balística

**Completado:** módulo `components/weapons/` (arma, bala por raycast, blindaje por
cara) con modelo de penetración por blindaje/ángulo (penetra / rebota / no
penetra), **tipos de proyectil con esquema de daño** (AP / APCR / HEAT / HE) y
demo `tanks.html`. Mejoras posibles:

- [x] **Tipos de proyectil / esquema de daño:** `projectiles.js` con AP, APCR,
      HEAT y HE; cada tipo ajusta penetración, daño, rebote y sensibilidad al
      ángulo, y HE astilla al blanco aun sin penetrar.
- [ ] **Sobrepenetración:** tras penetrar, la bala sigue con penetración reducida.
- [ ] **Daño por área (HE radial):** hoy el HE sólo astilla la cara impactada;
      falta radio de explosión que afecte a varios blancos/caras.
- [ ] **Blindaje espaciado** y multi-capa (necesario para modelar bien el HEAT).
- [ ] **Balística con gravedad** (obuses en arco) además del tiro tenso.
- [x] **Mini-juego jugable:** `drive.html` es una batalla contra cuatro tanques
      con IA, con HUD, barras de vida y victoria/derrota. Falta puntuación.

## Fase 4 — Infraestructura del proyecto

Objetivo: preparar el repositorio para desarrollo continuo.

- [x] **Despliegue en GitHub Pages.** Workflow `.github/workflows/deploy.yml` que
      regenera las páginas y publica en cada push a `main`; portada en
      `index.html`. Sitio en <https://jukoleda.github.io/raptor-project/>.
- [ ] **`package.json`** con un servidor de desarrollo estático (p. ej. `vite`).
- [ ] **Linter** (ESLint) con configuración base y script `npm run lint`.
- [ ] **gl-matrix como dependencia npm** (en vez de CDN) una vez haya build,
      importándolo como módulo ES.
- [ ] **Tests** para la lógica no gráfica (transformaciones, utilidades).

## Controles / input

**Completado:** `components/controls/TankController` mueve una forma con controles
estilo tanque (acelerador + giro sobre el eje, fricción y límites), con binding
de teclado WASD/flechas incluido. Demo `drive.html`. Mejoras posibles:

- [x] **Colisión al conducir:** el tanque (círculo) choca con muros y obstáculos
      (AABB) por expulsión en `drive.html`, con minimapa de todo el mapa. Falta
      integrarlo con el módulo de física (`components/physics/`) para cuerpos
      dinámicos (empujar cajas, respuesta con masa) en vez del resolver ligero.
- [x] **Torreta apuntable:** `components/vehicles/Tank` (casco + torreta que gira
      independiente, con cadencia por diseño) y cuatro diseños con formas
      distintas; se apunta con ratón/dedo vía `Camera.screenToWorld()`.
- [x] **Disparar mientras se conduce:** `drive.html` engancha `Tank.muzzle` y la
      dirección de la torreta a `components/weapons/`; los proyectiles impactan
      contra tanques (círculo) y escenario (AABB).
- [x] **Tanques enemigos / IA:** `components/controls/TankAI`, máquina de estados
      (patrulla → persigue → ataca → se retira) con línea de tiro y detección de
      atasco. Cuatro enemigos en `drive.html`.
- [x] **Caja de cambios:** `components/controls/Gearbox` con marchas, curva de
      par, corte de transmisión al cambiar y modos **automático/manual**; una
      caja distinta por diseño de tanque.
- [x] **Auto-apuntado:** `components/controls/AutoAim` con políticas en ciclo
      (más cercano → menos vida → más vida → más fuerte → off), retícula sobre el
      objetivo y marca en el minimapa.
- [x] **Fuego automático:** botón/tecla que mantiene el gatillo, espera a que la
      torreta esté alineada y no dispara a través de la cobertura.
- [x] **Balística en la batalla:** `drive.html` usa el modelo de penetración por
      cara y ángulo, con tipos de proyectil (AP/APCR/HEAT/HE) y rebote, en vez de
      daño plano. Blindaje por cara derivado de la silueta (`Armor.forHull`).
- [ ] **Gamepad** además del teclado.
- [x] **Modo con objetivo:** rey de la colina por equipos (5 aliados + jugador
      contra 5 enemigos) con zona central y 30 s de control para ganar; la IA
      gana el estado `ADVANCE` para tomar y defender terreno.
- [ ] **Oleadas / puntuación:** hoy es una batalla única; falta progresión.
- [ ] **Más modos:** captura de banderas, escolta, dominación con varias zonas.
- [x] **Colisiones por forma:** los cascos chocan por su contorno real (SAT de
      `components/physics/`) con filtro por radio, no como círculos.
- [ ] **Órdenes al escuadrón:** hoy los aliados van siempre a la zona; poder
      pedirles que defiendan o ataquen daría control táctico.
- [ ] **Zonas / puntos de interés** en el mapa grande (hoy es una llanura con
      cobertura dispersa).
- [ ] **IA con cobertura:** usar los obstáculos para cubrirse, no solo para
      bloquear la línea de tiro.

## Cámara

**Completado:** `components/camera.js` — cámara 2D con paneo y zoom integrada en
`RaptorEngine` (todas las entidades se dibujan a través de `game.camera`),
`follow(objetivo, dt)` suave y límites de mapa (`bounds`). `drive.html` la usa
sobre un mapa mayor que la pantalla. Mejoras posibles:

- [ ] **Zoom interactivo** (rueda / pellizco) en las demos.
- [ ] **Deadzone / adelanto** (mirar hacia donde se avanza).
- [ ] **Sacudida de cámara** (screen shake) para impactos.

## Ideas futuras

- Picking en el editor teniendo en cuenta la cámara (el helper
  `Camera.screenToWorld()` ya está disponible).
- Bucle de juego con estados (update / render separados).

> **Nota sobre 3D:** el pipeline actual ya usa matrices de proyección en
> perspectiva y model-view (gl-matrix), por lo que el salto a 3D es viable en el
> futuro. Por ahora el foco se mantiene en 2D.
