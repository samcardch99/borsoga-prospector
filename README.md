# Borsoga Prospector

Plataforma interna de prospección B2B para el sur de Florida. Busca negocios con
Google Places, audita su presencia digital, detecta deficiencias que Borsoga
puede resolver y las convierte en una propuesta de colaboración.

El handoff de diseño original está en `docs/handoff.md`, y la referencia visual
en `docs/design/prospector-control-center-v3.dc.html` (se abre en el navegador).

## Estructura

```
packages/shared   Contrato de datos, validadores zod, scoring, ICP, capa agéntica
packages/db       Esquema Postgres (Drizzle), cliente y cola de trabajos
apps/worker       El agente: herramientas, proveedores de LLM, cola y Traza
apps/web          Next.js 16 + Tailwind 4 + shadcn/ui
```

## Puesta en marcha

```bash
brew install postgresql@17 && brew services start postgresql@17
createdb -U postgres borsoga_prospector

pnpm install
pnpm --filter @borsoga/worker exec playwright install chromium
cp .env.example .env          # rellena DATABASE_URL y GOOGLE_PLACES_API_KEY
pnpm db:migrate

pnpm dev                      # web: http://localhost:3000
pnpm dev:worker               # worker: tira de la cola
```

La raíz de `/` es la vista de Mapa: lista, mapa y expediente resumido leyendo
Postgres. La página de verificación de tokens se mudó a `/tokens`, y sigue
sirviendo para comprobar que los seis temas y los componentes de shadcn heredan
bien el diseño.

La selección y los filtros de la lista viven en la URL (`?p=` y `?f=`), no en
estado de cliente: así recargar no pierde el sitio, el enlace se puede pasar a
otra persona, y el expediente se renderiza en el servidor con el prospecto ya
resuelto.

### El mapa no necesita ninguna clave

MapLibre GL con tiles vectoriales de OpenFreeMap: sin clave, sin registro, sin
facturación. Funciona nada más clonar.

El motivo de elegirlo **no** fue el coste. `theme.css` ya traía una paleta de
mapa completa —`--map-bg`, `--water`, `--island`, `--road1` a `--road4`,
`--block`— porque el handoff §9 trata el mapa como parte del diseño. MapLibre
consume un style JSON, así que esos tokens se leen y se aplican directamente
(`src/lib/map-style.ts`) y el mapa cambia con el tema como cualquier otra
superficie. Con Google habría que recrear la paleta a mano en la consola de
Cloud, en un Map ID por tema y fuera del repositorio.

La regla de que "en modo claro la rampa del mapa se invierte" no se implementa
en ningún sitio: ya está en los tokens. En claro `--block` es más oscuro que
`--island`; en oscuro, más claro que `--map-bg`. Al leerlos tal cual, el mapa se
invierte solo.

#### La rampa del mapa se ha reajustado

Los valores del prototipo vivían todos dentro de unos 30 niveles de gris, y
sobre pantalla el mapa salía plano: el agua no se distinguía del suelo y las
calles no se leían. Se ha ensanchado la rampa en los dos temas, conservando el
orden que pide el handoff §9 y el carácter neutro cálido:

- El **agua** gana tono azul (`#b9cfda` claro, `#16323f` oscuro) en vez de
  depender solo del brillo. Es la separación que más se nota.
- El **oscuro deja de ser casi negro**: `--map-bg` sube de `#101317` a
  `#1c2126`, y la rampa se abre hacia arriba, que es como se invierte en
  oscuro (calles más claras que el suelo).
- Las **manzanas** se pintan al 55 % de opacidad, no al 85 %: `--block` es
  ahora bastante más oscuro y a plena opacidad el centro de una ciudad se
  convierte en una mancha sólida que se come las calles.

Las **etiquetas del mapa no usan `--dim` ni `--dim2`**, por el problema de
contraste que ya documenta el aviso de más abajo: sobre el mapa es peor todavía,
porque compiten con calles y manzanas en vez de con un panel liso. Usan
`--text2` para poblaciones y `--muted` para calles y sitios.

