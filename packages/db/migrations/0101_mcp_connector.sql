-- MCP connector (ADR-0048, spec §7): the OAuth authorization server, the
-- stored previews a person confirms, and which connected app an action came
-- from. Seven new tables, plus the connector's funnel events on
-- product_events (end of file), which only widens what that table accepts.
-- The foreign keys take a brief lock on workspaces, users, mailbox_accounts
-- and action_jobs, so bound the wait.
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
  -- Unsubscribe only: Archive or Delete the senders' existing email in the
  -- same confirmation, as the web app's unsubscribe backlog does.
  also_verb text,
  older_than_days integer,
  wake_at timestamptz,
  -- Frozen when the preview was made: senders that were Protected or unknown
  -- then are not in it.
  sender_ids uuid[] NOT NULL,
  email_count integer NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  -- Set by the one request that is starting the action for a confirmed
  -- preview, so two requests arriving together cannot both start it.
  claimed_at timestamptz,
  applied_at timestamptz,
  -- The action or batch the confirmation started, when the verb starts one.
  action_id uuid REFERENCES action_jobs(id) ON DELETE SET NULL,
  -- What applying it did: counts, sender ids and reason codes only.
  result jsonb,
  -- Why the last press could not start it (a tool error code). The press
  -- is spent: the row is back to pending until the person presses again.
  refused_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT action_previews_verb_check
    CHECK (verb IN ('keep', 'archive', 'unsubscribe', 'later', 'delete')),
  CONSTRAINT action_previews_state_check
    CHECK (state IN ('pending', 'confirmed', 'applied')),
  CONSTRAINT action_previews_also_verb_check
    CHECK (also_verb IS NULL OR (verb = 'unsubscribe' AND also_verb IN ('archive', 'delete'))),
  CONSTRAINT action_previews_window_check
    CHECK (older_than_days IS NULL
      OR (older_than_days IN (30, 90, 180, 365)
        AND (verb IN ('archive', 'later', 'delete') OR also_verb IS NOT NULL))),
  CONSTRAINT action_previews_wake_at_check
    CHECK ((verb = 'later') = (wake_at IS NOT NULL)),
  CONSTRAINT action_previews_selection_check
    CHECK (cardinality(sender_ids) BETWEEN 1 AND 1000 AND email_count >= 0),
  -- Each state carries exactly its own facts. A refused start moves a row
  -- from confirmed back to pending; applied is final.
  CONSTRAINT action_previews_lifecycle_check
    CHECK ((state = 'pending' AND confirmed_at IS NULL AND applied_at IS NULL
        AND action_id IS NULL AND result IS NULL)
      OR (state = 'confirmed' AND confirmed_at IS NOT NULL AND applied_at IS NULL
        AND action_id IS NULL AND result IS NULL)
      OR (state = 'applied' AND confirmed_at IS NOT NULL AND applied_at IS NOT NULL
        AND result IS NOT NULL)),
  CONSTRAINT action_previews_refused_check
    CHECK (refused_code IS NULL OR (state = 'pending' AND refused_code ~ '^[A-Z_]{1,40}$')),
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
-- The connector's funnel on product_events (0086): seven event names and
-- six prop keys (client, tool, outcome, verb, reason, preview_id), each a
-- closed list or a uuid. Nothing in this file writes the new labels:
-- Postgres cannot use an enum value added in the same transaction, and
-- ADD VALUE IF NOT EXISTS is accepted inside it on Postgres 12+ (0087).
ALTER TYPE "public"."product_event_name" ADD VALUE IF NOT EXISTS 'connector_app_connected';
--> statement-breakpoint
ALTER TYPE "public"."product_event_name" ADD VALUE IF NOT EXISTS 'connector_app_disconnected';
--> statement-breakpoint
ALTER TYPE "public"."product_event_name" ADD VALUE IF NOT EXISTS 'connector_tool_called';
--> statement-breakpoint
ALTER TYPE "public"."product_event_name" ADD VALUE IF NOT EXISTS 'connector_request_prepared';
--> statement-breakpoint
ALTER TYPE "public"."product_event_name" ADD VALUE IF NOT EXISTS 'connector_confirm_viewed';
--> statement-breakpoint
ALTER TYPE "public"."product_event_name" ADD VALUE IF NOT EXISTS 'connector_request_started';
--> statement-breakpoint
ALTER TYPE "public"."product_event_name" ADD VALUE IF NOT EXISTS 'connector_request_refused';
--> statement-breakpoint
-- The CHECK is replaced by a strictly wider one, so every existing row
-- passes it. The table is small (one row per funnel step) and the scan
-- runs under the lock_timeout above.
ALTER TABLE "product_events" DROP CONSTRAINT "product_events_props_chk";
--> statement-breakpoint
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_props_chk" CHECK (
  jsonb_typeof("props") = 'object'
  AND ("props" - ARRAY['kind', 'plan', 'requested_bucket', 'duration_s', 'emails', 'template', 'mode', 'error_class', 'provider', 'mailbox_id', 'client', 'tool', 'outcome', 'verb', 'reason', 'preview_id']::text[]) = '{}'::jsonb
  AND strpos("props"::text, '@') = 0
  AND ("props"->'kind' IS NULL OR (jsonb_typeof("props"->'kind') = 'string' AND "props"->>'kind' IN ('gmail', 'workspace')))
  AND ("props"->'plan' IS NULL OR (jsonb_typeof("props"->'plan') = 'string' AND "props"->>'plan' ~ '^[A-Za-z0-9._+-]{1,64}$'))
  AND ("props"->'requested_bucket' IS NULL OR (jsonb_typeof("props"->'requested_bucket') = 'string' AND "props"->>'requested_bucket' IN ('1', '2-10', '11-100', '101-1000', '1001+')))
  AND ("props"->'duration_s' IS NULL OR (jsonb_typeof("props"->'duration_s') = 'number' AND ("props"->>'duration_s')::numeric IN (0, 30, 60, 120, 300, 600, 1800, 3600, 7200)))
  AND ("props"->'emails' IS NULL OR (jsonb_typeof("props"->'emails') = 'number' AND ("props"->>'emails')::numeric IN (0, 100, 1000, 10000, 50000, 100000)))
  AND ("props"->'template' IS NULL OR (jsonb_typeof("props"->'template') = 'string' AND "props"->>'template' IN ('sync_complete', 'sync_reminder_24h', 'lapse', 'weekly', 'weekly_detail', 'sync_failed', 'gmail_reconnect', 'deletion_scheduled')))
  AND ("props"->'mode' IS NULL OR (jsonb_typeof("props"->'mode') = 'string' AND "props"->>'mode' IN ('login', 'connect', 'reconnect')))
  AND ("props"->'error_class' IS NULL OR (jsonb_typeof("props"->'error_class') = 'string' AND "props"->>'error_class' ~ '^[A-Za-z][A-Za-z0-9]{0,63}$'))
  AND ("props"->'provider' IS NULL OR (jsonb_typeof("props"->'provider') = 'string' AND "props"->>'provider' = 'google'))
  AND ("props"->'mailbox_id' IS NULL OR (jsonb_typeof("props"->'mailbox_id') = 'string' AND "props"->>'mailbox_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'))
  AND ("props"->'client' IS NULL OR (jsonb_typeof("props"->'client') = 'string' AND "props"->>'client' IN ('claude', 'chatgpt', 'local', 'other')))
  AND ("props"->'tool' IS NULL OR (jsonb_typeof("props"->'tool') = 'string' AND "props"->>'tool' IN ('list_mailboxes', 'list_senders', 'get_sender', 'get_usage', 'preview_cleanup', 'apply_cleanup', 'get_action_status', 'list_recent_actions', 'undo', 'protect_sender')))
  AND ("props"->'outcome' IS NULL OR (jsonb_typeof("props"->'outcome') = 'string' AND "props"->>'outcome' IN ('ok', 'error')))
  AND ("props"->'verb' IS NULL OR (jsonb_typeof("props"->'verb') = 'string' AND "props"->>'verb' IN ('keep', 'archive', 'unsubscribe', 'later', 'delete')))
  AND ("props"->'reason' IS NULL OR (jsonb_typeof("props"->'reason') = 'string' AND "props"->>'reason' IN ('QUOTA_EXHAUSTED', 'UPGRADE_REQUIRED', 'UNSUBSCRIBE_UNAVAILABLE')))
  AND ("props"->'preview_id' IS NULL OR (jsonb_typeof("props"->'preview_id') = 'string' AND "props"->>'preview_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'))
);
--> statement-breakpoint
RESET lock_timeout;
