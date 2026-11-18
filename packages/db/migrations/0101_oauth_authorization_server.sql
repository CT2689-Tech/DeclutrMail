-- OAuth authorization server for the MCP connector (ADR-0048 rule 4, spec §7).
-- Additive: five new tables, nothing existing is altered. The foreign keys to
-- workspaces and users take a brief lock on those tables, so bound the wait.
SET lock_timeout = '3s';
--> statement-breakpoint
CREATE TABLE oauth_clients (
  client_id text PRIMARY KEY,
  client_name text,
  redirect_uris text[] NOT NULL,
  registration_type text NOT NULL,
  metadata jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Set when a person first approves this client, and on every approval
  -- after. NULL = never approved: the only registrations retention removes.
  last_granted_at timestamptz,
  CONSTRAINT oauth_clients_registration_type_check CHECK (registration_type IN ('dynamic'))
);
--> statement-breakpoint
-- Server-only: no browser/public policies.
ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Registration is unauthenticated, so this table's size is not ours to
-- choose; the retention sweep must find old rows without scanning it.
CREATE INDEX oauth_clients_created_at_idx ON oauth_clients(created_at);
--> statement-breakpoint
CREATE TABLE oauth_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  scopes text[] NOT NULL,
  resource text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
--> statement-breakpoint
ALTER TABLE oauth_grants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX oauth_grants_user_id_idx ON oauth_grants(user_id, created_at);
--> statement-breakpoint
CREATE INDEX oauth_grants_workspace_id_idx ON oauth_grants(workspace_id);
--> statement-breakpoint
CREATE INDEX oauth_grants_client_id_idx ON oauth_grants(client_id);
--> statement-breakpoint
CREATE INDEX oauth_grants_revoked_at_idx ON oauth_grants(revoked_at);
--> statement-breakpoint
CREATE TABLE oauth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  kind text NOT NULL,
  token_hash text NOT NULL,
  family_id uuid,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  replaced_by uuid REFERENCES oauth_tokens(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oauth_tokens_kind_check CHECK (kind IN ('access', 'refresh'))
);
--> statement-breakpoint
ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE UNIQUE INDEX oauth_tokens_token_hash_uniq ON oauth_tokens(token_hash);
--> statement-breakpoint
CREATE INDEX oauth_tokens_grant_id_idx ON oauth_tokens(grant_id);
--> statement-breakpoint
CREATE INDEX oauth_tokens_replaced_by_idx ON oauth_tokens(replaced_by);
--> statement-breakpoint
CREATE INDEX oauth_tokens_expires_at_idx ON oauth_tokens(expires_at);
--> statement-breakpoint
CREATE TABLE oauth_auth_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL,
  grant_id uuid NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  code_challenge text NOT NULL,
  code_challenge_method text NOT NULL,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oauth_auth_codes_challenge_method_check CHECK (code_challenge_method = 'S256')
);
--> statement-breakpoint
ALTER TABLE oauth_auth_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE UNIQUE INDEX oauth_auth_codes_code_hash_uniq ON oauth_auth_codes(code_hash);
--> statement-breakpoint
CREATE INDEX oauth_auth_codes_grant_id_idx ON oauth_auth_codes(grant_id);
--> statement-breakpoint
CREATE INDEX oauth_auth_codes_expires_at_idx ON oauth_auth_codes(expires_at);
--> statement-breakpoint
CREATE TABLE oauth_interactions (
  id_hash text PRIMARY KEY,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE oauth_interactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX oauth_interactions_expires_at_idx ON oauth_interactions(expires_at);
--> statement-breakpoint
RESET lock_timeout;
