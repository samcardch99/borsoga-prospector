CREATE TYPE "public"."branch" AS ENUM('renders', 'web', 'branding');--> statement-breakpoint
CREATE TYPE "public"."county" AS ENUM('miami_dade', 'broward', 'palm_beach');--> statement-breakpoint
CREATE TYPE "public"."disqualify_reason" AS ENUM('national_franchise', 'has_in_house_agency', 'too_large', 'no_own_product', 'no_website_no_product', 'ticket_too_low', 'out_of_area', 'already_client', 'manual');--> statement-breakpoint
CREATE TYPE "public"."evidence_layer" AS ENUM('served_html', 'rendered_dom', 'both_equal', 'mismatch', 'external_source');--> statement-breakpoint
CREATE TYPE "public"."icp_fit" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."pipeline_stage" AS ENUM('detected', 'reviewed', 'proposal_sent', 'meeting', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."proposal_block_type" AS ENUM('fixed', 'text', 'ai_text', 'findings', 'pricing');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('draft', 'sent', 'opened', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('queued', 'running', 'completed', 'failed', 'quota_exceeded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."sector" AS ENUM('construction', 'remodeling', 'real_estate_development', 'modular_homes', 'closets', 'kitchens', 'millwork', 'cabinetry', 'interior_design');--> statement-breakpoint
CREATE TYPE "public"."sentiment" AS ENUM('positive', 'neutral', 'negative');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."trace_status" AS ENUM('ok', 'retry', 'error', 'timeout', 'http_404', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('pending', 'confirmed', 'nuanced', 'discarded');--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"trace_step_id" uuid,
	"url" text NOT NULL,
	"quote" text NOT NULL,
	"layer" "evidence_layer" NOT NULL,
	"method" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"screenshot_storage_key" text,
	"screenshot_width" integer,
	"screenshot_height" integer,
	"screenshot_taken_at" timestamp with time zone,
	"additional_sources" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"branch" "branch" NOT NULL,
	"severity" "severity" NOT NULL,
	"verdict" "verdict" DEFAULT 'pending' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"client_gain" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"excluded_from_proposal" boolean DEFAULT false NOT NULL,
	"proposal_order" smallint,
	"recheck_count" smallint DEFAULT 0 NOT NULL,
	"trace_step_id" uuid
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"priority" smallint DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"max_attempts" smallint DEFAULT 5 NOT NULL,
	"last_error" text,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"scan_id" uuid,
	"prospect_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"url" text NOT NULL,
	"published_at" timestamp with time zone,
	"sentiment" "sentiment" DEFAULT 'neutral' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"confidence" smallint DEFAULT 0 NOT NULL,
	"profiles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"phones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"buying_signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provenance" text[] DEFAULT '{}' NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purge_after" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "places_cache" (
	"place_id" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"type" "proposal_block_type" NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"order" smallint DEFAULT 0 NOT NULL,
	"content" text,
	"finding_ids" uuid[] DEFAULT '{}' NOT NULL,
	"include_screenshots" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"branch" "branch" NOT NULL,
	"name" text NOT NULL,
	"deliverables" text[] DEFAULT '{}' NOT NULL,
	"price_usd" integer DEFAULT 0 NOT NULL,
	"weeks" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"order" smallint DEFAULT 0 NOT NULL,
	"finding_ids" uuid[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"status" "proposal_status" DEFAULT 'draft' NOT NULL,
	"language" text DEFAULT 'es' NOT NULL,
	"tone" text DEFAULT 'direct' NOT NULL,
	"template" text DEFAULT 'default' NOT NULL,
	"recipient_person_id" uuid,
	"recipient_name" text DEFAULT '' NOT NULL,
	"recipient_email" text DEFAULT '' NOT NULL,
	"subtotal_usd" integer DEFAULT 0 NOT NULL,
	"discount_usd" integer DEFAULT 0 NOT NULL,
	"total_usd" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"pdf_storage_key" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"place_id" text NOT NULL,
	"name" text NOT NULL,
	"sectors" "sector"[] DEFAULT '{}' NOT NULL,
	"county" "county" NOT NULL,
	"city" text NOT NULL,
	"address" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"website" text,
	"phone" text,
	"employees_estimate" integer,
	"ratings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score" smallint DEFAULT 0 NOT NULL,
	"branch_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"branch_tickets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ticket_estimate" integer DEFAULT 0 NOT NULL,
	"score_factors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"icp_fit" "icp_fit" DEFAULT 'low' NOT NULL,
	"disqualified" boolean DEFAULT false NOT NULL,
	"disqualify_reason" "disqualify_reason",
	"disqualify_note" text,
	"commercial_viability" text DEFAULT '' NOT NULL,
	"growth_signals" text[] DEFAULT '{}' NOT NULL,
	"stage" "pipeline_stage" DEFAULT 'detected' NOT NULL,
	"owner_id" uuid,
	"last_activity_at" timestamp with time zone,
	"zone_id" uuid NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_scanned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quota_usage" (
	"period" text NOT NULL,
	"resource" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quota_usage_period_resource_pk" PRIMARY KEY("period","resource")
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"status" "scan_status" DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"progress_found" integer DEFAULT 0 NOT NULL,
	"progress_icp_filtered" integer DEFAULT 0 NOT NULL,
	"progress_disqualified" integer DEFAULT 0 NOT NULL,
	"progress_audited" integer DEFAULT 0 NOT NULL,
	"progress_total" integer DEFAULT 0 NOT NULL,
	"total_steps" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"total_cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"total_errors" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"resume_cursor" text
);
--> statement-breakpoint
CREATE TABLE "trace_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"prospect_id" uuid,
	"step" text NOT NULL,
	"target" text NOT NULL,
	"status" "trace_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"model" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"retries" smallint DEFAULT 0 NOT NULL,
	"robots_respected" boolean,
	"requests_per_second" double precision,
	"cache_hits" integer
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"county" "county" NOT NULL,
	"center_lat" double precision NOT NULL,
	"center_lng" double precision NOT NULL,
	"radius_meters" integer NOT NULL,
	"sectors" "sector"[] DEFAULT '{}' NOT NULL,
	"min_ticket_usd" integer DEFAULT 0 NOT NULL,
	"schedule" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_scan_at" timestamp with time zone,
	"last_scan_prospects" integer,
	"last_scan_cost_usd" numeric(10, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_blocks" ADD CONSTRAINT "proposal_blocks_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_phases" ADD CONSTRAINT "proposal_phases_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_recipient_person_id_people_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_steps" ADD CONSTRAINT "trace_steps_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_steps" ADD CONSTRAINT "trace_steps_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_prospect_idx" ON "evidence" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "evidence_trace_step_idx" ON "evidence" USING btree ("trace_step_id");--> statement-breakpoint
CREATE INDEX "findings_prospect_idx" ON "findings" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "findings_branch_idx" ON "findings" USING btree ("prospect_id","branch");--> statement-breakpoint
CREATE INDEX "findings_pending_idx" ON "findings" USING btree ("detected_at") WHERE "findings"."verdict" = 'pending';--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("priority" DESC NULLS LAST,"run_after") WHERE "jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "jobs_scan_idx" ON "jobs" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "mentions_prospect_idx" ON "mentions" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "people_prospect_idx" ON "people" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "people_purge_idx" ON "people" USING btree ("purge_after");--> statement-breakpoint
CREATE INDEX "places_cache_expires_idx" ON "places_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "proposal_blocks_proposal_idx" ON "proposal_blocks" USING btree ("proposal_id","order");--> statement-breakpoint
CREATE INDEX "proposal_phases_proposal_idx" ON "proposal_phases" USING btree ("proposal_id","order");--> statement-breakpoint
CREATE INDEX "proposals_prospect_idx" ON "proposals" USING btree ("prospect_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_place_id_key" ON "prospects" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX "prospects_zone_idx" ON "prospects" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "prospects_stage_idx" ON "prospects" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "prospects_score_idx" ON "prospects" USING btree ("score" DESC NULLS LAST) WHERE "prospects"."disqualified" = false;--> statement-breakpoint
CREATE INDEX "prospects_sectors_idx" ON "prospects" USING gin ("sectors");--> statement-breakpoint
CREATE INDEX "scans_zone_idx" ON "scans" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "scans_status_idx" ON "scans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scans_started_idx" ON "scans" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trace_scan_idx" ON "trace_steps" USING btree ("scan_id","started_at");--> statement-breakpoint
CREATE INDEX "trace_prospect_idx" ON "trace_steps" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "trace_errors_idx" ON "trace_steps" USING btree ("scan_id","started_at") WHERE "trace_steps"."status" <> 'ok';--> statement-breakpoint
CREATE INDEX "zones_active_idx" ON "zones" USING btree ("active");