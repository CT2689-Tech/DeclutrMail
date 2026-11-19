### 2026-08-13 — Submit the sitemap to Bing and Brave

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-08-13.
**Why:** The indexing work so far targeted Google. Bing and Brave run their own indexes, and pages they have not crawled cannot appear there or in tools built on them. The Bing ownership token is already in the site (`apps/web/src/app/layout.tsx:42`); whether the sitemap was submitted, and whether Brave knows the site, cannot be seen from the repo.
**How:**
1. Check in Bing Webmaster Tools (https://www.bing.com/webmasters): `declutrmail.com` is verified and Sitemaps lists `https://declutrmail.com/sitemap.xml` as read. Submit it if missing.
2. Register the site with Brave Search (https://search.brave.com/help/webmaster) and submit the same sitemap.
**Verifies by:** `site:declutrmail.com` returns pages on Bing and on Brave, and Bing Webmaster shows the sitemap as read.
**Who:** Founder
**Status:** Open
