// apps/api/src/senders/senders.controller.ts — HTTP surface for the
// Senders read endpoints (D39, D40, D44, D45, D46) plus the standing-
// policy write route (D40, D42, D43 — `PATCH :id/policy`).
//
// Thin per D201/D204: validates input, delegates to
// `SendersReadService` / `SendersPolicyService`, wraps the result in
// the D202 envelope. NO business logic, NO database access, NO
// exception handling — the shared `AllExceptionsFilter` (apps/api/src/
// common/all-exceptions.filter.ts) handles the error envelope per D168.
//
// AUTH (D155 + D205): every route requires `JwtGuard` to populate
// `req.user`, then `CurrentMailboxGuard` to resolve the active mailbox
// from session preferences (or the `X-Active-Mailbox-Id` override).
// The mailbox id arrives via the `@CurrentMailbox()` param decorator.
// The state-changing PATCH additionally requires `CsrfGuard`
// (double-submit cookie), matching the actions mutation routes.
//
// PRIVACY (D7, D228): never fetches from Gmail, never returns body
// content, never returns non-allowlisted headers. The allowlisted
// `mail_messages.snippet` IS returned (cap enforced at the schema
// column via `varchar(300)`). The policy write touches ONLY the
// sha256 sender_key + standing-policy flags.

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type Envelope,
  type PaginatedEnvelope,
  type PaginationMeta,
  clampLimit,
  decodeCursor,
  encodeCursor,
  ok,
  paginated,
} from '@declutrmail/shared/contracts';

import { CsrfGuard } from '../auth/csrf.guard.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentMailbox, CurrentMailboxGuard } from '../mailboxes/current-mailbox.guard.js';
import { RateLimit } from '../common/rate-limit/index.js';
import { SendersPolicyService } from './senders-policy.service.js';
import { SendersReadService } from './senders.read-service.js';
import { senderPolicyPatchSchema } from './senders.types.js';
import type {
  ActivityFilter,
  GmailCategory,
  DecisionHistoryRow,
  MailMessageRow,
  SenderDetail,
  SenderListDirection,
  SenderListQueryMeta,
  SenderListRow,
  SenderListSort,
  SenderPolicyResult,
  SenderSummary,
  TimeseriesPoint,
} from './senders.types.js';

/** Allowed `?category=` values — mirrors the `gmail_category` enum. */
const CATEGORIES = new Set<GmailCategory>(['primary', 'promotions', 'social', 'updates', 'forums']);

/**
 * `?sort=` values implemented at Slice 1 (ADR-0014). `read` and
 * `recommended` are reserved in the contract but deferred — the
 * service throws if they ever slip past this allowlist; controllers
 * return 400 directly so the wire never sees a 5xx for a known-
 * unimplemented sort.
 */
const SUPPORTED_SORTS = new Set<SenderListSort>(['total', 'last_seen', 'first_seen', 'name']);
const SORT_DIRECTIONS = new Set<SenderListDirection>(['asc', 'desc']);

/**
 * Paginated envelope with an additional `meta.query` block. Mirrors the
 * shape in `docs/api/senders-list-contract.md` — page 1's value is
 * authoritative for the duration of a scroll; subsequent pages return
 * the same shape but the client preserves page-1.
 */
interface SenderListEnvelope extends Envelope<
  SenderListRow[],
  {
    pagination: PaginationMeta;
    query: SenderListQueryMeta;
  }
> {
  meta: { pagination: PaginationMeta; query: SenderListQueryMeta };
}

/** Page-size bounds — see each route's clamp call for the route-specific defaults. */
const LIST_LIMIT = { def: 25, min: 1, max: 100 } as const;
const SUGGEST_LIMIT = { def: 8, min: 1, max: 20 } as const;
const MESSAGES_LIMIT = { def: 10, min: 1, max: 50 } as const; // D46 — 10 default
const HISTORY_LIMIT = { def: 10, min: 1, max: 50 } as const; // D46 — 10 default

@Controller('senders')
@UseGuards(JwtGuard, CurrentMailboxGuard)
export class SendersController {
  constructor(
    private readonly reads: SendersReadService,
    private readonly policies: SendersPolicyService,
  ) {}

