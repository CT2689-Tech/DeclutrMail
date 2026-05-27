// apps/api/src/senders/senders.controller.ts — HTTP surface for the
// Senders read endpoints (D39, D40, D44, D45, D46).
//
// Thin per D201/D204: validates input, delegates to
// `SendersReadService`, wraps the result in the D202 envelope. NO
// business logic, NO database access, NO exception handling — the
// shared `AllExceptionsFilter` (apps/api/src/common/all-
// exceptions.filter.ts) handles the error envelope per D168.
//
// AUTH NOTE (until D109/D224 lands): the mailbox is identified by the
// `x-mailbox-account-id` header — same pattern as `UndoController`
// and `OAuth callback`. When the session layer ships, the header is
// replaced by a guard reading the JWT.
//
// PRIVACY (D7, D228): read-only path. Never fetches from Gmail,
// never returns body content, never returns non-allowlisted headers.
// The allowlisted `mail_messages.snippet` IS returned (cap enforced
// at the schema column via `varchar(300)`).

import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Query,
} from '@nestjs/common';
import {
  type Envelope,
  type PaginatedEnvelope,
  clampLimit,
  decodeCursor,
  encodeCursor,
  ok,
  paginated,
} from '@declutrmail/shared/contracts';

import { RateLimit } from '../common/rate-limit/index.js';
import { SendersReadService } from './senders.read-service.js';
import type {
  GmailCategory,
  DecisionHistoryRow,
  MailMessageRow,
  SenderDetail,
  SenderListRow,
  TimeseriesPoint,
  WeeklyHero,
} from './senders.types.js';

/** Allowed `?category=` values — mirrors the `gmail_category` enum. */
const CATEGORIES = new Set<GmailCategory>(['primary', 'promotions', 'social', 'updates', 'forums']);

/** Page-size bounds — see each route's clamp call for the route-specific defaults. */
const LIST_LIMIT = { def: 25, min: 1, max: 100 } as const;
const MESSAGES_LIMIT = { def: 10, min: 1, max: 50 } as const; // D46 — 10 default
const HISTORY_LIMIT = { def: 10, min: 1, max: 50 } as const; // D46 — 10 default

@Controller('senders')
export class SendersController {
  constructor(private readonly reads: SendersReadService) {}

  /**
   * GET /api/senders — list senders for the caller's mailbox (D39).
   *
   * Query params:
   *   - `category` — optional `primary|promotions|social|updates|forums`
   *     to scope to one Gmail category.
   *   - `limit`    — page size (default 25, max 100).
   *   - `cursor`   — opaque continuation token from a prior page's
   *                  `meta.pagination.nextCursor`.
   *
   * Returns the D202 paginated envelope. Ordering: `last_seen_at DESC,
   * id DESC` — most-recently-active senders first.
   */
  @Get()
  @RateLimit('triage-load')
  async list(
    @Headers('x-mailbox-account-id') mailboxAccountId: string | undefined,
    @Query('category') rawCategory: string | undefined,
    @Query('limit') rawLimit: string | undefined,
    @Query('cursor') rawCursor: string | undefined,
  ): Promise<PaginatedEnvelope<SenderListRow>> {
    const accountId = this.requireMailbox(mailboxAccountId);
    const category = parseCategory(rawCategory);
    const limit = clampLimit(rawLimit, LIST_LIMIT);

    const cursorRaw = decodeCursor(rawCursor);
    if (rawCursor && cursorRaw === null) {
      // D202: a malformed cursor is client error, not server error —
      // the decoder returns `null` for every flavor of bad input.
      throw new BadRequestException('Invalid cursor.');
    }
    const cursor = cursorRaw ? { lastSeenAt: new Date(cursorRaw.key), id: cursorRaw.id } : null;
    if (cursor && Number.isNaN(cursor.lastSeenAt.getTime())) {
      throw new BadRequestException('Invalid cursor.');
    }

    const rows = await this.reads.listSenders({
      mailboxAccountId: accountId,
      category,
      cursor,
      limit,
    });

    const { page, nextCursor } = takePage(rows, limit, (row) =>
      encodeCursor({ key: row.lastSeenAt, id: row.id }),
    );
    return paginated({ items: page, limit, nextCursor });
  }

  /**
   * GET /api/senders/weekly-hero — Weekly Hero slices (D47, D48).
   *
   * Returns the three slice cards (`high_confidence`, `spike`,
   * `quiet`) the FE renders on Mondays. Slices with fewer than 3
   * qualifying senders are OMITTED — the FE iterates the returned
   * slices unconditionally.
   *
   * NOTE on route ORDER. This route MUST be declared BEFORE
   * `GET :id` — NestJS matches in declaration order; otherwise
   * `weekly-hero` is interpreted as an `:id` param and falls into
   * the UUID-validation 400 path.
   *
   * No pagination — the response is bounded (3 × 24 = 72 rows max)
   * and the FE re-fetches on screen mount.
   */
  @Get('weekly-hero')
  @RateLimit('triage-load')
  async weeklyHero(
    @Headers('x-mailbox-account-id') mailboxAccountId: string | undefined,
  ): Promise<Envelope<WeeklyHero>> {
    const accountId = this.requireMailbox(mailboxAccountId);
    const hero = await this.reads.listWeeklyHero({ mailboxAccountId: accountId });
    return ok(hero);
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
    @Headers('x-mailbox-account-id') mailboxAccountId: string | undefined,
    @Param('id') id: string,
  ): Promise<Envelope<SenderDetail>> {
    const accountId = this.requireMailbox(mailboxAccountId);
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
    @Headers('x-mailbox-account-id') mailboxAccountId: string | undefined,
    @Param('id') id: string,
    @Query('limit') rawLimit: string | undefined,
    @Query('cursor') rawCursor: string | undefined,
  ): Promise<PaginatedEnvelope<MailMessageRow>> {
    const accountId = this.requireMailbox(mailboxAccountId);
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
    @Headers('x-mailbox-account-id') mailboxAccountId: string | undefined,
    @Param('id') id: string,
  ): Promise<Envelope<TimeseriesPoint[]>> {
    const accountId = this.requireMailbox(mailboxAccountId);
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
    @Headers('x-mailbox-account-id') mailboxAccountId: string | undefined,
    @Param('id') id: string,
    @Query('limit') rawLimit: string | undefined,
    @Query('cursor') rawCursor: string | undefined,
  ): Promise<PaginatedEnvelope<DecisionHistoryRow>> {
    const accountId = this.requireMailbox(mailboxAccountId);
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

  /** Reject requests with no mailbox header — pre-auth-layer minimum. */
  private requireMailbox(headerValue: string | undefined): string {
    if (!headerValue || !isUuid(headerValue)) {
      throw new BadRequestException('x-mailbox-account-id header is required.');
    }
    return headerValue;
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
