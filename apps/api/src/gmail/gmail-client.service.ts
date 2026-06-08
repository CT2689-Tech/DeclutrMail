import { OAuth2Client } from 'google-auth-library';
import {
  AuthExpiredError,
  InvalidGrantError,
  RateLimitError,
  type RateLimiter,
  TransientError,
} from '@declutrmail/workers';
import type {
  GmailHistoryPage,
  GmailHistoryRecord,
  GmailMessageListPage,
  GmailMessageMetadata,
  GmailMetadataClient,
  GmailMutationClient,
  LabelChange,
} from '@declutrmail/workers';

/**
 * GmailClientService — the Gmail REST adapter behind the
 * `GmailMetadataClient` (read) and `GmailMutationClient` (label-modify)
 * ports (D201: external integrations sit behind an interface). One
 * instance is bound to one mailbox's `OAuth2Client` and one
 * `RateLimiter`.
 *
 * PRIVACY — D7 / D228. `getMessageMetadata` calls `messages.get` with
 * `format=metadata` and the six-header allowlist defined in
 * `METADATA_HEADERS` below (founder-approved per ADR-0004:
 * `From`, `Subject`, `To`, `Cc`, `List-Unsubscribe`,
 * `List-Unsubscribe-Post`). It NEVER uses `format=full` or
 * `format=raw`, so message bodies, attachments, inline images, and
 * raw MIME are never fetched — the "Full bodies fetched: 0"
 * guarantee. `messages.list` returns ids only. The mutation methods
 * (`modifyLabels` / `batchModify`) send only label ids + message ids and
 * never read the response body, so they are body-free by construction.
 * Enforced by `privacy-auditor`.
 *
 * QUOTA — D5. Gmail meters 15,000 quota units / user / minute. The local
 * `RateLimiter` is a coarse per-call governor: it already charges the
 * read rate (`UNITS_PER_CALL = 5`) for every request, and we keep that
 * same per-call accounting for the mutation POSTs — each `modify` call
 * and each `batchModify` chunk is one request through the limiter — so
 * the per-mailbox window paces writes the same way it paces reads. (Gmail
 * bills `messages.modify` at 5 and `messages.batchModify` at 50 units
 * server-side; the local governor does not attempt to mirror that finer
 * billing — the 12,000/60,000ms window already runs 20% under Gmail's
 * documented ceiling, per ADR-0005.) A 403 "Quota exceeded" (Gmail's
 * rate-limit signal — it is NOT always a 429) is classified as
 * `RateLimitError` so the worker treats it as retryable throttling, not
 * a generic fault.
 */

/** Gmail message-format value — `metadata` ONLY (D7). Never `full`/`raw`. */
const METADATA_FORMAT = 'metadata';
/**
 * Headers fetched alongside metadata — the D7 allowlist for sync.
 *
 * Amended 2026-05-22 (ADR-0004) — see the schema docs on `mail_messages`
 * for the per-field rationale:
 *   - `To`, `Cc` — recipient capture (used on outbound for the future
 *     Sent-sync / reply-attribution engine).
 *   - `List-Unsubscribe`, `List-Unsubscribe-Post` — RFC 8058 unsubscribe
 *     capability (D9 auto-unsubscribe).
 */
const METADATA_HEADERS = [
  'From',
  'Subject',
  'To',
  'Cc',
  'List-Unsubscribe',
  'List-Unsubscribe-Post',
];
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const PAGE_SIZE = 500;
const REQUEST_TIMEOUT_MS = 30_000;
/** Quota units charged to the local limiter per request (D5). */
const UNITS_PER_CALL = 5;
/** Gmail caps `messages.batchModify` at 1000 ids per request. */
const BATCH_MODIFY_MAX_IDS = 1000;

/** Shape of a `messages.list` response (the fields we read). */
interface GmailListResponse {
  messages?: { id?: string }[];
  nextPageToken?: string;
}

