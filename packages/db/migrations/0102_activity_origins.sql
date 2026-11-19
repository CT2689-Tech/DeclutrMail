-- Which connected app made a change on its own, with no confirmation in
-- DeclutrMail: today only the connector's protect_sender (ADR-0048, spec
-- §7). Activity then names the app on that row ("By <app>"), not the
-- person. Keyed by the activity row, which has no job (action_origins
-- covers rows that do); it goes when the row does.
CREATE TABLE activity_origins (
  activity_log_id uuid PRIMARY KEY REFERENCES activity_log(id) ON DELETE CASCADE,
  grant_id uuid REFERENCES oauth_grants(id) ON DELETE SET NULL,
  client_id text REFERENCES oauth_clients(client_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE activity_origins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX activity_origins_grant_id_idx ON activity_origins(grant_id);
--> statement-breakpoint
CREATE INDEX activity_origins_client_id_idx ON activity_origins(client_id);
