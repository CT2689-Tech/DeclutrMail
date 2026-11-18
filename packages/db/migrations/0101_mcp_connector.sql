-- MCP connector (ADR-0048, spec §7): the OAuth authorization server, the
-- stored previews a person confirms, and which connected app an action came
-- from. Additive: seven new tables, nothing existing is altered. The foreign
-- keys take a brief lock on workspaces, users, mailbox_accounts and
-- action_jobs, so bound the wait.
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
-- A cleanup an assistant asked for, waiting for the person to confirm it on
-- DeclutrMail's own page (ADR-0048 rule 1). Holds sender ids and counts,
-- never subjects. A row lives 15 minutes, plus a day for the retention sweep.
CREATE TABLE action_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mailbox_account_id uuid NOT NULL REFERENCES mailbox_accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The connected app that asked. Disconnecting it removes what it asked for.
  grant_id uuid NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  verb text NOT NULL,
  older_than_days integer,
  wake_at timestamptz,
  -- Frozen when the preview was made: senders that were Protected or unknown
  -- then are not in it.
  sender_ids uuid[] NOT NULL,
  email_count integer NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  applied_at timestamptz,
  -- The action or batch the confirmation started, when the verb starts one.
  action_id uuid REFERENCES action_jobs(id) ON DELETE SET NULL,
  -- What applying it did: counts, sender ids and reason codes only.
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT action_previews_verb_check
    CHECK (verb IN ('keep', 'archive', 'unsubscribe', 'later', 'delete')),
  CONSTRAINT action_previews_state_check
    CHECK (state IN ('pending', 'confirmed', 'applied')),
  CONSTRAINT action_previews_window_check
    CHECK (older_than_days IS NULL
      OR (older_than_days IN (30, 90, 180, 365) AND verb IN ('archive', 'later', 'delete'))),
  CONSTRAINT action_previews_wake_at_check
    CHECK ((verb = 'later') = (wake_at IS NOT NULL)),
  CONSTRAINT action_previews_selection_check
    CHECK (cardinality(sender_ids) BETWEEN 1 AND 1000 AND email_count >= 0),
  -- The three states move forward only, and each carries exactly its own facts.
  CONSTRAINT action_previews_lifecycle_check
    CHECK ((state = 'pending' AND confirmed_at IS NULL AND applied_at IS NULL
        AND action_id IS NULL AND result IS NULL)
      OR (state = 'confirmed' AND confirmed_at IS NOT NULL AND applied_at IS NULL
        AND action_id IS NULL AND result IS NULL)
      OR (state = 'applied' AND confirmed_at IS NOT NULL AND applied_at IS NOT NULL
        AND result IS NOT NULL)),
  CONSTRAINT action_previews_expiry_check CHECK (expires_at > created_at)
);
--> statement-breakpoint
ALTER TABLE action_previews ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX action_previews_workspace_id_idx ON action_previews(workspace_id);
--> statement-breakpoint
CREATE INDEX action_previews_mailbox_account_id_idx ON action_previews(mailbox_account_id);
--> statement-breakpoint
CREATE INDEX action_previews_user_id_idx ON action_previews(user_id);
--> statement-breakpoint
CREATE INDEX action_previews_grant_id_idx ON action_previews(grant_id);
--> statement-breakpoint
CREATE INDEX action_previews_action_id_idx ON action_previews(action_id)
  WHERE action_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX action_previews_expires_at_idx ON action_previews(expires_at);
--> statement-breakpoint
-- Which connected app started an action, so Activity can say so. One row
-- per action job; it goes when the job does. client_id outlives the grant,
-- which retention removes 30 days after the app is disconnected.
CREATE TABLE action_origins (
  action_job_id uuid PRIMARY KEY REFERENCES action_jobs(id) ON DELETE CASCADE,
  grant_id uuid REFERENCES oauth_grants(id) ON DELETE SET NULL,
  client_id text REFERENCES oauth_clients(client_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE action_origins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX action_origins_grant_id_idx ON action_origins(grant_id);
--> statement-breakpoint
CREATE INDEX action_origins_client_id_idx ON action_origins(client_id);
--> statement-breakpoint
RESET lock_timeout;
