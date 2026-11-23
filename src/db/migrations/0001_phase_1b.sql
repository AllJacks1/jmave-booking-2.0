CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."body_type" AS ENUM('compact', 'sedan', 'wagon', 'mpv', 'suv', 'pickup', 'van');--> statement-breakpoint
CREATE TYPE "public"."client_type" AS ENUM('individual', 'corporate');--> statement-breakpoint
CREATE TYPE "public"."fuel_type" AS ENUM('gasoline', 'premium', 'diesel');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('previewed', 'committed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ownership" AS ENUM('owned', 'operator', 'hired');--> statement-breakpoint
CREATE TYPE "public"."rate_card_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"fb_name" text,
	"phone" text,
	"email" text,
	"birthday" date,
	"address" text,
	"alt_contact_name" text,
	"alt_contact_phone" text,
	"drivers_license_no" text,
	"company_name" text,
	"client_type" "client_type" DEFAULT 'individual' NOT NULL,
	"is_blacklisted" boolean DEFAULT false NOT NULL,
	"blacklist_reason" text,
	"first_rental_at" timestamp with time zone,
	"source" text DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holidays_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" text NOT NULL,
	"file_sha256" text NOT NULL,
	"file_size" integer NOT NULL,
	"kind" text NOT NULL,
	"status" "import_status" DEFAULT 'previewed' NOT NULL,
	"summary" jsonb NOT NULL,
	"payload" jsonb,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_by" uuid,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "number_sequences" (
	"key" text PRIMARY KEY NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"status" "rate_card_status" DEFAULT 'draft' NOT NULL,
	"effective_from" timestamp with time zone,
	"data" jsonb NOT NULL,
	"source" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_cards_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"plate" text,
	"make" text,
	"model" text,
	"year" integer,
	"color" text,
	"transmission" text,
	"chassis_no" text,
	"engine_no" text,
	"engine" text,
	"body_type" "body_type",
	"fuel_type" "fuel_type",
	"tank_capacity_l" integer,
	"ownership" "ownership" DEFAULT 'owned' NOT NULL,
	"operator_name" text,
	"daily_rate_display" integer,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_plate_unique" UNIQUE("plate")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_committed_by_user_id_fk" FOREIGN KEY ("committed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clients_phone_idx" ON "clients" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "clients_email_lower_idx" ON "clients" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "clients_full_name_trgm_idx" ON "clients" USING gin ("full_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "clients_fb_name_trgm_idx" ON "clients" USING gin ("fb_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "import_runs_created_at_idx" ON "import_runs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_cards_one_active_idx" ON "rate_cards" USING btree ("status") WHERE "rate_cards"."status" = 'active';--> statement-breakpoint
CREATE INDEX "vehicles_display_name_idx" ON "vehicles" USING btree ("display_name");