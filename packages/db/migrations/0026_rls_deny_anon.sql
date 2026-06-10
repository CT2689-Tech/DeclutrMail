-- 0026_rls_deny_anon.sql
--
-- Belt-and-suspenders Row Level Security on every V2 table. Cloud Run
-- connects as the `postgres` role which bypasses RLS, so this migration
-- is a NO-OP for the runtime path; nothing about Drizzle queries or
-- worker job execution changes.
--
-- What this closes: the hypothetical "Supabase Data API gets
-- re-enabled later AND the anon key leaks" hole flagged by Supabase's
-- security advisor (ADR-0022 follow-up). Without RLS, those two gates
-- failing simultaneously would let any holder of the anon key read or
-- modify every row via PostgREST. With RLS on + zero policies, anon +
-- authenticated Supabase roles get nothing. The application-layer
-- gates (Cloud Run → NestJS guards → Drizzle queries as `postgres`
-- role) remain the only access path.
--
-- Why no policies are added: D7 + D228 lock the access model to
-- "app-server-only via Cloud Run". A SELECT policy of any shape would
-- create an extra access path; we explicitly want NONE. RLS-enabled-
-- but-policy-less = the secure default for our model.
--
-- Privacy note (D7, D228): no data shape changes; no new exposure;
-- only adds a default-deny gate that further restricts non-postgres
-- roles.

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.mailbox_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.senders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.mail_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.sender_timeseries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.sender_policies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.triage_decisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.undo_journal ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.action_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.rule_match_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.followup_tracker ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.brief_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.webhook_dedup ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.provider_sync_state ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
