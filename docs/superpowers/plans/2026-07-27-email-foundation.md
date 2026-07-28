# Email Foundation Implementation Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert DeclutrMail's four transactional email templates to React Email multipart, and give every opt-out-able send a working Gmail one-click unsubscribe button.

**Architecture:** Templates become `.tsx` pure functions returning `{subject, text, html?}` in `apps/api/src/notifications/templates/`. The job payload and delivery port widen by two optional fields (`html`, `headers`). A signed-JWT unsubscribe token backs a new unauthenticated `POST /api/email/unsubscribe` route that Gmail calls directly. `packages/workers` stays React-free — it receives renderers as injected ports.

**Tech Stack:** NestJS (ESM, `@swc-node/register`) · React Email 4 · `jose` · Resend SDK 6 · BullMQ · Vitest · Drizzle

**Spec:** `docs/superpowers/specs/2026-07-27-resend-email-surface-design.md` (§4, §6, §10)

## Global Constraints

- **Privacy (D7, D228):** templates carry counts, dates, the user's own mailbox address, and DeclutrMail URLs — **never** message content, subjects, snippets, or third-party addresses.
- **Canonical verbs (D227):** any verb in copy is one of Keep · Archive · Unsubscribe · Later · Delete. Never the word "Screen" in user-facing copy.
- **Trust copy (D2.1):** the badge line is exactly `Full bodies fetched: 0`. Never "Bodies read: 0 forever."
- **Fail-closed:** `EmailService` must never pretend-send. A missing `RESEND_API_KEY` returns `{ok:false, reason:'disabled'}` and dead-letters on attempt 1.
- **Vitest include glob** is `src/**/*.spec.ts` today (`apps/api/vitest.config.ts`) — `.test.ts` and `.spec.tsx` are NOT collected. Task 2 widens it to include `.spec.tsx`; until that lands, any `.spec.tsx` silently never runs. `packages/workers` uses `*.test.ts` instead — check its own config before naming files there.
- **ESM import extensions:** intra-package imports use `.js` even when the source is `.ts`/`.tsx` (e.g. `import { x } from './foo.js'` for `foo.tsx`).
- **Commit types:** commitlint allows only `feat|fix|chore|docs|refactor|test|perf|security`. `build` is rejected. Subject ≤50 chars, D-ref in trailing parens.
- **Branch:** `feat/d162-react-email-templates` (already created).
- **No `--no-verify`.** If a hook fires, fix the cause.

## File Structure

| File                                                          | Responsibility                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------- |
| `apps/api/src/notifications/templates/shell.tsx`              | Branded layout + shared `<Footer>`; the only place brand chrome lives |
| `apps/api/src/notifications/templates/sync-complete.tsx`      | D6 completion email                                                   |
| `apps/api/src/notifications/templates/sync-reminder-24h.tsx`  | D6 24h nudge                                                          |
| `apps/api/src/notifications/templates/deletion-scheduled.tsx` | D232 notice                                                           |
| `apps/api/src/notifications/templates/deletion-receipt.tsx`   | D232 receipt                                                          |
| `apps/api/src/notifications/templates/index.ts`               | Barrel; re-exports `RenderedEmail`, `EMAIL_FROM`, every template      |
| `apps/api/src/notifications/unsubscribe-token.ts`             | Sign/verify the one-click token                                       |
| `apps/api/src/notifications/unsubscribe.controller.ts`        | Unauthenticated `POST`/`GET /api/email/unsubscribe`                   |
| `apps/api/src/notifications/email.service.ts`                 | **Modify** — accept `html` + `headers`                                |
| `packages/workers/src/email-send.worker.ts`                   | **Modify** — `html?` on job + port; header assembly per kind          |
| `apps/api/src/notifications/email-templates.ts`               | **Delete** at Task 5, after all callers move to the barrel            |

`email-templates.ts` is replaced rather than extended: it currently mixes the `EMAIL_FROM` constant, the `RenderedEmail` type, four templates, and a formatting helper in one file. Splitting per-template keeps each unit small enough to hold in context, which is the codebase's own convention for the notifications module.

---

### Task 1: React Email toolchain — ✅ DONE

Completed before this plan was written, because its outcome determined the plan's shape.

**Files:** `apps/api/package.json`, `apps/api/tsconfig.json`
**Commit:** `5108fea5`

**Produces:** `"jsx": "react-jsx"` in `apps/api/tsconfig.json`; `@react-email/components`, `@react-email/render`, `react`, `react-dom` as dependencies; `@types/react`, `@types/react-dom` as devDependencies.

**Findings that later tasks depend on:**

- Without `"jsx": "react-jsx"` the transform uses the classic runtime and every render throws `ReferenceError: React is not defined`.
- `@types/react` must NOT go in `compilerOptions.types` — that makes it a global type library and `tsc` fails with `TS2688` for the whole package.
- `.tsx` loads correctly under `@swc-node/register/esm-register`, which is what `apps/api` boots the API and worker with. Verified, not assumed.
- Full `apps/api` suite passes with the compiler option live: 1202 passed, 13 skipped.

---

### Task 2: Template shell

**Files:**

- Create: `apps/api/src/notifications/templates/shell.tsx`
- Test: `apps/api/src/notifications/templates/shell.spec.tsx` (`.tsx` — the test renders JSX)
- Modify: `apps/api/vitest.config.ts` (include glob)

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `interface RenderedEmail { subject: string; text: string; html?: string }`
  - `const EMAIL_FROM = 'DeclutrMail <hello@send.declutrmail.com>'`
  - `function formatCount(count: number, singular: string, plural: string): string`
  - `function Shell(props: { preview: string; children: ReactNode; footer: string }): ReactElement`
  - `async function renderShell(el: ReactElement): Promise<string>`

**Use `ReactElement`, never `JSX.Element`.** React 19's `@types/react` removed the global `JSX` namespace; `JSX.Element` fails with `TS2503: Cannot find namespace 'JSX'`. Verified against this workspace.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/notifications/templates/shell.spec.ts
import { describe, expect, it } from 'vitest';
import { EMAIL_FROM, formatCount, renderShell, Shell } from './shell.js';

