# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/).

## [Sin publicar] - 2026-07-22

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
