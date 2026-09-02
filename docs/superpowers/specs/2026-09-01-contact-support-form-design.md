# Contact-support form — design

**Date:** 2026-09-01
**Status:** Approved (design); implementation plan pending
**Tier:** 2 (new feature/copy — no D-number required per CLAUDE.md §2.0)
**Privacy posture:** unchanged — no Gmail data touched; see §6

---

## 1. Why

`/contact` (the public marketing page) is deliberately mailto-only —
its own header comment says "Deliberately NO contact form — there is
no backend for one." That was a correct call for a pre-launch site
with no backend to build one against. DeclutrMail now has a logged-in
product surface (Settings) and an existing Resend-backed transactional
email pipeline; a signed-in user asking for help currently has to leave
the app and compose a raw email by hand.

This spec adds one in-app path: a "Contact support" form on
`/settings/help` that sends one email to `support@declutrmail.com`,
Reply-To set to the submitting user, via the existing `EmailService`.

## 2. Scope decisions (locked via user Q&A this session)

| Question   | Decision                                                          | Why                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audience   | Logged-in users only                                              | Smallest scope, highest signal (real customers vs. prospects). Public/unauthed form is a separate future decision with a different threat model (spam).                                           |
| Mechanism  | Email `support@` only, no DB row                                  | Matches the existing `EmailService` infra exactly; no admin UI exists to consume a ticket table yet, so persisting one would be dead weight.                                                      |
| Attachment | None — message only                                               | The existing diagnostic bundle (`ActivitySupportBundleService`) stays a separate, already-shipped "download and attach manually" flow. Multipart/size-limit handling is real scope not asked for. |
| Placement  | Inside existing `/settings/help` page, under the product glossary | No new nav entry, no new route. `/settings/help` is already the "Help & glossary" settings section.                                                                                               |

Explicitly not built: public/unauthed contact form, persisted support-request table, bundle attachment upload, category/topic dropdown, new settings page or nav entry.

## 3. What exists today (infra this reuses)

- `EmailService.deliver({to, subject, text, idempotencyKey, html?, headers?})` (`apps/api/src/notifications/email.service.ts`) — thin Resend wrapper. Fails closed (typed `disabled` outcome) when `RESEND_API_KEY` is unset; checks `EmailSuppressionService` before sending; classifies provider errors as retryable/permanent. This is the seam every transactional email already goes through.
- The BullMQ `email-send` queue / `EmailSendWorker` (D162, D225) — the pipeline every _other_ email uses. It resolves its recipient **from a `userId`** and applies D165 opt-out prefs, the unsubscribe-header contract, and "did the user return" skip logic. All of that is designed for mail sent _to_ a user. It does not fit here: the recipient is fixed (`support@`) and the user is the _sender_, not the recipient. Forcing this feature through that queue would be the wrong abstraction for the sake of reuse.
- `ProductFeedbackController` / `.service.ts` / `.module.ts` (`apps/api/src/product-feedback/`) — the closest existing precedent for "authed user submits free text via a simple POST": `JwtGuard` + `CsrfGuard` + `@RateLimit('default')`, Zod-validated body via a `.strict()` schema in `@declutrmail/shared/contracts`, thin controller delegating to a service.
- `UsersService.findById(userId)` (`apps/api/src/users/users.service.ts`) — resolves the full user row (including email) from a `userId`. `SessionPrincipal` (what `JwtGuard` populates) only carries `{userId, workspaceId, sessionId, jti}` — no email — so the service needs this lookup to know who to Reply-To.
- `WaitlistForm` (`apps/web/src/features/marketing/pricing/waitlist-form.tsx`) — the house pattern for a small form: `idle → submitting → confirmed | error` state machine, raw `<input>`/`<button>` styled inline with `tokens` (no shared `Input`/`Textarea` component exists in `packages/shared` — confirmed by search, none exists), error state keeps the typed value.

## 4. Backend design

### 4.1 Contract — `packages/shared/src/contracts/support-request.ts`

```ts
export const SupportRequestSchema = z
  .object({
    subject: z.string().trim().min(1).max(150),
    message: z.string().trim().min(10).max(5000),
  })
  .strict();

export type SupportRequestPayload = z.infer<typeof SupportRequestSchema>;

export interface SupportRequestResult {
  submittedAt: string;
}
```

### 4.2 `EmailService.deliver()` — one additive parameter

Today `deliver()` pulls Reply-To only from `process.env.EMAIL_REPLY_TO`
— a single fixed value meant for the founder's inbox on outbound
transactional mail _to_ users. This feature needs the Reply-To to be
the _submitting user's_ address so support can hit Reply and land in
their inbox. Add an optional per-call override:

```ts
async deliver(input: {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
  html?: string;
  headers?: Record<string, string>;
  replyTo?: string;          // NEW
}): Promise<EmailDeliveryOutcome> {
  ...
  const replyTo = input.replyTo ?? process.env.EMAIL_REPLY_TO;
  ...
}
```