Es una desviación consciente de "los colores son finales". Si se quiere revertir,
está todo en el bloque de mapa de `theme.css` y el estilo lo recoge solo.

Si los tiles no cargan —sin red, o el servicio caído— se cae al lienzo de
referencia con los prospectos proyectados sobre el área, y lo dice en pantalla.
OpenFreeMap es un servicio gratuito de mejor esfuerzo; si algún día importa la
disponibilidad, se autoaloja un extracto del sur de Florida con Protomaps sin
tocar el código de la vista, porque hablan el mismo formato de estilo.

### Meter trabajo en la cola sin interfaz

La vista de Zonas todavía no existe, así que el worker trae una utilidad para
lanzar trabajo a mano. Se borra el día que exista la pantalla.

```bash
# Escanear una zona (necesita GOOGLE_PLACES_API_KEY)
pnpm --filter @borsoga/worker enqueue zone "Doral" miami_dade 25.809 -80.355 8000 kitchens,cabinetry

# Auditar un solo negocio, sin gastar cuota de Places
pnpm --filter @borsoga/worker enqueue prospect "Nombre" https://ejemplo.com Miami
```

---

## El build de producción usa webpack, no Turbopack

`pnpm build` pasa `--webpack`. `next dev` sigue en Turbopack, que va bien.

El motivo es un fallo concreto y comprobado: Turbopack resuelve `next/font/google`
en su binario nativo y pide a `fonts.gstatic.com` URLs de JetBrains Mono que hoy
devuelven **404**. Las mismas fuentes pedidas al CSS de Google en vivo devuelven
200, así que no es que las fuentes hayan desaparecido — es que Turbopack tiene
una instantánea desfasada. El build entero se cae con doce errores de
`Module not found` que apuntan a un `.module.css` interno y no dicen nada de
fuentes.

```
# la URL que pide Turbopack
…/jetbrainsmono/v24/…BNntkaToggR7BYaTNPx7cwgknk-6nFg.woff2   → 404
# la que sirve Google ahora mismo
…/jetbrainsmono/v24/…BNntkaToggR7BYRbKPx3cwgknk-6nFg.woff2   → 200
```

Con webpack, que pide el CSS en vivo, el build pasa limpio.

**Cuándo quitarlo:** cuando una versión de Next traiga la instantánea al día.
Se comprueba en un minuto — quita `--webpack` y lanza `pnpm build`. Si pasa, el
fallo está arreglado y la bandera sobra.

## Decisiones que se apartan del handoff

### 1. Arquitectura agéntica en vez de pipeline determinista

El handoff (§10.1) proponía que casi todo el pipeline fuera determinista y que el
LLM solo interviniera en los puntos de juicio. **Se ha decidido lo contrario:**
la IA conduce el proceso entero y decide por sí misma qué mirar, en qué orden,
cuándo profundizar y cuándo parar.

Lo que **no** cambia es la regla del auditor: *sin evidencia no hay hallazgo*. Se
conserva moviendo el punto donde se hace cumplir:

- Las herramientas (`packages/shared/src/agent.ts`) devuelven `Observation`s con
  la URL, la cita textual y la fecha de lo que realmente ocurrió.
- El agente no redacta objetos `Evidence`. Cita el `evidenceRef` que le devolvió
  una herramienta.
- `resolveEvidence()` rechaza cualquier ref que no case con una observación de
  ese mismo run, y `findings.evidence_id` es `NOT NULL` en el esquema.

Resultado: la IA puede investigar lo que quiera, pero no puede afirmar haber
visto algo que ninguna herramienta vio. La traza de llamadas a herramienta *es*
justo lo que necesita la vista de Traza, así que encaja mejor que el diseño
original.

Consecuencia práctica: un bucle agéntico puede no terminar. Por eso
`runAgent()` exige `maxTurns` y `maxCostUsd`, y la cola tiene reintentos con
retroceso exponencial y recogida de trabajos huérfanos (`reapStaleJobs`).

