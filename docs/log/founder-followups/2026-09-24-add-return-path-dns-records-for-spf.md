### 2026-09-24 — Add the return-path DNS records so SPF passes for our domain

**Source:** FOUNDER-FOLLOWUPS.md (root, deleted 2026-11-19; read with `git show cb785809:FOUNDER-FOLLOWUPS.md`), entry dated 2026-09-24.
**Why:** We send from `hello@send.declutrmail.com` through Resend (apps/api/src/notifications/templates/shell.tsx:24). On 2026-09-24, the return-path host `send.send.declutrmail.com` had no records, so SPF passed only for Amazon SES and not for our domain. DKIM and DMARC still pass. Adding the records gives mailbox providers a second aligned signal and keeps our email out of spam.
**How:**
1. Check first: `dig +short MX send.send.declutrmail.com`. If it already returns the SES host, skip to step 4.
2. Open your DNS host (Squarespace → Domains → declutrmail.com → DNS) and add the records exactly as Resend → Domains → declutrmail.com lists them. On 2026-09-24 they were:
   - Host `send.send`, type MX, priority `10`, value `feedback-smtp.us-east-1.amazonses.com`
   - Host `send.send`, type TXT, value `v=spf1 include:amazonses.com ~all`
3. In Resend, click Verify for the domain.
4. Send one product email to a Gmail inbox, then open "Show original".
**Verifies by:** "Show original" shows `spf=pass` with `smtp.mailfrom=…send.declutrmail.com`.
**Who:** Founder
**Status:** Open