describe('shell', () => {
  it('keeps the locked From header', () => {
    expect(EMAIL_FROM).toBe('DeclutrMail <hello@send.declutrmail.com>');
  });

  it('formats counts with en-US grouping and singular/plural', () => {
    expect(formatCount(1, 'message', 'messages')).toBe('1 message');
    expect(formatCount(24310, 'message', 'messages')).toBe('24,310 messages');
    expect(formatCount(0, 'message', 'messages')).toBe('0 messages');
  });

  it('renders children and footer into html', async () => {
    const html = await renderShell(
      <Shell preview="Preview line" footer="Footer line">
        <p>Body line</p>
      </Shell>,
    );
    expect(html).toContain('Body line');
    expect(html).toContain('Footer line');
    expect(html).toContain('Preview line');
  });
});
```

The file is `.spec.tsx` because it renders JSX. The current include glob only collects `.spec.ts`, so Step 3 widens it — without that, this test silently never runs.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/api exec vitest run src/notifications/templates/shell.spec.tsx`
Expected: FAIL — `Failed to resolve import "./shell.js"`

- [ ] **Step 3: Widen the vitest include glob**

```ts
// apps/api/vitest.config.ts — change the include line only
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
```

- [ ] **Step 4: Write the shell**

```tsx
// apps/api/src/notifications/templates/shell.tsx
import { Body, Container, Head, Hr, Html, Preview, Text } from '@react-email/components';
import { render } from '@react-email/render';
import type { ReactElement, ReactNode } from 'react';

/** Rendered email — what the EmailSendWorker job carries. */
export interface RenderedEmail {
  subject: string;
  text: string;
  /** Absent for the plain-text-locked kinds (D126 P3, D189). */
  html?: string;
}

/**
 * The locked From header (D162). Domain `send.declutrmail.com` is
 * verified in Resend; the display name keeps inbox rows scannable.
 */
export const EMAIL_FROM = 'DeclutrMail <hello@send.declutrmail.com>';

const font = '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

/**
 * Brand chrome lives here and nowhere else, so a copy or colour change
 * is one edit rather than one per template. Colours are inlined rather
 * than tokenised: email clients strip <style> blocks and CSS custom
 * properties, so `tokens.css` cannot reach this surface.
 */
export function Shell(props: {
  preview: string;
  children: ReactNode;
  footer: string;
}): ReactElement {
  return (
    <Html lang="en">
      <Head />
      <Preview>{props.preview}</Preview>
      <Body style={{ backgroundColor: '#fafafa', fontFamily: font, margin: 0, padding: '24px 0' }}>
        <Container
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #eaeaea',
            borderRadius: '8px',
            maxWidth: '520px',
            padding: '32px',
          }}
        >
          {props.children}
          <Hr style={{ borderColor: '#eaeaea', margin: '28px 0 16px' }} />
          <Text style={{ color: '#666666', fontSize: '12px', lineHeight: '18px', margin: 0 }}>
            {props.footer}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

/** `render()` is async in React Email 4 — every caller must await. */
export async function renderShell(el: ReactElement): Promise<string> {
  return render(el);
}

/** "1 message" / "24,310 messages" — en-US grouping, premium-calm. */
export function formatCount(count: number, singular: string, plural: string): string {
  const formatted = new Intl.NumberFormat('en-US').format(count);
  return `${formatted} ${count === 1 ? singular : plural}`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/api exec vitest run src/notifications/templates/shell.spec.tsx`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/notifications/templates/shell.tsx \
        apps/api/src/notifications/templates/shell.spec.tsx \
        apps/api/vitest.config.ts
git commit -m "feat(notifications): add the email template shell (D162)"
```

---

### Task 3: Convert `sync-complete` to multipart

Proves the pattern end-to-end on one template before the other three follow.

**Files:**

- Create: `apps/api/src/notifications/templates/sync-complete.tsx`
- Test: `apps/api/src/notifications/templates/sync-complete.spec.tsx`

**Interfaces:**

- Consumes: `Shell`, `renderShell`, `formatCount`, `RenderedEmail` from `./shell.js`.
- Produces: `async function syncCompleteEmail(input: { mailboxEmail: string; messageCount: number; appUrl: string }): Promise<RenderedEmail>`

**Note the signature change:** every template becomes `async` because `render()` returns a Promise. Task 6 updates all callers.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/api/src/notifications/templates/sync-complete.spec.tsx
import { describe, expect, it } from 'vitest';
import { syncCompleteEmail } from './sync-complete.js';

describe('sync-complete', () => {
  const input = {
    mailboxEmail: 'you@gmail.com',
    messageCount: 24310,
    appUrl: 'https://app.declutrmail.com',
  };

  it('renders subject, text and html', async () => {
    const email = await syncCompleteEmail(input);
    expect(email.subject).toBe('Your inbox is ready');
    expect(email.text).toContain('24,310 messages');
    expect(email.text).toContain('you@gmail.com');
    expect(email.html).toContain('24,310 messages');
    expect(email.html).toContain('https://app.declutrmail.com/triage');
  });

  it('carries no message content (D7)', async () => {
    const email = await syncCompleteEmail(input);
    // Counts, dates, the user's own address and DeclutrMail URLs only.
    expect(email.text).not.toMatch(/subject:/i);
    expect(email.html).not.toMatch(/snippet/i);
  });

  it('matches the snapshot', async () => {
    const email = await syncCompleteEmail(input);
    expect(email.text).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/api exec vitest run src/notifications/templates/sync-complete.spec.tsx`
Expected: FAIL — cannot resolve `./sync-complete.js`

- [ ] **Step 3: Write the template**

