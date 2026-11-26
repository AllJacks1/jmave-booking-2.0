CREATE TYPE "public"."loyalty_status" AS ENUM('active', 'expired');--> statement-breakpoint
CREATE TYPE "public"."outbox_kind" AS ENUM('rework_lead', 'email');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."points_kind" AS ENUM('earn', 'reversal', 'redeem', 'refund', 'adjust', 'import');--> statement-breakpoint
CREATE TABLE "loyalty_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"card_no" text NOT NULL,
	"member_since" date NOT NULL,
	"expires_at" date NOT NULL,
	"tier" integer,
	"status" "loyalty_status" DEFAULT 'active' NOT NULL,
	"imported_name" text,
	"imported" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_accounts_client_id_unique" UNIQUE("client_id"),
	CONSTRAINT "loyalty_accounts_card_no_unique" UNIQUE("card_no"),
	CONSTRAINT "loyalty_accounts_tier_range" CHECK ("loyalty_accounts"."tier" is null or "loyalty_accounts"."tier" between 0 and 99)
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "outbox_kind" NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"response" jsonb,
	"sent_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entity" text,
	"entity_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "points_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"booking_id" uuid,
	"quotation_id" uuid,
	"kind" "points_kind" NOT NULL,
	"points" integer NOT NULL,
	"note" text,
	"import_key" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_ledger_import_key_unique" UNIQUE("import_key"),
	CONSTRAINT "points_ledger_nonzero" CHECK ("points_ledger"."points" <> 0)
);
--> statement-breakpoint
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_account_id_loyalty_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."loyalty_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_due_idx" ON "outbox" USING btree ("next_attempt_at") WHERE "outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "outbox_entity_idx" ON "outbox" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "points_ledger_account_idx" ON "points_ledger" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "points_ledger_booking_idx" ON "points_ledger" USING btree ("booking_id");