# Handoff: Borsoga Prospector — plataforma de prospección B2B

## 1. Qué es esto

Una plataforma interna de Borsoga Studio para encontrar clientes B2B en el sur de Florida. Busca negocios en una zona del mapa con Google Places, audita automáticamente su presencia digital (web, reputación, redes, prensa), detecta deficiencias que Borsoga puede resolver, y las convierte en una propuesta de colaboración.

El eje de la interfaz es un mapa. Alrededor: una lista de prospectos ordenada por potencial, el expediente de cada prospecto con evidencia, una cola de revisión humana, un generador de propuestas, un pipeline de venta, la traza del agente y la configuración de zonas.

Stack previsto: Next.js + TypeScript en el front, Node + TypeScript en el back, shadcn/ui como librería de componentes, Google Places API, Postgres.

## 2. Sobre los archivos de diseño

Los `.dc.html` de este paquete son **referencias de diseño hechas en HTML**: prototipos que muestran aspecto y comportamiento previstos, no código de producción para copiar. La tarea es **recrear estas pantallas en el entorno real del proyecto** (Next.js + shadcn/ui) con sus patrones y su librería de componentes, no portar el HTML.

Concretamente: cada bloque del prototipo tiene un equivalente en shadcn — las tarjetas son `Card`, los chips son `Badge`, la barra de pestañas es `Tabs`, los desplegables de la cabecera son `Select`/`Popover`, el kanban son columnas con `ScrollArea`, la tabla de traza es `Table`, los interruptores de zona son `Switch`, los diálogos de estado son `Card` sobre el mapa (no `Dialog`: no bloquean). El mapa es `@vis.gl/react-google-maps` o la librería equivalente que elijas; en el prototipo es un SVG estilizado porque no había API key.

## 3. Fidelidad

**Alta fidelidad.** Colores, tipografía, espaciados y estados son finales y están tokenizados. Recréalos con precisión. Dos excepciones explícitas:

- El mapa es un placeholder SVG. Sustitúyelo por el mapa real con tiles y marcadores.
- Las capturas de pantalla de evidencia son bloques grises. En producción son imágenes reales guardadas por el crawler.

## 4. Archivos

| Archivo | Contenido |
| --- | --- |
| `Prospector Control Center v3.dc.html` | **La referencia buena.** Las 7 pantallas, paleta final, modo claro y oscuro, estados de carga/vacío/error. |
| `types.ts` | Contrato de datos: entidades, enums, payloads de API. Cópialo al repo y trabaja desde ahí. |
| `Prospector Control Center v2.dc.html` | Versión anterior, paleta viva. Solo referencia histórica, no la sigas. |

Cómo abrir la referencia: es un archivo HTML autónomo, se abre en el navegador. Navega con las pestañas de la cabecera. El icono de luna cambia a modo oscuro. Los estados de carga, vacío y error viven en la variable `estado` del componente (`normal` por defecto): cámbiala en el código para verlos.

## 5. Modelo de datos

El detalle está en `types.ts`. Las cinco decisiones que importan:

**El hallazgo (`Finding`) es la unidad de dato, no el negocio.** Un prospecto tiene N hallazgos; cada hallazgo pertenece a **una** rama de Borsoga (`renders` | `web` | `branding`), tiene severidad, veredicto, evidencia obligatoria y un texto de "lo que gana el cliente" en lenguaje de ventas.

**Sin evidencia no hay hallazgo.** `Evidence` exige `url`, `quote` (cita textual o volcado), `capturedAt` y `layer` — donde `layer` distingue lo que ve el buscador de lo que ve el usuario: `served_html`, `rendered_dom`, `both_equal`, `mismatch`, `external_source`. Esa distinción es una regla del auditor, no un detalle técnico: no se afirma nada sin comprobarlo en navegador real.

**Tres veredictos, y solo la IA propone.** `pending` → un humano lo mueve a `confirmed`, `nuanced` o `discarded`. En la cola de revisión el humano puede además pedir reverificación, que devuelve el hallazgo a `pending` con un nuevo intento.

**El score no es un número plano.** Cada rama tiene su score y su ticket estimado; el score total es su combinación ponderada. Dos prospectos de 80 se venden distinto según de qué rama venga su 80, y la interfaz lo muestra siempre desglosado.