  /**
   * GET /api/senders — list senders for the caller's mailbox (D39).
   *
   * Query params:
   *   - `category`  — optional `primary|promotions|social|updates|forums`
   *                   to scope to one Gmail category.
   *   - `protected` — optional `true` to return only standing-protected
   *                   senders (D42/D43). Backs the Settings → Standing
   *                   Policies surface so it no longer needs to fetch the
   *                   whole mailbox client-side and filter (see ADR-0014
   *                   + the senders list contract). Any value other than
   *                   `true` (including `false`, missing) → no filter.
   *   - `limit`     — page size (default 25, max 100).
   *   - `cursor`    — opaque continuation token from a prior page's
   *                   `meta.pagination.nextCursor`.
   *
   * Returns the D202 paginated envelope. Ordering: `last_seen_at DESC,
   * id DESC` — most-recently-active senders first.
   */
  @Get()
  @RateLimit('triage-load')
  async list(
    @CurrentMailbox() mailbox: { id: string },
    @Query('category') rawCategory: string | undefined,
    @Query('limit') rawLimit: string | undefined,
    @Query('cursor') rawCursor: string | undefined,
    @Query('protected') rawProtected: string | undefined,
    // Intentionally undecorated positional slot. Existing direct unit-test
    // callers predate the removed query axis; Nest supplies `undefined`
    // here and no HTTP query parameter maps to it.
    _removedQuerySlot: undefined,
    @Query('sort') rawSort: string | undefined,
    @Query('direction') rawDirection: string | undefined,
    @Query('q') rawQ: string | undefined,
    @Query('activity') rawActivity: string | undefined,
    @Query('unsub_ready') rawUnsubReady: string | undefined,
    @Query('replied') rawReplied: string | undefined,
    @Query('window') rawWindow: string | undefined,
    @Query('domain') rawDomain: string | undefined,
    @Query('unsub_ignored') rawUnsubIgnored: string | undefined,
  ): Promise<SenderListEnvelope> {
    const accountId = mailbox.id;
    const category = parseCategory(rawCategory);
    const isProtected = parseProtectedFlag(rawProtected);
    const limit = clampLimit(rawLimit, LIST_LIMIT);
    const sort = parseSort(rawSort);
    const direction = parseDirection(rawDirection);
    const q = parseSearch(rawQ);
    // D38 compose strip params.
    const activity = parseActivity(rawActivity);
    const unsubReady = parseTriState(rawUnsubReady);
    const repliedTo = parseTriState(rawReplied);
    const quietForDays = parseWindow(rawWindow);
    const domain = parseSearch(rawDomain); // share the search trimmer
    // D51 — "unsub'd, still emailing". `true`-only (no negated surface),
    // mirroring the protected flag's stance.
    const unsubIgnored = rawUnsubIgnored === 'true' ? true : null;

    const cursorRaw = decodeCursor(rawCursor);
    if (rawCursor && cursorRaw === null) {
      // D202: a malformed cursor is client error, not server error —
      // the decoder returns `null` for every flavor of bad input.
      throw new BadRequestException('Invalid cursor.');
    }
    // The service parses the cursor's `key` per the active sort — a
    // Date string for time columns, an integer string for `total`,
    // etc. We pass the wire shape through untouched; the validation
    // failure surfaces as a `400 Invalid cursor` from the service's
    // per-sort parser.
    const cursor = cursorRaw ? { key: cursorRaw.key, id: cursorRaw.id } : null;

    const [rows, query] = await Promise.all([
      this.reads.listSenders({
        mailboxAccountId: accountId,
        category,
        isProtected,
        sort,
        direction,
        cursor,
        limit,
        q,
        activity,
        unsubReady,
        repliedTo,
        quietForDays,
        domain,
        unsubIgnored,
      }),
      this.reads.getSenderListQueryMeta({
        mailboxAccountId: accountId,
        category,
        isProtected,
        q,
        activity,
        unsubReady,
        repliedTo,
        quietForDays,
        domain,
        unsubIgnored,
      }),
    ]);

    const { page, nextCursor } = takePage(rows, limit, (row) =>
      encodeCursor({ key: encodeCursorKey(sort, row), id: row.id }),
    );
    const pagination: PaginationMeta = {
      nextCursor,
      hasMore: nextCursor !== null,
      limit,
    };
    return { data: page, meta: { pagination, query } };
  }