Every existing call site (8, none passing `replyTo` today) is
unaffected — this is a pure addition, not a behavior change.

### 4.3 New module — `apps/api/src/support/`

- **`support-request.service.ts`** — `submit(principal, payload)`:
  1. `UsersService.findById(principal.userId)` → user row (email).
  2. Compose `subject = "Support request: " + payload.subject"`, and a
     plain-text body: the user's message, then a footer with
     `userId`, `workspaceId`, the user's email, and an ISO timestamp
     (for support triage — never message/Gmail content, just account
     identifiers already visible to the user themselves).
  3. `emailService.deliver({ to: 'support@declutrmail.com', replyTo: user.email, subject, text, idempotencyKey: crypto.randomUUID() })`.
  4. `ok: true` → return `{ submittedAt: new Date().toISOString() }`.
     `ok: false` (disabled / suppressed / provider error) → throw
     `ServiceUnavailableException`. Never report success on a send
     that didn't happen — ties to CLAUDE.md's "a claim is only as true
     as what backs it" rule.

- **`support-request.controller.ts`**:

  ```ts
  @Controller('support-request')
  @UseGuards(JwtGuard)
  export class SupportRequestController {
    @Post()
    @UseGuards(CsrfGuard)
    @RateLimit({ bucket: 'default', limit: 5, windowSec: 300 })
    async submit(@CurrentUser() principal, @Body() body: unknown) { ... }
  }
  ```

  Account-scoped, not mailbox-scoped — no `CurrentMailboxGuard`
  (matches `account.controller.ts`'s pattern for account-level
  mutations like deletion, not `product-feedback`'s mailbox-scoped
  one). Rate limit matches the account-deletion endpoints' bucket
  (5 per 5 min) — tight enough to block abuse of an authed mutation
  that sends real email, loose enough for a genuine retry.

- **`support-request.module.ts`** — imports `NotificationsModule`
  (for `EmailService`) and `UsersModule`.

### 4.4 Tests

- `support-request.controller.spec.ts` + `.service.spec.ts`, mirroring
  `product-feedback`'s mocking style: happy path (`deliver` called
  with the right `to`/`replyTo`/`subject`/`text`), validation failure
  (400 on empty/oversized fields), `deliver` returning each `ok:false`
  reason (503, not a silent 200).
- One added case in `email.service.spec.ts` asserting `replyTo` is
  forwarded to the Resend client when passed, and falls back to
  `EMAIL_REPLY_TO` when omitted (regression guard for existing
  callers).

## 5. Frontend design

- **`apps/web/src/lib/api/support-request.ts`** — `postSupportRequest(payload)`, thin `apiPost` wrapper, mirrors `lib/api/product-feedback.ts`.
- **`apps/web/src/features/help/contact-support-form.tsx`** — subject `<input>` + message `<textarea>`, `idle → submitting → confirmed | error`, styled inline with `tokens` (mirrors `WaitlistForm`). Client-side length checks match the shared Zod bounds. On `error`: keep the typed subject/message (never discard user input on failure), show inline text pointing to `support@declutrmail.com` as a fallback.
- **`apps/web/src/app/(app)/settings/help/page.tsx`** — renders `<ContactSupportForm />` beneath `<ProductGlossary />`. No new route, no `SettingsScreen` nav change (the existing "Help & glossary" `LinkCard` already points here).
- **Tests** — `contact-support-form.test.tsx`: renders, client-side validation rejects too-short message, submit → success shows confirmation + clears form, submit → error keeps typed text and shows fallback copy.

## 6. Privacy posture (Tier 1 check)

No Gmail data is read, fetched, or transmitted by this feature — the
email body is entirely user-authored text (subject + message they
typed) plus account identifiers the user can already see themselves
(their own email, workspace id). D7/D228's no-body-storage invariant
governs Gmail _message_ content; it does not apply here. No new gate
gets triggered structurally (`privacy-auditor` scopes to
`{gmail,messages,senders}` paths), and there is no Tier-1 concern to
flag to the founder.

## 7. Gate network

Touches `apps/api/**` and `apps/web/**` → per CLAUDE.md §7,
`architecture-guardian` and `design-system-agent` are must-pass gates,
run before recommending merge.

## 8. Definition of done

- `pnpm typecheck` / `pnpm lint` / `pnpm test` (affected packages) pass.
- Negative control: `email.service.spec.ts`'s new `replyTo` assertion
  fails against the pre-change `deliver()` (proves the test isn't
  vacuous).
- Local smoke via D206 dev test-login: open `/settings/help`, submit a
  message, confirm success state renders; force `RESEND_API_KEY`
  unset (or a `deliver()` throw) and confirm the error state renders
  and preserves typed text rather than a silent/false success.
- `architecture-guardian` + `design-system-agent` run with no
  unresolved `[BLOCKING]` findings.