**Los descartados no se borran.** Un prospecto fuera del ICP se guarda con `disqualified` y `disqualifyReason` legible, y se muestra en gris con el motivo. El equipo necesita ver por qué el sistema descartó algo para corregir los filtros.

### Cálculo del score (propuesta, ajustad los pesos con datos reales)

```
severityWeight = { critical: 10, high: 6, medium: 3, low: 1 }
verdictFactor  = { confirmed: 1, nuanced: 0.6, pending: 0.5, discarded: 0 }

branchScore = min(100, round(100 * Σ(severityWeight × verdictFactor) / 24))
totalScore  = round(0.45 × maxBranchScore + 0.35 × secondBranchScore + 0.20 × icpFitScore)
```

`icpFitScore` sale de tamaño de empresa, sector, ticket estimado, reputación e indicios de crecimiento. Guarda siempre los factores del cálculo (`scoreFactors`) para poder explicar un score en la interfaz; un número sin explicación no se puede discutir con el equipo comercial.

### Filtro de ICP

Entra: empresa independiente, 10–200 empleados, Miami-Dade / Broward / Palm Beach, sectores visuales de ticket alto (construcción, remodelación, desarrollo inmobiliario, casas modulares, closets, cocinas, millwork, cabinetry, interiorismo), proyectos de $20.000 o más, producto real y buena reputación.

Sale: franquicias nacionales, empresas con agencia interna o más de ~200 empleados, negocios sin web ni producto propio. Cada exclusión se guarda con su motivo.

## 6. Pantallas

Cabecera y barra de pestañas son comunes a todas. Lienzo de referencia: 1600 × 1000, pero el layout es fluido — las columnas laterales tienen ancho fijo y el centro absorbe.

### Cabecera (52 px)

Izquierda: logotipo (cuadrado 25 px, radio 7, fondo `--accent`, letra B en `--accent-ink`) y "Borsoga / Prospector". Centro (máx. 620 px): campo de zona con lupa, luego selectores compactos de sector y de ticket mínimo, y el botón primario "Escanear zona" con icono de mira. Derecha: contador de cuota de Places con punto de estado, conmutador de tema (icono de luna) y avatar.

Todos los controles de la cabecera son de 32 px de alto, radio 8, borde `--line2`, fondo `--input`. Nada envuelve en dos líneas: `white-space: nowrap` en todas las etiquetas y `flex: none` en los selectores, solo el campo de zona encoge.

### Barra de pestañas (40 px)

Mapa · Revisión (23) · Expediente · Propuestas (4) · Pipeline (11) · Traza · Zonas. Pestaña activa: fondo `--chip`, radio 7, texto `--text`. Inactiva: texto `--muted`. Los contadores van en mono 10,5 px. A la derecha, la marca de tiempo del último escaneo con un punto de color de acento.

### 6.1 Mapa (vista principal)

Tres columnas: lista 336 px · mapa fluido · expediente resumido 372 px.

**Lista izquierda.** Cabecera con "Prospectos en la zona" y el total, más tres chips de filtro (Encaje ICP, Sin contactar, Descartados) con su recuento. Cada fila: cuadrado 32 px con el score en mono coloreado por tramo, nombre, sector y ciudad, y una fila de insignias por rama (`R`, `W`, `B` con su recuento) más el ticket estimado alineado a la derecha. Los descartados van al 55 % de opacidad con el motivo en cursiva. Pie: criterio de orden y "Exportar JSON".

**Mapa.** Marcadores circulares de 29 px con el score dentro, coloreados por tramo (alto: acento; medio: `--warn`; bajo: neutro; descartado: neutro al 45 %). El prospecto seleccionado usa un marcador de 38 px relleno de acento con anillo pulsante (2,4 s, `pulseRing`). El área de búsqueda es un círculo de trazo discontinuo con relleno radial tenue. Arriba a la izquierda, conmutador de codificación de color (Score total · Rama · Ticket · CRM) y "Dibujar área". Arriba a la derecha, panel de escaneo en curso con barra de progreso, pasos y coste acumulado. Abajo a la izquierda, leyenda. Abajo a la derecha, zoom.