  /**
   * GET /api/senders/summary — mailbox-wide aggregates (#145, real-data
   * counts mandate).
   *
   * Returns the totals the Senders screen's hero, KPI strip, and intent
   * chips read so headline numbers reflect the whole mailbox — not the
   * ≤50-row page the FE has loaded. Honors `?q=` so search narrows the
   * chip + KPI counts in lockstep with the list rows.
   *
   * NOTE on route ORDER. Declared BEFORE
   * `GET :id` — NestJS matches in declaration order, so `summary` must
   * not fall into the UUID-validation 400 path.
   */
  @Get('summary')
  @RateLimit('triage-load')
  async summary(
    @CurrentMailbox() mailbox: { id: string },
    @Query('q') rawQ: string | undefined,
    @Query('includeOneTime') rawIncludeOneTime: string | undefined,
  ): Promise<Envelope<SenderSummary>> {
    const q = parseSearch(rawQ);
    // Default true — match the list endpoint default. Pivots the whole
    // summary in lockstep w/ the FE "show one-time" toggle.
    const includeOneTime = rawIncludeOneTime !== 'false';
    const data = await this.reads.getSenderSummary({
      mailboxAccountId: mailbox.id,
      q,
      includeOneTime,
    });
    return ok(data);
  }

  /**
   * GET /api/senders/suggest — typeahead autocomplete for the senders
   * search input. Returns up to `limit` minimal-shape rows ordered by
   * `total_received DESC`. Mailbox-scoped.
   *
   * NOTE on route ORDER. Declared BEFORE `GET :id` — NestJS matches in
   * declaration order; otherwise `suggest` is interpreted as an `:id`
   * param and falls into the UUID-validation 400 path.
   *
   * Rate-limit: `triage-load` bucket overridden to 120/min (typing
   * fires 1-3 calls per term with the FE's 150ms debounce; 120/min
   * absorbs an aggressive typist plus their backspace).
   */
  @Get('suggest')
  @RateLimit({ bucket: 'triage-load', limit: 120, windowSec: 60 })
  async suggest(
    @CurrentMailbox() mailbox: { id: string },
    @Query('q') rawQ: string | undefined,
    @Query('limit') rawLimit: string | undefined,
  ): Promise<
    Envelope<{
      senders: Array<{
        id: string;
        name: string;
        email: string;
        domain: string;
        totalReceived: number;
      }>;
    }>
  > {
    const q = parseSearch(rawQ);
    if (q === null) return ok({ senders: [] });
    const limit = clampLimit(rawLimit, SUGGEST_LIMIT);
    const rows = await this.reads.suggestSenders({
      mailboxAccountId: mailbox.id,
      q,
      limit,
    });
    return ok({ senders: rows });
  }

  /**
   * GET /api/senders/:id — single sender detail (D39, D40).
   *
   * 404 when the sender doesn't exist OR belongs to a different
   * mailbox. The cross-mailbox case deliberately collapses to 404 so
   * we don't leak existence across tenants.
   */
  @Get(':id')
  @RateLimit('triage-load')
  async detail(
    @CurrentMailbox() mailbox: { id: string },
    @Param('id') id: string,
  ): Promise<Envelope<SenderDetail>> {
    const accountId = mailbox.id;
    if (!isUuid(id)) {
      // A non-UUID id is structurally impossible — bail with 400
      // before hitting the DB.
      throw new BadRequestException('Sender id must be a UUID.');
    }
    const detail = await this.reads.getSenderDetail(accountId, id);
    if (!detail) {
      throw notFound('Sender not found.');
    }
    return ok(detail);
  }