```tsx
// apps/api/src/notifications/templates/sync-complete.tsx
import { Button, Text } from '@react-email/components';

import { formatCount, renderShell, Shell, type RenderedEmail } from './shell.js';

export interface SyncCompleteEmailInput {
  /** The user's own connected mailbox address, e.g. "you@gmail.com". */
  mailboxEmail: string;
  /** Messages indexed by the initial sync (metadata only). */
  messageCount: number;
  /** Web app origin, e.g. "https://app.declutrmail.com". */
  appUrl: string;
}

const FOOTER = 'You received this because you connected this mailbox to DeclutrMail.';

/** D6 — sent when a mailbox's initial sync reaches `ready`. */
export async function syncCompleteEmail(input: SyncCompleteEmailInput): Promise<RenderedEmail> {
  const messages = formatCount(input.messageCount, 'message', 'messages');
  const triageUrl = `${input.appUrl}/triage`;

  const text = [
    `DeclutrMail finished indexing ${input.mailboxEmail}.`,
    '',
    `${messages} indexed — your senders are grouped and ready to`,
    'triage. The first pass usually takes a few minutes and clears',
    'the bulk of the noise.',
    '',
    `Jump back in: ${triageUrl}`,
    '(Still in setup? That link drops you right back where you left off.)',
    '',
    '— DeclutrMail',
    '',
    FOOTER,
  ].join('\n');

  const html = await renderShell(
    <Shell preview={`${messages} indexed and ready to triage`} footer={FOOTER}>
      <Text style={{ fontSize: '16px', lineHeight: '24px', margin: '0 0 16px' }}>
        DeclutrMail finished indexing <strong>{input.mailboxEmail}</strong>.
      </Text>
      <Text style={{ fontSize: '16px', lineHeight: '24px', margin: '0 0 24px' }}>
        {messages} indexed — your senders are grouped and ready to triage. The first pass usually
        takes a few minutes and clears the bulk of the noise.
      </Text>
      <Button
        href={triageUrl}
        style={{
          backgroundColor: '#000000',
          borderRadius: '6px',
          color: '#ffffff',
          display: 'inline-block',
          fontSize: '14px',
          fontWeight: 500,
          padding: '10px 20px',
          textDecoration: 'none',
        }}
      >
        Open Triage
      </Button>
    </Shell>,
  );

  return { subject: 'Your inbox is ready', text, html };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/api exec vitest run src/notifications/templates/sync-complete.spec.tsx`
Expected: PASS (3 tests, 1 snapshot written)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/notifications/templates/sync-complete.tsx \
        apps/api/src/notifications/templates/sync-complete.spec.tsx \
        apps/api/src/notifications/templates/__snapshots__/
git commit -m "feat(notifications): render sync-complete as multipart (D162)"
```

---

### Task 4: Convert the remaining three templates

**Files:**

- Create: `apps/api/src/notifications/templates/sync-reminder-24h.tsx`
- Create: `apps/api/src/notifications/templates/deletion-scheduled.tsx`
- Create: `apps/api/src/notifications/templates/deletion-receipt.tsx`
- Test: `apps/api/src/notifications/templates/deletion.spec.tsx`, `apps/api/src/notifications/templates/sync-reminder-24h.spec.tsx`

**Interfaces:**

- Consumes: `Shell`, `renderShell`, `RenderedEmail` from `./shell.js`.
- Produces:
  - `async function syncReminder24hEmail(input: { mailboxEmail: string; appUrl: string }): Promise<RenderedEmail>`
  - `async function deletionScheduledEmail(input: { scheduledFor: string; cancelUrl: string }): Promise<RenderedEmail>`
  - `async function deletionReceiptEmail(input: { deletedAt: string }): Promise<RenderedEmail>`

The exact plain-text bodies are preserved verbatim from the current `apps/api/src/notifications/email-templates.ts` lines 72–146 — copy them across unchanged so the existing snapshots in `apps/api/src/notifications/__snapshots__/email-templates.spec.ts.snap` still describe the text output. Only the `html` field is new.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/api/src/notifications/templates/deletion.spec.tsx
import { describe, expect, it } from 'vitest';
import { deletionReceiptEmail } from './deletion-receipt.js';
import { deletionScheduledEmail } from './deletion-scheduled.js';

describe('deletion emails', () => {
  it('scheduled carries the cancel url and the non-opt-out notice', async () => {
    const email = await deletionScheduledEmail({
      scheduledFor: 'June 18, 2026',
      cancelUrl: 'https://app.declutrmail.com/account/cancel-deletion?t=tok',
    });
    expect(email.subject).toBe('Your DeclutrMail deletion is scheduled');
    expect(email.text).toContain('June 18, 2026');
    expect(email.text).toContain('https://app.declutrmail.com/account/cancel-deletion?t=tok');
    expect(email.text).toContain('This is a required account notice; it cannot be turned off.');
    expect(email.html).toContain('cancel-deletion');
  });

  it('receipt states Gmail itself was untouched', async () => {
    const email = await deletionReceiptEmail({ deletedAt: 'June 18, 2026' });
    expect(email.subject).toBe('Your DeclutrMail data has been deleted');
    expect(email.text).toContain('Your Gmail account itself was never modified');
    expect(email.html).toContain('never modified');
  });
});
```

```tsx
// apps/api/src/notifications/templates/sync-reminder-24h.spec.tsx
import { describe, expect, it } from 'vitest';
import { syncReminder24hEmail } from './sync-reminder-24h.js';

describe('sync-reminder-24h', () => {
  it('points opt-out at settings', async () => {
    const email = await syncReminder24hEmail({
      mailboxEmail: 'you@gmail.com',
      appUrl: 'https://app.declutrmail.com',
    });
    expect(email.subject).toBe('Your inbox is still ready');
    expect(email.text).toContain('https://app.declutrmail.com/settings');
    expect(email.html).toContain('/triage');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @declutrmail/api exec vitest run src/notifications/templates/`
Expected: FAIL — cannot resolve the three new modules

- [ ] **Step 3: Write the three templates**

Follow Task 3's shape exactly: build the `text` array verbatim from the current `email-templates.ts`, then render an HTML twin through `Shell`. Footers per template:

- `sync-reminder-24h.tsx` → footer `You can turn off reminder emails at ${appUrl}/settings.`, preview `Five minutes of triage is usually enough.`, CTA button to `${appUrl}/triage`.
- `deletion-scheduled.tsx` → footer `This is a required account notice; it cannot be turned off.`, preview `Cancel any time before ${scheduledFor}.`, CTA button labelled `Cancel deletion` to `cancelUrl`.
- `deletion-receipt.tsx` → footer `This receipt is the last email you will receive from us.`, preview `Your DeclutrMail data has been deleted.`, **no CTA button** — there is nowhere left to send them.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @declutrmail/api exec vitest run src/notifications/templates/`
Expected: PASS (all template specs)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/notifications/templates/
git commit -m "feat(notifications): render remaining emails multipart (D162)"
```

---

### Task 5: Barrel + delete the old module

**Files:**

