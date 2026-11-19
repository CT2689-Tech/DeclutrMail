### 2026-09-18 — Turn on Vercel Web Analytics for the public site

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-09-18.
**Why:** We cannot tell a traffic problem from a conversion problem. PostHog starts only after "Accept all", so its visitor numbers are a floor. The cookieless counter is in the code (`apps/web/src/features/marketing/site-analytics.tsx`), but it counts nothing until Web Analytics is on for the project; until then its script path returns 404.
**How:**
1. Check in the Vercel dashboard: web project → Analytics.
2. If it is off, click Enable Web Analytics. The next production deploy serves the script.
3. Open https://declutrmail.com in a private window → DevTools → Network.
**Verifies by:** `/_vercel/insights/script.js` returns 200 and a `view` request goes out, with no CSP error in the console; the visit shows in the Analytics tab within minutes.
**Who:** Founder
**Status:** Open
