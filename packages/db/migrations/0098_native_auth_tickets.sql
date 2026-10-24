-- One-time tickets for the native app's sign-in handoff (ADR-0049).
-- Hash of the code, ids, a PKCE challenge and an app path. No token, no Gmail
-- data. Consumed by DELETE ... RETURNING; the user and session FKs cascade.

CREATE TABLE "native_auth_tickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "code_hash" text NOT NULL,
  "user_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "code_challenge" text,
  "return_to" text,
  "options" jsonb,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "native_auth_tickets_code_hash_unique" UNIQUE("code_hash"),
  CONSTRAINT "native_auth_tickets_kind_check" CHECK ("native_auth_tickets"."kind" IN ('handoff', 'connect_start')),
  CONSTRAINT "native_auth_tickets_shape_check" CHECK (("native_auth_tickets"."kind" = 'handoff' AND "native_auth_tickets"."code_challenge" IS NOT NULL AND "native_auth_tickets"."return_to" IS NOT NULL AND "native_auth_tickets"."options" IS NULL) OR ("native_auth_tickets"."kind" = 'connect_start' AND "native_auth_tickets"."code_challenge" IS NULL AND "native_auth_tickets"."return_to" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "native_auth_tickets" ADD CONSTRAINT "native_auth_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "native_auth_tickets" ADD CONSTRAINT "native_auth_tickets_session_id_active_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."active_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "native_auth_tickets_expires_at_idx" ON "native_auth_tickets" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "native_auth_tickets_user_id_idx" ON "native_auth_tickets" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "native_auth_tickets_session_id_idx" ON "native_auth_tickets" USING btree ("session_id");
--> statement-breakpoint
ALTER TABLE "native_auth_tickets" ENABLE ROW LEVEL SECURITY;
