CREATE INDEX "bookings_end_idx" ON "bookings" USING btree ("end_at");--> statement-breakpoint
CREATE INDEX "bookings_number_trgm_idx" ON "bookings" USING gin ("number" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "bookings_client_name_trgm_idx" ON "bookings" USING gin ("client_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "clients_email_trgm_idx" ON "clients" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "clients_phone_trgm_idx" ON "clients" USING gin ("phone" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "quotations_number_trgm_idx" ON "quotations" USING gin ("number" gin_trgm_ops);