  /**
   * PATCH /api/senders/:id/policy — standing-policy write (D40, D245).
   * Set-state patch over `policy_type='keep'` / `is_protected`; the
   * service diffs against the current row, upserts
   * only actual changes, and appends the D43 audit rows in the same
   * transaction. Naturally idempotent — see `senderPolicyPatchSchema`.
   *
   * No preview (D40: "Keep applies immediately"; ADR-0015 routes `keep`
   * to the `inline-confirm` surface, not a modal) and no undo token —
   * a standing-policy flip is non-destructive; toggling back IS the
   * undo. NOT part of the D226 destructive lifecycle.
   *
   * Auth: class guards + `CsrfGuard` (state-changing). Rate-limit
   * (D156): `gmail-action` bucket — the mutation-surface bucket the
   * sibling action routes use (no Gmail call happens here, but the
   * abuse profile of a write endpoint matches).
   *
   * Errors:
   *   - 400 INVALID_REQUEST (bad body) / non-UUID id
   *   - 404 SENDER_NOT_FOUND (ownership mismatch collapses to 404)
   */
  @RateLimit({ bucket: 'gmail-action' })
  @Patch(':id/policy')
  @UseGuards(CsrfGuard)
  async patchPolicy(
    @CurrentMailbox() mailbox: { id: string },
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Envelope<SenderPolicyResult>> {
    if (!isUuid(id)) {
      throw new BadRequestException('Sender id must be a UUID.');
    }
    const parsed = senderPolicyPatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: parsed.error.issues[0]?.message ?? 'Invalid policy patch.',
      });
    }
    const result = await this.policies.setPolicy({
      mailboxAccountId: mailbox.id,
      senderId: id,
      patch: parsed.data,
    });
    return ok(result);
  }

  /**
   * GET /api/senders/:id/messages — recent messages from this sender
   * (D46). Default page 10 per the D-decision; max 50.
   *
   * Orders by `internal_date DESC, id DESC` — index
   * `mail_messages_account_sender_date_idx` covers the WHERE +
   * ORDER BY exactly.
   */
  @Get(':id/messages')
  @RateLimit('triage-load')
  async messages(
    @CurrentMailbox() mailbox: { id: string },
    @Param('id') id: string,
    @Query('limit') rawLimit: string | undefined,
    @Query('cursor') rawCursor: string | undefined,
  ): Promise<PaginatedEnvelope<MailMessageRow>> {
    const accountId = mailbox.id;
    if (!isUuid(id)) {
      throw new BadRequestException('Sender id must be a UUID.');
    }
    const limit = clampLimit(rawLimit, MESSAGES_LIMIT);

    const cursorRaw = decodeCursor(rawCursor);
    if (rawCursor && cursorRaw === null) {
      throw new BadRequestException('Invalid cursor.');
    }
    const cursor = cursorRaw ? { internalDate: new Date(cursorRaw.key), id: cursorRaw.id } : null;
    if (cursor && Number.isNaN(cursor.internalDate.getTime())) {
      throw new BadRequestException('Invalid cursor.');
    }

    const rows = await this.reads.listMessagesForSender({
      mailboxAccountId: accountId,
      senderId: id,
      cursor,
      limit,
    });
    if (rows === null) {
      throw notFound('Sender not found.');
    }

    const { page, nextCursor } = takePage(rows, limit, (row) =>
      encodeCursor({ key: row.internalDate, id: row.id }),
    );
    return paginated({ items: page, limit, nextCursor });
  }

  /**
   * GET /api/senders/:id/timeseries — past 12 calendar months (D39,
   * D45). Fixed window — no pagination.
   *
   * Returned in chronological order; the FE fills missing months on
   * the client side (see read-service comment for why we don't
   * `generate_series` in the DB).
   */
  @Get(':id/timeseries')
  @RateLimit('triage-load')
  async timeseries(
    @CurrentMailbox() mailbox: { id: string },
    @Param('id') id: string,
  ): Promise<Envelope<TimeseriesPoint[]>> {
    const accountId = mailbox.id;
    if (!isUuid(id)) {
      throw new BadRequestException('Sender id must be a UUID.');
    }
    const points = await this.reads.listTimeseries({
      mailboxAccountId: accountId,
      senderId: id,
    });
    if (points === null) {
      throw notFound('Sender not found.');
    }
    return ok(points);
  }

  /**
   * GET /api/senders/:id/history — decision history for this sender
   * (D46). Default page 10; max 50.
   *
   * Today's `triage_decisions` schema enforces ONE current row per
   * sender so the page is at most one entry — pagination is forward-
   * compatible for the planned `triage_decision_history` table. See
   * ADR-0008 §3 for the pragmatic exception that lets this service
   * read the triage-owned table directly at launch.
   */
  @Get(':id/history')
  @RateLimit('triage-load')
  async history(
    @CurrentMailbox() mailbox: { id: string },
    @Param('id') id: string,
    @Query('limit') rawLimit: string | undefined,
    @Query('cursor') rawCursor: string | undefined,
  ): Promise<PaginatedEnvelope<DecisionHistoryRow>> {
    const accountId = mailbox.id;
    if (!isUuid(id)) {
      throw new BadRequestException('Sender id must be a UUID.');
    }
    const limit = clampLimit(rawLimit, HISTORY_LIMIT);

    const cursorRaw = decodeCursor(rawCursor);
    if (rawCursor && cursorRaw === null) {
      throw new BadRequestException('Invalid cursor.');
    }
    const cursor = cursorRaw ? { producedAt: new Date(cursorRaw.key), id: cursorRaw.id } : null;
    if (cursor && Number.isNaN(cursor.producedAt.getTime())) {
      throw new BadRequestException('Invalid cursor.');
    }

    const rows = await this.reads.listDecisionHistory({
      mailboxAccountId: accountId,
      senderId: id,
      cursor,
      limit,
    });
    if (rows === null) {
      throw notFound('Sender not found.');
    }

    const { page, nextCursor } = takePage(rows, limit, (row) =>
      encodeCursor({ key: row.producedAt, id: row.id }),
    );
    return paginated({ items: page, limit, nextCursor });
  }
}

