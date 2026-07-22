# raptor-project

Un motor de render **2D** ligero construido sobre **WebGL**, en JavaScript puro
(módulos ES), sin dependencias de build. Usa
[gl-matrix](https://glmatrix.net/) para las operaciones con matrices.

El motor inicializa un canvas WebGL, mantiene una lista de entidades y las dibuja
en un único bucle de render. Incluye un juego de formas básicas (rectángulo,
cuadrado, triángulo, círculo, polígono regular y polígono arbitrario), cada una
con color, posición, rotación y escala configurables.

## Estructura

```
index.html                 # Punto de entrada; carga gl-matrix (CDN) y el motor
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

## Cómo ejecutarlo

El proyecto usa módulos ES, así que necesita servirse por HTTP (no vale abrir
`index.html` con `file://`). Con cualquier servidor estático, por ejemplo:

```bash
# Con Python
python3 -m http.server 8000

# o con Node
npx serve
```

Luego abre `http://localhost:8000` en un navegador con soporte WebGL.

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
