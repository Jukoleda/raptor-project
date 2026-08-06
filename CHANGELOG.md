# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/).

## [0.3.0] - 2026-08-06

Paso 2 de los tres: ya se puede declarar lo que un juego necesita, cargarlo con
una barra de progreso y empezar cuando está todo.

### Añadido (Carga de assets)
- **`components/assets/assets.js`** — `Assets`: manifiesto, carga y lectura de
  `texture`, `image`, `json`, `text`, `sound` (decodificado a `AudioBuffer`) y
  `font` (registrada en `document.fonts`). **El mismo nombre declara y lee**: con
  URL encola, sin URL busca, así las dos mitades de la vida de un asset se
  escriben igual. `add({ texture: {...}, json: {...} })` declara un manifiesto
  entero de golpe, y `put(clave, valor)` registra algo que ya tienes en la mano
  —un canvas que dibujaste— para que lo generado y lo cargado se lean igual.

  Lo que resuelve, que es donde un cargador duele de verdad:
  - **Un asset que falla no cuelga el juego**: cada tipo tiene ruta de error y
    tiempo máximo. Y `fetch` **no rechaza ante un 404** —llega como una respuesta
    correcta—, que es como un archivo que falta se convierte tres frames después
    en un `undefined is not an object`.
  - **La misma URL se carga una vez**: dos claves pueden apuntar al mismo archivo
    y se descarga, decodifica y sube a la GPU una sola vez.
  - **El progreso es honesto**: ni un `<img>` ni `decodeAudioData` dan un tamaño
    fiable, así que se cuenta en assets y no en bytes. Fingirlo es lo que produce
    barras atascadas en el 73%.
  - **La concurrencia está limitada** a 8: lanzar cuatrocientas peticiones de
    golpe es más lento, no más rápido.
  - **Leer mal se queja**: antes de cargar, con el tipo equivocado, con una clave
    inexistente o con una que falló, todas lanzan diciendo qué pasó, en vez de
    devolver `undefined` para que tropieces más adelante.
  - `tolerant: true` sigue adelante y deja los fallos en `assets.failed`, para lo
    que un juego puede perderse.
- **`components/ui/loadingScreen.js`** — `LoadingScreen`: la pantalla que tapa el
  canvas mientras llegan los assets. No usa ningún asset (una pantalla de carga
  hecha con una imagen no puede aparecer hasta que algo haya cargado) y **un
  fallo se ve**: se pone en rojo y dice cuál falló y por qué, porque una barra
  parada en el 73% sin explicación es el peor resultado posible.
- **`App.boot({ assets })`** — declara el manifiesto y `setup` no corre hasta que
  está todo dentro, de modo que `app.assets.texture("heroe")` es una lectura
  síncrona y no un `await` en cada punto del código. `app.assets` existe desde el
  principio aunque no se cargue nada. Nuevos eventos `progress` y `assetserror`,
  y opciones `assetPath`, `loadingTitle` y `tolerantAssets`.
- **Demo `assets.html`** (fuente `assets/assetsDemo.js`): le da la vuelta al
  cargador y pone el manifiesto en pantalla como una **tabla que se llena**, con
  estado, tipo y tiempo de cada asset, más una entrada apuntando a un archivo que
  no existe para que la ruta de fallo se vea en vez de contarse. Los assets se
  construyen al arrancar y se sirven como `data:` URIs —un PNG de verdad por un
  `<img>`, JSON de verdad por `fetch`, un WAV de verdad decodificado por Web
  Audio—, así que el camino asíncrono se ejercita entero y la página sigue siendo
  un único archivo. El mapa que se dibuja sale del JSON cargado, con la textura
  del PNG y el sonido del WAV.

### Corregido
- **El resolutor de exports del build no entendía `export { A as B };` local**
  (sin `from`). La cláusula se elimina del bundle, así que el nombre público
  apuntaba a nada y el build fallaba con un mensaje que no ayudaba
  (`ASSET_KIND → ASSET_KIND`). Ahora lo resuelve, y el nombre correcto llega a
  `dist/`.

## [0.2.0] - 2026-08-06

Con esto Raptor deja de poder dibujar solo colores planos. Un motor de juegos
sin imágenes no es una herramienta para hacer juegos.

### Añadido (Sprites y texturas)
- **`components/render/texture.js`** — `Texture`: una imagen en la GPU, desde una
  URL, un `<canvas>`, píxeles en crudo o un color liso. Es **usable desde el
  primer frame**: nace como un píxel blanco de 1×1 y se cambia sola cuando la
  imagen llega, así que nada tiene que esperar ni revienta mientras tanto
  (`texture.loaded` es la promesa, para quien prefiera esperar). Resuelve de una
  vez las tres trampas de WebGL 1: la **Y invertida** (la primera fila de una
  imagen es la de arriba, la de una textura la de abajo), los **lados que no son
  potencia de dos** (no admiten mipmaps ni `REPEAT`, y pedirlos dibuja la textura
  en negro sin decir por qué) y el propio tiempo de carga. `setSmooth` alterna
  `NEAREST` —por defecto, para pixel art nítido— y `LINEAR`.
