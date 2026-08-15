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
5. Expediente completo con evidencia y capturas
6. Cola de revisión con veredictos y reverificación
7. Generador de propuesta: configurar y PDF, luego modo edición
8. Pipeline y zonas programadas

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

La Traza escribe en la base y se puede leer con `psql`; la **pantalla** de
Traza (handoff §6.6) es parte del trabajo de interfaz que viene después.

Sin implementar todavía: `finding.recheck` y `proposal.draft`, los dos tipos de
trabajo que la cola ya contempla y el worker rechaza con "tipo de trabajo no
soportado".

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

Los botones "Abrir expediente", "Generar propuesta", "Escanear zona" y "Dibujar
área" están visibles y apagados, con la pista de en qué paso llegan. Se dejan
en su sitio en vez de esconderlos porque son parte del layout que hay que
recrear, y un hueco cambiaría las medidas de las columnas.