#### El tope de coste no significa lo mismo en los dos proveedores

Con `anthropic-api`, `LLM_MAX_COST_USD_PER_PROSPECT` es dinero: el bucle suma
tokens a precio de tarifa y corta.

Con `claude-code-local` es una cifra **nocional**. El consumo va contra la
suscripción, pero el SDK devuelve `total_cost_usd` valorado a precio de tarifa
y ahí entra la escritura de caché del prefijo del harness — una vez por hora,
no por prospecto. Medido: ~120.000 tokens de prefijo si el agente hereda las
skills y los plugins de quien lanza el worker, que a solas ya se comen 1,20 USD
nocionales. El proveedor los apaga (`skills: []`, `plugins: []`, junto a
`tools: []` y `settingSources: []`), y no solo por el coste: el auditor tiene
que comportarse igual en cualquier máquina, no según lo que tenga instalado el
que lo arranca.

Aun así el número que verás en la Traza es de tarifa, no de factura. El tope
por defecto es 2,50 USD; por debajo de ~1,50 la primera auditoría de cada hora
se queda sin presupuesto a mitad y no entrega informe.

### 2. Tres colisiones de nombre entre el prototipo y shadcn

Documentadas en `apps/web/src/app/globals.css`. El mismo identificador significa
cosas distintas en cada sistema, y enchufarlos 1:1 no da error — se ve mal:

| Token | En el prototipo | En shadcn | Resuelto como |
| --- | --- | --- | --- |
| `--accent` | color de marca | fondo de hover | `--color-accent` → `--hover`; la marca en `--color-brand` |
| `--input` | fondo del control | color del borde | `--color-input` → `--line2`; el fondo en `--color-field` |
| `--muted` | color de **texto** | fondo apagado | `--color-muted` → `--inset`; el texto en `--color-muted-foreground` |

Los nombres del prototipo se conservan intactos en `theme.css`, para poder traer
cualquier valor del `.dc.html` sin traducirlo. El puente vive solo en
`@theme inline`.

### 3. La escala tipográfica sustituye a la de Tailwind

`text-sm` son 11px y `text-base` 12px, no 14 y 16. Es la escala real del
prototipo (herramienta densa de escritorio). Afecta también a los componentes de
shadcn, que es lo que se quiere.

---

## Aviso: los importes de ticket son un marcador de posición

El handoff no trae lista de precios y el contrato pide `branchTickets` y
`ticketEstimate`, así que `apps/worker/src/pricing.ts` lleva unos importes base
inventados (renders 8.000, web 14.000, branding 10.000 USD) que escalan con el
score de la rama. **Sustituidlos por la tarifa real antes de enseñar una cifra a
nadie de fuera.** Están todos en ese archivo justamente para que cambiarlos sea
editar tres números; el cálculo sí es deliberado y puede quedarse.

## Aviso: el contraste de `--dim2` no cumple lo que pide el propio handoff

El handoff §9 dice que `--dim` y `--dim2` llevan la mayor parte de los metadatos
de evidencia y **tienen que superar 4,5:1** contra `--panel` y `--card`. Medida
la paleta del prototipo, no se cumple:

| Token | Tema | vs `--panel` | vs `--card` | |
| --- | --- | --- | --- | --- |
| `--dim` | claro | 4,75 | 4,52 | cumple |
| `--dim2` | claro | 3,90 | 3,71 | **no cumple** |
| `--dim` | oscuro | 4,29 | 4,09 | **no cumple** |
| `--dim2` | oscuro | 2,85 | 2,72 | **no cumple** |

Los tokens se han portado **tal cual** están en el prototipo, porque el handoff
dice que los colores son finales. La corrección es decisión de diseño, no de
implementación. Si se quiere aplicar, los valores mínimos que alcanzan 4,5:1
conservando el tono son:

