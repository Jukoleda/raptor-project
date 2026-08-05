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
drive.html                 # GENERADO: batalla de tanques (IA + combate), doble clic
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
  driveDemo.js             # Demo de batalla: tanque manejable, enemigos con IA y HUD
components/
  raptorEngine.js          # RaptorEngine: canvas + lista de entidades + render loop
  camera.js                # Camera 2D: pan/zoom, follow(target) y límites de mapa
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
    autoAim.js             # AutoAim: elige objetivo (cercano/vida/fuerza) y apunta
    gearbox.js             # Gearbox: marchas, par motor y cambio automático/manual
    tankController.js      # TankController: movimiento estilo tanque + input de teclado
    tankAI.js              # TankAI: máquina de estados enemiga (patrulla/persigue/ataca/huye)
    index.js               # Re-exporta los controladores
  vehicles/
    tank.js                # Tank: casco + torreta móvil; diseños (formas y stats)
    index.js               # Re-exporta los vehículos
```

## Cómo verlo

**Opción rápida (cualquier navegador, sin servidor ni internet):** abre con doble
clic el archivo que quieras — son builds autocontenidos con gl-matrix y todo el
motor embebidos, funcionan incluso offline vía `file://`:

- `index.html` — portada que enlaza las demos.
- `engine.html` — demo con las formas.
- `editor.html` — editor visual (ver abajo).
- `tanks.html` — demo de armas: cañón vs blindaje (ver abajo).
- `drive.html` — batalla de tanques: conduces y luchas contra IA (ver abajo).

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
A/D o ←/→ giran; **en móvil** hay un D-pad táctil en pantalla). El mapa es mayor
que la pantalla y la **cámara sigue al tanque** (ver abajo), con un **minimapa**
del mapa completo; el tanque **choca** con muros y obstáculos (colisión por
expulsión círculo-AABB). Puedes **elegir entre cuatro tanques** (teclas 1-4), la
**torreta apunta con el ratón o el dedo** (Q/E la giran a mano) o con
**auto-apuntado** por modos y **fuego automático** (ver abajo), se conduce con
**caja de cambios**
(automática o manual) y se combate contra **doce enemigos con IA** repartidos por
una arena de **57 × 41** unidades, todos con **barra de vida**.
Sigue la convención del motor: rotación en grados CCW y el eje local
**+Y es «adelante»**.

```js
import { TankController } from "./controls/index.js";

const tank = new TankController(hullShape, {
    maxSpeed: 3, accel: 5, turnSpeed: 140,
    bounds: { minX: -3, maxX: 3, minY: -2.1, maxY: 2.1 }, // opcional
});
tank.bindKeys(window);                       // teclado: WASD + flechas
tank.bindTouch({ forward, back, left, right }); // táctil/ratón: elementos-botón
// (o alimenta tú el estado con tank.setInput({forward, turn}) / tank.hold(dir, on))

// ...cada frame:
tank.update(dt);       // mueve y rota la forma; tank.forward / tank.velocity disponibles
```

## Tanques (casco + torreta móvil)

`components/vehicles/Tank` arma un tanque con formas del motor: un **casco** que
conduce (lo mueve un `TankController`) y una **torreta con cañón** que giran
**independientemente** del casco. Ese es el punto: el arma mantiene la puntería
mientras el casco maniobra. La torreta guarda un ángulo **absoluto** del mundo y
gira a la cadencia (`traverse`) de cada diseño.

`TANK_DESIGNS` trae cuatro diseños que varían la **forma** del casco y la torreta
además de las prestaciones, así que cada uno se conduce distinto:

| Diseño | Casco | Torreta | Vel. máx | Torreta °/s |
|--------|-------|---------|:---:|:---:|
| **Medio** | `Rectangle` | `Circle` | 3.0 | 120 |
| **Ligero** | `Triangle` | `RegularPolygon` (5) | 4.4 | 180 |
| **Pesado** | `RegularPolygon` (6) | `Circle` | 1.9 | 60 |
| **Cazacarros** | `Polygon` (cuña) | `Square` | 3.4 | 45 |

```js
import { Tank, TANK_DESIGNS } from "./vehicles/index.js";

const tank = new Tank(gl, { design: TANK_DESIGNS.heavy, x: 0, y: 0 });
tank.addTo(game);

// El casco se conduce con las stats del diseño:
const driver = new TankController(tank.hull, { ...tank.design.drive });

// ...cada frame:
driver.update(dt);
tank.aimAt(worldPoint, dt);  // o tank.traverse(±1, dt) para girarla a mano
tank.sync();                 // coloca torreta y cañón sobre el casco
// tank.muzzle -> boca del cañón, listo para el módulo de armas
```

## Blindaje y balística en la batalla

`drive.html` **usa el modelo de penetración completo** de
`components/weapons/`, no daño plano: los proyectiles se lanzan por *raycast*
contra el **casco poligonal** de cada tanque, así que importa **qué cara**
golpean y **con qué ángulo**.

