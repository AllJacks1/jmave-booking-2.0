CREATE TYPE "public"."quotation_kind" AS ENUM('quick', 'formal');--> statement-breakpoint
CREATE TYPE "public"."quotation_status" AS ENUM('draft', 'issued', 'accepted', 'expired', 'lost', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."service" AS ENUM('self_drive', 'with_driver');--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"kind" "quotation_kind" NOT NULL,
	"service" "service" NOT NULL,
	"status" "quotation_status" DEFAULT 'draft' NOT NULL,
	"client_id" uuid,
	"client_name" text,
	"vehicle_id" uuid,
	"body_type" "body_type",
	"category" text,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"inputs" jsonb NOT NULL,
	"result" jsonb,
	"snapshot" jsonb,
	"rate_card_id" uuid,
	"total_centavos" integer,
	"valid_until" timestamp with time zone,
	"consultant_id" uuid,
	"share_token" text,
	"issued_at" timestamp with time zone,
	"revised_from_id" uuid,
	"status_note" text,
	"blacklist_override_reason" text,
	"blacklist_override_by" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotations_number_unique" UNIQUE("number"),
	CONSTRAINT "quotations_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_rate_card_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."rate_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_consultant_id_user_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_revised_from_id_quotations_id_fk" FOREIGN KEY ("revised_from_id") REFERENCES "public"."quotations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_blacklist_override_by_user_id_fk" FOREIGN KEY ("blacklist_override_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quotations_status_idx" ON "quotations" USING btree ("status","valid_until");--> statement-breakpoint
CREATE INDEX "quotations_consultant_idx" ON "quotations" USING btree ("consultant_id","created_at");--> statement-breakpoint
CREATE INDEX "quotations_created_at_idx" ON "quotations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "quotations_client_idx" ON "quotations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "quotations_revised_from_idx" ON "quotations" USING btree ("revised_from_id");--> statement-breakpoint
CREATE INDEX "quotations_client_name_trgm_idx" ON "quotations" USING gin ("client_name" gin_trgm_ops);