**Ventanas flotantes en vivo.** Dos paneles ancladas al marcador seleccionado por una línea de puntos animada (marcha de hormigas, `ants` 1,1 s lineal infinita, `stroke-dasharray: 2 6`), con un punto de acento en el codo y otro en el destino. Importante: en SVG las coordenadas porcentuales solo funcionan en `line`/`circle`, no en `path` ni `polyline` — en producción calcula las coordenadas desde la proyección real del mapa y recolócalas al mover o hacer zoom.

- *Auditoría web en vivo*: barra de título con punto de estado y etiqueta del agente, URL actual con contador de páginas, miniatura del sitio recorrida por una línea de escaneo (`scanY`, 3,2 s, alterna) y un cursor circular que salta entre zonas (`crawl`, 6 s), y a la derecha el log con símbolos ✓ ✗ ! → y un cursor que parpadea.
- *Personas y menciones*: fichas de directivos con iniciales, cargo, porcentaje de confianza, y filas mono de LinkedIn, email, móvil parcialmente enmascarado y señal de intención; debajo, menciones en internet con fuente y fecha.

**Expediente resumido (derecha).** Cabecera con nombre, dirección, score grande en acento, ratings de Google y Houzz, tamaño de empresa, y dos chips (encaje ICP, indicio de crecimiento). Cuerpo: una tarjeta por rama con punto de color, nombre, recuento, ticket y score de rama, y dentro hasta tres hallazgos con punto de severidad, titular, URL de evidencia en mono y etiqueta de veredicto abreviada. Al final, la propuesta sugerida con ticket y confianza. Pie: "Abrir expediente" (primario) y "Generar propuesta".

> Ojo con un error que ya se cometió: el contenedor con scroll de esta columna debe ser `display: flex; flex-direction: column` con `gap`, no `grid`. Un grid con altura definida comprime las filas en lugar de desbordar, y las tarjetas recortan hallazgos sin que aparezca barra de scroll.

### 6.2 Expediente completo

Cabecera fija: botón de volver, nombre, chip de encaje, línea de metadatos (sector, ciudad, dominio, empleados, fecha de verificación) y a la derecha cuatro cifras (score total, hallazgos, confirmados, ticket) más "Generar propuesta".

Cuerpo con scroll, una sección por rama. Cada sección abre con punto de color, nombre, recuento y, a la derecha, ticket y score de rama sobre una línea divisoria.

Cada hallazgo es una rejilla de dos columnas, `1fr 496px`, separadas 20 px:

- **Izquierda**: etiquetas de veredicto y severidad, titular 15 px/500, descripción 12,5 px `--muted` con `line-height: 1.55` y ancho máximo 620 px, luego el bloque "Lo que gana el cliente" con borde izquierdo de 2 px del color de la rama, y por último el botón "Reverificar con IA" con la marca de tiempo de la última verificación.
- **Derecha**: tarjeta de evidencia con cabecera (etiqueta, URL en mono, capa), la cita textual en un bloque mono sobre `--inset` con `white-space: pre-wrap`, fecha y método debajo, y a su derecha la captura de 178 px con su fecha y el enlace a tamaño completo.

Al final, la tarjeta de viabilidad comercial en prosa (crecimiento, si es franquicia, si tiene agencia) con "Añadir al pipeline" y "Descartar".

### 6.3 Revisión

Un hallazgo a la vez, a pantalla ancha, más un rail derecho de 328 px con la cola.

Barra superior: título, recuento de pendientes y prospectos, filtro de tres estados (Pendientes · Matizados · Todos) y, a la derecha, los atajos de teclado en mono (`C` confirmar, `M` matizar, `D` descartar, `↑↓` navegar).

Cuerpo: línea de contexto (prospecto, chip de rama, chip de severidad, "hallazgo 1 de 23"), titular 21 px/700, descripción, y dos tarjetas al 50 % con la evidencia servida y la captura. Debajo, "Lo que gana el cliente" con borde de rama, y la fila de acciones: Confirmar (primario), Matizar y editar, Descartar, Reverificar con IA, más la nota "se guarda y salta al siguiente".

Rail derecho: filas con punto de severidad, prospecto en pequeño, letra de rama coloreada y titular a dos líneas. Pie con "Revisados hoy".

