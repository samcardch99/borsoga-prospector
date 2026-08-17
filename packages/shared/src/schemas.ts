/**
 * Validadores zod del contrato. El worker valida la salida del agente contra
 * `auditorOutputSchema` antes de persistir nada.
 *
 * Los dos que importan:
 *  - `evidenceRef` no puede venir vacío. Un hallazgo sin ref se rechaza aquí,
 *    antes de tocar la base de datos, y el worker reintenta.
 *  - `verdict` no admite "confirmed". La IA propone; confirmar es de un humano.
 */

import { z } from "zod";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const branchSchema = z.enum(["renders", "web", "branding"]);
export const severitySchema = z.enum(["critical", "high", "medium", "low"]);
export const verdictSchema = z.enum(["pending", "confirmed", "nuanced", "discarded"]);

export const evidenceLayerSchema = z.enum([
  "served_html",
  "rendered_dom",
  "both_equal",
  "mismatch",
  "external_source",
]);

export const pipelineStageSchema = z.enum([
  "detected",
  "reviewed",
  "proposal_sent",
  "meeting",
  "won",
  "lost",
]);

export const countySchema = z.enum(["miami_dade", "broward", "palm_beach"]);

export const sectorSchema = z.enum([
  "construction",
  "remodeling",
  "real_estate_development",
  "modular_homes",
  "closets",
  "kitchens",
  "millwork",
  "cabinetry",
  "interior_design",
]);

export const disqualifyReasonSchema = z.enum([
  "national_franchise",
  "has_in_house_agency",
  "too_large",
  "no_own_product",
  "no_website_no_product",
  "ticket_too_low",
  "out_of_area",
  "already_client",
  "manual",
]);

export const icpFitSchema = z.enum(["high", "medium", "low"]);

// ─── Evidencia ───────────────────────────────────────────────────────────────

export const evidenceSchema = z.object({
  id: z.string().min(1),
  traceStepId: z.string().nullable(),
  url: z.string().url(),
  quote: z.string().min(1, "la cita textual es obligatoria"),
  layer: evidenceLayerSchema,
  method: z.string().min(1),
  capturedAt: z.string().datetime(),
  screenshot: z
    .object({
      storageKey: z.string().min(1),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      takenAt: z.string().datetime(),
    })
    .optional(),
  additionalSources: z
    .array(
      z.object({
        url: z.string().url(),
        quote: z.string().min(1),
        capturedAt: z.string().datetime(),
      }),
    )
    .optional(),
});

// ─── Salida del agente auditor ───────────────────────────────────────────────

export const auditorFindingSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().min(1),
  branch: branchSchema,
  clientGain: z.string().min(1),
  severity: severitySchema,
  /** La IA nunca confirma. Solo un humano mueve un hallazgo a "confirmed". */
  verdict: z.enum(["pending", "nuanced", "discarded"]),
  /** Sin ref no hay hallazgo: se rechaza antes de persistir. */
  evidenceRef: z.string().min(1, "todo hallazgo cita una observación real"),
  additionalEvidenceRefs: z.array(z.string().min(1)).optional(),
});

export const auditorOutputSchema = z.object({
  company: z.object({
    name: z.string().min(1),
    sectors: z.array(sectorSchema),
    city: z.string().min(1),
    county: countySchema,
    website: z.string().url().nullable(),
    ratings: z.array(
      z.object({
        source: z.string().min(1),
        score: z.number().min(0).max(5),
        reviewCount: z.number().int().nonnegative(),
      }),
    ),
  }),
  opportunityScore: z.number().min(0).max(100),
  icpFit: icpFitSchema,
  disqualified: z.boolean(),
  disqualifyReason: disqualifyReasonSchema.nullable(),
  commercialViability: z.string().min(1),
  findings: z.array(auditorFindingSchema),
});

export type AuditorOutputParsed = z.infer<typeof auditorOutputSchema>;