- Create: `apps/api/src/notifications/templates/index.ts`
- Modify: `apps/api/src/notifications/email.service.ts:6` (import path)
- Modify: `apps/api/src/worker.ts:126` (import path)
- Modify: `apps/api/src/notifications/sync-ready-email.trigger.ts:15` (import path)
- Modify: `apps/api/src/account/deletion.service.ts` (import path)
- Delete: `apps/api/src/notifications/email-templates.ts`
- Delete: `apps/api/src/notifications/email-templates.spec.ts` and its `__snapshots__` entry

**Interfaces:**

- Consumes: all five template modules.
- Produces: `apps/api/src/notifications/templates/index.js` re-exporting `EMAIL_FROM`, `RenderedEmail`, and all four template functions.

- [ ] **Step 1: Write the barrel**

```ts
// apps/api/src/notifications/templates/index.ts
export { EMAIL_FROM, formatCount, type RenderedEmail } from './shell.js';
export { syncCompleteEmail, type SyncCompleteEmailInput } from './sync-complete.js';
export { syncReminder24hEmail, type SyncReminderEmailInput } from './sync-reminder-24h.js';
export { deletionScheduledEmail, type DeletionScheduledEmailInput } from './deletion-scheduled.js';
export { deletionReceiptEmail, type DeletionReceiptEmailInput } from './deletion-receipt.js';
```

- [ ] **Step 2: Find every importer**

Run: `rg -n "email-templates" apps/api/src packages --glob '!*.snap'`
Expected: the four files listed above, plus the old spec.

- [ ] **Step 3: Repoint imports and delete the old module**

Change each `from './email-templates.js'` / `from './notifications/email-templates.js'` to the `templates/index.js` equivalent, then:

```bash
git rm apps/api/src/notifications/email-templates.ts \
       apps/api/src/notifications/email-templates.spec.ts
rm -rf apps/api/src/notifications/__snapshots__
```

- [ ] **Step 4: Await the now-async renderers**

Every call site becomes `await`. In `sync-ready-email.trigger.ts` the handler is already `async`. In `deletion.service.ts` the caller is already `async`. In `worker.ts:1741` the injected `renderReceiptEmail` port now returns a Promise — update the port's type in `packages/workers/src/deletion.worker.ts:92` to `(input: DeletionReceiptEmailInput) => Promise<RenderedEmail>` and `await` it at the call site.

- [ ] **Step 5: Verify typecheck and full suite**

Run: `pnpm --filter @declutrmail/api typecheck && pnpm --filter @declutrmail/workers typecheck`
Expected: no errors

Run: `pnpm --filter @declutrmail/api test && pnpm --filter @declutrmail/workers test`
Expected: PASS — 1202+ in api, all in workers

- [ ] **Step 6: Commit**

```bash
git add -A apps/api/src packages/workers/src
git commit -m "refactor(notifications): split templates per kind (D162)"
```

---

### Task 6: Widen the job + delivery contracts

**Files:**

- Modify: `packages/workers/src/email-send.worker.ts:66-99` (`EmailSendJobData`), `:113-133` (`EmailDeliveryOutcome`, `EmailDeliveryPort`)
- Modify: `apps/api/src/notifications/email.service.ts:75-134`
- Test: `packages/workers/src/email-send.worker.test.ts`, `apps/api/src/notifications/email.service.spec.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces:
  - `EmailSendJobData` gains `html?: string` and `headers?: Record<string, string>`
  - `EmailDeliveryPort.deliver(input: { to, subject, text, idempotencyKey, html?, headers? })`

Note `packages/workers` uses `*.test.ts`, not `*.spec.ts` — check its vitest config's include glob before naming new test files.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/workers/src/email-send.worker.test.ts
it('forwards html and headers to the delivery port', async () => {
  const delivered: unknown[] = [];
  const delivery = {
    deliver: async (input: unknown) => {
      delivered.push(input);
      return { ok: true as const, providerId: 'rsnd_2' };
    },
  };
  const worker = new EmailSendWorker({ db: fakeDb, delivery });

  await worker.processJob(
    {
      ...baseJob,
      html: '<p>hi</p>',
      headers: { 'List-Unsubscribe': '<https://example.com/u>' },
    },
    ctx,
  );

  expect(delivered[0]).toMatchObject({
    html: '<p>hi</p>',
    headers: { 'List-Unsubscribe': '<https://example.com/u>' },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/workers exec vitest run src/email-send.worker.test.ts -t "forwards html"`
Expected: FAIL — `html` not present on the delivered input

- [ ] **Step 3: Widen the types and pass the fields through**

In `email-send.worker.ts`, add to `EmailSendJobData`:

```ts
  /**
   * Pre-rendered HTML body. ABSENT for the plain-text-locked kinds —
   * D126 Part 3 ("Plain text only; no marketing chrome") and D189's
   * receipt. Optional rather than required so those kinds cannot be
   * forced to carry a body the plan forbids.
   */
  html?: string;
  /**
   * Extra provider headers — RFC 8058 List-Unsubscribe on opt-out-able
   * kinds. System notices (deletion) set none: there is nothing to
   * unsubscribe from.
   */
  headers?: Record<string, string>;
```

Then in `processJob`, forward them:

```ts
const delivered = await this.deps.delivery.deliver({
  to,
  subject: payload.subject,
  text: payload.text,
  idempotencyKey: payload.idempotencyKey,
  ...(payload.html === undefined ? {} : { html: payload.html }),
  ...(payload.headers === undefined ? {} : { headers: payload.headers }),
});
```