### 6.4 Propuestas

Panel izquierdo de 396 px + documento centrado de 720 px sobre `--bg`.

El panel tiene dos modos, conmutados en su cabecera:

- **Configurar**: fases activables con casilla, precio, viñetas de entregables y plazo, y al final el desglose de subtotal, descuento y total.
- **Editar**: lista de bloques del documento arrastrables (asa de puntos, punto de activo, nombre, tipo: fijo / texto / texto IA / hallazgos / precios), "+ Añadir bloque", y un selector de tono (Directo · Cercano · Técnico) con la nota de que la IA solo reescribe los bloques de texto IA — los hallazgos y los precios nunca.

En modo Editar aparece además una barra de inserción sobre el documento (H, Párrafo, Lista, Cita de evidencia, Tabla de precios, separador, "Reescribir con IA" en color de acento, y "guardado hace 12 s"), y el bloque seleccionado se marca con contorno discontinuo de acento, su etiqueta de tipo y controles ↑ ↓ ⋯.

El documento: membrete "Borsoga Studio · Miami" en versalitas espaciadas, título a dos líneas 27 px/700, fecha y destinatario en mono, párrafo de apertura, sección "Lo más urgente" con tres hallazgos numerados (01, 02, 03) que citan URL y fecha, sección de tres fases con plazo y precio alineado a la derecha y total, y cierre con el siguiente paso sobre fondo `--accent-soft`.

Cabecera del panel: idioma ES/EN y plantilla. Pie: "Enviar por email" (primario) y "PDF".

### 6.5 Pipeline

Barra de métricas de 62 px: En pipeline, Valor abierto (en acento), Propuestas activas, Tasa de respuesta, Ganado este trimestre (en `--ok`). A la derecha, filtros de responsable y de periodo.

Kanban de seis columnas de 246 px con scroll horizontal: Detectado · Revisado · Propuesta enviada · Reunión · Ganado · Perdido. Cabecera de columna con punto de color, nombre, recuento y valor agregado. Tarjeta: nombre, score en mono a la derecha, sector y ciudad, y pie con avatar del responsable, antigüedad, ticket, y una línea de aviso opcional en `--warn` ("sin abrir · reenviar", "preparar renders de muestra").

### 6.6 Traza

Tabla en vivo + panel de detalle de 388 px.

Barra superior: identificador del escaneo, zona, hora de inicio y estado, y a la derecha los totales en mono (pasos, tokens, coste, errores en `--crit`). Debajo, filtros (Todos los pasos · Solo errores · Llamadas a IA) y la nota "se actualiza en vivo".

Rejilla de columnas `86px 1fr 168px 74px 74px 68px 84px`: Hora, Paso, Objetivo, Estado, Duración, Tokens, Coste. Todo en mono 11 px. La cabecera es `position: sticky`. Estado coloreado: `ok` en `--ok`, `reintento` en `--warn`, `404`/`timeout` en `--crit`. La fila seleccionada usa fondo `--hover`.

Panel derecho: nombre del paso, modelo, duración y coste; bloques de entrada y salida en JSON mono sobre `--inset`; y una tarjeta de reintentos y errores que incluye las señales de cumplimiento (robots.txt respetado, 1 req/s, aciertos de caché de Places).

### 6.7 Zonas

Tabla de zonas + formulario de 388 px.

Columnas `1fr 178px 130px 120px 96px 84px 46px`: Zona (nombre + coordenadas y radio en mono), Sectores, Programación, Último escaneo, Prospectos, Coste, e interruptor. Las zonas inactivas van al 55 % de opacidad y su programación en `--dim2`.

Formulario: mini mapa de 168 px con el círculo de radio arrastrable y una pista flotante, campos de nombre, centro, radio, sectores, ticket mínimo y programación (cada uno con una pista a la derecha en mono), y una tarjeta de estimación de negocios, coste y consumo de cuota. Pie: "Guardar y escanear" (primario) y "Solo guardar".

## 7. Estados

**Cargando.** Lista izquierda con siete filas esqueleto (cuadrado + tres barras) y tarjeta centrada en el mapa: título, explicación con la duración esperada, barra animada, progreso y coste, y la nota de que puede cerrar la pestaña porque sigue en segundo plano.