/** Shape of a `messages.get?format=metadata` response (the fields we read). */
interface GmailGetResponse {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: { name: string; value: string }[] };
  /**
   * Rough byte-count of the encoded message — D7 storage-allowlist
   * amendment per ADR-0021 (2026-06-06). In Gmail's metadata envelope,
   * not the body; the call shape is unchanged (`format=metadata`).
   * Gmail occasionally omits the field; tolerate undefined and persist
   * the column as NULL when absent.
   */
  sizeEstimate?: number;
}

/** Shape of a `users.getProfile` response (only the historyId is read). */
interface GmailProfileResponse {
  historyId?: string;
}

/** Shape of a `users.history.list` response (only the fields we read). */
interface GmailHistoryResponse {
  history?: GmailHistoryRecordRaw[];
  nextPageToken?: string;
  historyId?: string;
}

/**
 * One Gmail history record on the wire. Each record carries any
 * combination of the four event arrays — Gmail does NOT split records
 * per event kind. Our `GmailHistoryRecord` normalisation flattens the
 * arrays into a single ordered list per page.
 *
 * Privacy: every nested message reference is id+threadId+labelIds — no
 * header, snippet, body, or attachment.
 */
interface GmailHistoryRecordRaw {
  id?: string;
  messages?: { id?: string; threadId?: string }[];
  messagesAdded?: { message?: GmailHistoryMessageRef }[];
  messagesDeleted?: { message?: GmailHistoryMessageRef }[];
  labelsAdded?: { message?: GmailHistoryMessageRef; labelIds?: string[] }[];
  labelsRemoved?: { message?: GmailHistoryMessageRef; labelIds?: string[] }[];
}

interface GmailHistoryMessageRef {
  id?: string;
  threadId?: string;
  labelIds?: string[];
}

/**
 * Reason enum for the D181 `oauth.refresh_failed` audit emit. A closed
 * set so the audit payload never carries raw upstream error text.
 *
 *   - `invalid_grant`     — Google rejected the stored refresh token
 *     (revoked, password changed, account suspended, app un-trusted).
 *     Surfaces as `InvalidGrantError`; the mailbox needs reconnect.
 *   - `no_access_token`   — `getAccessToken()` returned no token but
 *     did not throw. Treated as `InvalidGrantError` upstream.
 *   - `transient_failure` — any non-`invalid_grant` token-swap error
 *     (network blip, Google 5xx, timeout). Surfaces as `TransientError`
 *     and the worker retries the job.
 */
export type OauthRefreshFailureReason = 'invalid_grant' | 'no_access_token' | 'transient_failure';

/**
 * Optional fire-and-forget audit callback (D181). Invoked by
 * {@link GmailClientService} on each token-swap failure — the worker
 * supplies a closure that records the event with the mailbox context
 * it knows about (`workspaceId` / `userId` / `mailboxAccountId`); the
 * service itself stays oblivious to those identifiers and to the
 * SecurityEventsService class entirely.
 *
 * Implementations MUST NOT throw and MUST NOT delay the caller —
 * the recorder runs alongside the original throw and never replaces
 * or alters it. Constructed callers are expected to wrap with
 * `void`.
 */
export type OauthRefreshFailureRecorder = (failure: { reason: OauthRefreshFailureReason }) => void;

export class GmailClientService implements GmailMetadataClient, GmailMutationClient {
  /**
   * Optional D181 audit recorder — set on construction by the worker
   * (which closes over the mailbox/workspace context). Absent in test
   * setups + any future API-context construction that doesn't need
   * the audit emit.
   */
  private readonly onRefreshFailed: OauthRefreshFailureRecorder | undefined;

  constructor(
    private readonly oauth: OAuth2Client,
    private readonly limiter: RateLimiter,
    onRefreshFailed?: OauthRefreshFailureRecorder,
  ) {
    this.onRefreshFailed = onRefreshFailed;
  }

  /** Page through every message id in the mailbox (ids only — no bodies). */
  async listMessageIds(pageToken?: string): Promise<GmailMessageListPage> {
    const params = new URLSearchParams({ maxResults: String(PAGE_SIZE) });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }
    const json = await this.get<GmailListResponse>(`/messages?${params.toString()}`, false);
    const ids = (json?.messages ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string');
    return json?.nextPageToken ? { ids, nextPageToken: json.nextPageToken } : { ids };
  }

