# Raptor

Un **framework 2D sobre WebGL**, escrito a mano en JavaScript puro (módulos ES).
Usa [gl-matrix](https://glmatrix.net/) para las matrices y nada más. Cada demo se
distribuye además como un `.html` autocontenido que se abre en cualquier
navegador sin servidor ni conexión.

**▶ En vivo:** <https://jukoleda.github.io/raptor-project/>

```js
import { App, Rectangle } from "./raptor.js";

App.boot({ title: "Hola" }, (app) => {
    const caja = app.add(new Rectangle(app.gl, { width: 2, height: 1 })
        .setColor({ red: 0.9, green: 0.4, blue: 0.2 }).init());

    app.onUpdate((dt) => caja.setRotation(caja.rotation + 90 * dt));
});
```

Eso es un programa completo: `App.boot` espera al documento, monta la página,
crea el canvas y el contexto WebGL, engancha teclado y mandos táctiles y arranca
el bucle. Lo de dentro es tu escena.

## Las capas

Raptor está hecho de piezas que se usan juntas o sueltas. De abajo arriba:

| Capa | Qué hace |
|---|---|
| `shapes/` | Geometría que sabe dibujarse a través de una cámara, incluido `Sprite` |
| `render/` | Texturas, hojas de sprites, animación y los programas de shader |
| `camera.js` | La ventana móvil al mundo: pan, zoom, `follow()` y límites de mapa |
| `raptorEngine.js` | Canvas, contexto GL y **un solo** bucle de render |
| `physics/` | Cuerpos, colisión convexa (SAT) y solver de impulsos |
| `input/` | Estado de teclado y mandos en pantalla que **no se contradicen** |
| `ui/` | El armazón DOM: panel, tarjetas, sliders, lecturas, pantalla completa |
| `audio/` | Sonido sintetizado, para que un build siga siendo un único archivo |
| `assets/` | Declarar, cargar y leer imágenes, JSON, sonidos y fuentes |
| `scenes/` | Menú, partida, final: cada pantalla se monta y se desmonta sola |
| `math/` | Aleatoriedad con semilla, para que un nivel se pueda reproducir |
| `app.js` | El shell que conecta todo lo anterior |

Encima va un **kit de juego** —`controls/`, `weapons/`, `vehicles/`— del que
salen las demos de tanques. Es código Raptor normal: nada del motor depende de
él, y borrarlo dejaría el framework intacto.

### Por qué existe `App`

Porque sin él cada demo reescribía lo mismo. Antes de extraerlo, `el()` estaba
copiado literalmente en cuatro archivos, `kv()` en tres, la secuencia de arranque
en cuatro y el conjunto de teclas pulsadas en tres. Las demos sumaban 2682 líneas
frente a 2709 del motor, que es la señal de que faltaba una capa. Ahora suman
2344 y ninguna vuelve a escribir ese armazón.

## Instalar y construir

```bash
npm run build     # framework (dist/) + las ocho páginas autocontenidas
npm run check     # valida el grafo de módulos sin escribir nada
npm test          # ejecuta las páginas en un navegador de verdad
```

El build produce dos cosas:

- **`dist/raptor.js`** — el framework como librería ESM, con los 87 nombres
  públicos; y **`dist/raptor.global.js`** para un `<script src>` de toda la vida,
  que deja `window.Raptor`.
- **Las páginas** (`engine.html`, `editor.html`, `tanks.html`, `dyno.html`,
  `drive.html`, `sprites.html`, `assets.html`, `bosque.html`) — cada una
  autocontenida: gl-matrix y el framework embebidos.

En una aplicación se importa desde la raíz, o desde una sola capa si solo quieres
una:

```js
import { App, World, Body } from "raptor-engine";
import { collide } from "raptor-engine/physics";
```

## Estructura

```
raptor.js                  # Entrada pública del framework: import { App, ... }
package.json               # Nombre, versión y mapa de exports por capa
dist/
  raptor.js                # GENERADO: el framework como librería ESM
  raptor.global.js         # GENERADO: para <script src>, deja window.Raptor
index.html                 # Portada (escrita a mano): enlaza las demos
engine.html                # GENERADO: demo de formas autocontenido, doble clic
editor.html                # GENERADO: editor visual autocontenido, doble clic
tanks.html                 # GENERADO: demo cañón vs blindaje, doble clic
dyno.html                  # GENERADO: banco de pruebas motor/caja, doble clic
drive.html                 # GENERADO: batalla de tanques (IA + combate), doble clic
sprites.html               # GENERADO: sprites, texturas y animación, doble clic
assets.html                # GENERADO: carga de assets con manifiesto, doble clic
bosque.html                # GENERADO: El Bosque, un juego completo, doble clic
dev.html                   # Demo en desarrollo (módulos ES + gl-matrix por CDN)
editor-dev.html            # Editor en desarrollo (módulos ES + gl-matrix por CDN)
tanks-dev.html             # Demo de tanques en desarrollo (módulos ES + CDN)
drive-dev.html             # Demo de conducción en desarrollo (módulos ES + CDN)
dyno-dev.html              # Banco de pruebas en desarrollo (módulos ES + CDN)
sprites-dev.html           # Demo de sprites en desarrollo (módulos ES + CDN)
assets-dev.html            # Demo de assets en desarrollo (módulos ES + CDN)
bosque-dev.html            # El Bosque en desarrollo (módulos ES + CDN)
.github/workflows/
  deploy.yml               # Despliega el sitio en GitHub Pages en cada push a main
vendor/
  gl-matrix-min.js         # Copia vendorizada de gl-matrix (para el build offline)
tools/
  build.mjs                # Sigue el grafo de imports: dist/ + páginas; falla si hay nombres duplicados
  test.mjs                 # Suite: ejecuta las páginas generadas en un navegador real
editor/
  editor.js                # Editor visual: UI + edición en vivo de las entidades
weapons/
  tanksDemo.js             # Demo de armas: cañón, blanco con blindaje y HUD
controls/
  driveDemo.js             # Demo de batalla: tanque manejable, enemigos con IA y HUD
vehicles/
  dynoDemo.js              # Banco de pruebas: recta larga, motor y caja con telemetría
sprites/
  spritesDemo.js           # Demo de sprites: hoja procedural, animación y capas
assets/
  assetsDemo.js            # Demo de carga: manifiesto, progreso, caché y fallos
game/                      # El Bosque: un juego pequeño pero completo
  main.js                  # Arranque: crea el SceneManager y va al menú
  menuScene.js             # Menú principal, dificultad y mejor marca
  forestScene.js           # La partida: mapa, movimiento, bellotas, reloj
  endScene.js              # Resultado: victoria o derrota, y qué hacer ahora
  forest.js                # Generación del mapa y colisión con deslizamiento
  art.js                   # Hoja de sprites y sonidos, generados al arrancar
components/
  index.js                 # Barrel de barrels: toda la superficie pública
  app.js                   # App: arranque, canvas, panel, entrada, ciclo de vida
  raptorEngine.js          # RaptorEngine: canvas + lista de entidades + render loop
  camera.js                # Camera 2D: pan/zoom, follow(target) y límites de mapa
  main.js                  # Hola mundo: las formas básicas en pantalla
  ui/
    dom.js                 # el(), card(), kv(), slider(), select(), button(), hint()
    fullscreen.js          # Pantalla completa con los prefijos de Safari
    loadingScreen.js       # Pantalla de carga: barra de progreso y errores
    index.js               # Re-exporta la interfaz
  input/
    keyboard.js            # Keyboard: teclas mantenidas, acciones y axis()
    touchpad.js            # TouchPad: pedales y taps sobre el canvas
    index.js               # Re-exporta la entrada
  assets/
    assets.js              # Assets: manifiesto, carga con progreso, caché y errores
    index.js               # Re-exporta los assets
  scenes/
    scene.js               # Scene: se monta al entrar y se desmonta al salir
    sceneManager.js        # SceneManager: transiciones y carga por escena
    index.js               # Re-exporta las escenas
  math/
    random.js              # createRandom: LCG con semilla, reproducible
    index.js               # Re-exporta las matemáticas
  render/
    projection.js          # FOV, profundidad y matrices compartidas
    texture.js             # Texture: imagen en la GPU (URL, canvas o píxeles)
    spriteSheet.js         # SpriteSheet, Animation y Animator
    shaders.js             # Programas de shader, cacheados por contexto
    index.js               # Re-exporta el render
  shapes/
    shape.js               # Clase base: shaders, buffers, transform y draw()
    sprite.js              # Sprite: quad texturizado con fotogramas y tinte
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
  audio/
    engineSound.js         # EngineSound: nota del motor sintetizada con Web Audio
    index.js               # Re-exporta el audio
  vehicles/
    engine.js              # Engine: curva de par y potencia derivada (P = T·ω)
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
- `dyno.html` — banco de pruebas de motor y caja de cambios (ver abajo).
- `drive.html` — batalla de tanques: conduces y luchas contra IA (ver abajo).
- `sprites.html` — sprites, texturas y animación (ver abajo).
- `assets.html` — carga de assets: manifiesto, progreso y errores (ver abajo).
- `bosque.html` — **El Bosque**: un juego completo con menú (ver abajo).

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

`engine.html`, `editor.html`, `tanks.html`, `dyno.html` y `drive.html` son
**archivos generados**; no los edites a mano (`index.html` sí es la portada
escrita a mano). Tras cambiar algo en `components/`, `editor/`, `weapons/`,
`vehicles/` o `controls/`, reconstrúyelos con:

```bash
node tools/build.mjs
```

**El build sigue los `import`, no una lista.** Las páginas generadas son un
`<script>` plano, así que todas las declaraciones caen en un mismo ámbito: dos
módulos que declaren el mismo `const` son un `SyntaxError` que deja la página en
blanco, y dos que declaren la misma `function` se pisan en silencio. Antes cada
página llevaba su lista de módulos escrita a mano, en orden de dependencias, y
ambos fallos ocurrieron más de una vez. Ahora el build lee el grafo de imports,
ordena los módulos solo, y **falla** si dos declaran el mismo nombre:

```
Error: dyno.html: nombres duplicados en el ámbito global del bundle.
  BASE_STYLES (const) — components/ui/dom.js y components/camera.js
```

Añadir un módulo a una demo es, ahora, importarlo.

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

## Rey de la colina: dos escuadrones

`drive.html` es una batalla **por equipos** con un objetivo en el centro del mapa.

- **Despliegue enfrentado:** tú y **5 aliados** (azules) al oeste, **5 enemigos**
  (rojos) al este, con la zona entre medias. Tu tanque conserva los colores de su
  diseño para que siempre te encuentres.
- **La zona** (disco translúcido, radio 4,5) cambia de color según quién la pisa:
  neutral, tuya, del enemigo o **en disputa**.
- **Se gana controlándola 30 s.** Un bando solo suma tiempo si está **solo**
  dentro; con los dos bandos presentes el reloj **se para**. Con la zona vacía,
  ambos marcadores decaen poco a poco. Ir en número ayuda, pero con rendimientos
  decrecientes (×1,6 como mucho), así que un tanque suelto también captura.
- **Final:** ganas por control o destruyendo al escuadrón enemigo; pierdes si el
  enemigo la controla 30 s o si te destruyen. El banner dice por qué.
- **Sin fuego amigo:** los proyectiles atraviesan a los tuyos.

### Ver a tu escuadrón

En un mapa de 57 × 41 tus aliados suelen estar fuera de pantalla, así que cada
uno vivo que quede fuera de la vista tiene una **flecha azul fijada al borde**
apuntando hacia él (desaparece en cuanto entra en cuadro). El panel de escuadrón
añade además **a qué distancia** está cada uno, y el minimapa los pinta en azul.

### Colisiones por la forma del vehículo

Los cuerpos ya **no chocan como círculos**: el casco colisiona por su **contorno
real** usando el SAT de `components/physics/`. Un filtro barato por radio
descarta lo que está lejos y solo entonces se resuelve el solapamiento de verdad,
así que sigue siendo barato con 11 tanques y 82 sólidos.

Se nota: el mismo casco **para a distinta distancia según cómo lo presentes** —
el Medio se detiene a 1,348 u de un bloque puesto de morro (su semilargo, 0,400)
y a 1,223 u de costado (su semiancho, 0,275). Y una cuña puede colarse por un
hueco donde un casco rectangular se engancha.

La IA gana un estado para esto: **`ADVANCE`**, en el que va a por el terreno que
le asignaron (`objective`) y lo defiende, en vez de deambular. Cada tanque recibe
un punto ligeramente distinto alrededor del centro, así el escuadrón se despliega
por la zona en lugar de apilarse. Y ya no persigue solo al jugador: apunta al
**rival vivo más cercano de su equipo**, sea quien sea.

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

## Banco de pruebas: motor, caja y telemetría

`dyno.html` es una **recta de 420 × 9 m** (unas 47 veces más larga que ancha) para
jugar con un tren motriz. Todo va en **unidades reales** —metros, segundos,
newtons, N·m— así que los números del panel significan algo.

### El motor (`components/vehicles/Engine`)

El par **no es plano**: sube desde el ralentí, hace pico a media vuelta y cae
hacia el corte. Esa forma es la razón de ser de las marchas, así que es lo que
modela la curva:

```
par(rpm) = parMáximo · (1 − k · desviación²)
```

con una `k` distinta por debajo y por encima del pico, elegida para que la curva
pase exactamente por los valores que le des a ralentí y al corte.

La **potencia no se configura: sale** del par y las vueltas —

```
P [W] = T [N·m] · ω [rad/s],   ω = rpm · 2π / 60
```

— y por eso el pico de potencia siempre cae **a más vueltas** que el de par: el
par ya está bajando, pero ω sube más rápido. Con los valores por defecto: par
máximo **340 Nm a 3400 rpm**, potencia máxima **247 CV a 6280 rpm**.

### La caja en modo mecánico

Dale a `Gearbox` relaciones reales y un `Engine` y deja de estimar: las
revoluciones **vuelven** desde la velocidad a través de la transmisión, y
`wheelTorque` / `wheelForce` dicen lo que llega de verdad al suelo.

```js
const engine = new Engine({ peakTorque: 340, peakTorqueRpm: 3400, redlineRpm: 6800 });
const caja = new Gearbox({
    engine, gearRatios: [3.6, 2.1, 1.4, 1.0, 0.8],
    finalDrive: 3.9, wheelRadius: 0.34,
});
caja.update(dt, { speed, throttle });
caja.engineRpm;    // vueltas reales
caja.wheelForce;   // newtons en el suelo
caja.gearTopSpeed; // a cuánto llega esa marcha
```

Sin esos parámetros la caja conserva el modelo normalizado ligero que usa la
batalla, así que nada cambia allí.

### Lo que puedes probar

- **Curva en vivo** de par y potencia, con marcas en los dos picos y una línea
  vertical donde está el motor ahora mismo.
- **Sliders del motor**: par máximo, a qué vueltas y dónde está el corte.
- **Grupo final** ajustable, para ver el compromiso aceleración / velocidad
  punta: con 4.8 el 0-100 baja a 4,87 s; con 2.8 sube a 6,00 s.
- **Cronómetro**: 0-100 km/h, 400 m con velocidad de paso, distancia y G máxima.
- **Caja automática o manual** (G, y Z/X): déjala en 5ª desde parado y verás el
  motor ahogarse — 9 km/h en 2,5 s, frente a 62 km/h en 1ª.

**En móvil** hay controles sobre la pista: **GAS** y **FRENO** (pedales, se
mantienen pulsados), **▲/▼** para cambiar de marcha, **AUTO/MAN** para alternar
el modo y **↺** para volver a la salida. Teclado y táctil alimentan el mismo
estado, así que ninguno pisa al otro.

Con la configuración de fábrica: **0-100 en 4,87 s** y **400 m en 13,35 s** a
169 km/h de paso.

### Sonido del motor

Las páginas son autocontenidas y se abren desde `file://`, así que no hay
ficheros de audio: la nota se **sintetiza** con Web Audio en
`components/audio/EngineSound`. Lo que da el tono es la **frecuencia de
encendido** —cada cuánto explota un cilindro—:

```
f = rpm / 60 · cilindros / (tiempos / 2)
```

Para un cuatro cilindros de cuatro tiempos eso es `rpm/30`: 27 Hz al ralentí y
227 Hz en el corte. Solos son demasiado graves para el altavoz de un móvil, así
que la nota se apila con varios **armónicos** en diente de sierra (×1, ×2, ×3 y
un ×0,5 de fondo) más algo de **ruido filtrado** para el soplido de admisión. Un
**paso bajo que se abre con la carga** es lo que separa un zumbido lejano de algo
a fondo, y un **cambio de marcha corta la nota** igual que corta la transmisión.

Los navegadores no dejan sonar nada sin un gesto del usuario, así que el primer
clic, toque o tecla lo arranca. **🔊 / M** silencia.

### Pantalla completa

**⛶ / F** pone la demo a pantalla completa. En ese modo la pista se lleva todo el
alto y el panel queda al lado con scroll (debajo, en pantallas estrechas). Como
el panel puede quedar fuera de vista, hay un **HUD compacto** pegado a la pista
con lo que de verdad se mira: marcha, velocidad y cuentavueltas.

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
import { App, Rectangle, Circle } from "./raptor.js";

App.boot({ title: "Dos formas" }, (app) => {
    app.add(
        new Rectangle(app.gl, { width: 1.4, height: 0.9 })
            .setColor({ red: 0.9, green: 0.3, blue: 0.2 })
            .setPosition({ x: -1, y: 0 })
            .init()            // sube la geometría a la GPU (llamar al final)
    );

    app.add(
        new Circle(app.gl, { radius: 0.6 })
            .setColor({ blue: 0.9 })
            .setPosition({ x: 1, y: 0 })
            .init()
    );
});
```

`App.boot` espera al documento, inyecta los estilos, monta `#app` / `#stage` /
`#panel`, crea el canvas y el contexto, y arranca el bucle **después** de que tu
`setup` termine, para que el primer frame no te pille a medio construir.

### Qué te da `App`

```js
app.gl              // el contexto WebGL
app.canvas          // el <canvas>
app.camera          // la cámara (app.camera.follow(objetivo, dt))
app.stage           // el contenedor posicionado: HUD, banners, mandos
app.keyboard        // Keyboard, ya enganchado a window
app.touch           // TouchPad sobre el canvas

app.add(forma)              // registra una entidad dibujable
app.onUpdate((dt) => {})    // un callback por frame, en segundos
app.addPanel(card(...))     // tarjetas en el panel lateral
app.addOverlay(nodo)        // cualquier cosa encima del canvas
app.use(world)              // plugin: si tiene step(dt), entra en el bucle
app.pause() / app.resume()  // el bucle para; el último frame se queda
app.toggleFullscreen()      // con los prefijos que aún pide Safari
app.on("resize" | "fullscreenchange", fn)
```

`app.use(plugin)` es el punto de extensión: si el objeto tiene `install(app)` se
le deja configurarse; si tiene `step(dt)` o `update(dt)`, se engancha al bucle.
Un `World` de física cumple lo segundo, así que `app.use(world)` basta.

### Entrada que no se contradice

`Keyboard` separa las dos cosas que un juego necesita y que se suelen mezclar:

```js
app.keyboard.isDown("w", "ArrowUp")        // ¿está pulsada ahora? (por frame)
app.keyboard.axis("a", "d")                // −1, 0 o +1, listo para la física
app.keyboard.on("r", reset)                // acción: una vez por pulsación
```

La diferencia importa: `on()` **ignora la repetición automática** del teclado, y
al perder el foco de la ventana se sueltan todas las teclas — si no, la que
estuviera pulsada se queda pulsada para siempre, que es el bug clásico de
cambiar de pestaña acelerando.

`TouchPad` escribe en **el mismo conjunto** de teclas pulsadas, así que un dedo y
una tecla nunca pueden decir cosas distintas:

```js
const gas = app.touch.button("gas", "GAS", "gas");
app.touch.pedal(gas, "gas");                    // mantenido, con captura de puntero
app.touch.tap(app.touch.button("fire", "🔥"), disparar);   // una vez, en pointerdown
app.touch.pad("right", [[aim, auto], fire]);    // anclado a una esquina; array = columna
```

Los pedales usan captura de puntero, de modo que deslizar el dedo fuera del botón
lo suelta en vez de dejarlo pegado. Los taps van en `pointerdown`, no en `click`,
porque en táctil `click` llega ~300 ms tarde y en un botón de disparo eso se
siente roto.

## Sprites, texturas y animación

Hasta aquí todas las formas eran de color plano. `Sprite` es un rectángulo que
dibuja **parte de una textura**, que es de lo que están hechos los juegos.

```js
import { App, Sprite, Texture, SpriteSheet, Animator } from "./raptor.js";

const textura = Texture.fromImage(gl, "heroe.png");
const hoja = new SpriteSheet(textura, { frameWidth: 16, frameHeight: 16 });

const heroe = new Sprite(gl, { texture: textura, frame: hoja.frame(0) })
    .setPosition({ x: 0, y: 0 })
    .init();

const anim = new Animator(heroe, {
    quieto: hoja.animation(4, 5, { fps: 2 }),
    andar:  hoja.animation(0, 3, { fps: 10 }),
});

app.onUpdate((dt) => anim.update(dt));
```

### Texture

Una textura es utilizable **desde el primer frame**: nace como un píxel blanco de
1×1 y se cambia sola por la imagen cuando llega. Nada tiene que esperar y nada
revienta mientras tanto. `texture.loaded` es la promesa, para el código que sí
prefiera esperar.

Fuentes: `fromImage(gl, url)`, `fromCanvas(gl, canvas)`, `fromPixels(gl, bytes, w, h)`
y `solid(gl, color)`.

`fromCanvas` es más útil de lo que parece: es como la demo genera su hoja **al
vuelo**, y por eso `sprites.html` sigue siendo un único archivo que se abre desde
`file://` sin nada al lado — el mismo truco que el sonido del motor.

Tres trampas de WebGL resueltas de una vez, porque cuestan una tarde cada una:

- **La Y va al revés.** La primera fila de una imagen es la de *arriba*; la de
  una textura GL es la de *abajo*. Sin `UNPACK_FLIP_Y_WEBGL` todo sale del revés.
- **Lados que no son potencia de dos** no admiten mipmaps ni `REPEAT`: si los
  pides, la textura se dibuja **negra** y sin explicación. Se comprueba el tamaño
  y se eligen los parámetros que sí valen.
- **Cargar lleva tiempo.** De ahí el píxel blanco de arriba.

`setSmooth(false)` (por defecto) usa `NEAREST` y mantiene el pixel art nítido;
`true` usa `LINEAR` y suaviza. En la demo está en un botón para que se vea.

### Fotogramas y atlas

`SpriteSheet` corta la textura en una rejilla —con `margin` y `spacing` si tu
exportador los añade— y `frame(i)` o `frame(columna, fila)` devuelve el
rectángulo **en píxeles**, que es como se mide una hoja de verdad. `Sprite` lo
convierte a coordenadas 0..1 por ti.

`Animation` guarda **tiempo**, no un contador de fotogramas, así que a 8 fps un
ciclo de andar dura lo mismo a 30 Hz que a 144. `Animator` le pone nombres:

```js
anim.play("andar");   // llamarlo cada frame no lo reinicia
```

Eso último importa: reiniciar la animación en cada frame es lo que deja a un
personaje congelado a media zancada, y es el error más fácil de cometer.

### Tinte

El color de un sprite es un **tinte**: el shader multiplica el téxel por él.
Blanco no toca nada, un color tiñe, y un alfa por debajo de 1 desvanece. Así se
pone un personaje en rojo al recibir un golpe sin una segunda imagen.

```js
heroe.setTint({ red: 1, green: 0.35, blue: 0.3 });          // herido
heroe.setTint({ red: 1, green: 1, blue: 1, alpha: 0.45 });  // fantasma
```

### Voltear

```js
heroe.setFlip({ x: true });
```

Voltea la **imagen**, no la transformación: girar el sprite lo pondría boca
abajo. Es lo que quieres cuando un personaje se da la vuelta.

### Capas

`setLayer(n)` decide el orden de dibujo: las capas bajas primero, y dentro de una
capa manda el orden de inserción. El motor reordena solo cuando algo cambia, no
en cada frame.

```js
const LAYER = { SUELO: -20, SOMBRA: -10, OBJETO: 0, ACTOR: 10, COPAS: 20 };
```

En la demo los troncos están por debajo del jugador y las copas por encima
—aunque se añaden al revés—, así que puedes caminar *detrás* de un árbol. Sin
capas, la única forma de poner un fondo detrás sería añadirlo primero y no
cambiar de opinión nunca.

Los sprites **no sustituyen** a las formas de color: la sombra del personaje es
un `Circle` normal en la misma escena. Cada forma dice con qué programa de shader
se dibuja y el motor cambia entre ellos.

### Un detalle que se ve

Los tiles del suelo se dibujan un 4% más grandes que la casilla que ocupan. Dos
quads que comparten un borde caen sobre un límite de sub-píxel tras la división
en perspectiva, y el rasterizador no le da ese píxel a ninguno: aparece una
**costura** oscura recorriendo todo el mapa. Solaparlos un poco es la solución
habitual; la otra es rellenar el borde de cada celda en la hoja.

## Cargar assets

Un juego no puede dibujar una imagen que todavía no ha llegado. Sin un cargador,
o alcanzas un asset que no está, o cada punto del código se llena de `await`. El
patrón que funciona es viejo y aburrido: **declarar, cargar, y solo entonces
empezar**.

```js
App.boot({
    title: "Mi juego",
    assets: (assets) => assets.add({
        texture: { heroe: "heroe.png", tiles: "tiles.png" },
        json:    { nivel: "nivel1.json" },
        sound:   { salto: "salto.wav" },
        font:    { titulo: "pixel.woff2" },
    }),
}, (app) => {
    // Aquí ya está todo cargado: esto es una lectura síncrona, sin await.
    const heroe = new Sprite(app.gl, { texture: app.assets.texture("heroe") }).init();
    const nivel = app.assets.json("nivel");
});
```

`App.boot` levanta la pantalla de carga, lo carga todo con su barra de progreso y
solo después llama a tu `setup`. Si prefieres llevarlo a mano:

```js
const assets = new Assets({ gl });
assets.texture("heroe", "heroe.png");
await assets.load({ onProgress: (p) => barra(p.ratio) });
```

### El mismo nombre declara y lee

Con URL encola; sin URL busca. Mantiene las dos mitades de la vida de un asset
escritas igual:

```js
assets.texture("heroe", "heroe.png");   // declara
assets.texture("heroe");                // lee, ya cargado
```

Tipos: `texture`, `image`, `json`, `text`, `sound` (decodificado a `AudioBuffer`)
y `font` (registrada en `document.fonts`). `put(clave, valor)` mete algo que ya
tienes en la mano —un canvas que dibujaste— para que lo generado y lo cargado se
lean igual.

### Lo que hace bien, que es donde duele

- **Un asset que falla no cuelga el juego.** Cada tipo tiene su ruta de error y
  su tiempo máximo, así que un nombre de archivo mal escrito es un mensaje, no un
  spinner para siempre. Y `fetch` **no rechaza ante un 404** —llega como una
  respuesta perfectamente correcta—, que es como un archivo que falta se
  convierte tres frames más tarde en un `undefined is not an object`.
- **La misma URL se carga una vez.** Dos claves pueden apuntar al mismo archivo y
  se descarga, decodifica y sube a la GPU una sola vez.
- **El progreso es honesto.** Ni un `<img>` ni `decodeAudioData` dan un tamaño
  fiable, así que se cuenta en **assets**, no en bytes, y se dice. Fingir el byte
  count es lo que produce barras que se atascan en el 73%.
- **La concurrencia está limitada** (8 a la vez): lanzar cuatrocientas peticiones
  de golpe es más lento, no más rápido.
- **Leer mal se queja.** Leer antes de cargar, con el tipo equivocado, una clave
  inexistente o una que falló, lanzan con un mensaje que dice qué pasó — en vez
  de devolver `undefined` para que tropieces con él más adelante.

### Cuando algo falla

Por defecto `load()` rechaza nombrando lo que se rompió. Con `tolerant: true`
sigue adelante y los deja en `assets.failed`, para lo que un juego puede
perderse (un sonido decorativo). La pantalla de carga se pone en rojo y **dice
cuál falló y por qué**: una barra parada en el 73% sin explicación es el peor
resultado posible.

### Sonido

`sound()` deja un `AudioBuffer` listo. **Decodificar no necesita un gesto del
usuario; reproducir sí**, así que el buffer ya está esperando cuando alguien pulsa
por primera vez:

```js
const ctx = app.assets.audioContext;
const source = ctx.createBufferSource();
source.buffer = app.assets.sound("salto");
source.connect(ctx.destination);
source.start();
```

### La demo

`assets.html` le da la vuelta al cargador: el manifiesto es una **tabla que ves
llenarse**, con el estado, el tipo y lo que tardó cada asset, más una entrada
apuntando a un archivo que no existe para que la ruta de fallo esté en pantalla
en vez de descrita. Los assets se construyen al arrancar y se sirven como `data:`
URIs —un PNG de verdad por un `<img>`, JSON de verdad por `fetch`, un WAV de
verdad decodificado por Web Audio—, así que el camino asíncrono se ejercita
entero y la página sigue siendo un único archivo. Apuntar el mismo manifiesto a
archivos reales es cambiar las URLs y nada más.

## Escenas

Hasta aquí una página **era** un juego: una función de arranque, un mundo, y
ninguna forma de ir de un menú a una partida y de ahí a un resultado. Una
`Scene` es esa unidad que faltaba — se construye al entrar y se deshace al
salir.

```js
class Menu extends Scene {
    enter() {
        this.overlay(el("h1", { textContent: "El Bosque" }));
        this.onKey("Enter", () => this.go("juego"));
    }
}

const escenas = new SceneManager(app);
escenas.add("menu", new Menu()).add("juego", new Bosque());
escenas.go("menu");
```

### Lo que importa es el deshacer

Todo lo que una escena crea hay que quitarlo al salir —entidades, callbacks por
frame, atajos de teclado, nodos del DOM— y olvidarse de uno solo es una fuga que
notas tres cambios de escena más tarde, cuando la música del menú sigue sonando
encima del jefe final y el bucle viejo sigue moviendo a un jugador que ya no
existe.

Por eso una `Scene` no te deja registrar esas cosas directamente:

```js
this.add(sprite)          // entidad, se quita al salir
this.onUpdate(fn)         // callback por frame, se desengancha al salir
this.onKey("p", pausa)    // atajo, se desata al salir
this.overlay(nodo)        // DOM sobre el canvas, se elimina al salir
this.panel(tarjeta)       // tarjeta del panel lateral, ídem
```

Cada uno apunta lo que hizo, y salir lo revierte. Si te saltas eso y llamas a
`app.onUpdate` directamente, la limpieza es tuya — que es justo el trato que
conviene hacer a propósito y no por descuido.

### Lo que hace el `SceneManager`

- **Carga al entrar.** Una escena declara sus assets en `preload()`, y la
  primera vez que entras se cargan detrás de una pantalla de carga. Así el menú
  aparece al instante y el arte del nivel llega mientras el jugador lo lee, en
  vez de que todo espere a todo.
- **Funde.** Un corte seco entre dos pantallas se lee como un fallo. El fundido
  también tapa los frames en los que la escena vieja ya no está y la nueva
  todavía no.
- **No se pisa consigo mismo.** Dos `go()` a la vez —una tecla y un clic en el
  mismo botón— harían dos desmontajes y dos montajes entrelazados. El segundo
  espera.

## El Bosque: un juego completo

`bosque.html` es la prueba de que todo lo anterior sirve para algo. **Menú →
partida → resultado**, con tres dificultades y mejor marca.

Juntá todas las bellotas antes de que se acabe el tiempo. Los árboles no se
cruzan. **WASD** o flechas, **P** pausa, **Esc** vuelve al menú — y en el móvil
hay mandos en pantalla.

Usa, sin excepción, todo lo que hay en el framework: el cargador declara la hoja
y los sonidos en el `preload` de la partida, los sprites y las capas dibujan el
bosque, el animador lleva el ciclo de andar, la cámara sigue al personaje con
límites de mapa, y la entrada hace que un dedo y una tecla no puedan
contradecirse.

### Colisión que se desliza

El mapa es una rejilla y algunas casillas son sólidas. Lo interesante es cómo se
resuelve el choque: **un eje a la vez**.

```js
if (dx !== 0 && !blocked(x + dx, y)) x += dx;
if (dy !== 0 && !blocked(x, y + dy)) y += dy;
```

Probar los dos a la vez y deshacer los dos es la versión que sale primero, y es
la razón por la que un personaje **se clava** en una pared en vez de deslizarse
a lo largo: empujar en diagonal contra un muro cancela también la componente que
sí habría funcionado.

El cuerpo del jugador es además más estrecho que su dibujo, a propósito: una caja
de colisión que calca al personaje se siente injusta, porque los hombros se
enganchan en huecos por los que claramente estabas apuntando.

## Rendimiento

Tres cosas, medidas sobre El Bosque (1397 sprites, Chromium con rasterizado por
software):

### La proyección se calcula una vez, no mil cuatrocientas

`Shape.draw` construía una matriz de proyección **por forma y por frame** —
trabajo idéntico repetido — más una matriz modelo-vista y tres arrays sueltos
para los argumentos de translate/rotate/scale. Unos siete mil objetos
desechables por frame, que luego hay que recoger.

Ahora la proyección se cachea por canvas y se rehace solo si cambia la relación
de aspecto, y las matrices salen de un buffer reutilizado. Dibujar es síncrono y
nunca reentrante, así que compartir ese buffer es seguro.

**Coste de CPU de la pasada de dibujo: 10,5 ms → 6,0 ms.**

Además arregla un acoplamiento que era un bug esperando: el campo de visión y la
profundidad estaban escritos **dos veces** —en `Shape.draw` y en
`Camera.viewExtents`— y tenían que coincidir sin que nada lo dijera. Cambiar la
profundidad de una forma desajustaba en silencio los límites de mapa de la
cámara. Ahora viven en `components/render/projection.js` y nada más.

### No se dibuja lo que no se ve

`app.culling = true` descarta las entidades que no pueden estar en pantalla. En
el bosque eso es **57 de 1397**.

**Frame: 51,9 ms → 25,3 ms (51% menos).**

Está apagado por defecto, y el radio de recorte es un círculo que envuelve la
forma —generoso a propósito—: esconder algo que sí se veía se nota como cosas
que aparecen de golpe en el borde, y eso es mucho peor que dibujar algún quad de
más. La prueba de esto no compara píxeles (la animación avanza entre capturas y
eso daba falsos positivos), sino que **proyecta cada vértice con las matrices
reales** y comprueba que nada de lo que cae dentro del volumen de vista quede
descartado.

### Lo que no se optimizó

Las llamadas a GL siguen siendo una por forma. Agruparlas en lotes por textura
es la siguiente ganancia, y es un cambio grande; con el culling puesto, las 57
formas que quedan no lo justifican todavía.

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