**Vacío.** No es "no hay resultados": es "se encontraron 34 negocios y todos quedaron fuera del ICP, con el desglose de por qué", más tres acciones concretas (ampliar radio, añadir sectores, bajar el ticket mínimo) y el acceso a los descartados.

**Error de cuota.** Tarjeta con borde izquierdo `--crit`: qué pasó, en qué negocio se detuvo, el código exacto (`OVER_QUERY_LIMIT`) con hora, y dos salidas (reanudar cuando renueve la cuota, subir el límite de facturación). Insiste en que lo auditado está guardado. Nunca un modal que bloquee: el usuario tiene que poder seguir trabajando con lo que ya hay.

Faltan por diseñar, decídelos con criterio propio o pídelos: sesión caducada, sin conexión, prospecto ya en pipeline al intentar añadirlo, y conflicto de edición si dos personas editan la misma propuesta.

## 8. Interacciones y comportamiento

- Clic en un marcador o en una fila de la lista → selecciona el prospecto y actualiza la columna derecha; el marcador seleccionado crece y gana el anillo pulsante.
- "Abrir expediente" o clic en un hallazgo del resumen → expediente completo, con scroll hasta ese hallazgo.
- En Revisión, las acciones guardan y avanzan al siguiente automáticamente; los atajos `C`/`M`/`D` y `↑`/`↓` deben funcionar sin foco en ningún control.
- "Reverificar con IA" devuelve el hallazgo a `pending`, encola un trabajo y muestra el estado en la propia fila (no un spinner global).
- El escaneo es asíncrono: la interfaz refleja progreso por polling cada 2–3 s o por websocket. El progreso debe sobrevivir a recargar la página y a cerrar la pestaña.
- Transiciones: solo las tres animaciones descritas (anillo, línea de escaneo, cursor del crawler) más `bar` en las barras de progreso. Nada de animaciones de entrada en las listas.
- Estados hover: fondo `--hover` en filas y tarjetas clicables, `--chip` en botones secundarios, `--btn-bg-h` en el primario. El foco de teclado debe ser visible en todos los controles: contorno de 2 px en `--accent`.
- Responsive: la referencia es de escritorio y la herramienta es de escritorio. Por debajo de ~1280 px colapsa la columna derecha a un panel deslizante; por debajo de ~900 px prioriza lista y expediente y deja el mapa como pestaña.

## 9. Tokens de diseño

Todo el color pasa por variables CSS. Dos temas (`.pc-light`, `.pc-dark`) y tres acentos (`p-bronce`, `p-tinta`, `p-pino`). **Base actual: tinta sobre claro.** Tipografía: DM Sans para interfaz, JetBrains Mono para toda cifra, URL, código y marca de tiempo. Radios: 5–8 px en controles, 9–12 px en tarjetas, 4 px en el documento de propuesta. Escala tipográfica real: 9,5 · 10 · 10,5 · 11 · 11,5 · 12 · 12,5 · 13 · 13,5 · 14 · 15 · 15,5 · 17 · 19 · 21 · 23 · 27 px.

