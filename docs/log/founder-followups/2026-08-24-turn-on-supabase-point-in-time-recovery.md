### 2026-08-24 — Turn on point-in-time recovery before the first paying customer

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-08-24.
**Why:** On 2026-08-24 production had daily backups only, so a disaster could lose up to a day of data. That was accepted while the founder was the only user, and deferred until someone pays. The project is on Supabase Pro now, where point-in-time recovery is a paid add-on.
**How:**
1. Check in the Supabase dashboard → Database → Backups → Point in time: is it on?
2. Check in Paddle and Razorpay whether any customer has paid.
3. If someone has paid and it is off: click Enable add-on on that page. Check the price shown there first.
**Verifies by:** the Point in time tab shows a recovery window instead of the add-on offer.
**Who:** Founder
**Status:** Open