The conditional spreads are required: `tsconfig.base.json` sets `exactOptionalPropertyTypes: true`, so passing an explicit `undefined` to an optional property is a type error.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/workers exec vitest run src/email-send.worker.test.ts`
Expected: PASS

- [ ] **Step 5: Pass through to Resend**

In `email.service.ts`, widen `ResendLikeClient` and `deliver`:

```ts
export interface ResendLikeClient {
  emails: {
    send(
      payload: {
        from: string;
        to: string;
        subject: string;
        text: string;
        html?: string;
        headers?: Record<string, string>;
        replyTo?: string;
      },
      options?: { idempotencyKey?: string },
    ): Promise<{
      data: { id: string } | null;
      error: { message: string; statusCode: number | null; name: string } | null;
    }>;
  };
}
```

and in `deliver()`, build the payload with the same conditional-spread discipline. Add the Reply-To env gate here:

```ts
// Ships dormant: FOUNDER-FOLLOWUPS.md:1786 records that
// support@declutrmail.com .com delivery is still pending the
// domain-alias add. A bouncing Reply-To is worse than none, so the
// header appears only once the founder sets this variable.
const replyTo = process.env.EMAIL_REPLY_TO;
```

- [ ] **Step 6: Add the service test**

```ts
// append to apps/api/src/notifications/email.service.spec.ts
it('omits reply-to when EMAIL_REPLY_TO is unset', async () => {
  delete process.env.EMAIL_REPLY_TO;
  const sent: any[] = [];
  const svc = new EmailService(passThroughSuppression, {
    emails: { send: async (p: any) => (sent.push(p), { data: { id: 'x' }, error: null }) },
  });
  await svc.deliver({ to: 'a@b.com', subject: 's', text: 't', idempotencyKey: 'k' });
  expect(sent[0].replyTo).toBeUndefined();
});

it('sets reply-to when EMAIL_REPLY_TO is set', async () => {
  process.env.EMAIL_REPLY_TO = 'support@declutrmail.com';
  const sent: any[] = [];
  const svc = new EmailService(passThroughSuppression, {
    emails: { send: async (p: any) => (sent.push(p), { data: { id: 'x' }, error: null }) },
  });
  await svc.deliver({ to: 'a@b.com', subject: 's', text: 't', idempotencyKey: 'k' });
  expect(sent[0].replyTo).toBe('support@declutrmail.com');
  delete process.env.EMAIL_REPLY_TO;
});
```

- [ ] **Step 7: Run both suites**

Run: `pnpm --filter @declutrmail/api test && pnpm --filter @declutrmail/workers test`
Expected: PASS

- [ ] **Step 8: Document the env var**

Add to `.env.example`:

```
# Optional. When set, transactional email carries this Reply-To.
# Leave UNSET until support@declutrmail.com accepts mail on .com —
# a bouncing Reply-To is worse than none.
EMAIL_REPLY_TO=
```

- [ ] **Step 9: Commit**

```bash
git add packages/workers/src apps/api/src/notifications .env.example
git commit -m "feat(notifications): carry html and headers to Resend (D162)"
```

---

### Task 7: Unsubscribe token

**Files:**

- Create: `apps/api/src/notifications/unsubscribe-token.ts`
- Test: `apps/api/src/notifications/unsubscribe-token.spec.ts`

**Interfaces:**

- Consumes: `jose` (already a dependency), `EmailPrefs` from `@declutrmail/shared/contracts`.
- Produces:
  - `async function signUnsubscribeToken(input: { userId: string; category: keyof EmailPrefs }): Promise<string>`
  - `async function verifyUnsubscribeToken(token: string): Promise<{ userId: string; category: keyof EmailPrefs } | null>` — returns `null` for **every** failure mode, never throws.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/notifications/unsubscribe-token.spec.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { signUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe-token.js';

describe('unsubscribe token', () => {
  beforeAll(() => {
    process.env.UNSUBSCRIBE_TOKEN_SECRET = 'x'.repeat(32);
  });

  it('round-trips userId and category', async () => {
    const token = await signUnsubscribeToken({ userId: 'u-1', category: 'reminders' });
    expect(await verifyUnsubscribeToken(token)).toEqual({ userId: 'u-1', category: 'reminders' });
  });

  it('returns null for a tampered token', async () => {
    const token = await signUnsubscribeToken({ userId: 'u-1', category: 'reminders' });
    expect(await verifyUnsubscribeToken(`${token}x`)).toBeNull();
  });

  it('returns null for garbage rather than throwing', async () => {
    expect(await verifyUnsubscribeToken('not-a-jwt')).toBeNull();
    expect(await verifyUnsubscribeToken('')).toBeNull();
  });

  it('returns null for an unknown category', async () => {
    // A token minted for a key that is not an EmailPrefs key must not
    // be honoured — it would flip an arbitrary preference.
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(process.env.UNSUBSCRIBE_TOKEN_SECRET);
    const rogue = await new SignJWT({ userId: 'u-1', category: 'isAdmin' })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(secret);
    expect(await verifyUnsubscribeToken(rogue)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/api exec vitest run src/notifications/unsubscribe-token.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// apps/api/src/notifications/unsubscribe-token.ts
import { jwtVerify, SignJWT } from 'jose';

import { EmailPrefsSchema, type EmailPrefs } from '@declutrmail/shared/contracts';

/**
 * RFC 8058 one-click unsubscribe token (D165).
 *
 * Gmail POSTs the List-Unsubscribe URL with NO cookies, so the token is
 * the only credential. It is therefore: unguessable (HMAC over a
 * server secret), single-purpose (carries exactly userId + category),
 * and non-enumerable (verification failures are indistinguishable from
 * one another to the caller — see the controller's uniform 200).
 *
 * No expiry: an unsubscribe link in a two-year-old email must still
 * work. That is the point of the header, and a stale token can only
 * ever turn a preference OFF.
 */
const VALID_CATEGORIES = new Set(Object.keys(EmailPrefsSchema.shape));

function secret(): Uint8Array {
  const raw = process.env.UNSUBSCRIBE_TOKEN_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error('UNSUBSCRIBE_TOKEN_SECRET must be set and at least 32 characters.');
  }
  return new TextEncoder().encode(raw);
}

export async function signUnsubscribeToken(input: {
  userId: string;
  category: keyof EmailPrefs;
}): Promise<string> {
  return new SignJWT({ userId: input.userId, category: input.category })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .sign(secret());
}

/** Never throws — every failure is `null` so the caller stays uniform. */
export async function verifyUnsubscribeToken(
  token: string,
): Promise<{ userId: string; category: keyof EmailPrefs } | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    const userId = payload.userId;
    const category = payload.category;
    if (typeof userId !== 'string' || userId.length === 0) return null;
    if (typeof category !== 'string' || !VALID_CATEGORIES.has(category)) return null;
    return { userId, category: category as keyof EmailPrefs };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/api exec vitest run src/notifications/unsubscribe-token.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Document the secret**

Add to `.env.example`:

```
# HMAC secret for RFC 8058 one-click unsubscribe tokens. >=32 chars.
# Rotating it invalidates unsubscribe links in already-delivered mail.
UNSUBSCRIBE_TOKEN_SECRET=
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/notifications/unsubscribe-token.ts \
        apps/api/src/notifications/unsubscribe-token.spec.ts .env.example
