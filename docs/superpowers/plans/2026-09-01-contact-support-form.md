# Contact-support form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an in-app "Contact support" form on `/settings/help` that emails `support@declutrmail.com` (Reply-To = the submitting user) via the existing Resend pipeline — no ticket persistence, no attachment.

**Architecture:** A shared Zod contract; a NestJS `support` module (controller + service, account-scoped, no mailbox guard) that calls `EmailService.deliver()` directly (not the BullMQ `email-send` queue, which is built for mail _to_ users); a small React form mirroring the existing `WaitlistForm` state-machine pattern, mounted under the existing product glossary.

**Tech Stack:** NestJS, Zod, Drizzle (read-only `UsersService.findById`), Resend (via `EmailService`), Next.js/React, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-01-contact-support-form-design.md`

## Global Constraints

- Logged-in users only — no public/unauthed form (spec §2).
- Email `support@declutrmail.com` only — no `support_requests` DB table (spec §2).
- No attachment / diagnostic-bundle upload (spec §2).
- Lives inside the existing `/settings/help` page — no new route, no new Settings nav entry (spec §2).
- Send via `EmailService.deliver()` directly and synchronously — never enqueue onto the `email-send` BullMQ queue (spec §3: that pipeline resolves its recipient from a `userId` and applies D165 opt-out/suppression logic built for mail _to_ a user; here the recipient is fixed and the user is the sender).
- `EmailService.deliver()`'s existing 8 call sites must keep behaving identically — the new `replyTo` param is additive only (spec §4.2).
- No shared `Input`/`Textarea` component exists in `packages/shared` — style raw elements inline with `tokens`, matching `WaitlistForm` (spec §3, §5).
- Reuse the already-registered `BAD_REQUEST` / `SERVICE_UNAVAILABLE` error codes from `packages/shared/src/contracts/error-codes.ts` — do not add new registry entries for this feature.
- This is a Tier 2 feature per `CLAUDE.md` §2.0 — no D-number, no plan citation required.

---

### Task 1: Shared contract — `SupportRequestSchema`

**Files:**

- Create: `packages/shared/src/contracts/support-request.ts`
- Create: `packages/shared/src/contracts/support-request.test.ts`
- Modify: `packages/shared/src/contracts/index.ts`

**Interfaces:**

- Produces: `SupportRequestSchema` (Zod, `.strict()`), `SupportRequestPayload` (`{ subject: string; message: string }`), `SupportRequestResult` (`{ submittedAt: string }`) — every later backend/frontend task imports these from `@declutrmail/shared/contracts`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/contracts/support-request.test.ts
import { describe, expect, it } from 'vitest';

import { SupportRequestSchema } from './support-request';

describe('SupportRequestSchema', () => {
  it('accepts a bounded subject + message', () => {
    const value = {
      subject: 'Cannot connect Gmail',
      message: 'I keep hitting an error at step 2.',
    };
    expect(SupportRequestSchema.parse(value)).toEqual(value);
  });

  it('trims surrounding whitespace', () => {
    const parsed = SupportRequestSchema.parse({
      subject: '  Billing question  ',
      message: '  Why was I charged twice this month?  ',
    });
    expect(parsed).toEqual({
      subject: 'Billing question',
      message: 'Why was I charged twice this month?',
    });
  });

  it('rejects an empty subject, a too-short message, and unknown fields', () => {
    expect(
      SupportRequestSchema.safeParse({ subject: '', message: 'short but not too short' }).success,
    ).toBe(false);
    expect(SupportRequestSchema.safeParse({ subject: 'Hi', message: 'too short' }).success).toBe(
      false,
    );
    expect(
      SupportRequestSchema.safeParse({
        subject: 'Hi',
        message: 'A message that is long enough to pass.',
        category: 'billing',
      }).success,
    ).toBe(false);
  });

  it('rejects a subject or message over the length cap', () => {
    expect(
      SupportRequestSchema.safeParse({
        subject: 'x'.repeat(151),
        message: 'A message that is long enough to pass.',
      }).success,
    ).toBe(false);
    expect(
      SupportRequestSchema.safeParse({ subject: 'Hi', message: 'x'.repeat(5001) }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/shared vitest run support-request.test.ts`
