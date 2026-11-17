### 2026-11-17 — Unbind and delete the retired Razorpay credentials and webhook
**Source:** session — Razorpay rail removal (founder decision 4A), branch `chore/distill-retire-razorpay`
**Why:** No code reads a Razorpay credential any more, and `POST /api/webhooks/billing/razorpay` now returns 404. Live credentials with no consumer are exposure only. The deploy workflow no longer lists them, but `gcloud run deploy --update-secrets` merges, so the bindings stay on the running revisions until removed. A Secret Manager secret that a revision still references cannot be deleted safely: the next deploy would fail.
**Step 0, before this change is merged or deployed (blocking):** from 2026-07-25 to 2026-10-10 the old Razorpay checkout created a Razorpay subscription with `customer_notify: 1` and no expiry before any payment, so Razorpay emailed the payer a pay link. An unpaid one left no row in DeclutrMail's database, so the 2026-11-17 production check cannot see it. If one is paid after this change ships, the customer is charged, the webhook gets a 404 and no plan is granted. In the Razorpay dashboard (or API), list subscriptions in **any** status created since 2026-07-25 and cancel every one in `created` or `authenticated`. A PostHog query for `checkout_session_created` with `provider = razorpay` is a second witness. Only then merge.

**How:** in this order, after the change is deployed:
1. Razorpay dashboard, live mode → Account & Settings → Webhooks → disable, then delete, the webhook pointing at `https://api.declutrmail.com/api/webhooks/billing/razorpay`. Repeat in test mode for any dev-tunnel webhook. Then revoke the live and test API keys under Account & Settings → API keys.
2. Unbind the secrets from Cloud Run:
   - `gcloud run services update declutrmail-api --project=declutrmail-ai-prod --region=us-central1 --remove-secrets=RAZORPAY_KEY_ID,RAZORPAY_KEY_SECRET,RAZORPAY_WEBHOOK_SECRET`
   - `gcloud run services update declutrmail-worker --project=declutrmail-ai-prod --region=us-west1 --remove-secrets=RAZORPAY_KEY_ID,RAZORPAY_KEY_SECRET`
3. Delete the Secret Manager secrets `razorpay-key-id-prod`, `razorpay-key-secret-prod` and `razorpay-webhook-secret-prod` in `declutrmail-ai-prod`.
4. Delete the GitHub Actions secrets `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` at repo level, and the same names in the `sandbox` and `production` GitHub Environments (the deleted catalog-provisioning workflow was their only other reader).
5. Remove the `RAZORPAY_*` lines from local `.env.local` files.
**Verifies by:** `gcloud run services describe declutrmail-api --project=declutrmail-ai-prod --region=us-central1 --format=json | grep -c RAZORPAY` prints `0`, and the same for `declutrmail-worker` in `us-west1`; `gcloud secrets list --project=declutrmail-ai-prod --filter='name~razorpay'` prints nothing; `gh secret list | grep -i razorpay` prints nothing; the next production deploy succeeds.
**Status:** Open