- **`components/shapes/sprite.js`** — `Sprite`: un quad que dibuja **parte** de
  una textura. `setFrame({ x, y, width, height })` toma el rectángulo **en
  píxeles**, que es como se mide una hoja de sprites, y lo convierte a
  coordenadas 0..1. El color actúa como **tinte** (el shader multiplica el
  téxel), así que blanco no toca nada, un color tiñe y el alfa desvanece: poner
  un personaje en rojo al recibir un golpe no necesita una segunda imagen.
  `setFlip` voltea la imagen sin tocar la transformación — girarla lo pondría
  boca abajo.
- **`components/render/spriteSheet.js`** — `SpriteSheet` corta una textura en
  rejilla (con `margin` y `spacing`); `Animation` guarda **tiempo**, no un
  contador de fotogramas, así que a 8 fps un ciclo dura lo mismo a 30 Hz que a
  144; y `Animator` le pone nombres (`play("andar")`). Volver a pedir la
  animación que ya está sonando es un no-op, que es lo que evita el personaje
  congelado a media zancada.
- **Capas de dibujo**: `shape.setLayer(n)` decide el orden — bajas primero, y
  dentro de una capa manda el orden de inserción. El motor reordena solo cuando
  algo cambia, no en cada frame. Sin esto, la única forma de poner un fondo
  detrás era añadirlo el primero y no cambiar de opinión nunca.
- **Demo `sprites.html`** (fuente `sprites/spritesDemo.js`): un mapa con suelo
  por tiles, árboles, una moneda girando y un personaje animado que se voltea al
  cambiar de sentido. La hoja de sprites se **dibuja al vuelo** con un canvas 2D
  y se sube con `Texture.fromCanvas`, así que la página sigue siendo un único
  archivo que se abre desde `file://` sin nada al lado — el mismo enfoque que el
  sonido sintetizado. Panel con la hoja a la vista, el fotograma actual y sus UV,
  velocidad de animación, tintes, filtrado y visibilidad de las copas.
  Los troncos van por debajo del jugador y las copas por encima, aunque se añaden
  al revés: se puede caminar *detrás* de un árbol.

### Cambiado
- **Varios programas de shader.** `components/render/shaders.js` cachea los
  programas por (contexto, tipo) en vez de haber uno solo. `Shape` expone
  `program` y un `bindAttributes` que las subclases amplían, de modo que un
  sprite añade sus coordenadas de textura sin tocar las matrices. Las formas de
  color y los sprites **conviven en la misma escena** (en la demo, la sombra del
  personaje es un `Circle` normal).
- **Los arrays de atributos se desactivan tras dibujar.** Son estado global, no
  del programa: dejar uno encendido hacía que la forma siguiente leyera un búfer
  que su shader nunca pidió. Con un único programa no se notaba; con dos, sí.
- **Los errores de shader lanzan** en lugar de abrir un `alert()`. Una librería
  no tiene por qué abrir un modal, y una traza dice qué forma pidió el programa.

## [0.1.0] - 2026-08-06

Raptor pasa de ser un montón de componentes con demos alrededor a ser un
**framework**: una superficie pública, un shell de aplicación y un build que
sigue el grafo de módulos.

### Añadido (El framework)
- **`raptor.js`** — entrada única: `import { App, Rectangle } from "./raptor.js"`.
  Junto a **`components/index.js`** define la **superficie pública** (61 nombres):
  si algo está ahí, se puede usar y no se mueve sin una nota aquí; si no está, es
  detalle interno.
- **`package.json`** con `type: module`, versión y un **mapa de `exports` por
  capa**, así que se puede importar todo (`raptor-engine`) o solo una parte
  (`raptor-engine/physics`).
- **`components/app.js`** — `App`, el shell. `App.boot(opciones, setup)` espera al
  documento, inyecta los estilos, monta `#app`/`#stage`/`#panel`, crea el canvas y
  el contexto, engancha teclado y mandos táctiles, y arranca el bucle **después**
  de que `setup` termine. Expone `add`, `onUpdate`, `addPanel`, `addOverlay`,
  `pause`/`resume`, `toggleFullscreen`, `resize`/`watchResize` y eventos
  `resize`/`fullscreenchange`. **`app.use(plugin)`** es el punto de extensión: con
  `install(app)` el plugin se configura solo; con `step(dt)` o `update(dt)` entra
  directamente en el bucle (un `World` de física cumple lo segundo).