```css
/* Claro (base) */
--bg:#f3f1ed; --panel:#fffefb; --card:#faf8f4; --card2:#f8f6f2; --inset:#f1eee8; --input:#f7f5f1;
--glass:#fffefbf5; --glass2:#fffefbec; --glass3:#fffefbe0;
--line:#e6e1d9; --line-soft:#eeeae3; --line2:#dbd5cb; --line3:#cec7bb; --chip:#eeeae3; --hover:#f0ece5;
--text:#1c1d20; --text2:#41454a; --muted:#63686f; --dim:#6d737a; --dim2:#7b8188; --dim3:#c6cacf;
--crit:#a2454f; --crit2:#8d3d46; --warn:#8a6a2f; --warn2:#75591f; --warn-soft:#f4ecdd; --ok:#4d7a56;
--b1:#4a6b85; --b1-soft:#e9edf2; --b3:#8a6a45; --b3-soft:#f3ece3;
--map-bg:#f1efea; --water:#dbe4e5; --island:#e8e5df;
--road1:#e2ded6; --road2:#e9e5de; --road3:#d4cfc5; --road4:#dcd7ce; --block:#d6d1c8;
--pin-hi:#f3ead9; --pin-mid:#f4ecdb;
--btn-bg:#1c1d20; --btn-fg:#faf8f4; --btn-bg-h:#34363b;
/* acento tinta, claro */
--accent:#3a5a8c; --accent2:#2b4574; --accent-ink:#fbfcfe; --accent-soft:#e7ecf4; --accent-line:#3a5a8c55;
--accent-glow:rgba(58,90,140,.10); --accent-ring:rgba(58,90,140,.15); --accent-shadow:rgba(58,90,140,.22);

/* Oscuro */
--bg:#0e0f12; --panel:#14161a; --card:#181b1f; --card2:#15181c; --inset:#1b1e22; --input:#1a1d21;
--glass:#14161af2; --glass2:#14161ae8; --glass3:#14161ad6;
--line:#22252a; --line-soft:#1b1e22; --line2:#2b2f35; --line3:#343941; --chip:#212429; --hover:#1e2126;
--text:#e9eaec; --text2:#c6cacf; --muted:#99a0a7; --dim:#757c84; --dim2:#5a6068; --dim3:#3e434a;
--crit:#c4707a; --crit2:#cf858d; --warn:#c0a068; --warn2:#d0b585; --warn-soft:#282216; --ok:#8faa8f;
--b1:#93a9bd; --b1-soft:#1d2329; --b3:#c0a482; --b3-soft:#28221b;
--map-bg:#101317; --water:#0d1418; --island:#12161a;
--road1:#1a1e23; --road2:#161a1e; --road3:#22272d; --road4:#1c2126; --block:#151a1e;
--pin-hi:#211c12; --pin-mid:#221b12;
--btn-bg:#e9eaec; --btn-fg:#14161a; --btn-bg-h:#d1d4d8;
/* acento tinta, oscuro */
--accent:#8ea6cc; --accent2:#adbfdd; --accent-ink:#0f141c; --accent-soft:#1b2230; --accent-line:#8ea6cc55;
--accent-glow:rgba(142,166,204,.10); --accent-ring:rgba(142,166,204,.16); --accent-shadow:rgba(142,166,204,.26);
```

Otros acentos disponibles — bronce claro `#8a6636` / oscuro `#c9a870`; pino claro `#35634a` / oscuro `#93b59d`.

Dos reglas aprendidas a golpes: en modo claro la rampa del mapa se **invierte** (fondo claro, calles más oscuras, manzanas más oscuras todavía) — copiar la relación del modo oscuro deja el mapa en blanco; y `--dim`/`--dim2` llevan la mayor parte de los metadatos de evidencia, así que tienen que superar 4,5:1 contra `--panel` y `--card`, no solo parecer discretos.

Uso del color por rama: `--b1` (azul apagado) para visualización arquitectónica, `--accent` para web, `--b3` (cálido) para branding. Nunca más de esos tres más severidad. Severidad: `--crit` crítico, `--warn` alto/medio, neutro para bajo.

## 10. Arquitectura y LLM

### 10.1 Reparto del trabajo

Casi todo el pipeline es determinista y **no debe pasar por un modelo**: Places, descarga de HTML, comparación de HTML servido contra DOM renderizado, Lighthouse, detección de 404 y enlaces roto, comprobación de HTTPS, prueba real del formulario, hash de imágenes para detectar stock, lectura de directorios para el NAP, captura de pantalla. El LLM solo hace lo que exige juicio: clasificar cada deficiencia por rama, redactar titular y "lo que gana el cliente", juzgar viabilidad comercial y escribir los bloques de texto de la propuesta.

Esto no es solo ahorro: lo determinista es lo que produce evidencia citable, y la evidencia es el requisito del auditor.

### 10.2 Claude local con el plan Max, en lugar de API

Claude Code corre sin interfaz (`claude -p`) y el Agent SDK lo expone como librería en TypeScript. Con la sesión autenticada con la suscripción, el consumo va contra el plan.