/**
 * Take the first `limit` rows from a `limit + 1` page, deriving the
 * `nextCursor` from the discarded sentinel row. Shared by every
 * paginated route so the cursor-derivation contract is identical.
 *
 * Returning `nextCursor = null` when there's no sentinel signals
 * `hasMore = false` through the envelope helper.
 */
function takePage<T>(
  rows: T[],
  limit: number,
  buildCursor: (row: T) => string,
): { page: T[]; nextCursor: string | null } {
  if (rows.length <= limit) {
    return { page: rows, nextCursor: null };
  }
  const page = rows.slice(0, limit);
  // `lastVisible` is the last row WE return; the next page starts
  // strictly after this row (the OR-chain in the read-service uses
  // `<` so equality on this boundary belongs on the prior page).
  const lastVisible = page[page.length - 1]!;
  return { page, nextCursor: buildCursor(lastVisible) };
}

/** Coerce a raw `?category=` to the enum or `null` (silently ignore unknowns). */
function parseCategory(raw: string | undefined): GmailCategory | null {
  if (!raw) return null;
  return CATEGORIES.has(raw as GmailCategory) ? (raw as GmailCategory) : null;
}

/**
 * Coerce a raw `?q=` search term: trim, cap length (bounds the ILIKE
 * scan + a hostile query), and collapse empty to `null` (no search). The
 * service escapes LIKE wildcards — no sanitization needed here beyond the
 * length cap.
 */