- **`components/ui/`** — `el()`, `card()`, `kv()`, `slider()`, `select()`,
  `button()`, `hint()`, `injectStyles()` y `BASE_STYLES`, más `fullscreen.js` con
  la API prefijada de Safari y un `onFullscreenChange` (hace falta: se puede salir
  con Escape sin tocar el botón).
- **`components/input/`** — `Keyboard` separa **teclas mantenidas** (`isDown`,
  `axis`) de **acciones** (`on`, una vez por pulsación, ignorando la repetición
  automática), y suelta todo al perder el foco, que es lo que evita que cambiar de
  pestaña acelerando deje el acelerador pegado. `TouchPad` monta los mandos sobre
  el canvas y **escribe en el mismo conjunto de teclas**, así que dedo y teclado
  no pueden contradecirse; los pedales capturan el puntero y los taps van en
  `pointerdown`, no en `click`.
- **`dist/raptor.js`** (librería ESM) y **`dist/raptor.global.js`** (para
  `<script src>`, deja `window.Raptor`), generados por el build.
- **`tools/test.mjs`** y `npm test`: 51 comprobaciones que ejecutan las páginas
  generadas en un Chromium real (SwiftShader, sin GPU). Si Playwright no está
  instalado lo dice y sale con 0 en vez de romper el checkout.

### Cambiado
- **El build sigue los `import`, no una lista.** `tools/build-standalone.mjs` pasa
  a ser **`tools/build.mjs`**: lee el grafo de módulos desde cada entrada, los
  ordena por dependencias y **falla** —diciendo qué dos archivos— si dos declaran
  el mismo nombre de nivel superior. Las páginas generadas son un `<script>`
  plano, donde eso es un `SyntaxError` que deja la página en blanco (`const`,
  `class`) o un solapamiento silencioso (`function`); las listas escritas a mano
  hicieron que ocurriera más de una vez. Añadir un módulo a una demo es ahora
  importarlo. También detecta ciclos y comprueba que cada nombre público existe
  de verdad en el bundle.
- **Las cinco demos pasan por el framework.** `el()` estaba copiado literalmente
  en cuatro archivos, `kv()` en tres, `slider()` en tres, el arranque en cuatro y
  el conjunto de teclas pulsadas en tres; las demos sumaban 2682 líneas frente a
  2709 del motor. Ahora suman **2344** y ninguna vuelve a escribir ese armazón.
  `components/main.js` se convierte en el hola-mundo del framework.
- **Teclas mantenidas en lugar de eventos repetidos**: las flechas del demo de
  blindaje y la torreta manual (Q/E) de la batalla se leen del estado del teclado
  en cada frame, así que giran a velocidad constante en grados por segundo en vez
  de depender de la configuración de repetición del sistema — y no hay forma de
  que se queden girando.
- **`RaptorEngine`** gana `stop()` y `running`, y `start()` es idempotente (dos
  bucles duplicarían cada delta). Al reanudar se descarta la marca de tiempo, de
  modo que el frame siguiente a una pausa recibe `dt = 0` y no todo el rato que
  estuviste fuera. `createWindow(mount, { width, height })` acepta el tamaño.
- `.github/workflows/deploy.yml` construye con `tools/build.mjs`, así que un
  despliegue ya no puede salir con una página en blanco por nombres duplicados.

## [Sin publicar] - 2026-07-22

### Añadido (Banco de pruebas: motor y caja)
- **`components/vehicles/engine.js`**: `Engine` modela una **curva de par**
  (sube desde el ralentí, pico a media vuelta, caída hacia el corte) con una
  parábola por tramo que pasa exactamente por los valores de ralentí y corte que
  se le den. La **potencia se deriva**, no se configura: `P = T · ω`, y por eso
  su pico cae a más vueltas que el de par (por defecto 340 Nm @ 3400 rpm y
  247 CV @ 6280 rpm). `peakPower` lo encuentra muestreando la curva.
- **Modo mecánico en `Gearbox`**: con relaciones reales y un `Engine`, las
  revoluciones **vuelven** desde la velocidad a través de la transmisión
  (`engineRpm`) y expone `wheelTorque`, `wheelForce`, `gearTopSpeed` y `power`,
  para que quien llame integre física de verdad. Sin esos parámetros conserva el
  modelo normalizado que usa la batalla, así que allí nada cambia.
- **Demo `dyno.html`** (fuente `vehicles/dynoDemo.js`): recta de **420 × 9 m**
  (unas 47 veces más larga que ancha) con integración longitudinal real
  (tracción con tope de agarre, resistencia aerodinámica ∝ v², rodadura, frenos).
  Panel con marcha, velocidad, **cuentavueltas**, par, fuerza a la rueda,
  potencia y aceleración en g; **curva de par y potencia en vivo** con marcas en
  los picos y la posición actual del motor; **sliders** de par máximo, régimen de
  par máximo, corte y grupo final; **cronómetro** de 0-100 km/h, 400 m con
  velocidad de paso, distancia y G máxima. Caja automática o manual. La cámara se
  aleja con la velocidad. Entrada de desarrollo `dyno-dev.html`.
