### 2026-08-13 — Verify Search Console, submit the sitemap and finish the .ai move

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-08-13.
**Why:** Only Search Console shows Google clicks and indexed pages, and the 2026-11-17 SEO audit says it still needs DNS verification. The sitemap lists 47 pages, and `declutrmail.ai` now 301s to `declutrmail.com`, so Google can be told about the move.
**How:**
1. Search Console → add or open the Domain property `declutrmail.com` → copy its TXT record → add it at the DNS host → Verify.
2. Sitemaps → submit `https://declutrmail.com/sitemap.xml`.
3. URL Inspection → Request indexing for the newest guides, a few a day (Google rate-limits it).
4. On the `declutrmail.ai` property: Settings → Change of address → `declutrmail.com`.
**Verifies by:** the property shows Verified, Sitemaps shows a recent "Last read", and Change of address shows an active move.
**Who:** Founder
**Status:** Open