function parseSearch(raw: string | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().slice(0, 200);
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Coerce a raw `?sort=` to a supported `SenderListSort`. Defaults to
 * `'total'` (the new Slice 1 contract default — `Total ↓`). Throws
 * `BadRequestException` for an unknown sort so the wire surfaces a
 * 400 with the offending value rather than silently coercing to the
 * default (which would hide client bugs).
 */
function parseSort(raw: string | undefined): SenderListSort {
  if (!raw) return 'total';
  if (!SUPPORTED_SORTS.has(raw as SenderListSort)) {
    throw new BadRequestException(`Unsupported sort: ${raw}`);
  }
  return raw as SenderListSort;
}

/**
 * Coerce a raw `?direction=` to `asc | desc | null` (no direction → the
 * service picks a sane default per sort). 400 on an unknown value —
 * same posture as `parseSort`.
 */
function parseDirection(raw: string | undefined): SenderListDirection | null {
  if (!raw) return null;
  if (!SORT_DIRECTIONS.has(raw as SenderListDirection)) {
    throw new BadRequestException(`Unsupported direction: ${raw}`);
  }
  return raw as SenderListDirection;
}

/**
 * Encode a row's sort-column value into the cursor's opaque `key`.
 * The service's `buildCursorPredicate` decodes the same per-sort shape
 * on the next request — keep both in lockstep when adding new sorts.
 */
function encodeCursorKey(sort: SenderListSort, row: SenderListRow): string {
  switch (sort) {
    case 'total':
      return String(row.totalReceived);
    case 'last_seen':
      return row.lastSeenAt;
    case 'first_seen':
      return row.firstSeenAt;
    case 'name': {
      // Mirror the read service's effective-name expression
      // (LOWER(COALESCE(NULLIF(TRIM(display_name),''), email))) — the
      // cursor key must be the value the ORDER BY actually sorted on.
      const trimmed = row.displayName.trim();
      return (trimmed === '' ? row.email : trimmed).toLowerCase();
    }
    case 'read':
    case 'recommended':
      // Filtered upstream by SUPPORTED_SORTS; defense in depth.
      throw new BadRequestException(`Unsupported sort: ${sort}`);
  }
}

/**
 * Coerce a raw `?protected=` to a boolean filter or `null` (no filter).
 *
 * Only the literal string `'true'` enables the protected filter. Any other
 * value — missing, `'false'`, or garbage — returns `null` so the read
 * service applies no `is_protected` predicate. The "false" case is not yet
 * a product surface (no "show only non-protected" UI), so we don't expose
 * it on the wire and instead leave that bit to a later slice.
 */
function parseProtectedFlag(raw: string | undefined): boolean | null {
  // D38 — `not` (and `false`) now surfaces explicitly as the negated
  // form ("NOT protected") so the compose strip can ride the same
  // predicate as the toggle chip.
  if (raw === 'true') return true;
  if (raw === 'not' || raw === 'false') return false;
  return null;
}

/**
 * Parse `?activity=` (D38 compose strip).
 *
 * Accepted forms:
 *   - `active | quiet | dormant`         → require the bucket
 *   - `not-active | not-quiet | not-dormant` → exclude the bucket
 *   - missing / empty                     → no filter
 *
 * Any other value 400s so a typo doesn't silently widen the result.
 */
function parseActivity(raw: string | undefined): ActivityFilter | null {
  if (!raw) return null;
  let negate = false;
  let value = raw;
  if (raw.startsWith('not-')) {
    negate = true;
    value = raw.slice(4);
  }
  if (value !== 'active' && value !== 'quiet' && value !== 'dormant') {
    throw new BadRequestException(`Unsupported activity: ${raw}`);
  }
  return { bucket: value, negate };
}

/**
 * Parse a tri-state filter query param (D38).
 *
 *   `true`           → required (matches)
 *   `false` | `not`  → negated (excludes)
 *   missing / empty  → no filter
 */
function parseTriState(raw: string | undefined): boolean | null {
  if (!raw) return null;
  if (raw === 'true') return true;
  if (raw === 'false' || raw === 'not') return false;
  throw new BadRequestException(`Unsupported tri-state value: ${raw}`);
}

/**
 * Parse `?window=` (D38) into `quietForDays`. Accepts the spec's
 * presets (`30d | 90d | 180d | 365d`) plus a bare number (clamped to
 * the action_jobs CHECK range 1..3650 to keep wire shape consistent
 * across surfaces). Missing → null (no constraint).
 */
function parseWindow(raw: string | undefined): number | null {
  if (!raw) return null;
  const map: Record<string, number> = {
    '30d': 30,
    '90d': 90,
    '180d': 180,
    '365d': 365,
    '6mo': 180,
    '1yr': 365,
  };
  if (map[raw] !== undefined) return map[raw]!;
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 3650) return n;
  throw new BadRequestException(`Unsupported window: ${raw}`);
}

/**
 * Build a NOT_FOUND HTTP exception with the D202 error code on the
 * envelope. `AllExceptionsFilter` maps HTTP 404 → `'NOT_FOUND'` so
 * the code travels through; the message is what we set here.
 */
function notFound(message: string): HttpException {
  return new HttpException({ message }, HttpStatus.NOT_FOUND);
}

/** UUID v4 (relaxed — accepts any RFC 4122 hex layout). */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