- **Controles táctiles** sobre la pista, para poder probarlo en el móvil:
  **GAS** y **FRENO** como pedales (se mantienen pulsados, con captura de
  puntero para que soltar fuera del botón también los suelte), **▲/▼** de marcha,
  **AUTO/MAN** y **↺** de reinicio. Teclado y táctil alimentan el mismo estado,
  así que ninguno pisa al otro; los botones de marcha se atenúan en automática y
  el pad se compacta en pantallas estrechas para no tapar la pista.
- **`components/audio/engineSound.js`**: `EngineSound` sintetiza la nota del
  motor con Web Audio, sin ficheros, para que las páginas sigan abriéndose desde
  `file://`. El tono es la **frecuencia de encendido** (`f = rpm/60 ·
  cilindros/(tiempos/2)`, o sea `rpm/30` en un cuatro cilindros de cuatro
  tiempos: 27 Hz al ralentí, 227 Hz en el corte). Sobre ella se apilan armónicos
  en diente de sierra y ruido en banda para el soplido, y un **paso bajo que se
  abre con la carga** da la sensación de esfuerzo. Un cambio de marcha **corta la
  nota**, igual que corta la transmisión. El primer clic, toque o tecla arranca
  el audio (los navegadores lo exigen) y **🔊 / M** silencia. Si no hay Web Audio
  todo queda en no-op, así que quien llame no necesita comprobarlo.
- **Pantalla completa** en el banco de pruebas (**⛶ / F**, con los prefijos de
  Safari): la pista se lleva todo el alto y el panel queda al lado con scroll
  —debajo en pantallas estrechas—. Como el panel puede quedar fuera de vista, un
  **HUD compacto** sobre la pista mantiene a la vista marcha, velocidad y
  cuentavueltas.
- Portada (`index.html`) con la nueva tarjeta.

### Corregido
- **`RPM_TO_RAD` duplicada** como `const` en `engine.js` y `gearbox.js`: en el
  build autocontenido ambas caen en el mismo ámbito y eso es un `SyntaxError`
  que dejaba la página en blanco. La de la caja pasa a ser `RPM_PER_RAD` (la
  inversa, con nombre y semántica distintos).
- **`toggleMode` como `const` flecha** en el banco de pruebas: el handle de
  depuración la referenciaba antes de su declaración y las flechas no se izan.
  Pasa a ser una declaración de función.

### Cambiado (Colisiones por la forma del vehículo)
- **Los cuerpos dejan de chocar como círculos**: el casco colisiona por su
  **contorno real** reutilizando `collide()` (SAT) y `boundingRadius()` de
  `components/physics/`, tanto contra el escenario como entre tanques. Un filtro
  por radio descarta lo lejano y solo entonces se resuelve el solapamiento.
- Se nota en el juego: el mismo casco para a **1,348 u** de un bloque puesto de
  morro (su semilargo, 0,400) y a **1,223 u** de costado (su semiancho, 0,275).
- Los límites del mundo (`TANK_BOUNDS`) pasan a ser una red de seguridad en el
  borde del mapa: antes recortaban a todos a la misma distancia y **tapaban** las
  diferencias de forma; ahora manda la colisión del casco.

### Añadido (Visualizar el escuadrón)
- **Flechas de escuadrón**: cada aliado vivo que queda fuera de la vista tiene un
  indicador azul fijado al borde de la pantalla apuntando hacia él, que
  desaparece en cuanto entra en cuadro.
- El panel de escuadrón muestra **la distancia** a cada aliado.

### Corregido
- **`worldPolygon` duplicada** en `ballistics.js` y `physics/collision.js`: en el
  build autocontenido ambas acaban como globales y una pisaba a la otra. La de
  balística pasa a llamarse `hullOutline`.

### Añadido (Modo por equipos: rey de la colina)
- **Dos escuadrones enfrentados** en `drive.html`: el jugador y **5 aliados**
  (azules) despliegan al oeste, **5 enemigos** (rojos) al este, con el objetivo
  entre medias. El tanque del jugador conserva los colores de su diseño.
- **Zona central** (disco translúcido) que se gana **controlándola 30 s**: un
  bando solo suma mientras está **solo** dentro, con los dos presentes el reloj
  **se para** («en disputa») y con la zona vacía ambos marcadores decaen. El
  número ayuda con rendimientos decrecientes (×1,6 máximo). El disco cambia de
  color según quién manda.
- **Final con motivo:** victoria por control o por aniquilar al escuadrón
  enemigo; derrota si el enemigo controla la zona o si te destruyen — el banner
  dice cuál de las cuatro.
