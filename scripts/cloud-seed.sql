-- cloud-seed.sql — a 2-connected-account workspace for local smoke.
-- Free tier; founder + crypt mailboxes both active + sync-ready; senders
-- and messages incl. an attacker-controlled formula-injection subject
-- and display name (for the #224 CSV-export hardening smoke). Idempotent.
INSERT INTO workspaces (id, name, tier) VALUES
  ('11111111-1111-4111-8111-111111111111','Founder WS','free') ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id, workspace_id, email) VALUES
  ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','chintan.a.thakkar@gmail.com') ON CONFLICT (id) DO NOTHING;
INSERT INTO mailbox_accounts (id, workspace_id, user_id, provider, provider_account_id, status) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','gmail','chintan.a.thakkar@gmail.com','active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','gmail','chintan.a.thakkar.crypt@gmail.com','active') ON CONFLICT (id) DO NOTHING;
INSERT INTO provider_sync_state (mailbox_account_id, readiness_status, current_stage) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ready','ready'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ready','ready') ON CONFLICT (mailbox_account_id) DO NOTHING;
UPDATE users SET preferences = jsonb_set(COALESCE(preferences,'{}'::jsonb),'{activeMailboxId}','"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"')
  WHERE id='22222222-2222-4222-8222-222222222222';
INSERT INTO senders (mailbox_account_id, sender_key, display_name, email, domain, gmail_category, first_seen_at, last_seen_at) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('a',64), 'Acme News', 'news@acme.com','acme.com','promotions', now()-interval '90 days', now()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('b',64), '=cmd|''/c calc''!A1', 'evil@bad.com','bad.com','promotions', now()-interval '30 days', now()) ON CONFLICT (mailbox_account_id, sender_key) DO NOTHING;
INSERT INTO mail_messages (mailbox_account_id, provider_message_id, provider_thread_id, sender_key, subject, snippet, internal_date, is_unread, label_ids) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','m-evil','t-evil', repeat('a',64), '=HYPERLINK("http://evil","click")','preview text', now(), true, ARRAY['INBOX']),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','m-evilname','t-evilname', repeat('b',64), 'Totally normal subject','hi', now(), true, ARRAY['INBOX']),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','m-norm','t-norm', repeat('a',64), 'Your weekly digest','hello', now(), false, ARRAY['INBOX','CATEGORY_PROMOTIONS']) ON CONFLICT (mailbox_account_id, provider_message_id) DO NOTHING;
