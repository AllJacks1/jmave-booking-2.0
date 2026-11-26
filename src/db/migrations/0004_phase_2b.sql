CREATE TYPE "public"."duty" AS ENUM('operations', 'sales');--> statement-breakpoint
CREATE TYPE "public"."movement_kind" AS ENUM('release', 'return', 'extension');--> statement-breakpoint
CREATE TABLE "movement_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"kind" "movement_kind" NOT NULL,
	"planned_at" timestamp with time zone,
	"actual_at" timestamp with time zone NOT NULL,
	"odometer_km" integer,
	"fuel_level_eighths" integer,
	"delivery" boolean DEFAULT false NOT NULL,
	"previous_end_at" timestamp with time zone,
	"new_end_at" timestamp with time zone,
	"recorded_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movement_events_fuel_range" CHECK ("movement_events"."fuel_level_eighths" is null or "movement_events"."fuel_level_eighths" between 0 and 8),
	CONSTRAINT "movement_events_odometer_positive" CHECK ("movement_events"."odometer_km" is null or "movement_events"."odometer_km" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shift_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"user_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"duty" "duty" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_templates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "show_notes_on_board" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "movement_events" ADD CONSTRAINT "movement_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_events" ADD CONSTRAINT "movement_events_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_events" ADD CONSTRAINT "movement_events_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_template_id_shift_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."shift_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "movement_events_booking_idx" ON "movement_events" USING btree ("booking_id","actual_at");--> statement-breakpoint
CREATE INDEX "movement_events_vehicle_idx" ON "movement_events" USING btree ("vehicle_id","actual_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_assignments_date_user_idx" ON "shift_assignments" USING btree ("date","user_id");--> statement-breakpoint
-- One release and one return per booking (extensions may repeat).
CREATE UNIQUE INDEX "movement_events_one_release_return_idx" ON "movement_events" ("booking_id", "kind") WHERE "kind" IN ('release', 'return');--> statement-breakpoint
-- bookings-and-movement.md §9: the five shift templates (9PM–6AM crosses midnight).
INSERT INTO "shift_templates" ("name", "start_time", "end_time", "sort_order") VALUES
  ('5AM–2PM', '05:00', '14:00', 1),
  ('8AM–5PM', '08:00', '17:00', 2),
  ('10AM–7PM', '10:00', '19:00', 3),
  ('1PM–10PM', '13:00', '22:00', 4),
  ('9PM–6AM', '21:00', '06:00', 5)
ON CONFLICT ("name") DO NOTHING;