- **Sin fuego amigo:** los proyectiles atraviesan a los tanques del mismo bando.
- **IA con estado `ADVANCE`** (`tankAI.js`): toma y defiende el terreno que se le
  asigna (`objective`, `objectiveRadius`) en vez de deambular, y cada tanque
  recibe un punto distinto alrededor del centro para desplegarse por la zona.
  Además ya no persigue solo al jugador: ataca al **rival vivo más cercano**.
- **HUD:** tarjeta de objetivo al frente del panel con una barra por bando, los
  segundos acumulados y el estado de la zona; rosters separados para tu
  escuadrón y el enemigo; el minimapa dibuja la zona y a los aliados en azul.

### Añadido (Balística en la batalla)
- **`drive.html` pasa a usar el modelo de penetración completo** en vez de daño
  plano: los proyectiles se lanzan por *raycast* contra el **casco poligonal** de
  cada tanque (`raycastShape`), y el impacto se resuelve con `resolveShot`, de
  modo que importan la **cara golpeada** y el **ángulo**.
- **`Armor.forHull(shape, {front, side, rear})`**: deriva el blindaje por cara de
  la propia silueta del casco, clasificando cada arista según hacia dónde mira en
  el espacio local. Funciona con cualquier casco convexo — rectángulo, triángulo,
  hexágono y cuña reparten sus caras solos.
- **Blindaje, penetración y munición por diseño**: Ligero 30/18/14 con cañón de
  55 mm … Pesado 105/62/45 con 145 mm. Los enemigos cargan el proyectil de su
  diseño; el jugador elige entre **AP, APCR, HEAT y HE** con la tecla **C**.
- **Rebote**: un proyectil que patina **sigue volando**, más lento y con menos
  penetración, y puede impactar en otra cosa.
- **HUD**: marcadores de impacto de colores en el mundo (penetra / esquirlas /
  rebote / no penetra) e informe en el panel con cara, ángulo, **blindaje
  efectivo** y penetración.

### Corregido
- **Winding del casco en cuña** (`Cazacarros`): estaba definido en sentido
  horario, y `raycastShape` deduce la normal saliente asumiendo **antihorario**.
  Con el orden anterior sus normales apuntaban hacia dentro, así que todos los
  impactos contra ese casco se habrían resuelto como rebote.

### Añadido (Mapa y puntería)
- **Arena diez veces mayor**: `drive.html` pasa de 18 × 13 a **57 × 41** unidades
  (√10 más larga por lado, es decir **10× el área**), con **78 obstáculos**
  dispersos desde una semilla fija (mismo mapa en cada carga) y **12 enemigos**
  repartidos en anillo alrededor del inicio. Rejilla cada 4 unidades.
- **Auto-apuntado** (`components/controls/autoAim.js`): `AutoAim` cede la torreta
  a una política de selección de objetivo, y un botón recorre el ciclo
  **off → más cercano → menos vida → más vida → más fuerte → off**. Solo elige
  objetivo y apunta: nunca dispara. Los empates se rompen por distancia y el
  objetivo actual gana el empate exacto, para que el cañón no oscile.
- **`Tank.power`**: amenaza de diseño (resistencia × daño por segundo), que es lo
  que ordena el modo «más fuerte».
- **Fuego automático**: botón **AUTO** (tecla **F**, también en móvil) que
  mantiene el gatillo. Con un objetivo enganchado no malgasta proyectiles —
  espera a que la torreta esté **alineada** (4° de margen) y **no dispara si hay
  cobertura por medio**; sin objetivo equivale a tener el gatillo apretado.
- **`Tank.aimErrorTo(punto)`**: grados que le faltan al cañón para estar sobre un
  punto. Lo usan el fuego automático y la IA enemiga (que deja de duplicar el
  cálculo de ángulos).
- **Demo:** tecla **T** (o botón 🎯, también en móvil) cicla el modo; el objetivo
  enganchado se marca con una **retícula** en el mundo y un círculo en el
  minimapa, y el panel muestra el modo, el enemigo fijado, su vida y la
  distancia. Prioridad de apuntado: giro manual (Q/E) > auto-apuntado > puntero.

### Añadido (Transmisión)
- **Caja de cambios** (`components/controls/gearbox.js`): `Gearbox` da al
  vehículo una transmisión real. Cada marcha alcanza una fracción del tope de
  velocidad (`ratios`): las cortas dan **más par** pero se quedan sin vueltas y
  la larga es la única que llega al máximo. Las **revoluciones** (0..1) salen de
  la banda de la marcha y una **curva de par** ahoga el motor abajo y lo hace
  perder fuerza cerca del corte; cambiar **corta la transmisión** durante
  `shiftTime`.
  - **Automática:** cambia sola por revoluciones, con histéresis
    (`upshiftAt`/`downshiftAt`) para no saltar entre dos marchas, y engrana la
    **marcha atrás** al pedir retroceso desde parado.
  - **Manual:** el jugador recorre `R · N · 1 · 2 · …`; dejar una marcha larga a
    pocas vueltas ahoga el motor y estirarla topa con el limitador.