git commit -m "feat(notifications): sign one-click unsubscribe tokens (D165)"
```

---

### Task 8: Unsubscribe endpoint

**Files:**

- Create: `apps/api/src/notifications/unsubscribe.controller.ts`
- Test: `apps/api/src/notifications/unsubscribe.controller.spec.ts`
- Modify: `apps/api/src/notifications/notifications.module.ts` (register the controller)
- Modify: the auth exemption list — find it with `rg -n "webhooks/resend" apps/api/src --glob '!*.spec.ts'` and add `email/unsubscribe` the same way the Resend webhook is exempted.

**Interfaces:**

- Consumes: `verifyUnsubscribeToken`, `EmailPrefsSchema`, Drizzle `users`.
- Produces: `POST /api/email/unsubscribe` and `GET /api/email/unsubscribe`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/notifications/unsubscribe.controller.spec.ts
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { UnsubscribeController } from './unsubscribe.controller.js';
import { signUnsubscribeToken } from './unsubscribe-token.js';

describe('UnsubscribeController', () => {
  beforeAll(() => {
    process.env.UNSUBSCRIBE_TOKEN_SECRET = 'y'.repeat(32);
  });

  function build() {
    const updates: unknown[] = [];
    const db = {
      update: () => ({ set: (v: unknown) => ({ where: async () => void updates.push(v) }) }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [{ preferences: { emailPrefs: {} } }] }),
        }),
      }),
    };
    return { controller: new UnsubscribeController(db as never), updates };
  }

  it('flips the category off for a valid token', async () => {
    const { controller, updates } = build();
    const token = await signUnsubscribeToken({ userId: 'u-1', category: 'reminders' });
    const res = await controller.unsubscribe(token);
    expect(res.status).toBe('ok');
    expect(JSON.stringify(updates)).toContain('"reminders":false');
  });

  it('returns 200 for an invalid token and writes nothing', async () => {
    const { controller, updates } = build();
    const res = await controller.unsubscribe('garbage');
    expect(res.status).toBe('ok');
    expect(updates).toHaveLength(0);
  });

  it('returns 200 for a missing token and writes nothing', async () => {
    const { controller, updates } = build();
    const res = await controller.unsubscribe(undefined);
    expect(res.status).toBe('ok');
    expect(updates).toHaveLength(0);
  });

  it('GET never mutates, even with a perfectly valid token', async () => {
    const { controller, updates } = build();
    const token = await signUnsubscribeToken({ userId: 'u-1', category: 'reminders' });
    const html = await controller.confirmPage(token);
    // Link prefetchers (Outlook Safe Links, malware scanners) issue this
    // GET without any human involved. If it mutated, a scanner would
    // unsubscribe users from mail they never opened.
    expect(updates).toHaveLength(0);
    expect(html).toContain('<form method="POST"');
    expect(html).toContain('Unsubscribe');
  });

  it('GET escapes the token into the form action', async () => {
    const { controller } = build();
    const html = await controller.confirmPage('a"><script>alert(1)</script>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&quot;');
  });
});
```

Two security properties are under test here, both deliberate:

1. **Uniform `status: 'ok'`** across valid, invalid, and missing tokens. A distinguishable error would let an attacker probe which tokens — and therefore which users — exist.
2. **GET mutates nothing.** Mail clients and corporate security products prefetch links in email. A mutating GET would let a scanner silently unsubscribe a user before they ever opened the message, with no signal to anyone about why their notifications stopped.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/api exec vitest run src/notifications/unsubscribe.controller.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the controller**

```ts
// apps/api/src/notifications/unsubscribe.controller.ts
import { Body, Controller, Get, Header, Inject, Logger, Post, Query } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { users } from '@declutrmail/db';
import { parseEmailPrefs } from '@declutrmail/shared/contracts';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { verifyUnsubscribeToken } from './unsubscribe-token.js';

/**
 * The token is echoed into a form action, so it must not be able to
 * break out of the attribute. Tokens are base64url JWTs and contain
 * none of these characters today — this is defence against a future
 * token format, not a live hole.
 */
function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * RFC 8058 one-click unsubscribe (D165).
 *
 * UNAUTHENTICATED by necessity — Gmail POSTs this URL with no cookies
 * and no user agent we control. The signed token is the only
 * credential.
 *
 * Every response is an identical 200 regardless of token validity. A
 * 4xx would turn this endpoint into an oracle for which tokens (and
 * therefore which users) exist. The only observable effect of a valid
 * token is that one preference flips OFF — never on, never anything
 * else.
 *
 * ONLY POST MUTATES. The GET renders a confirmation page and touches
 * nothing. This is not REST pedantry: mail clients and corporate
 * security products PREFETCH links in email (Outlook Safe Links,
 * malware scanners, proxy warmers). A GET that unsubscribed would let
 * a scanner silently opt users out of mail they never opened, and the
 * user would have no idea why their notifications stopped.
 */
@Controller('email/unsubscribe')
export class UnsubscribeController {
  private readonly logger = new Logger(UnsubscribeController.name);

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /** The mutating route. Gmail's one-click POST lands here. */
  @Post()
  async unsubscribe(
    @Query('t') queryToken?: string,
    @Body() _body?: unknown,
  ): Promise<{ status: 'ok' }> {
    await this.apply(queryToken);
    return { status: 'ok' };
  }

  /**
   * READ-ONLY. Backs the footer link a human clicks: renders a page
   * whose button POSTs the same token. Prefetchers hit this and change
   * nothing.
   */
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async confirmPage(@Query('t') queryToken?: string): Promise<string> {
    // Deliberately does NOT verify the token: a verification result
    // here would be an enumeration oracle, and there is nothing to
    // protect — the page mutates nothing. An invalid token simply
    // yields a POST that no-ops.
    const token = queryToken ?? '';
    return [
      '<!doctype html><html lang="en"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<title>Unsubscribe · DeclutrMail</title></head>',
      '<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;',
      'max-width:420px;margin:80px auto;padding:0 24px;color:#111">',
      '<h1 style="font-size:20px;margin:0 0 12px">Turn off these emails?</h1>',
      '<p style="color:#666;font-size:14px;line-height:20px;margin:0 0 24px">',
      'You will still receive required account notices, such as billing',
      'and account deletion.</p>',
      `<form method="POST" action="/api/email/unsubscribe?t=${escapeHtmlAttr(token)}">`,
      '<button type="submit" style="background:#000;color:#fff;border:0;',
      'border-radius:6px;padding:10px 20px;font-size:14px;cursor:pointer">',
      'Unsubscribe</button></form></body></html>',
    ].join('');
  }

  private async apply(token: string | undefined): Promise<void> {
    if (!token) {
      this.logger.log('email.unsubscribe.no_token');
      return;
    }
    const claims = await verifyUnsubscribeToken(token);
    if (!claims) {
      this.logger.warn('email.unsubscribe.invalid_token');
      return;
    }
    const [row] = await this.db
      .select({ preferences: users.preferences })
      .from(users)
      .where(eq(users.id, claims.userId))
      .limit(1);
    if (!row) {
      this.logger.log('email.unsubscribe.user_gone');
      return;
    }
    const current = parseEmailPrefs(row.preferences);
    const base = (row.preferences ?? {}) as Record<string, unknown>;
    await this.db
      .update(users)
      .set({
        preferences: { ...base, emailPrefs: { ...current, [claims.category]: false } },
      })
      .where(eq(users.id, claims.userId));
    // Never log the address or the token — category + outcome only (D7).
    this.logger.log(`email.unsubscribe.applied category=${claims.category}`);
  }
}
```

