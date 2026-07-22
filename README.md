# raptor-project

Un motor de render **2D** ligero construido sobre **WebGL**, en JavaScript puro
(módulos ES), sin dependencias de build. Usa
[gl-matrix](https://glmatrix.net/) para las operaciones con matrices.

Actualmente el motor inicializa un canvas WebGL y renderiza un cuadrado con
color, rotación y escalado configurables, mediante un único bucle de render.

## Estructura

```
index.html                 # Punto de entrada; carga gl-matrix (CDN) y el motor
components/
  raptorEngine.js          # RaptorEngine (canvas + render loop) y Square
  main.js                  # Arranque: crea el motor y lanza el render
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

const game = new RaptorEngine();
game.createWindow(); // crea el canvas y el contexto WebGL
game.draw();         // configura el estado GL y arranca el render loop
```

## Estado y hoja de ruta

Consulta el [CHANGELOG](./CHANGELOG.md) para los cambios recientes y el
[ROADMAP](./ROADMAP.md) para el trabajo planificado (múltiples entidades,
animación con delta-time, tooling, etc.).

## Licencia

Ver [LICENSE](./LICENSE).