Arquitectura: un **worker local** en TypeScript hace el trabajo determinista, invoca el SDK localmente para las tareas de juicio, y escribe el JSON en Postgres. La plataforma Next.js **nunca habla con el modelo**: lee de la base de datos. Los trabajos se publican en una cola (Redis, o una tabla con `SKIP LOCKED` si quieres cero infraestructura). Si el worker está apagado, la plataforma sigue mostrando lo ya escaneado y los trabajos esperan — que es exactamente lo que muestran la vista de Traza y el estado de error.

Tres advertencias:

1. **Términos de uso.** Las suscripciones de consumo son para uso interactivo de una persona. Un backend desatendido con cientos de peticiones nocturnas está en zona gris y los límites de uso lo van a frenar. Para una herramienta interna que lanzáis vosotros, razonable. Para producto multiusuario, no: ahí toca API.
2. **No escala ni es fiable desatendido.** Depende de que la máquina esté encendida y la sesión viva. Cola persistente, reintentos con retroceso exponencial, y nunca asumir disponibilidad.
3. **Deja la puerta abierta.** Interfaz `LLMProvider` con dos implementaciones, `claude-code-local` y `anthropic-api`, elegida por variable de entorno. Cuesta poco y permite migrar sin tocar el resto.

Coste que sí se paga: Places (~$0,03–0,04 por negocio con caché) y alojamiento.

### 10.3 Cuota, caché y buena vecindad

La cabecera y la vista de Zonas muestran la cuota de Places porque es un recurso escaso y visible: cachea los `details` por `placeId` con caducidad larga (30 días) y no vuelvas a pedir lo que ya tienes. Antes de escanear, estima el consumo y muéstralo — está diseñado en el formulario de nueva zona.

En el crawling: respeta `robots.txt`, un `user-agent` identificable, 1 petición por segundo por dominio, máximo ~25 páginas por sitio, y nada de tocar formularios que envíen correo a terceros salvo el propio formulario de contacto del prospecto en modo prueba. La vista de Traza expone estas señales a propósito; mantenlo.

### 10.4 Datos personales

La ficha de personas guarda email, teléfono y perfiles de directivos, algunos **inferidos**. Decidid antes de programar: qué se almacena, cuánto tiempo, quién lo ve, y cómo se marca lo inferido frente a lo verificado (el diseño ya lo distingue con el porcentaje de confianza y con "inferido:" delante del valor). Enmascarad los teléfonos en la interfaz por defecto. Registrad la fuente de cada dato personal. Aunque el mercado sea Florida, si algún prospecto es europeo aplica el RGPD.

## 11. Estado de la interfaz

Global: prospecto seleccionado, vista activa, tema, acento, filtros de zona y sector, y el escaneo en curso con su progreso.

Por vista: en Revisión, índice en la cola y borrador de edición del hallazgo matizado; en Propuestas, modo (configurar/editar), fases activas, bloques activos y su orden, idioma, tono y el borrador con autoguardado; en Pipeline, agrupación y filtros; en Traza, paso seleccionado y filtro; en Zonas, la zona en edición.

Servidor como fuente de verdad para todo lo persistente. El progreso del escaneo debe reconstruirse al recargar. Autoguardado del borrador de propuesta cada pocos segundos, con la marca "guardado hace 12 s" que ya está en el diseño.

## 12. Orden de construcción sugerido

1. Esquema de base de datos y `types.ts`. Sin el contrato, cualquier UI se rehace.
2. Escaneo determinista de una sola zona, con la cola y la vista de Traza. Traza primero: es lo que hace depurable todo lo demás.
3. Mapa + lista + expediente resumido leyendo datos reales.
4. Expediente completo con evidencia y capturas.
5. Cola de revisión con veredictos y reverificación.
6. Generador de propuesta: primero configurar y PDF, luego el modo edición.
7. Pipeline y zonas programadas.

## 13. Assets

Ninguno externo. Todos los iconos del prototipo son SVG en línea de trazo 1,6–2,2 px, sustituibles por `lucide-react` (que ya viene con shadcn): lupa, mira, cheurón, luna, flecha de vuelta, recarga, chispa, asa de arrastre. Tipografías desde Google Fonts: DM Sans (400/500/700) y JetBrains Mono (400/500). El logotipo es un cuadrado con la letra B; si existe un logotipo real de Borsoga, sustitúyelo.