/**
 * JSON Schema que se le pasa al agente como forma de su salida final.
 *
 * Sin `$schema`: el validador del Agent SDK rechaza el esquema si lleva una
 * referencia al meta-esquema de draft 2020-12 que no puede resolver, y a un
 * modelo esa línea no le dice nada. El resto sale tal cual de zod.
 */
export const auditorOutputJsonSchema = (() => {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(auditorOutputSchema, {
    target: "draft-2020-12",
  });
  return schema as Record<string, unknown>;
})();

// ─── Descubrimiento de una zona ──────────────────────────────────────────────

/**
 * Un negocio encontrado por el prospector, antes de auditarlo.
 *
 * Es deliberadamente pobre. Aquí no se decide si el negocio vale: eso es el
 * trabajo del auditor, que abrirá su web y mirará. Lo único que se pide es que
 * exista, que esté dentro del área y que se pueda volver a él, de ahí que
 * `sourceId` sea lo único imprescindible. Un negocio sin web sigue siendo un
 * negocio, y muchas veces es justo el que más falta le hace un estudio.
 */
export const discoveredBusinessSchema = z.object({
  /** Identificador estable de la fuente. De Maps, el `0x…:0x…` del enlace. */
  sourceId: z.string().min(1),
  name: z.string().min(1),
  address: z.string().min(1),
  city: z.string().min(1),
  county: countySchema,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /*
   * Cadena vacía y cero en vez de `null`, y no por gusto.
   *
   * Con `.nullable()` estos cuatro campos volvían **siempre** null: la web, el
   * teléfono y la valoración de cinco negocios seguidos, mientras que el
   * nombre, la dirección y las coordenadas —que no son nulables— llegaban
   * perfectos. La herramienta las devolvía ("web: https://britobuilt.com/" en
   * su observación, literal) y se perdían al construir la salida estructurada:
   * un `anyOf: [tipo, null]` se colapsa al null.
   *
   * Cuesta un vacío que hay que traducir en el handler, y a cambio los datos
   * llegan. Un negocio sin web es "" y se convierte en `null` al guardarlo.
   */
  /** URL, o cadena vacía si no tiene. Nunca null: ver arriba. */
  website: z.string(),
  /** Teléfono, o cadena vacía si no tiene. */
  phone: z.string(),
  /** Qué sectores parece tocar. Pista para el auditor, no veredicto. */
  sectors: z.array(sectorSchema),
  /** Nota media, o 0 si el negocio no tiene valoraciones. */
  rating: z.number().min(0).max(5),
  /** Número de reseñas, 0 si no tiene. */
  reviewCount: z.number().int().nonnegative(),
});

/**
 * La salida de un `scan.zone`.
 *
 * `queries` no es decorativo: es lo que permite entender por qué una zona
 * devolvió lo que devolvió, y repetir o corregir la búsqueda. Sin eso, un
 * escaneo pobre es indistinguible de una zona pobre.
 */
export const prospectorOutputSchema = z.object({
  businesses: z.array(discoveredBusinessSchema),
  /** Los términos que se llegaron a buscar, en el orden en que se buscaron. */
  queries: z.array(z.string().min(1)),
  /** Qué se descartó y por qué: cadenas grandes, fuera de área, duplicados. */
  notes: z.string().min(1),
});

export type ProspectorOutputParsed = z.infer<typeof prospectorOutputSchema>;
export type DiscoveredBusiness = z.infer<typeof discoveredBusinessSchema>;

export const prospectorOutputJsonSchema = (() => {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(prospectorOutputSchema, {
    target: "draft-2020-12",
  });
  return schema as Record<string, unknown>;
})();

// ─── Reverificación de un hallazgo ───────────────────────────────────────────