```css
/* claro  */ --dim2: #6e7379;   /* era #7b8188 */
/* oscuro */ --dim:  #7c838b;   /* era #757c84 */
/* oscuro */ --dim2: #7e8389;   /* era #5a6068 */
```

En oscuro `--dim` y `--dim2` quedarían casi idénticos, así que probablemente
haga falta replantear los dos niveles en vez de solo subirlos.

`--dim3` es decorativo (separadores, `/` del logotipo) y no lleva texto, así que
queda fuera del requisito.

---

## Orden de construcción

Del handoff §12, adaptado al enfoque agéntico:

1. ~~Esquema de base de datos y contrato de datos~~ ✅
2. ~~Tokens de diseño y tema~~ ✅
3. ~~Worker: herramientas del agente + `LLMProvider` + Traza~~ ✅
4. ~~Mapa + lista + expediente resumido con datos reales~~ ✅
5. ~~Expediente completo con evidencia y capturas~~ ✅
6. ~~Cola de revisión con veredictos y reverificación~~ ✅
7. ~~Generador de propuesta: configurar y PDF, luego modo edición~~ ✅
8. ~~Pipeline y zonas~~ ✅ · la programación cron no se dispara sola todavía

La Traza va antes que las pantallas: es lo que hace depurable todo lo demás, y
con un agente que decide por su cuenta hace todavía más falta.

### Qué falta del paso 3

De las diez herramientas que declara el contrato hay cuatro implementadas
(`places_details`, `fetch_served_html`, `render_dom`, `screenshot`). Las otras
seis —`crawl_site`, `lighthouse`, `search_web`, `fetch_external_profile`,
`image_fingerprint` y `probe_contact_form`— están declaradas pero no
registradas, así que el agente no las ve y no puede prometer evidencia que
nadie recogió. Ampliar la superficie es añadirlas en
`apps/worker/src/tools/`, no meter pasos antes del agente.

Los cuatro tipos de trabajo de la cola están implementados: `scan.zone`,
`audit.prospect`, `finding.recheck` y `proposal.draft`. Los dos últimos no se
han visto correr — hace falta el worker en marcha con un proveedor de LLM.

**La pantalla de Traza ya existe** (`/traza`), y lo primero que ha destapado es
que los contadores de `scans` y las filas de `trace_steps` no cuadran: en el
escaneo de pruebas la tabla dice 11 pasos y 6 errores, y hay 4 filas, todas
`ok`. Hubo trabajo que ocurrió sin registrarse como paso.

No está probado de dónde sale la diferencia — `scan.zone` y `audit.prospect`
llaman los dos a `recordStep`, así que puede ser un paso que no se escribe o un
contador que suma algo que no es un paso. La pantalla avisa de la discrepancia
sin atribuirle causa, que es lo único comprobable hoy. Merece un rato con el
worker en marcha.

### Qué falta del paso 4

Las **dos ventanas flotantes en vivo** del handoff §6.1 —"Auditoría web en
vivo" y "Personas y menciones", ancladas al marcador con la línea de hormigas—
no están. No es una decisión estética: las tablas `people` y `mentions` no
tienen todavía quien las escriba. Ninguna de las cuatro herramientas del worker
recoge directivos ni menciones, y las que lo harían (`search_web` y
`fetch_external_profile`) son dos de las seis que faltan del paso 3. Construir
el panel ahora sería pintar un marco vacío.

El **control de zoom** solo aparece con el mapa real, que trae el suyo. En el
lienzo de reserva no hay nada que ampliar, así que ese hueco lo ocupa el aviso
de que los tiles no cargaron.

Los botones "Generar propuesta", "Escanear zona" y "Dibujar área" están
visibles y apagados, con la pista de en qué paso llegan. Se dejan en su sitio
en vez de esconderlos porque son parte del layout que hay que recrear, y un
hueco cambiaría las medidas de las columnas.

### Qué falta del paso 5

