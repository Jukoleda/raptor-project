# raptor-project

Un motor de render **2D** ligero construido sobre **WebGL**, en JavaScript puro
(módulos ES). Usa [gl-matrix](https://glmatrix.net/) para las operaciones con
matrices. Se distribuye además como un único `index.html` autocontenido que se
abre en cualquier navegador sin servidor ni conexión.

El motor inicializa un canvas WebGL, mantiene una lista de entidades y las dibuja
en un único bucle de render. Incluye un juego de formas básicas (rectángulo,
cuadrado, triángulo, círculo, polígono regular y polígono arbitrario), cada una
con color, posición, rotación y escala configurables.

## Estructura

```
index.html                 # GENERADO: build autocontenido, se abre con doble clic
dev.html                   # Entrada de desarrollo (módulos ES + gl-matrix por CDN)
vendor/
  gl-matrix-min.js         # Copia vendorizada de gl-matrix (para el build offline)
tools/
  build-standalone.mjs     # Genera index.html a partir de components/ + vendor/
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
```

## Cómo verlo

**Opción rápida (cualquier navegador, sin servidor ni internet):** abre
`index.html` con doble clic. Es un build autocontenido con gl-matrix y todo el
motor embebidos, así que funciona incluso offline vía `file://`.

**Desarrollo (con módulos ES):** `dev.html` usa los archivos de `components/`
directamente, lo que exige servirlo por HTTP (los módulos no cargan desde
`file://`). Con cualquier servidor estático:

```bash
python3 -m http.server 8000   # o: npx serve
# luego abre http://localhost:8000/dev.html
```

### Regenerar `index.html`

`index.html` es un **archivo generado**; no lo edites a mano. Tras cambiar algo
en `components/`, reconstrúyelo con:

```bash
node tools/build-standalone.mjs
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