- **Blindaje por cara**, deducido de la propia silueta del casco con
  `Armor.forHull(shape, { front, side, rear })`: cada arista se clasifica según
  hacia dónde mira en el espacio local (frontal si está a menos de 75° del
  «adelante» local, trasera si está igual de lejos, lateral el resto). Sale
  gratis para cualquier casco convexo — el rectángulo da 1 frontal / 2 laterales
  / 1 trasera, el triángulo del Ligero **dos caras de nariz**, el hexágono 2/2/2
  y la cuña del Cazacarros 2 frontales / 2 laterales / 1 trasera.
- **Tipos de proyectil** seleccionables (**C**): AP, APCR, HEAT y HE, cada uno
  con su penetración, daño, umbral de rebote y sensibilidad al ángulo.
- **Rebote**: un proyectil que patina sigue volando, más lento y con menos
  penetración — puede acabar impactando en otra cosa.

| Diseño | Frontal | Lateral | Trasera | Cañón |
|--------|:---:|:---:|:---:|:---:|
| **Ligero** | 30 | 18 | 14 | 55 mm |
| **Medio** | 65 | 38 | 28 | 95 mm |
| **Cazacarros** | 85 | 42 | 30 | 125 mm |
| **Pesado** | 105 | 62 | 45 | 145 mm |

Esto le da profundidad táctica real: un Medio (95 mm) **no atraviesa** el frontal
de un Pesado, pero sí su costado — o puede cargar **HEAT** (114 mm, que ignora la
inclinación) para perforarlo de frente. Y la nariz triangular del Ligero
**desvía** proyectiles perforantes que la golpean muy oblicuos.

> El casco de la cuña se reorientó a sentido **antihorario** al integrarlo: el
> raycast deduce la normal saliente asumiendo esa dirección, y con el orden
> anterior todas sus caras habrían rebotado siempre.

## Auto-apuntado

`components/controls/AutoAim` cede la torreta a una política de selección de
objetivo. Un solo botón (**T**, o 🎯 en móvil) recorre las políticas, así que
puedes pasar de «apunta a lo que tengas encima» a «remata al herido» sin soltar
el volante:

```
OFF → Más cercano → Menos vida → Más vida → Más fuerte → OFF …
```

| Modo | A quién apunta |
|------|----------------|
| **Más cercano** | El más próximo — el que probablemente te está disparando. |
| **Menos vida** | El de menos HP restante: para rematarlo. |
| **Más vida** | El de más HP restante: el que más va a durar. |
| **Más fuerte** | El de mayor **amenaza de diseño** (`Tank.power` = resistencia × daño por segundo), esté como esté de dañado. |

Solo elige objetivo y mueve el cañón: **nunca dispara**. Los empates se rompen
por distancia y, en un empate exacto, gana el objetivo actual, para que el cañón
no oscile entre dos candidatos iguales.

```js
import { AutoAim, AIM_MODE } from "./controls/index.js";

const autoAim = new AutoAim(playerTank, { mode: AIM_MODE.OFF });
autoAim.cycle();                       // avanza al siguiente modo

// ...cada frame:
const objetivo = autoAim.update(dt, enemigos.map((e) => e.tank));
// objetivo === null si está desactivado o no queda nadie vivo
autoAim.label;   // "Más cercano" | "Menos vida" | ...
```

En `drive.html` la prioridad es: giro manual (Q/E) **>** auto-apuntado **>**
puntero, y el objetivo enganchado se marca con una **retícula** en el mundo y un
círculo en el minimapa.

### Fuego automático

El botón **AUTO** (tecla **F**) mantiene el gatillo por ti: dispara en cuanto el
cañón ha recargado. Cuando hay un objetivo enganchado no malgasta proyectiles —
**espera a que la torreta esté alineada** (4° de margen) y **no dispara si hay
cobertura por medio**. Sin objetivo se comporta como tener el gatillo apretado.
Se combina con el auto-apuntado: 🎯 elige a quién, AUTO aprieta el gatillo.

`Tank.aimErrorTo(punto)` devuelve los grados que le faltan al cañón para estar
sobre un punto — lo usan tanto el fuego automático como la IA enemiga.

## Caja de cambios

`components/controls/Gearbox` es lo que convierte «mantener W acelera» en algo
mecánico. Cada marcha alcanza una fracción del tope de velocidad (`ratios`): las
**cortas tiran fuerte pero se quedan sin vueltas**, la larga apenas empuja pero
es la única que llega al máximo. Las **revoluciones** (`rpm`, 0..1) salen de por
dónde vas dentro de la banda de la marcha, y una curva de par hace que el motor
se **ahogue** abajo y pierda fuerza cerca del corte. Cambiar de marcha **corta la
transmisión** durante `shiftTime` — eso es lo que de verdad se nota al conducir.

Dos modos:

- **Automática** — cambia sola según las vueltas, con histéresis entre
  `upshiftAt` y `downshiftAt` para que no vaya *saltando* entre dos marchas, y
  mete la marcha atrás cuando pides retroceder desde parado.
