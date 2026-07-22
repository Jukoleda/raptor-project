# raptor-project

Un motor de render **2D** ligero construido sobre **WebGL**, en JavaScript puro
(módulos ES). Usa [gl-matrix](https://glmatrix.net/) para las operaciones con
matrices. Cada demo se distribuye además como un `.html` autocontenido que se
abre en cualquier navegador sin servidor ni conexión.

**▶ En vivo:** <https://jukoleda.github.io/raptor-project/>

El motor inicializa un canvas WebGL, mantiene una lista de entidades y las dibuja
en un único bucle de render. Incluye un juego de formas básicas (rectángulo,
cuadrado, triángulo, círculo, polígono regular y polígono arbitrario), cada una
con color, posición, rotación y escala configurables.

## Estructura

```
index.html                 # Portada (escrita a mano): enlaza las demos
engine.html                # GENERADO: demo de formas autocontenido, doble clic
editor.html                # GENERADO: editor visual autocontenido, doble clic
tanks.html                 # GENERADO: demo cañón vs blindaje, doble clic
drive.html                 # GENERADO: demo conducción de tanque, doble clic
dev.html                   # Demo en desarrollo (módulos ES + gl-matrix por CDN)
editor-dev.html            # Editor en desarrollo (módulos ES + gl-matrix por CDN)
tanks-dev.html             # Demo de tanques en desarrollo (módulos ES + CDN)
drive-dev.html             # Demo de conducción en desarrollo (módulos ES + CDN)
.github/workflows/
  deploy.yml               # Despliega el sitio en GitHub Pages en cada push a main
vendor/
  gl-matrix-min.js         # Copia vendorizada de gl-matrix (para el build offline)
tools/
  build-standalone.mjs     # Genera engine/editor/tanks .html desde el source
editor/
  editor.js                # Editor visual: UI + edición en vivo de las entidades
weapons/
  tanksDemo.js             # Demo de armas: cañón, blanco con blindaje y HUD
controls/
  driveDemo.js             # Demo de conducción: tanque manejable + HUD
components/
  raptorEngine.js          # RaptorEngine: canvas + lista de entidades + render loop
  main.js                  # Arranque: crea el motor, añade formas y arranca
  shapes/
    shape.js               # Clase base: shaders, buffers, transform y draw()
    rectangle.js           # Rectangle
    square.js              # Square (extiende Rectangle)
    triangle.js            # Triangle
    circle.js              # Circle (extiende RegularPolygon)
    polygon.js             # Polygon (puntos) y RegularPolygon (N lados)
    index.js               # Re-exporta todas las formas
  physics/
    body.js                # Body: tipo (static/dynamic), velocidad, masa, grupos
    collision.js           # Detección convexa (círculo + SAT de polígonos)
    world.js               # World: integra, resuelve colisiones, grupos y bounds
    index.js               # Re-exporta la física
  weapons/
    ballistics.js          # Raycast segmento-arista + modelo de penetración
    projectiles.js         # Tipos de proyectil (AP/APCR/HEAT/HE) + esquema de daño
    bullet.js              # Bullet: proyectil (raycast continuo)
    weapon.js              # Weapon: cadencia, penetración, velocidad de boca
    armor.js               # Armor: blindaje por cara + integridad (HP)
    index.js               # Re-exporta las armas
  controls/
    tankController.js      # TankController: movimiento estilo tanque + input de teclado
    index.js               # Re-exporta los controladores
```

## Cómo verlo

**Opción rápida (cualquier navegador, sin servidor ni internet):** abre con doble
clic el archivo que quieras — son builds autocontenidos con gl-matrix y todo el
motor embebidos, funcionan incluso offline vía `file://`:

- `index.html` — portada que enlaza las demos.
- `engine.html` — demo con las formas.
- `editor.html` — editor visual (ver abajo).
- `tanks.html` — demo de armas: cañón vs blindaje (ver abajo).
- `drive.html` — conducción de un tanque con teclado (ver abajo).

**Online:** publicado con GitHub Pages en
<https://jukoleda.github.io/raptor-project/>. El workflow
`.github/workflows/deploy.yml` regenera las páginas y despliega en cada push a
`main`.

**Desarrollo (con módulos ES):** `dev.html` / `editor-dev.html` usan los archivos
fuente directamente, lo que exige servirlos por HTTP (los módulos no cargan desde
`file://`). Con cualquier servidor estático:

```bash
python3 -m http.server 8000   # o: npx serve
# luego abre http://localhost:8000/dev.html  (o editor-dev.html)
```

### Regenerar los HTML

`engine.html`, `editor.html`, `tanks.html` y `drive.html` son **archivos
generados**; no los edites a mano (`index.html` sí es la portada escrita a mano).
Tras cambiar algo en `components/`, `editor/`, `weapons/` o `controls/`,
reconstrúyelos con:

```bash
node tools/build-standalone.mjs
```

## Editor visual

`editor.html` es un editor básico de escena: canvas del motor + panel de control.

- **Añadir** formas (rectángulo, cuadrado, triángulo, círculo, hexágono).
- **Escena:** lista de formas; clic para seleccionar.
- **Propiedades:** color, posición, rotación y escala de la forma seleccionada,
  con actualización **en vivo** (el motor redibuja cada frame).
- **Física** por forma: tipo de **cuerpo** (dinámico / estático / sin física),
  **grupo** de colisión y **rebote**.
- **Simulación:** **Play/Pausa**, **Gravedad** y **Reiniciar** (restaura las
  posiciones y velocidades de antes de simular).
- **Eliminar** la forma seleccionada.

La edición en vivo es directa porque el motor lee el transform de cada entidad en
`draw()`; los controles solo mutan la forma seleccionada (`setPosition`,
`setRotation`, `setScale`, `setColor`).

## Física (colisiones)

`components/physics/` añade una capa de colisiones 2D (rigid-body lineal):

- **Tipos de cuerpo:** `static` (no se mueve, masa infinita) y `dynamic` (se
  integra y responde a colisiones).
- **Detección convexa:** círculo-círculo, y **SAT** para polígono-polígono y
  círculo-polígono (todas las formas del motor son convexas).
- **Resolución:** corrección posicional + impulso con restitución (rebote).
- **Grupos de colisión:** `groupIndex` (estilo Box2D: mismo grupo negativo → se
  ignoran; positivo → siempre colisionan) más `category`/`mask` por bits.
- **Límites del mundo** (bounds) opcionales para mantener los cuerpos en pantalla.

```js
import { World, Body, STATIC } from "./physics/index.js";

const world = new World({ gravity: { x: 0, y: -6 }, bounds: { minX: -3.2, maxX: 3.2, minY: -2.4, maxY: 2.4 } });
world.add(new Body(circulo, { restitution: 0.6 }));           // dinámico
world.add(new Body(suelo, { type: STATIC }));                 // estático

game.addUpdater((dt) => world.step(dt));                       // integra en el loop
```

> **Alcance (Fase A):** rigid-body **lineal** (sin rotación por impacto). *Soft
> body* y respuesta angular quedan para una fase posterior — ver el
> [ROADMAP](./ROADMAP.md).

## Armas y balística

`components/weapons/` añade armas y balas con penetración realista por blindaje y
ángulo (estilo arcade de tanques). Pruébalo en `tanks.html`.

- **Balas por raycast:** cada frame se lanza el segmento *posición anterior →
  actual* contra las aristas del blanco. Esto evita el *tunneling* de balas
  rápidas y da el punto de impacto exacto **y la normal de la cara** — lo que el
  modelo de ángulo necesita. (Las balas no son cuerpos físicos que rebotan.)
- **Modelo de penetración:** `blindajeEfectivo = blindajeNominal / cos(θ)`, con θ
  el ángulo entre la bala y la normal de la superficie.
  - **Rebota** si θ ≥ umbral (~70°).
  - **Penetra** si `penetración ≥ blindajeEfectivo`.
  - **No penetra** en caso contrario.
- **Blindaje por cara:** frontal / lateral / trasera, deducido de qué arista
  golpea la bala. Angular el blanco cambia el blindaje efectivo.
- **Tipos de proyectil y esquema de daño** (`projectiles.js`): cada tipo escala la
  penetración y el daño del arma y ajusta el modelo de impacto.

  | Tipo | ×Penetración | ×Daño | Rebote | Notas |
  |------|:---:|:---:|:---:|-------|
  | **AP** — Perforante | 1.0 | 1.0 | 70° | Polivalente; el ángulo importa. |
  | **APCR** — Subcalibre | 1.4 | 0.7 | 68° | Más penetración, menos daño, rebota antes. |
  | **HEAT** — Carga hueca | 1.2 | 1.1 | — | Ignora la inclinación y no rebota. |
  | **HE** — Alto explosivo | 0.35 | 1.8 | — | Poca penetración, mucho daño; sin penetrar astilla (25%). |

  `resolveShot()` resuelve el impacto de principio a fin: aplica el modelo de
  penetración afinado por el tipo y devuelve los **HP causados** (penetración =
  daño completo; bloqueo = esquirlas de HE; rebote = 0).

```js
import { Weapon, Armor, raycastShape, resolveShot, PROJECTILES } from "./weapons/index.js";

const weapon = new Weapon({ penetration: 150, muzzleSpeed: 10, reload: 0.6, damage: 25 });
const armor = Armor.rectangle(tankShape, { front: 120, side: 50, rear: 30, frontEdge: 3 });

// Dispara hacia +x con carga hueca (ignora el ángulo del blindaje).
const bullet = weapon.fire(muzzleX, muzzleY, 1, 0, null, PROJECTILES.HEAT);
// ...cada frame:
bullet.update(dt);
const hit = raycastShape(bullet.prev, bullet.position, tankShape);
if (hit) {
    const face = armor.faceForEdge(hit.edgeIndex);
    const shot = resolveShot({
        type: bullet.type, penetration: bullet.penetration, damage: bullet.damage,
        direction: bullet.direction, normal: hit.normal, armor: face.armor,
    });
    // shot.result -> "penetration" | "ricochet" | "block"
    if (shot.damage > 0) armor.takeDamage(shot.damage);
}
```

## Conducción (controles de tanque)

`components/controls/TankController` mueve cualquier forma como un tanque de
orugas: el acelerador la impulsa hacia adelante/atrás según su orientación y el
volante gira el casco **sobre su eje** (giro neutral). Al soltar el acelerador,
la fricción la frena enseguida. Pruébalo en `drive.html` (W/S o ↑/↓ avanzan,
A/D o ←/→ giran). Sigue la convención del motor: rotación en grados CCW y el
eje local **+Y es «adelante»**.

```js
import { TankController } from "./controls/index.js";

const tank = new TankController(hullShape, {
    maxSpeed: 3, accel: 5, turnSpeed: 140,
    bounds: { minX: -3, maxX: 3, minY: -2.1, maxY: 2.1 }, // opcional
});
tank.bindKeys(window); // WASD + flechas (o alimenta tank.setInput({forward, turn}) tú)

// ...cada frame:
tank.update(dt);       // mueve y rota la forma; tank.forward / tank.velocity disponibles
```

## Uso básico

```js
import RaptorEngine from "./raptorEngine.js";
import { Rectangle, Circle } from "./shapes/index.js";

const game = new RaptorEngine();
game.createWindow();          // crea el canvas y el contexto WebGL
const gl = game.context;

game.add(
    new Rectangle(gl, { width: 1.4, height: 0.9 })
        .setColor({ red: 0.9, green: 0.3, blue: 0.2 })
        .setPosition({ x: -1, y: 0 })
        .init()                // sube la geometría a la GPU (llamar al final)
);

game.add(
    new Circle(gl, { radius: 0.6 })
        .setColor({ blue: 0.9 })
        .setPosition({ x: 1, y: 0 })
        .init()
);

game.start();                 // configura el estado GL y arranca el render loop
```

## Formas disponibles

Todas extienden `Shape` y comparten la misma API fluida. Los constructores
reciben el contexto WebGL y un objeto de opciones:

| Forma            | Opciones                          | Notas                                   |
| ---------------- | --------------------------------- | --------------------------------------- |
| `Rectangle`      | `{ width, height }`               |                                         |
| `Square`         | `{ size }`                        | Rectángulo de lados iguales             |
| `Triangle`       | `{ width, height }`               | Isósceles, vértice hacia arriba         |
| `Circle`         | `{ radius, segments }`            | `segments` controla la suavidad         |
| `RegularPolygon` | `{ sides, radius }`               | Polígono regular de N lados             |
| `Polygon`        | `{ points: [{x, y}, ...] }`       | Convexo (relleno con `TRIANGLE_FAN`)    |

### Métodos comunes (encadenables)

- `setColor({ red, green, blue, alpha })` — canales en `0..1` (por defecto 0, alpha 1)
- `setPosition({ x, y })`
- `setScale({ x, y })`
- `setRotation(grados)` — sentido antihorario
- `setDepth(z)` — distancia a la cámara (por defecto `-6`)
- `init()` — sube la geometría a la GPU; llámalo **al final** de la cadena

El coordenado es espacio-mundo con cámara en perspectiva; con la profundidad por
defecto (`-6`) el área visible ronda `x ∈ [-3.3, 3.3]`, `y ∈ [-2.5, 2.5]`.

## Estado y hoja de ruta

Consulta el [CHANGELOG](./CHANGELOG.md) para los cambios recientes y el
[ROADMAP](./ROADMAP.md) para el trabajo planificado (múltiples entidades,
animación con delta-time, tooling, etc.).

## Licencia

Ver [LICENSE](./LICENSE).
