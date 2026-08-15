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