Las **capturas de evidencia no se han visto funcionando**. La ruta que las
sirve existe (`/api/captura/…`, con el mismo anclaje al repositorio que usa el
worker) y el expediente ya reserva su hueco, pero las evidencias que hay en la
base salieron de `render_dom` y no llevan imagen: `screenshot_storage_key` está
vacío en todas. La tarjeta lo dice en el hueco en vez de callárselo.

`STORAGE_LOCAL_PATH` pasa a resolverse desde la **raíz del repositorio** y no
desde el cwd. Antes el worker (que corre en `apps/worker`) y la web (en
`apps/web`) apuntaban a carpetas distintas, así que la web nunca habría
encontrado una captura.

"Descartar" el prospecto entero sigue apagado: llega con el pipeline, en el
paso 8.

### Qué falta del paso 6

`finding.recheck` ya está implementado en el worker y encolado desde la web,
pero **el handler no se ha visto correr**: hace falta el worker en marcha y un
proveedor de LLM disponible, y la verificación de esta rama se hizo con el
worker apagado. Lo que sí está probado es la mitad de la web — encolar deja el
trabajo en la cola y devuelve el hallazgo a `pending`, que es justo lo que debe
pasar con el worker parado.

No hay usuarios ni sesiones, así que `findings.reviewed_by` se queda a null.
Cuando los haya, se rellena en `apps/web/src/app/revision/actions.ts`.

### Qué falta del paso 7

El **modo de edición ya está**: bloques arrastrables, activables y borrables,
selector de tono y reescritura con IA. El documento se arma desde los bloques,
así que reordenar o desactivar se ve al instante — no hay dos maquetaciones que
mantener a la par.

La **reescritura con IA no se ha visto correr**, como el resto de lo que pasa
por el worker. Lo que sí está probado es que solo se le pasan los bloques
`ai_text`: el filtro se aplica dos veces, en la web al encolar y otra vez en el
handler, porque el payload viene del navegador y no es la autoridad sobre qué se
puede reescribir. Los hallazgos y los precios no llegan al modelo ni por
accidente — el esquema de salida no tiene dónde ponerlos.

El **PDF sale de imprimir**, no de un servicio de render: el navegador ya sabe
hacer un PDF de una página y el documento está maquetado para que al imprimir
solo quede él. No se ha llegado a generar un PDF real en este entorno; lo
verificado es que la hoja `@media print` está en el bundle, que el panel lleva
`print:hidden` y que el botón llama a `window.print()`.

Entrar en `/propuestas/[id]` **crea el borrador** si no existe. Es deliberado:
todo lo que lleva la propuesta sale del expediente, así que pedir un clic para
generar algo ya determinado solo añadiría un paso. Un borrador ya tocado no se
pisa.

Los importes y los entregables de `PHASE_TEMPLATE` son un marcador de posición,
igual que los de `BASE_TICKET_USD`. Están juntos en
`packages/shared/src/pricing.ts` para que revisarlos sea abrir un archivo.

### Qué falta del paso 8

La **programación cron no se dispara sola**. Las zonas guardan su expresión y la
tabla la muestra, pero falta un planificador que encole `scan.zone` a su hora;
hoy es un proceso que no existe. Escanear a mano desde la tabla sí funciona y
encola igual que el CLI del worker.

Las **tarjetas del kanban no se han visto con datos**: el único prospecto de la
base está descartado y los descartados no entran al pipeline. Lo verificado son
las seis columnas, sus contadores y la barra de métricas. Las columnas se pintan
aunque estén vacías a propósito — un tablero vacío sigue diciendo cuáles son las
etapas, y sustituirlo por una frase lo esconde.

El **mini mapa arrastrable** del formulario de zona (handoff §6.7) no está: los
campos de centro y radio se escriben a mano. Los **filtros de responsable y
periodo** del pipeline tampoco, porque no hay usuarios a quien asignar nada.

El movimiento entre etapas va por un selector en cada tarjeta y no arrastrando.
El handoff describe el arrastre para los bloques de la propuesta, no para el
kanban, y un `select` funciona igual con teclado, con ratón y en pantalla
estrecha.