- **Manual** — eliges tú recorriendo `R · N · 1 · 2 · …`. Si la dejas larga a
  pocas vueltas se ahoga; si la estiras, rebotas contra el limitador.

Cada diseño de tanque trae su propia caja: el **Pesado** solo tiene 3 marchas y
cambia lentísimo (0,5 s), mientras que el **Ligero** lleva 5 y cambia en 0,16 s.

```js
import { Gearbox, GEARBOX_MODE, TankController } from "./controls/index.js";

const gearbox = new Gearbox({
    ratios: [0.3, 0.52, 0.75, 1.0],  // fracción del tope por marcha
    reverseRatio: 0.4,
    shiftTime: 0.25,                 // segundos con la transmisión cortada
    mode: GEARBOX_MODE.AUTO,
});
const driver = new TankController(hull, { ...design.drive, gearbox });

// El controlador la alimenta solo; para el HUD:
gearbox.label;   // "R" | "N" | "1" | "2" | ...
gearbox.rpm;     // 0..1 dentro de la marcha actual
gearbox.torque;  // multiplicador de aceleración (0 mientras cambia)
gearbox.toggleMode();            // automática ⇄ manual
gearbox.shiftUp() / shiftDown(); // solo tiene sentido en manual
```

En `drive.html`: **G** alterna automática/manual y **Z**/**X** cambian de marcha
(o los botones del panel, que también valen en móvil).

## Enemigos (máquina de estados finitos)

`components/controls/TankAI` gobierna un tanque enemigo con una **FSM** de cuatro
estados. No toca el motor ni las armas: lee el mundo, escribe acelerador y giro
en un `TankController`, apunta la torreta y levanta `wantsToFire` cuando tiene
tiro — quien posee el tanque decide qué significa disparar.

```
PATROL   deambula entre puntos al azar, cañón al frente
  │ objetivo a la vista (con línea de tiro)
  ▼
CHASE    va a por él, torreta siguiéndolo
  │ entra en rango de tiro          ▲ se le escapa del rango
  ▼                                 │
ATTACK   mantiene la distancia, apunta y dispara al estar alineado
  │ su salud baja del umbral de retirada
  ▼
RETREAT  rompe el contacto sin dejar de apuntarle
```

Detalles que evitan que la FSM «parezca rota»: **línea de tiro** opcional
(`isBlocked`) para no disparar a través del escenario, y un **detector de
atasco** que da marcha atrás y gira si el tanque no progresa contra un muro.

```js
import { TankAI, AI_STATE_LABEL } from "./controls/index.js";

const ai = new TankAI(enemyTank, enemyDriver, {
    bounds: MAPA,              // por dónde puede patrullar
    sightRange: 6.5,           // a esta distancia empieza a perseguir
    attackRange: 4.5,          // dentro de esto se planta y dispara
    retreatAt: 0.3,            // se retira por debajo de este % de vida
    isBlocked: (a, b) => hayObstaculoEntre(a, b),
});

// ...cada frame:
ai.update(dt, playerTank);   // decide estado, conduce y apunta
if (ai.wantsToFire) disparar(enemyTank);
AI_STATE_LABEL[ai.state];    // "Patrulla" | "Persigue" | "Ataca" | "Se retira"
```

### Salud y barra de vida

Cada `Tank` lleva **integridad** (`hp` / `maxHp`, del diseño) y dibuja su propia
**barra de vida** flotando sobre el casco — nunca rota con él, y cambia de verde
a amarillo y rojo según baja. `tank.takeDamage(n)` devuelve si sigue vivo.

## Cámara 2D

El motor tiene una **cámara** (`components/camera.js`) que es una ventana móvil
sobre el mundo: las formas restan el centro de la cámara y multiplican por el
zoom al dibujarse, así mover la cámara hace *paneo* de toda la escena y subir el
zoom la amplía. `RaptorEngine` crea una por defecto en el origen con zoom 1 (un
no-op), por lo que las escenas que no la tocan se ven igual que antes.

`follow(objetivo, dt)` la lleva suavemente hacia un objetivo (frame-rate
independiente) y `bounds` evita que la vista se salga de los bordes del mapa
(clamp del centro). Así, con un mapa mayor que la pantalla, la cámara sigue al
jugador y se frena en los muros — justo lo que hace `drive.html`.

```js
const camera = game.camera;         // la cámara por defecto del motor
camera.smoothing = 6;               // mayor = más rápida en alcanzar
camera.bounds = { minX, maxX, minY, maxY }; // límites del centro (opcional)
camera.centerOn(player.x, player.y);

// ...cada frame, tras mover al jugador:
camera.follow(player.position, dt); // el render loop dibuja todo a través de game.camera

// Pantalla -> mundo (teniendo en cuenta paneo y zoom): apuntar, seleccionar...
const p = camera.screenToWorld(event.clientX, event.clientY, game.canvas);
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