- [ ] **Step 4: Register and exempt from auth**

Add `UnsubscribeController` to `controllers` in `apps/api/src/notifications/notifications.module.ts`, then add the route to the same auth-exemption mechanism the Resend webhook uses. Confirm the exemption is real:

Run: `rg -n "webhooks/resend|AUTH_EXEMPT|isPublic|@Public" apps/api/src --glob '!*.spec.ts' | head -20`

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/api exec vitest run src/notifications/unsubscribe.controller.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/notifications
git commit -m "feat(notifications): add one-click unsubscribe route (D165)"
```

---

### Task 9: Attach List-Unsubscribe headers

**Files:**

- Modify: `apps/api/src/notifications/sync-ready-email.trigger.ts:80-104`
- Create: `apps/api/src/notifications/unsubscribe-headers.ts`
- Test: `apps/api/src/notifications/unsubscribe-headers.spec.ts`

**Interfaces:**

- Consumes: `signUnsubscribeToken`.
- Produces: `async function unsubscribeHeaders(input: { userId: string; category: keyof EmailPrefs; apiUrl: string }): Promise<Record<string, string>>`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/notifications/unsubscribe-headers.spec.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { unsubscribeHeaders } from './unsubscribe-headers.js';

describe('unsubscribeHeaders', () => {
  beforeAll(() => {
    process.env.UNSUBSCRIBE_TOKEN_SECRET = 'z'.repeat(32);
  });

  it('emits both RFC 8058 headers', async () => {
    const headers = await unsubscribeHeaders({
      userId: 'u-1',
      category: 'reminders',
      apiUrl: 'https://api.declutrmail.com',
    });
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(headers['List-Unsubscribe']).toMatch(
      /^<https:\/\/api\.declutrmail\.com\/api\/email\/unsubscribe\?t=.+>$/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/api exec vitest run src/notifications/unsubscribe-headers.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// apps/api/src/notifications/unsubscribe-headers.ts
import type { EmailPrefs } from '@declutrmail/shared/contracts';

import { signUnsubscribeToken } from './unsubscribe-token.js';

/**
 * RFC 8058 headers for one opt-out-able send (D165).
 *
 * Both headers are required for Gmail to render its native unsubscribe
 * control: the URL alone yields a mailto-style fallback at best.
 * `List-Unsubscribe-Post` is what promises the endpoint accepts a POST
 * with no user interaction.
 *
 * SYSTEM kinds (deletion-scheduled, deletion-receipt) must NOT call
 * this — there is nothing to unsubscribe from, and offering the control
 * on a required account notice is a lie.
 */
export async function unsubscribeHeaders(input: {
  userId: string;
  category: keyof EmailPrefs;
  apiUrl: string;
}): Promise<Record<string, string>> {
  const token = await signUnsubscribeToken({
    userId: input.userId,
    category: input.category,
  });
  const url = `${input.apiUrl.replace(/\/$/, '')}/api/email/unsubscribe?t=${encodeURIComponent(token)}`;
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
```

- [ ] **Step 4: Attach to both sync emails**

In `sync-ready-email.trigger.ts`, the deps gain `apiUrl: string` (sourced from the same env the outbox router already reads for `appUrl` — check `apps/api/src/worker.ts` for how `WEB_URL` is passed and mirror it with `API_URL`). Then each `enqueueEmailSend` call gains:

```ts
      headers: await unsubscribeHeaders({
        userId: mailbox.userId,
        category: 'syncComplete', // 'reminders' for the 24h job
        apiUrl: deps.apiUrl,
      }),
```

- [ ] **Step 5: Assert the trigger sets them**

```ts
// append to apps/api/src/notifications/sync-ready-email.trigger.spec.ts
it('attaches RFC 8058 headers to both sync emails', async () => {
  // ...existing harness setup...
  expect(enqueued[0].headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  expect(enqueued[1].headers['List-Unsubscribe']).toContain('/api/email/unsubscribe?t=');
});
```

- [ ] **Step 6: Run the suite**

Run: `pnpm --filter @declutrmail/api test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/notifications
git commit -m "feat(notifications): set List-Unsubscribe on opt-outs (D165)"
```

---

### Task 10: Delivery telemetry

**Files:**

- Create: `apps/api/src/observability/product-analytics.ts`
- Test: `apps/api/src/observability/product-analytics.spec.ts`
- Modify: `apps/api/src/webhooks/resend/resend-webhook.controller.ts:148-154`
- Modify: `apps/api/package.json` (add `posthog-node`)

**Interfaces:**

- Consumes: `posthog-node`.
- Produces: `function captureServerEvent(event: string, properties: Record<string, unknown>): void` — fire-and-forget, never throws, no-ops without a key.

**Context:** `apps/api` has **no** PostHog client today — `posthog-js` exists only in `apps/web`. This task stands one up.