/**
 * La salida de un `finding.recheck`: mirar otra vez **un** hallazgo concreto.
 *
 * Fíjate en lo que NO lleva: veredicto. La regla del handoff §5 es que solo un
 * humano mueve un hallazgo a confirmado, matizado o descartado, y una
 * reverificación no es una excepción — devuelve el hallazgo a `pending` con
 * prueba fresca para que alguien vuelva a decidir.
 *
 * `stillHolds` es la lectura del agente, no un veredicto: si dice que ya no se
 * sostiene, el hallazgo se marca para no entrar en propuestas y espera igual a
 * que un humano lo descarte.
 */
export const recheckOutputSchema = z.object({
  stillHolds: z.boolean(),
  /** Qué ha cambiado desde la última verificación, o por qué sigue igual. */
  reasoning: z.string().min(1),
  title: z.string().min(1).max(160),
  description: z.string().min(1),
  clientGain: z.string().min(1),
  severity: severitySchema,
  /** Sin ref no hay hallazgo, tampoco al reverificar. */
  evidenceRef: z.string().min(1, "la reverificación cita una observación real"),
  additionalEvidenceRefs: z.array(z.string().min(1)).optional(),
});

export type RecheckOutputParsed = z.infer<typeof recheckOutputSchema>;

/** Mismo tratamiento que el del auditor: sin `$schema`. */
export const recheckOutputJsonSchema = (() => {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(recheckOutputSchema, {
    target: "draft-2020-12",
  });
  return schema as Record<string, unknown>;
})();

// ─── Redacción de bloques de propuesta ───────────────────────────────────────

/**
 * La salida de un `proposal.draft`: el texto de los bloques marcados como
 * "texto IA", y nada más.
 *
 * Lo que este esquema NO permite es tan importante como lo que permite. No hay
 * sitio para hallazgos, ni para precios, ni para fases: esos salen de la base y
 * el modelo no los toca. Si algún día alguien quiere que la IA "mejore" un
 * hallazgo, tendrá que cambiar este esquema a propósito, y ese es exactamente
 * el freno que se busca.
 */
export const proposalDraftOutputSchema = z.object({
  blocks: z
    .array(
      z.object({
        id: z.string().min(1),
        content: z.string().min(1),
      }),
    )
    .min(1),
});

export type ProposalDraftOutputParsed = z.infer<typeof proposalDraftOutputSchema>;

export const proposalDraftOutputJsonSchema = (() => {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(proposalDraftOutputSchema, {
    target: "draft-2020-12",
  });
  return schema as Record<string, unknown>;
})();

// ─── Acciones de revisión ────────────────────────────────────────────────────

export const reviewActionSchema = z
  .object({
    findingId: z.string().min(1),
    action: z.enum(["confirm", "nuance", "discard", "recheck"]),
    note: z.string().optional(),
    patch: z
      .object({
        title: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
        clientGain: z.string().min(1).optional(),
        severity: severitySchema.optional(),
        branch: branchSchema.optional(),
      })
      .optional(),
  })
  .refine((v) => v.action !== "nuance" || (v.note && v.note.trim().length > 0), {
    message: "matizar exige una nota del revisor",
    path: ["note"],
  });

// ─── Consultas ───────────────────────────────────────────────────────────────

export const prospectListQuerySchema = z.object({
  zoneId: z.string().optional(),
  minScore: z.number().min(0).max(100).optional(),
  branches: z.array(branchSchema).optional(),
  sectors: z.array(sectorSchema).optional(),
  stages: z.array(pipelineStageSchema).optional(),
  includeDisqualified: z.boolean().default(false),
  needsReview: z.boolean().optional(),
  sort: z.enum(["score", "ticket", "recent"]).default("score"),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const zoneInputSchema = z.object({
  name: z.string().min(1),
  county: countySchema,
  center: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  radiusMeters: z.number().int().min(100).max(50_000),
  sectors: z.array(sectorSchema).min(1),
  minTicketUsd: z.number().int().nonnegative(),
  /** Expresión cron. null = solo manual. */
  schedule: z.string().nullable(),
  active: z.boolean().default(true),
});