- **`TankController` acepta una caja** (`gearbox`): la acelera con el par de la
  marcha y limita la velocidad a la de esa marcha; pedir el sentido contrario al
  engranado **frena**. Sin caja, el comportamiento anterior no cambia.
- **Una caja por diseño de tanque**: el Pesado lleva 3 marchas y cambia en 0,5 s;
  el Ligero, 5 marchas y 0,16 s.
- **Demo `drive.html`:** panel de caja de cambios con **marcha engranada**,
  **cuentavueltas** (amarillo/rojo al acercarse al corte) e interruptor
  **automática/manual**; **G** alterna el modo y **Z**/**X** cambian de marcha
  (también con botones, útiles en móvil). Los enemigos usan caja automática.

### Añadido (Enemigos y combate)
- **IA por máquina de estados finitos** (`components/controls/tankAI.js`):
  `TankAI` gobierna un tanque enemigo con cuatro estados —
  **PATROL** (deambula entre puntos al azar) → **CHASE** (persigue al objetivo) →
  **ATTACK** (mantiene la distancia, apunta y dispara al estar alineado) →
  **RETREAT** (rompe el contacto al bajar del umbral de vida, sin dejar de
  apuntar). Incluye **línea de tiro** opcional (`isBlocked`) para no disparar a
  través del escenario y **detección de atasco** que da marcha atrás y gira. No
  toca el motor ni las armas: escribe en un `TankController`, apunta la torreta y
  levanta `wantsToFire`. Etiquetas legibles en `AI_STATE_LABEL`.
- **Salud y barra de vida en `Tank`**: integridad (`hp` / `maxHp` por diseño),
  `takeDamage()` y una **barra flotante sobre el casco** que no rota con él y
  pasa de verde a amarillo y rojo (solo se recolorea al cruzar umbral, para no
  re-subir el buffer cada frame). La lleva **tanto el jugador como los enemigos**.
- **Stats de combate por diseño**: Medio 100 HP / 25 daño, Ligero 65 / 13 (rápido
  de recarga), Pesado 170 / 42 (lento) y Cazacarros 90 / 36.
- **Demo `drive.html` convertida en batalla**: cuatro enemigos con IA sobre el
  mapa, **combate real** enganchando `Tank.muzzle` y la torreta a
  `components/weapons/` (proyectiles que impactan contra tanques y escenario,
  con fuego amigo), separación entre tanques, pecios al ser destruidos, banner de
  **victoria/derrota**, botón de nueva batalla, **botón de disparo táctil** para
  móvil y panel que muestra **el estado vivo de la FSM de cada enemigo** con su
  barra de vida. El minimapa dibuja aliados y enemigos.

### Añadido (Vehículos)
- **Tanques con torreta móvil** (`components/vehicles/tank.js`): `Tank` arma un
  vehículo con formas del motor — **casco** (lo conduce un `TankController`) más
  **torreta y cañón que giran independientemente** del casco, con ángulo absoluto
  del mundo y cadencia de giro (`traverse`) por diseño. API: `aimAt(punto, dt)`,
  `traverse(dir, dt)`, `sync()`, `addTo/removeFrom(game)` y `muzzle` (boca del
  cañón, lista para el módulo de armas).
- **Cuatro diseños** (`TANK_DESIGNS`) que varían la **forma** y las prestaciones:
  **Medio** (casco `Rectangle`, torreta `Circle`), **Ligero** (`Triangle` +
  pentágono, rápido y de torreta ágil), **Pesado** (hexágono `RegularPolygon` +
  `Circle`, lento y macizo) y **Cazacarros** (`Polygon` en cuña + `Square`, con
  torreta lenta).
- **`Camera.screenToWorld()`** y `viewExtents()`: convierten coordenadas de
  puntero a mundo teniendo en cuenta paneo y zoom (base para apuntar y para el
  *picking* del editor).
- **Demo `drive.html`:** selector de tanque (botones y teclas 1-4), la **torreta
  apunta con el ratón o el dedo** sobre el lienzo (Q/E la giran a mano), el
  minimapa dibuja cañón y casco por separado, y la telemetría muestra el ángulo
  de torreta. La colisión usa el radio de cada diseño.

### Añadido (Cámara)
- **Cámara 2D** (`components/camera.js`): ventana móvil sobre el mundo con centro
  (x, y) y zoom. `Camera.follow(objetivo, dt)` sigue suavemente (independiente
  del frame-rate) y `bounds` limita el centro a los bordes del mapa. Integrada en
  `RaptorEngine` (`game.camera`, por defecto identidad → escenas existentes sin
  cambios); todas las entidades se dibujan a través de ella. `Shape.draw(camera)`
  aplica paneo y zoom (mundo → pantalla).
- **Demo `drive.html`:** el mapa ahora es **mayor que la pantalla** (~18 × 13),
  con muros perimetrales, rejilla de referencia y más obstáculos; la **cámara
  sigue al tanque** y se frena en los bordes del mapa. HUD muestra la posición.
  - **Colisiones:** el tanque (círculo) choca con muros y obstáculos (cajas AABB)
    mediante resolución por expulsión (*push-out*); frena en un golpe frontal
    pero desliza al rozar. Ya no los atraviesa.
  - **Minimapa** en el panel: mapa completo con los obstáculos, el tanque (con
    rumbo) y el recuadro de la zona visible; rejilla más clara para percibir el
    movimiento de la cámara.

### Añadido (Controles)
- **Controlador de movimiento estilo tanque** (`components/controls/`):
  - `tankController.js` — `TankController` mueve una forma como un tanque de
    orugas: acelerador hacia adelante/atrás según la orientación, giro del casco
    **sobre su eje** (giro neutral), fricción al soltar y límites opcionales
    (`bounds`). Es input-agnóstico (`setInput` / `hold`) y trae bindings de
    **teclado** (WASD + flechas, `bindKeys()`) y **táctil/ratón** (botones en
    pantalla vía *pointer events*, `bindTouch()`); ambos alimentan el mismo
    estado, así que el multitáctil combina avanzar y girar. Expone `forward` y
    `velocity`. Sigue la convención del motor (rotación CCW, local +Y = adelante).
- **Demo `drive.html`** (fuente `controls/driveDemo.js`): un tanque manejable
  (casco + torreta + cañón) por un arena con obstáculos de referencia y HUD
  (velocidad, rumbo, acelerador y teclas activas). **Funciona en móvil**: D-pad
  táctil superpuesto al lienzo (giro a la izquierda, acelerador a la derecha) y
  diseño responsive que apila el panel bajo el lienzo en pantallas estrechas.
  Entrada de desarrollo `drive-dev.html`. Handle `window.raptorDrive`.

### Añadido (Despliegue)
- **Publicación en GitHub Pages** en <https://jukoleda.github.io/raptor-project/>
  mediante `.github/workflows/deploy.yml`, que regenera las páginas
  autocontenidas y despliega en cada push a `main`.
- **Portada** (`index.html`, escrita a mano) que enlaza las tres demos.

### Cambiado (Despliegue)
- La demo de formas del motor pasa de `index.html` a **`engine.html`** para que
  la raíz del sitio sea la portada. `build-standalone.mjs` genera ahora
  `engine.html` (antes `index.html`).

### Añadido (Armas y balística)
- **Módulo de armas** (`components/weapons/`):
  - `ballistics.js` — balas como **raycast** (segmento barrido) contra las aristas
    del blanco: da punto de impacto y normal de la cara, evitando *tunneling*.
    Modelo de penetración `blindajeEfectivo = nominal / cos(θ)` con resultado
    **penetra / rebota (≥70°) / no penetra**.
  - `bullet.js` — proyectil con posición previa para colisión continua.
  - `weapon.js` — arma con penetración, velocidad de boca, recarga y daño.
  - `armor.js` — blindaje por cara (frontal/lateral/trasera) e integridad (HP);
    helper `Armor.rectangle`.
  - `projectiles.js` — **tipos de proyectil básicos** con su **esquema de daño**:
    `AP` (perforante, polivalente), `APCR` (subcalibre: más penetración, menos
    daño, rebota antes), `HEAT` (carga hueca: ignora la inclinación del blindaje
    y no rebota) y `HE` (alto explosivo: poca penetración pero mucho daño, y aun
    sin penetrar astilla al blanco con esquirlas). Cada tipo escala penetración y
    daño del arma y ajusta el modelo de penetración (`ricochetAngle`,
    `normalizes`); `resolveShot()` resuelve impacto → HP según el tipo.
  - `ballistics.js` — `evaluateImpact` acepta `normalizes` para que los cargas
    huecas / HE penetren el blindaje nominal sin bonificación por ángulo.
- **Demo `tanks.html`** (fuente `weapons/tanksDemo.js`): cañón que dispara contra
  un blanco cuyo blindaje se puede **rotar** para ver PENETRA / REBOTE / NO PENETRA
  según el ángulo, con **selector de munición** (AP/APCR/HEAT/HE), HUD (cara,
  ángulo, blindaje efectivo, penetración y daño causado) y barra de integridad.
  Controles: Espacio / clic disparan, ←/→ rotan, teclas 1-4 cambian de munición,
  sliders de penetración base, ángulo y blindaje frontal. Handle
  `window.raptorTanks` (expone `setAmmo` y `PROJECTILES`).
- **Build:** `tools/build-standalone.mjs` genera también `tanks.html`; entrada de
  desarrollo `tanks-dev.html`.
- **Alcance:** balas rectas (sin gravedad) y respuesta por cara plana;
  penetración por ángulo/blindaje con esquema de daño por tipo de proyectil
  (incluye esquirlas de HE al no penetrar). Aún sin sobrepenetración, daño por
  área/radio real ni blindaje espaciado.

### Añadido (Física — Fase A: colisiones)
- **Módulo de física** (`components/physics/`):
  - `Body` — componente que se adjunta a una forma: tipo (`static` / `dynamic`),
    velocidad, masa/`invMass`, restitución (rebote) y filtrado de colisión
    (`groupIndex` estilo Box2D + `category`/`mask`).
  - `collision.js` — detección convexa: círculo-círculo, **SAT** polígono-polígono
    y círculo-polígono; devuelve normal + penetración. Aprovecha que todas las
    formas son convexas.
  - `World` — `step(dt)`: integra, detecta y resuelve (corrección posicional +
    impulso con restitución), con **grupos de colisión** y **límites** (bounds)
    del mundo. Escala O(n²), suficiente para el tamaño actual.
- **Colliders en las formas:** `getColliderVertices()` en rectángulo, cuadrado,
  triángulo y polígonos; `Circle` se trata como círculo real (`colliderShape`).
- **`RaptorEngine`:** el `renderLoop` calcula **delta-time** y ejecuta *updaters*
  (`addUpdater(fn)`) antes de dibujar. Base para física/animación/input.
- **Editor con física:** controles de **cuerpo** (dinámico / estático / sin física),
  **grupo** de colisión y **rebote** por forma, más **Play/Pausa**, **Gravedad**
  y **Reiniciar** (restaura posiciones y velocidades). Handle de depuración
  `window.raptorEditor`.
- **Nota de alcance:** Fase A es rigid-body **lineal** (sin respuesta angular) y no
  incluye soft body, que queda para una fase posterior (PBD + geometría dinámica).

### Añadido (Editor visual)
- **Editor básico de escena** (`editor.html`, fuente en `editor/editor.js`):
  canvas del motor + panel para **añadir** formas, **listarlas** y **seleccionarlas**,
  y **editar en vivo** color, posición, rotación y escala de la seleccionada, más
  **eliminar**. La edición es directa porque el motor lee el transform de cada
  entidad en `draw()`. Se genera autocontenido igual que `index.html`.
- **`RaptorEngine`**: `createWindow(mount)` admite montar el canvas en un
  contenedor (por defecto `document.body`) y expone `engine.canvas`; nuevo
  `remove(entity)` para quitar entidades.
- **`tools/build-standalone.mjs`** ahora genera varias páginas (`index.html` y
  `editor.html`) desde un mismo pipeline. Entrada de desarrollo `editor-dev.html`.

### Añadido (Distribución)
- **`index.html` autocontenido.** Nuevo build de un solo archivo con gl-matrix y
  todo el motor embebidos, que se abre en cualquier navegador con doble clic, sin
  servidor ni internet (funciona por `file://`). Es un archivo generado.
- **`tools/build-standalone.mjs`** genera ese `index.html` a partir de los módulos
  de `components/` y `vendor/gl-matrix-min.js` (desenrolla import/export e inlinea
  todo). Regenerar con `node tools/build-standalone.mjs`.
- **`vendor/gl-matrix-min.js`**: copia vendorizada de gl-matrix 3.4.3 para el build.
- La entrada de desarrollo basada en módulos ES se movió a **`dev.html`** (sigue
  usando gl-matrix por CDN y requiere servirse por HTTP).

### Añadido (Fase 3 — Sistema de formas)
- **Clase base `Shape`** (`components/shapes/shape.js`) que encapsula todo el
  pipeline común: shaders, buffers, transform (posición, rotación, escala, color)
  y `draw()`. Cada figura solo implementa `getVertices()` y su modo de dibujo.
- **Programa de shaders compartido y cacheado por contexto** (`WeakMap`): se
  compila y enlaza una sola vez y lo reutilizan todas las figuras, en lugar de
  recompilarlo por objeto.
- **Primitivas nuevas:** `Rectangle`, `Square`, `Triangle`, `Circle`,
  `RegularPolygon` (N lados) y `Polygon` (puntos arbitrarios, convexo).
- **API fluida (encadenable):** `setColor`, `setPosition`, `setScale`,
  `setRotation`, `setDepth` e `init()` devuelven la instancia. Recolorear tras
  `init()` reescribe el buffer de color sin reconstruir la geometría.
- **Barrel `components/shapes/index.js`** para importar todas las figuras de una.
- **Motor basado en entidades.** `RaptorEngine` ahora expone `add(entity)` y
  `start()`, y el `renderLoop` dibuja todas las entidades registradas. Sustituye
  al antiguo `draw()` que tenía un cuadrado cableado. `Square` se movió fuera de
  `raptorEngine.js`.

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
