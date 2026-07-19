-- 0047_senders_registrable_domain.sql
--
-- D247 (founder decision 2026-07-18): server-side brand grouping. Supersedes
-- the client-side, grid-only D51 rollup with a server aggregation so a brand
-- that mails from many subdomains/addresses (Macy's: shop@emails.macys.com,
-- alert@em.macys.com, notify.macys.com, … = 6+ sender rows) collapses into ONE
-- brand card with COMPLETE counts across the whole matching set, not just the
-- loaded page.
--
-- `registrable_domain` is the eTLD+1 of `domain`, computed by the IMMUTABLE
-- `dm_registrable_domain` function and materialised as a GENERATED STORED
-- column so Postgres can `GROUP BY registrable_domain` + keyset-paginate brand
-- cards on an index. The function is the SINGLE SOURCE OF TRUTH for eTLD+1 —
-- the old client-side TS `registrableDomain` (apps/web domain-rollup.ts) is
-- removed with the client rollup, so there is no dual-impl drift.
--
-- eTLD+1 derivation is PRAGMATIC (mirrors the retired TS util): a short
-- allowlist of common multi-part public suffixes (co.uk, com.au, co.in, …)
-- rather than a full ~200KB Public Suffix List. Worst case for a suffix NOT in
-- the list = an over-eager brand group; per-sender actions are unaffected
-- (grouping is presentation-only, D226 preview semantics stay per-sender).
-- Consumer mail providers (gmail.com, outlook.com, …) resolve to themselves
-- here and are excluded at QUERY time, not here — 338 unrelated humans at
-- gmail.com are never one "brand".
--
-- Generated STORED ⇒ existing rows are computed at ALTER time (no separate
-- backfill) and future rows on every sync write (no worker change).

CREATE FUNCTION dm_registrable_domain(domain text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT AS $$
  WITH clean AS (SELECT regexp_replace(lower(btrim(domain)), '\.+$', '') AS d),
  parts AS (SELECT d, string_to_array(d, '.') AS labels FROM clean),
  n AS (SELECT d, labels, array_length(labels, 1) AS len FROM parts)
  SELECT CASE
    WHEN len IS NULL OR len <= 2 THEN d
    WHEN (labels[len - 1] || '.' || labels[len]) = ANY (ARRAY[
      'co.uk','org.uk','gov.uk','ac.uk','net.uk',
      'com.au','net.au','org.au','gov.au','edu.au',
      'co.in','net.in','org.in','gov.in','ac.in',
      'co.nz','org.nz','net.nz','co.jp','or.jp','ne.jp','ac.jp',
      'com.br','org.br','com.mx','com.ar',
      'com.sg','com.hk','com.my','co.th','com.tw','com.cn','co.kr',
      'co.za','org.za','com.tr','com.eg','co.il'])
      THEN array_to_string(labels[len - 2:len], '.')
    ELSE array_to_string(labels[len - 1:len], '.')
  END FROM n
$$;
--> statement-breakpoint
ALTER TABLE "senders"
  ADD COLUMN "registrable_domain" text
  GENERATED ALWAYS AS (dm_registrable_domain("domain")) STORED;
--> statement-breakpoint
CREATE INDEX "senders_account_registrable_domain_idx"
  ON "senders" ("mailbox_account_id", "registrable_domain");