  /**
   * Fetch one message's metadata. `format=metadata` — bodies are never
   * fetched (D7). Returns `null` when the message no longer exists (404
   * — it was deleted between `messages.list` and this call).
   */
  async getMessageMetadata(messageId: string): Promise<GmailMessageMetadata | null> {
    const params = new URLSearchParams();
    params.set('format', METADATA_FORMAT);
    for (const header of METADATA_HEADERS) {
      params.append('metadataHeaders', header);
    }
    const json = await this.get<GmailGetResponse>(
      `/messages/${encodeURIComponent(messageId)}?${params.toString()}`,
      true,
    );
    if (json === null) {
      return null;
    }
    return {
      id: json.id,
      threadId: json.threadId,
      labelIds: Array.isArray(json.labelIds) ? json.labelIds : [],
      snippet: typeof json.snippet === 'string' ? json.snippet : '',
      internalDate: typeof json.internalDate === 'string' ? json.internalDate : '0',
      from: findHeader(json, 'From'),
      subject: findHeader(json, 'Subject'),
      to: findHeader(json, 'To'),
      cc: findHeader(json, 'Cc'),
      listUnsubscribe: findHeader(json, 'List-Unsubscribe'),
      listUnsubscribePost: findHeader(json, 'List-Unsubscribe-Post'),
      // ADR-0021 — pass through Gmail's `sizeEstimate` when present.
      // Gmail occasionally omits the field on certain message shapes;
      // a finite-number guard avoids surfacing `NaN`/`Infinity` into
      // the persisted integer column.
      ...(typeof json.sizeEstimate === 'number' && Number.isFinite(json.sizeEstimate)
        ? { sizeBytes: json.sizeEstimate }
        : {}),
    };
  }

  /**
   * Snapshot the mailbox's user-level `historyId` from
   * `users.getProfile` (D5 — incremental-sync starting cursor for PR-D).
   * Body-free; just the profile resource (email, historyId, totals).
   */
  async getProfile(): Promise<{ historyId: string }> {
    const json = await this.get<GmailProfileResponse>('/profile', false);
    if (!json?.historyId) {
      throw new TransientError('Gmail profile response missing historyId');
    }
    return { historyId: json.historyId };
  }

