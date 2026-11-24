CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TYPE "public"."block_kind" AS ENUM('owner_use', 'maintenance', 'hired_out', 'reserved', 'other');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('pending_reservation', 'confirmed', 'released', 'returned', 'closed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."charge_kind" AS ENUM('quoted', 'excess_km', 'fuel_shortage', 'extension', 'ot', 'damage', 'other');--> statement-breakpoint
CREATE TYPE "public"."charge_source" AS ENUM('quote', 'check_in', 'manual');--> statement-breakpoint
CREATE TYPE "public"."hold_kind" AS ENUM('booking', 'block');--> statement-breakpoint
CREATE TYPE "public"."payment_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'gcash', 'card', 'bank', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_type" AS ENUM('reservation_fee', 'delivery_fee', 'rental', 'deposit', 'deposit_refund', 'change_given', 'other');--> statement-breakpoint
CREATE TYPE "public"."source_channel" AS ENUM('facebook', 'whatsapp', 'viber', 'phone', 'walk_in', 'website', 'referral', 'other');--> statement-breakpoint
CREATE TABLE "booking_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"kind" charge_kind NOT NULL,
	"code" text,
	"label" text NOT NULL,
	"amount_centavos" integer NOT NULL,
	"source" charge_source NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"quotation_id" uuid,
	"client_id" uuid,
	"client_name" text,
	"vehicle_id" uuid,
	"vehicle_label" text,
	"service" "service" NOT NULL,
	"status" "booking_status" DEFAULT 'pending_reservation' NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"destination" text,
	"delivery_address" text,
	"pickup_address" text,
	"driver_id" uuid,
	"driver_overlap_reason" text,
	"driver_name_on_license" text,
	"drivers_license_no" text,
	"ids_presented" text[] DEFAULT '{}'::text[] NOT NULL,
	"passengers" integer,
	"luggage" text,
	"itinerary" text,
	"source_channel" "source_channel",
	"contact_handle" text,
	"rework_link" text,
	"or_issued" boolean DEFAULT false NOT NULL,
	"notes" text,
	"status_note" text,
	"confirm_without_rf_reason" text,
	"imported" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_number_unique" UNIQUE("number"),
	CONSTRAINT "bookings_quotation_id_unique" UNIQUE("quotation_id")
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"type" "payment_type" NOT NULL,
	"direction" "payment_direction" NOT NULL,
	"amount_centavos" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"collected_by_user_id" uuid,
	"collected_by_name" text,
	"paid_at" timestamp with time zone NOT NULL,
	"note" text,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_centavos" > 0)
);
--> statement-breakpoint
CREATE TABLE "vehicle_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"kind" "block_kind" NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"kind" "hold_kind" NOT NULL,
	"booking_id" uuid,
	"block_id" uuid,
	"period" "tstzrange" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_holds_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "vehicle_holds_block_id_unique" UNIQUE("block_id"),
	CONSTRAINT "vehicle_holds_owner_check" CHECK (("vehicle_holds"."kind" = 'booking' and "vehicle_holds"."booking_id" is not null and "vehicle_holds"."block_id" is null) or ("vehicle_holds"."kind" = 'block' and "vehicle_holds"."block_id" is not null and "vehicle_holds"."booking_id" is null))
);
--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "imported" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "imported_data" jsonb;--> statement-breakpoint
ALTER TABLE "booking_charges" ADD CONSTRAINT "booking_charges_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_charges" ADD CONSTRAINT "booking_charges_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_collected_by_user_id_user_id_fk" FOREIGN KEY ("collected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_blocks" ADD CONSTRAINT "vehicle_blocks_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_blocks" ADD CONSTRAINT "vehicle_blocks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_holds" ADD CONSTRAINT "vehicle_holds_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_holds" ADD CONSTRAINT "vehicle_holds_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_holds" ADD CONSTRAINT "vehicle_holds_block_id_vehicle_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."vehicle_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_charges_booking_idx" ON "booking_charges" USING btree ("booking_id","sort_order");--> statement-breakpoint
CREATE INDEX "bookings_vehicle_start_idx" ON "bookings" USING btree ("vehicle_id","start_at");--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "bookings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bookings_client_idx" ON "bookings" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "bookings_start_idx" ON "bookings" USING btree ("start_at");--> statement-breakpoint
CREATE INDEX "bookings_driver_idx" ON "bookings" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "drivers_name_lower_idx" ON "drivers" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "payments_booking_idx" ON "payments" USING btree ("booking_id","paid_at");--> statement-breakpoint
CREATE INDEX "vehicle_blocks_vehicle_start_idx" ON "vehicle_blocks" USING btree ("vehicle_id","start_at");--> statement-breakpoint
-- PLAN §6.2: a vehicle can never hold two overlapping active periods (bookings or blocks).
ALTER TABLE "vehicle_holds" ADD CONSTRAINT "vehicle_holds_no_overlap" EXCLUDE USING gist ("vehicle_id" WITH =, "period" WITH &&) WHERE ("active");--> statement-breakpoint
ALTER TABLE "vehicle_holds" ADD CONSTRAINT "vehicle_holds_period_not_empty" CHECK (NOT isempty("period") AND NOT lower_inf("period") AND NOT upper_inf("period"));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_end_after_start" CHECK ("end_at" > "start_at");--> statement-breakpoint
ALTER TABLE "vehicle_blocks" ADD CONSTRAINT "vehicle_blocks_end_after_start" CHECK ("end_at" > "start_at");