- [ ] **Step 1: Add the dependency**

```bash
pnpm --filter @declutrmail/api add posthog-node
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/api/src/observability/product-analytics.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { __setClientForTest, captureServerEvent } from './product-analytics.js';

describe('captureServerEvent', () => {
  it('no-ops without a configured client', () => {
    __setClientForTest(null);
    expect(() => captureServerEvent('email.delivered', { kind: 'sync-complete' })).not.toThrow();
  });

  it('forwards event and properties when configured', () => {
    const capture = vi.fn();
    __setClientForTest({ capture } as never);
    captureServerEvent('email.delivered', { kind: 'sync-complete' });
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ event: 'email.delivered' }));
  });

  it('swallows client errors — analytics must never break a request', () => {
    __setClientForTest({
      capture: () => {
        throw new Error('posthog down');
      },
    } as never);
    expect(() => captureServerEvent('email.delivered', {})).not.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/api exec vitest run src/observability/product-analytics.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement**

```ts
// apps/api/src/observability/product-analytics.ts
import { PostHog } from 'posthog-node';

/**
 * Server-side product analytics (D159, D126 Part 1).
 *
 * Fail-OPEN, unlike EmailService: a telemetry outage must never take
 * down a webhook or a request path. Every failure is swallowed after a
 * console warning.
 *
 * Privacy (D7): callers pass counts, kinds and outcomes. Never a
 * recipient address, never message content. The `distinctId` is the
 * internal user id where one is known, never an email address.
 */
let client: PostHog | null = null;
let initialised = false;

function resolve(): PostHog | null {
  if (initialised) return client;
  initialised = true;
  const key = process.env.POSTHOG_API_KEY;
  if (!key) {
    console.warn(JSON.stringify({ level: 'warn', kind: 'analytics.disabled_no_key' }));
    return (client = null);
  }
  client = new PostHog(key, {
    host: process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com',
    flushAt: 1,
    flushInterval: 0,
  });
  return client;
}

/** Test seam — bypasses env resolution. */
export function __setClientForTest(next: PostHog | null): void {
  client = next;
  initialised = true;
}

export function captureServerEvent(
  event: string,
  properties: Record<string, unknown>,
  distinctId = 'server',
): void {
  try {
    resolve()?.capture({ distinctId, event, properties });
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        kind: 'analytics.capture_failed',
        event,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/** Flush on shutdown so short-lived processes don't drop events. */
export async function shutdownAnalytics(): Promise<void> {
  try {
    await client?.shutdown();
  } catch {
    // Shutdown failures are not worth surfacing.
  }
}
```

- [ ] **Step 5: Capture delivery in the webhook**

In `resend-webhook.controller.ts`, replace the ignore branch:

```ts
const reason = SUPPRESSING_EVENTS[event.type];
if (!reason) {
  // Deliveries we don't suppress on are still worth counting —
  // D126 Part 1 wants delivery visibility. No open beacon: opens
  // are deliberately NOT tracked (founder decision 2026-07-27).
  if (event.type === 'email.delivered') {
    captureServerEvent('email.delivered', { emailType: event.type });
  }
  this.logger.log(`resend.webhook.ignored type=${event.type}`);
  return { status: 'ignored' };
}
```

Also capture on the suppressing path with `captureServerEvent('email.bounced', { reason })`.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/api exec vitest run src/observability src/webhooks/resend`
Expected: PASS

- [ ] **Step 7: Document env**

Add to `.env.example`:

```
# Server-side PostHog (D126 Part 1 delivery metrics). Unset = disabled.
POSTHOG_API_KEY=
POSTHOG_HOST=https://us.i.posthog.com
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/observability apps/api/src/webhooks/resend \
        apps/api/package.json pnpm-lock.yaml .env.example
git commit -m "feat(observability): count email delivery outcomes (D159)"
```

---

### Task 11: Full verification + smoke

- [ ] **Step 1: Whole-repo gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all pass

- [ ] **Step 2: Real delivery smoke**

Run: `pnpm --filter @declutrmail/api email-smoke`
Expected: a real message arrives at the founder's address.

- [ ] **Step 3: Verify the Gmail unsubscribe control**

In the received message, confirm Gmail renders its native **Unsubscribe** link beside the sender name. Click it. Then confirm the preference actually flipped:

```bash
psql "$DATABASE_URL" -c "SELECT preferences->'emailPrefs' FROM users WHERE email='chintan.a.thakkar@gmail.com';"
```

Expected: the clicked category reads `false`.

- [ ] **Step 4: Verify the plain-text alternative**

View the same message as plain text (Gmail: ⋮ → Show original, or a text-only client). Confirm the text body reads as written prose, not a tag-stripped approximation.

- [ ] **Step 5: Prove a link prefetch cannot unsubscribe anyone**

Mint a valid token, `curl` the GET as a scanner would, then confirm the preference is untouched:

```bash
curl -s "http://localhost:4000/api/email/unsubscribe?t=$TOKEN" > /dev/null
psql "$DATABASE_URL" -c "SELECT preferences->'emailPrefs' FROM users WHERE id='$USER_ID';"
```

Expected: unchanged. Then POST the same token and confirm it flips. If the GET mutated, every mail scanner on the internet is an unsubscribe button.

- [ ] **Step 6: Confirm system notices carry no unsubscribe control**

Trigger a `deletion-scheduled` email in dev and confirm **no** `List-Unsubscribe` header is present — a required account notice must not offer an opt-out it will not honour.

- [ ] **Step 7: Open the PR**

```bash
git push -u origin feat/d162-react-email-templates
gh pr create --title "feat(notifications): React Email templates + one-click unsubscribe (D162, D165)" --body "Closes D162
Closes D165

See docs/superpowers/specs/2026-07-27-resend-email-surface-design.md §4, §6, §10.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Definition of done (CLAUDE.md §8)

- `pnpm typecheck`, `pnpm lint`, `pnpm test` all green
- Real delivery smoked; Gmail's native unsubscribe control verified working end-to-end, not merely that the header is present
- Plain-text alternative read in a text-only client
- System notices confirmed to carry no unsubscribe header
- `Closes D162` / `Closes D165` in the PR body
- No gate agent has unresolved blocking comments (`design-system-agent` is **not** triggered — no `apps/web` changes in this plan)