  /**
   * Page through `users.history.list` from `startHistoryId`. Each page
   * normalises Gmail's four nested event arrays into a flat
   * `GmailHistoryRecord[]`; the worker pattern-matches by `kind` so it
   * never depends on Gmail's wire shape.
   *
   * Privacy (D7): every event surfaces id+threadId+labelIds only — no
   * `metadataHeaders`, no `format=full`. Snippets, subjects, bodies,
   * and attachment data are NEVER fetched by this path.
   *
   * Returns `null` when Gmail responds 404 with reason
   * `notFound` — the canonical signal that `startHistoryId` is older
   * than the 7-day Gmail retention window. The worker recovers by
   * snapshotting `getProfile()` + scheduling a full re-sync rather
   * than blindly retrying.
   */
  async listHistory(startHistoryId: string, pageToken?: string): Promise<GmailHistoryPage | null> {
    const params = new URLSearchParams({ startHistoryId, maxResults: String(PAGE_SIZE) });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }
    const json = await this.get<GmailHistoryResponse>(`/history?${params.toString()}`, true);
    if (json === null) {
      // 404 — `startHistoryId` too old. Caller falls back to full re-sync.
      return null;
    }
    if (!json.historyId) {
      throw new TransientError('Gmail history response missing historyId');
    }
    const records: GmailHistoryRecord[] = [];
    for (const raw of json.history ?? []) {
      if (raw.messagesAdded) {
        for (const added of raw.messagesAdded) {
          const m = added.message;
          if (m?.id && m.threadId) {
            records.push({
              kind: 'added',
              messageId: m.id,
              threadId: m.threadId,
              labelIds: Array.isArray(m.labelIds) ? m.labelIds : [],
            });
          }
        }
      }
      if (raw.messagesDeleted) {
        for (const deleted of raw.messagesDeleted) {
          const m = deleted.message;
          if (m?.id && m.threadId) {
            records.push({
              kind: 'deleted',
              messageId: m.id,
              threadId: m.threadId,
            });
          }
        }
      }
      if (raw.labelsAdded) {
        for (const added of raw.labelsAdded) {
          const m = added.message;
          if (m?.id && Array.isArray(added.labelIds) && added.labelIds.length > 0) {
            records.push({
              kind: 'labels_added',
              messageId: m.id,
              labelIds: added.labelIds,
            });
          }
        }
      }
      if (raw.labelsRemoved) {
        for (const removed of raw.labelsRemoved) {
          const m = removed.message;
          if (m?.id && Array.isArray(removed.labelIds) && removed.labelIds.length > 0) {
            records.push({
              kind: 'labels_removed',
              messageId: m.id,
              labelIds: removed.labelIds,
            });
          }
        }
      }
    }
    const page: GmailHistoryPage = { records, historyId: json.historyId };
    return json.nextPageToken ? { ...page, nextPageToken: json.nextPageToken } : page;
  }

  /**
   * Authenticated GET against the Gmail API. Paced by the `RateLimiter`
   * (D5), then maps HTTP failures to the typed worker errors so
   * `BaseDeclutrWorker` classifies retry vs. dead-letter correctly.
   * `allow404` returns `null` instead of throwing.
   */
  private async get<T>(path: string, allow404: boolean): Promise<T | null> {
    await this.limiter.acquire(UNITS_PER_CALL);
    const token = await this.accessToken();

    let res: Response;
    try {
      res = await fetch(`${GMAIL_API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Network failure or request timeout — retryable.
      throw new TransientError(`Gmail request failed: ${errorMessage(err)}`);
    }

    if (res.ok) {
      return (await res.json()) as T;
    }
    if (res.status === 404 && allow404) {
      return null;
    }
    return this.handleStatus(res);
  }

  /**
   * Authenticated POST against the Gmail API — the write sibling of
   * `get()`. Same `RateLimiter` pacing (D5), same `Authorization: Bearer`
   * auth, same timeout, and the same typed-error mapping via
   * `handleStatus`. Sends a JSON body and DELIBERATELY discards the
   * response body: a label-modify response carries only ids/labels, none
   * of which we need, and not reading it keeps the call body-free (D7).
   */
  private async post(path: string, body: unknown): Promise<void> {
    await this.limiter.acquire(UNITS_PER_CALL);
    const token = await this.accessToken();

    let res: Response;
    try {
      res = await fetch(`${GMAIL_API_BASE}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Network failure or request timeout — retryable.
      throw new TransientError(`Gmail request failed: ${errorMessage(err)}`);
    }

    if (res.ok) {
      return;
    }
    await this.handleStatus(res);
  }

  /**
   * Map a non-OK Gmail `Response` to the typed worker error that drives
   * `BaseDeclutrWorker`'s retry vs. dead-letter decision. Always throws —
   * the return type is `never`. Callers handle `res.ok` (and `get`'s
   * `allow404`) before delegating here, so this only ever sees failures.
   */
  private async handleStatus(res: Response): Promise<never> {
    if (res.status === 401) {
      throw new AuthExpiredError('Gmail returned 401 — access token rejected');
    }
    if (res.status === 429) {
      throw new RateLimitError('Gmail returned 429', retryAfterMs(res));
    }
    if (res.status === 403) {
      // Gmail signals a quota breach as 403 "Quota exceeded" (NOT 429).
      // Classify it as RateLimitError so the worker backs off rather
      // than burning retries against a per-minute window (D5).
      const body = await safeBody(res);
      if (isQuotaError(body)) {
        throw new RateLimitError('Gmail 403 — quota exceeded', retryAfterMs(res));
      }
      throw new TransientError(`Gmail returned 403: ${body}`);
    }
    if (res.status >= 500) {
      throw new TransientError(`Gmail returned ${res.status}`);
    }
    // Other 4xx — surface the body; the base class treats it as transient.
    throw new TransientError(`Gmail returned ${res.status}: ${await safeBody(res)}`);
  }

  /**
   * Apply a label change to a single message — `messages.modify` with
   * `addLabelIds` / `removeLabelIds`. Only label ids + the message id
   * cross the wire (D7-safe). Paced through the limiter like every other
   * call (D5).
   */
  async modifyLabels(messageId: string, change: LabelChange): Promise<void> {
    await this.post(`/messages/${encodeURIComponent(messageId)}/modify`, {
      addLabelIds: change.addLabelIds ?? [],
      removeLabelIds: change.removeLabelIds ?? [],
    });
  }

  /**
   * Apply the same label change to many messages — `messages.batchModify`.
   * Gmail caps a batch at 1000 ids per request, so the input is chunked
   * into ≤1000-id batches issued sequentially, each through the limiter
   * (D5). Only message ids + label ids cross the wire (D7-safe). An empty
   * id list is a no-op — no request, no quota spend.
   */
  async batchModify(messageIds: string[], change: LabelChange): Promise<void> {
    const addLabelIds = change.addLabelIds ?? [];
    const removeLabelIds = change.removeLabelIds ?? [];
    for (let i = 0; i < messageIds.length; i += BATCH_MODIFY_MAX_IDS) {
      const ids = messageIds.slice(i, i + BATCH_MODIFY_MAX_IDS);
      await this.post('/messages/batchModify', { ids, addLabelIds, removeLabelIds });
    }
  }

  /** A fresh access token — `OAuth2Client` refreshes it if expired. */
  private async accessToken(): Promise<string> {
    let token: string | null | undefined;
    try {
      ({ token } = await this.oauth.getAccessToken());
    } catch (err) {
      if (errorMessage(err).includes('invalid_grant')) {
        // D181: emit BEFORE the throw so a recorder failure (which the
        // recorder is contracted to swallow) never alters the existing
        // `InvalidGrantError`. The reason is a closed enum — the raw
        // upstream message is never copied into the audit payload.
        this.emitRefreshFailure('invalid_grant');
        throw new InvalidGrantError('Gmail OAuth grant is no longer valid — reconnect required');
      }
      this.emitRefreshFailure('transient_failure');
      throw new TransientError(`Gmail token refresh failed: ${errorMessage(err)}`);
    }
    if (!token) {
      this.emitRefreshFailure('no_access_token');
      throw new InvalidGrantError('Gmail OAuth client returned no access token');
    }
    return token;
  }

  /**
   * Run the D181 refresh-failure recorder if one was wired. Wrapped in
   * try/catch so a buggy recorder cannot mutate the original throw's
   * control flow — the recorder is documented as fire-and-forget, this
   * is defense in depth.
   */
  private emitRefreshFailure(reason: OauthRefreshFailureReason): void {
    if (!this.onRefreshFailed) {
      return;
    }
    try {
      this.onRefreshFailed({ reason });
    } catch {
      // Swallow — the recorder must never break the token-swap path.
    }
  }
}

/** True when a 403 body is a quota / rate-limit breach (not a real 403). */
function isQuotaError(body: string): boolean {
  const lower = body.toLowerCase();
  return (
    lower.includes('quota exceeded') ||
    lower.includes('ratelimitexceeded') ||
    lower.includes('user-rate limit') ||
    lower.includes('userratelimitexceeded')
  );
}

/** Case-insensitive header lookup from a metadata-format response. */
function findHeader(json: GmailGetResponse, name: string): string | null {
  const target = name.toLowerCase();
  const match = (json.payload?.headers ?? []).find((h) => h.name.toLowerCase() === target);
  return match ? match.value : null;
}

/** Parse a `Retry-After` header (delta-seconds) into ms, if present. */
function retryAfterMs(res: Response): number | undefined {
  const header = res.headers.get('retry-after');
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

/** Read a response body without throwing — for error messages only. */
async function safeBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '<unreadable>';
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