Expected: FAIL — `Failed to resolve import "./support-request"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/src/contracts/support-request.ts
import { z } from 'zod';

/**
 * In-app "Contact support" form (Settings → Help & glossary). One
 * free-text message emailed to support@declutrmail.com — no ticket
 * persistence, no attachment.
 */
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

Add the exports to `packages/shared/src/contracts/index.ts`, next to the existing `product-feedback` export block:

```ts
export { SupportRequestSchema } from './support-request';
export type { SupportRequestPayload, SupportRequestResult } from './support-request';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/shared vitest run support-request.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/contracts/support-request.ts packages/shared/src/contracts/support-request.test.ts packages/shared/src/contracts/index.ts
git commit -m "feat(shared): add SupportRequestSchema contract"
```

---

### Task 2: `EmailService.deliver()` — additive `replyTo` override

**Files:**

- Modify: `apps/api/src/notifications/email.service.ts:83-113`
- Modify: `apps/api/src/notifications/email.service.spec.ts`

**Interfaces:**

- Consumes: existing `EmailService.deliver()` — the exact input/output shape at `apps/api/src/notifications/email.service.ts:83`.
- Produces: `deliver(input)` now accepts an optional `input.replyTo?: string`, which takes priority over `process.env.EMAIL_REPLY_TO` when present. Task 3 depends on this.

- [ ] **Step 1: Write the failing test**

Add this test to `apps/api/src/notifications/email.service.spec.ts`, directly after the existing `'sets reply-to when EMAIL_REPLY_TO is set'` test (around line 164):

```ts
it('prefers a per-call replyTo over EMAIL_REPLY_TO', async () => {
  process.env.EMAIL_REPLY_TO = 'founder@declutrmail.com';
  try {
    const client = fakeClient({ data: { id: 'x' }, error: null });
    const service = new EmailService(fakeSuppression(false), client);

    await service.deliver({ ...INPUT, replyTo: 'user@example.com' });

    expect(client.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: 'user@example.com' }),
      { idempotencyKey: 'k1' },
    );
  } finally {
    delete process.env.EMAIL_REPLY_TO;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/api vitest run email.service.spec.ts -t "prefers a per-call replyTo"`
Expected: FAIL — the payload's `replyTo` is `'founder@declutrmail.com'`, not `'user@example.com'` (or a TS error if the test is written against the pre-change type, since `replyTo` isn't yet a valid `deliver()` input key).

- [ ] **Step 3: Write minimal implementation**

In `apps/api/src/notifications/email.service.ts`, change the `deliver()` input type (around line 83) from:

```ts
  async deliver(input: {
    to: string;
    subject: string;
    text: string;
    idempotencyKey: string;
    html?: string;
    headers?: Record<string, string>;
  }): Promise<EmailDeliveryOutcome> {
```

to:

```ts
  async deliver(input: {
    to: string;
    subject: string;
    text: string;
    idempotencyKey: string;
    html?: string;
    headers?: Record<string, string>;
    replyTo?: string;
  }): Promise<EmailDeliveryOutcome> {
```

And change the reply-to resolution (around line 104) from:

```ts
// Ships dormant: FOUNDER-FOLLOWUPS.md records that
// support@declutrmail.com .com delivery is still pending the
// domain-alias add. A bouncing Reply-To is worse than none, so the
// header appears only once the founder sets this variable.
const replyTo = process.env.EMAIL_REPLY_TO;
```

to:

```ts
// Ships dormant: FOUNDER-FOLLOWUPS.md records that
// support@declutrmail.com .com delivery is still pending the
// domain-alias add. A bouncing Reply-To is worse than none, so the
// env fallback only applies once the founder sets this variable.
// A caller can still pass `input.replyTo` explicitly regardless of
// that fallback — e.g. the in-app support form replies to the user
// who filed the request, not the founder's inbox.
const replyTo = input.replyTo ?? process.env.EMAIL_REPLY_TO;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/api vitest run email.service.spec.ts`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/notifications/email.service.ts apps/api/src/notifications/email.service.spec.ts
git commit -m "feat(api): let EmailService.deliver accept a per-call replyTo"
```

---

### Task 3: `SupportRequestService`

**Files:**

- Create: `apps/api/src/support/support-request.service.ts`
- Create: `apps/api/src/support/support-request.service.spec.ts`

**Interfaces:**

- Consumes: `UsersService.findById(userId): Promise<{ email: string; ... } | null>` (`apps/api/src/users/users.service.ts:37`); `EmailService.deliver(input): Promise<EmailDeliveryOutcome>` (Task 2's signature); `AppException` (`apps/api/src/common/app-exception.js`); `SupportRequestPayload` / `SupportRequestResult` (Task 1).
- Produces: `class SupportRequestService { submit(principal: {userId: string; workspaceId: string}, payload: SupportRequestPayload): Promise<SupportRequestResult> }` — Task 4's controller depends on this exact method name/signature.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/support/support-request.service.spec.ts
import { describe, expect, it, vi } from 'vitest';

import { AppException } from '../common/app-exception.js';
import type { EmailService } from '../notifications/email.service.js';
import type { UsersService } from '../users/users.service.js';
import { SupportRequestService } from './support-request.service.js';

const PRINCIPAL = { userId: 'user-1', workspaceId: 'workspace-1' };
const PAYLOAD = { subject: 'Cannot connect Gmail', message: 'I keep hitting an error at step 2.' };

function fakeUsers(email: string | null): UsersService {
  return {
    findById: vi.fn().mockResolvedValue(email ? { id: 'user-1', email } : null),
  } as unknown as UsersService;
}

function fakeEmail(outcome: Awaited<ReturnType<EmailService['deliver']>>): EmailService {
  return { deliver: vi.fn().mockResolvedValue(outcome) } as unknown as EmailService;
}

describe('SupportRequestService', () => {
  it('emails support@ with the user set as reply-to', async () => {
    const email = fakeEmail({ ok: true, providerId: 'rsnd_1' });
    const service = new SupportRequestService(fakeUsers('user@example.com'), email);

    const result = await service.submit(PRINCIPAL, PAYLOAD);

    expect(result.submittedAt).toEqual(expect.any(String));
    expect(email.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'support@declutrmail.com',
        replyTo: 'user@example.com',
        subject: 'Support request: Cannot connect Gmail',
      }),
    );
    const call = (email.deliver as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.text).toContain('I keep hitting an error at step 2.');
    expect(call.text).toContain('user@example.com');
    expect(call.text).toContain('user-1');
  });

  it('omits reply-to when the user row cannot be found', async () => {
    const email = fakeEmail({ ok: true, providerId: 'rsnd_1' });
    const service = new SupportRequestService(fakeUsers(null), email);

    await service.submit(PRINCIPAL, PAYLOAD);

    const call = (email.deliver as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call).not.toHaveProperty('replyTo');
  });

  it('throws instead of reporting success when delivery fails', async () => {
    const email = fakeEmail({ ok: false, reason: 'transient', detail: 'boom' });
    const service = new SupportRequestService(fakeUsers('user@example.com'), email);

    await expect(service.submit(PRINCIPAL, PAYLOAD)).rejects.toThrow(AppException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/api vitest run support-request.service.spec.ts`
Expected: FAIL — `Failed to resolve import "./support-request.service.js"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/support/support-request.service.ts
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

import type { SupportRequestPayload, SupportRequestResult } from '@declutrmail/shared/contracts';

import { AppException } from '../common/app-exception.js';
import { EmailService } from '../notifications/email.service.js';
import { UsersService } from '../users/users.service.js';

const SUPPORT_INBOX = 'support@declutrmail.com';

interface SupportPrincipal {
  userId: string;
  workspaceId: string;
}

/**
 * SupportRequestService — the in-app "Contact support" form
 * (Settings → Help & glossary).
 *
 * Sends ONE email to `support@declutrmail.com` directly through
 * `EmailService`, not the `email-send` BullMQ queue: that pipeline
 * resolves its recipient FROM a userId and applies D165 opt-out/
 * suppression logic built for mail sent TO a user. Here the recipient
 * is fixed and the user is the SENDER, so that machinery does not
 * apply — this calls the same underlying Resend seam directly.
 */
@Injectable()
export class SupportRequestService {
  constructor(
    private readonly users: UsersService,
    private readonly email: EmailService,
  ) {}

  async submit(
    principal: SupportPrincipal,
    payload: SupportRequestPayload,
  ): Promise<SupportRequestResult> {
    const user = await this.users.findById(principal.userId);
    const submittedAt = new Date();
    const text = [
      payload.message,
      '',
      '---',
      `User: ${user?.email ?? 'unknown'} (${principal.userId})`,
      `Workspace: ${principal.workspaceId}`,
      `Submitted: ${submittedAt.toISOString()}`,
    ].join('\n');

    const outcome = await this.email.deliver({
      to: SUPPORT_INBOX,
      subject: `Support request: ${payload.subject}`,
      text,
      idempotencyKey: randomUUID(),
      ...(user?.email ? { replyTo: user.email } : {}),
    });

    if (!outcome.ok) {
      throw new AppException({ code: 'SERVICE_UNAVAILABLE' });
    }

    return { submittedAt: submittedAt.toISOString() };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/api vitest run support-request.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/support/support-request.service.ts apps/api/src/support/support-request.service.spec.ts
git commit -m "feat(api): add SupportRequestService"
```

---

### Task 4: `SupportRequestController`

**Files:**

- Create: `apps/api/src/support/support-request.controller.ts`
- Create: `apps/api/src/support/support-request.controller.spec.ts`

**Interfaces:**

- Consumes: `SupportRequestService.submit` (Task 3); `SupportRequestSchema` (Task 1); `AppException`, `CsrfGuard`, `JwtGuard` + `CurrentUser`, `RateLimit`, `ok`/`Envelope` — all existing, same imports as `apps/api/src/account/account.controller.ts` and `apps/api/src/product-feedback/product-feedback.controller.ts`.
- Produces: `POST /api/support-request` → `Envelope<SupportRequestResult>`. Task 5 registers this controller in a module.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/support/support-request.controller.spec.ts
import { describe, expect, it, vi } from 'vitest';

import { AppException } from '../common/app-exception.js';
import type { SessionPrincipal } from '../auth/sessions.service.js';
import { SupportRequestController } from './support-request.controller.js';
import type { SupportRequestService } from './support-request.service.js';

const PRINCIPAL = { userId: 'user-1', workspaceId: 'workspace-1' } as SessionPrincipal;

describe('SupportRequestController', () => {
  it('validates and delegates a bounded request', async () => {
    const submit = vi.fn().mockResolvedValue({ submittedAt: '2026-09-01T00:00:00.000Z' });
    const controller = new SupportRequestController({
      submit,
    } as unknown as SupportRequestService);

    const result = await controller.submit(PRINCIPAL, {
      subject: 'Cannot connect Gmail',
      message: 'I keep hitting an error at step 2.',
    });

    expect(submit).toHaveBeenCalledWith(PRINCIPAL, {
      subject: 'Cannot connect Gmail',
      message: 'I keep hitting an error at step 2.',
    });
    expect(result).toEqual({ data: { submittedAt: '2026-09-01T00:00:00.000Z' } });
  });

  it('rejects a too-short message and an unknown field without calling the service', async () => {
    const submit = vi.fn();
    const controller = new SupportRequestController({
      submit,
    } as unknown as SupportRequestService);

    await expect(
      controller.submit(PRINCIPAL, { subject: 'Hi', message: 'too short' }),
    ).rejects.toThrow(AppException);
    await expect(
      controller.submit(PRINCIPAL, {
        subject: 'Hi',
        message: 'A message that is long enough to pass.',
        category: 'billing',
      }),
    ).rejects.toThrow(AppException);
    expect(submit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/api vitest run support-request.controller.spec.ts`
Expected: FAIL — `Failed to resolve import "./support-request.controller.js"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/support/support-request.controller.ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import {
  ok,
  SupportRequestSchema,
  type Envelope,
  type SupportRequestResult,
} from '@declutrmail/shared/contracts';

import { AppException } from '../common/app-exception.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { CurrentUser, JwtGuard } from '../auth/jwt.guard.js';
import type { SessionPrincipal } from '../auth/sessions.service.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { SupportRequestService } from './support-request.service.js';

/**
 * SupportRequestController — `POST /api/support-request`.
 *
 * AUTH: `JwtGuard` only, deliberately no `CurrentMailboxGuard` — this
 * is account-scoped like `AccountController`'s deletion endpoints, not
 * mailbox-scoped. The mutation additionally takes `CsrfGuard` + a
 * tight rate limit (an authed endpoint that sends real outbound
 * email).
 */
@Controller('support-request')
@UseGuards(JwtGuard)
export class SupportRequestController {
  constructor(private readonly support: SupportRequestService) {}

  @Post()
  @UseGuards(CsrfGuard)
  @RateLimit({ bucket: 'default', limit: 5, windowSec: 300 })
  async submit(
    @CurrentUser() principal: SessionPrincipal,
    @Body() body: unknown,
  ): Promise<Envelope<SupportRequestResult>> {
    const parsed = SupportRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppException({
        code: 'BAD_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Invalid support request.',
      });
    }
    return ok(await this.support.submit(principal, parsed.data));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/api vitest run support-request.controller.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/support/support-request.controller.ts apps/api/src/support/support-request.controller.spec.ts
git commit -m "feat(api): add SupportRequestController"
```

---

### Task 5: Wire the `support` module into the app

**Files:**

- Create: `apps/api/src/support/support-request.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**

- Consumes: `SupportRequestController` (Task 4), `SupportRequestService` (Task 3), `AuthModule`, `NotificationsModule` (exports `EmailService`), `UsersModule` (exports `UsersService`) — all existing.
- Produces: `SupportRequestModule`, registered in `AppModule`, making `POST /api/support-request` live.

- [ ] **Step 1: Write the module**

```ts
// apps/api/src/support/support-request.module.ts
import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { UsersModule } from '../users/users.module.js';
import { SupportRequestController } from './support-request.controller.js';
import { SupportRequestService } from './support-request.service.js';

@Module({
  imports: [AuthModule, NotificationsModule, UsersModule],
  controllers: [SupportRequestController],
  providers: [SupportRequestService],
})
export class SupportRequestModule {}
```

- [ ] **Step 2: Register it in `AppModule`**

In `apps/api/src/app.module.ts`, add the import next to `ProductFeedbackModule`'s (around line 17):

```ts
import { SupportRequestModule } from './support/support-request.module.js';
```

And add it to the `imports` array next to `ProductFeedbackModule` (around line 88):

```ts
    ProductFeedbackModule,
    SupportRequestModule,
    AccountModule,
```

- [ ] **Step 3: Run the full API test suite for a wiring sanity check**

Run: `pnpm --filter @declutrmail/api vitest run --no-file-parallelism`
Expected: PASS, no new failures. (Per-package `--no-file-parallelism` per this repo's known orphan-worker trap — do NOT run bare root `pnpm test`.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @declutrmail/api typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/support/support-request.module.ts apps/api/src/app.module.ts
git commit -m "feat(api): register SupportRequestModule"
```

---

### Task 6: Frontend API wrapper

**Files:**

- Create: `apps/web/src/lib/api/support-request.ts`

**Interfaces:**

- Consumes: `apiPost` (`apps/web/src/lib/api/client.ts`), `SupportRequestPayload` / `SupportRequestResult` (Task 1).
- Produces: `postSupportRequest(payload): Promise<Envelope<SupportRequestResult, unknown>>` — Task 7 imports this.

- [ ] **Step 1: Write the implementation** (thin wrapper — no meaningful unit to test beyond what Task 7's mocked-fetch tests already cover, mirroring `apps/web/src/lib/api/product-feedback.ts`)

```ts
// apps/web/src/lib/api/support-request.ts
import type {
  Envelope,
  SupportRequestPayload,
  SupportRequestResult,
} from '@declutrmail/shared/contracts';

import { apiPost } from './client';

export function postSupportRequest(
  payload: SupportRequestPayload,
): Promise<Envelope<SupportRequestResult, unknown>> {
  return apiPost<SupportRequestResult>('/api/support-request', payload);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @declutrmail/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api/support-request.ts
git commit -m "feat(web): add postSupportRequest API wrapper"
```

---

### Task 7: `ContactSupportForm`

**Files:**

- Create: `apps/web/src/features/help/contact-support-form.tsx`
- Create: `apps/web/src/features/help/contact-support-form.test.tsx`

**Interfaces:**

- Consumes: `postSupportRequest` (Task 6), `track` (`@/lib/posthog`), `Button` / `Card` / `tokens` (`@declutrmail/shared`).
- Produces: `export function ContactSupportForm(): JSX.Element` — Task 8 mounts this on the settings/help page.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/features/help/contact-support-form.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContactSupportForm } from './contact-support-form';

const h = vi.hoisted(() => ({ post: vi.fn(), track: vi.fn() }));

vi.mock('@/lib/api/support-request', () => ({ postSupportRequest: h.post }));
vi.mock('@/lib/posthog', () => ({ track: h.track }));

beforeEach(() => {
  h.post.mockReset();
  h.track.mockReset();
});

function fillForm(subject: string, message: string) {
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: subject } });
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: message } });
}

describe('ContactSupportForm', () => {
  it('enforces the shared length bounds natively', () => {
    render(<ContactSupportForm />);
    expect(screen.getByLabelText('Subject')).toHaveAttribute('maxlength', '150');
    const messageField = screen.getByLabelText('Message');
    expect(messageField).toHaveAttribute('minlength', '10');
    expect(messageField).toHaveAttribute('maxlength', '5000');
  });

  it('submits a valid message and shows confirmation', async () => {
    h.post.mockResolvedValue({ data: { submittedAt: '2026-09-01T00:00:00.000Z' } });
    render(<ContactSupportForm />);
    fillForm('Cannot connect Gmail', 'I keep hitting an error at step 2.');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() =>
      expect(h.post).toHaveBeenCalledWith({
        subject: 'Cannot connect Gmail',
        message: 'I keep hitting an error at step 2.',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/message sent/i);
    expect(h.track).toHaveBeenCalledWith('support_request_submitted', {});
  });

  it('keeps the typed text and shows a fallback on a failed submit', async () => {
    h.post.mockRejectedValue(new Error('offline'));
    render(<ContactSupportForm />);
    fillForm('Cannot connect Gmail', 'I keep hitting an error at step 2.');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t send/i);
    expect(screen.getByLabelText('Subject')).toHaveValue('Cannot connect Gmail');
    expect(screen.getByLabelText('Message')).toHaveValue('I keep hitting an error at step 2.');
    expect(h.track).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/web vitest run contact-support-form.test.tsx`
Expected: FAIL — `Failed to resolve import "./contact-support-form"`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/web/src/features/help/contact-support-form.tsx
'use client';

import { useState, type FormEvent } from 'react';

import { Button, Card, tokens } from '@declutrmail/shared';

import { postSupportRequest } from '@/lib/api/support-request';
import { track } from '@/lib/posthog';

const { color, font, radius } = tokens;

type Status = 'idle' | 'submitting' | 'confirmed' | 'error';

/**
 * "Contact support" — Settings → Help & glossary, below the product
 * glossary. Authed users only; sends one email to support@ via
 * `POST /api/support-request`. No attachment, no ticket persistence —
 * see docs/superpowers/specs/2026-09-01-contact-support-form-design.md.
 */
export function ContactSupportForm() {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');
    try {
      await postSupportRequest({ subject, message });
      setStatus('confirmed');
      setSubject('');
      setMessage('');
      void track('support_request_submitted', {});
    } catch {
      setStatus('error');
    }
  }

  if (status === 'confirmed') {
    return (
      <Card padding={0}>
        <div style={{ padding: '18px 20px', fontFamily: font.sans }}>
          <p
            role="status"
            style={{ margin: 0, fontSize: 13, fontWeight: 600, color: color.primary }}
          >
            Message sent — we reply within 2 business days.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card padding={0}>
      <form
        onSubmit={(e) => void submit(e)}
        style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        <h3
          style={{
            fontSize: 15,
            fontWeight: 600,
            margin: 0,
            color: color.fg,
            fontFamily: font.sans,
          }}
        >
          Contact support
        </h3>
        <p style={{ fontSize: 12.5, color: color.fgSoft, lineHeight: 1.5, margin: 0 }}>
          Send a message straight to our team — we reply within 2 business days.
        </p>
        <input
          type="text"
          required
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            if (status === 'error') setStatus('idle');
          }}
          placeholder="Subject"
          aria-label="Subject"
          maxLength={150}
          disabled={status === 'submitting'}
          style={{
            height: 34,
            padding: '0 10px',
            fontFamily: font.sans,
            fontSize: 13,
            color: color.fg,
            background: color.card,
            border: `1px solid ${status === 'error' ? color.dangerBorder : color.border}`,
            borderRadius: radius.sm,
            outline: 'none',
          }}
        />
        <textarea
          required
          minLength={10}
          maxLength={5000}
          rows={5}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            if (status === 'error') setStatus('idle');
          }}
          placeholder="What's going on?"
          aria-label="Message"
          disabled={status === 'submitting'}
          style={{
            padding: '8px 10px',
            fontFamily: font.sans,
            fontSize: 13,
            color: color.fg,
            background: color.card,
            border: `1px solid ${status === 'error' ? color.dangerBorder : color.border}`,
            borderRadius: radius.sm,
            outline: 'none',
            resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Button type="submit" tone="primary" disabled={status === 'submitting'}>
            {status === 'submitting' ? 'Sending…' : 'Send message'}
          </Button>
          {status === 'error' ? (
            <span role="alert" style={{ fontSize: 12.5, color: color.danger }}>
              Couldn’t send that — try again, or email{' '}
              <a href="mailto:support@declutrmail.com" style={{ color: color.danger }}>
                support@declutrmail.com
              </a>
              .
            </span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/web vitest run contact-support-form.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/help/contact-support-form.tsx apps/web/src/features/help/contact-support-form.test.tsx
git commit -m "feat(web): add ContactSupportForm"
```

---

### Task 8: Mount on `/settings/help`

**Files:**

- Modify: `apps/web/src/app/(app)/settings/help/page.tsx`

**Interfaces:**

- Consumes: `ContactSupportForm` (Task 7), `ProductGlossary` (existing).

- [ ] **Step 1: Update the page**

Current content (`apps/web/src/app/(app)/settings/help/page.tsx`):

```tsx
import { ProductGlossary } from '@/features/help/product-glossary';

export const metadata = {
  title: 'Help & Glossary — DeclutrMail',
};

export default function SettingsHelpPage() {
  return <ProductGlossary />;
}
```

New content:

```tsx
import { ContactSupportForm } from '@/features/help/contact-support-form';
import { ProductGlossary } from '@/features/help/product-glossary';

export const metadata = {
  title: 'Help & Glossary — DeclutrMail',
};

export default function SettingsHelpPage() {
  return (
    <>
      <ProductGlossary />
      <div style={{ width: '100%', maxWidth: 860, margin: '0 auto', padding: '0 24px 40px' }}>
        <ContactSupportForm />
      </div>
    </>
  );
}
```

- [ ] **Step 2: Run the full web test suite for a wiring sanity check**

Run: `pnpm --filter @declutrmail/web vitest run --no-file-parallelism`
Expected: PASS, no new failures.

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @declutrmail/web typecheck && pnpm --filter @declutrmail/web lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/settings/help/page.tsx"
git commit -m "feat(web): mount ContactSupportForm on /settings/help"
```

---

### Task 9: Gate network + local smoke

**Files:** none (verification-only task)

- [ ] **Step 1: Run the full monorepo typecheck/lint/test**

```bash
pnpm typecheck
pnpm lint
pnpm --filter @declutrmail/shared vitest run --no-file-parallelism
pnpm --filter @declutrmail/api vitest run --no-file-parallelism
pnpm --filter @declutrmail/web vitest run --no-file-parallelism
```

Expected: all PASS. (Never run bare root `pnpm test` — this repo's known orphan-vitest-worker livelock; see per-package invocations above.)

- [ ] **Step 2: Run the gate-network skill**

Invoke the `gate-network` skill against this branch's diff (touches `apps/api/**` and `apps/web/**`, so `architecture-guardian` and `design-system-agent` are must-pass per `CLAUDE.md` §7). Fix any `[BLOCKING]` finding, then re-run affected tests.

- [ ] **Step 3: Local smoke via the D206 dev test-login**

1. `docker compose up -d redis`
2. `./scripts/dev-up.sh`
3. `pnpm --filter @declutrmail/web dev`
4. In the browser preview, sign in via `http://localhost:4000/api/auth/dev/login?email=chintan.a.thakkar@gmail.com` (per `CLAUDE.md` §8), then navigate to `/settings/help`.
5. Confirm the "Contact support" card renders below the glossary, with a Subject field, a Message field, and a "Send message" button.
6. Submit a valid message. Confirm: the button shows "Sending…" then the card replaces itself with "Message sent — we reply within 2 business days."; no console errors.
7. Reload, fill the form again. Temporarily unset `RESEND_API_KEY` in the API's env (or stop the API process the request would hit) and resubmit. Confirm: an inline error renders ("Couldn't send that — try again, or email support@declutrmail.com."), and the typed Subject/Message text is still in the fields (not cleared). Restore `RESEND_API_KEY` afterward.
8. Confirm the email actually sends when `RESEND_API_KEY` is set and valid: check the API logs for `email.send.accepted` (or, if using a Resend test/sandbox key, check the Resend dashboard) — do not claim delivery works from the UI confirmation alone (CLAUDE.md §8, "a claim is only as true as what backs it").

- [ ] **Step 4: Stop the dev stack**

```bash
./scripts/dev-up.sh --stop
```
