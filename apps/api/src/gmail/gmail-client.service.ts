import { OAuth2Client } from 'google-auth-library';
import {
  AuthExpiredError,
  InvalidGrantError,
  RateLimitError,
  TransientError,
} from '@declutrmail/workers';
import type {
  GmailMessageListPage,
  GmailMessageMetadata,
  GmailMetadataClient,
} from '@declutrmail/workers';

/**
 * GmailClientService — the Gmail REST adapter behind the
 * `GmailMetadataClient` port (D201: external integrations sit behind an
 * interface). One instance is bound to one mailbox's `OAuth2Client`.
 *
 * PRIVACY — D7 / D228. `getMessageMetadata` calls `messages.get` with
 * `format=metadata` and a `From` + `Subject` header allowlist. It NEVER
 * uses `format=full` or `format=raw`, so message bodies, attachments,
 * inline images, and raw MIME are never fetched — the "Full bodies
 * fetched: 0" guarantee. `messages.list` returns ids only. `enforced by
 * privacy-auditor`.
 */

/** Gmail message-format value — `metadata` ONLY (D7). Never `full`/`raw`. */
const METADATA_FORMAT = 'metadata';
/** Headers fetched alongside metadata — the D7 allowlist for sync. */
const METADATA_HEADERS = ['From', 'Subject'];
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const PAGE_SIZE = 500;
const REQUEST_TIMEOUT_MS = 30_000;

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
}

export class GmailClientService implements GmailMetadataClient {
  constructor(private readonly oauth: OAuth2Client) {}

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
    };
  }

  /**
   * Authenticated GET against the Gmail API. Maps HTTP failures to the
   * typed worker errors so `BaseDeclutrWorker` classifies retry vs.
   * dead-letter correctly. `allow404` returns `null` instead of throwing.
   */
  private async get<T>(path: string, allow404: boolean): Promise<T | null> {
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
    if (res.status === 401) {
      throw new AuthExpiredError('Gmail returned 401 — access token rejected');
    }
    if (res.status === 429) {
      throw new RateLimitError('Gmail returned 429', retryAfterMs(res));
    }
    if (res.status >= 500) {
      throw new TransientError(`Gmail returned ${res.status}`);
    }
    // Other 4xx — surface the body; the base class treats it as transient.
    throw new TransientError(`Gmail returned ${res.status}: ${await safeBody(res)}`);
  }

  /** A fresh access token — `OAuth2Client` refreshes it if expired. */
  private async accessToken(): Promise<string> {
    let token: string | null | undefined;
    try {
      ({ token } = await this.oauth.getAccessToken());
    } catch (err) {
      if (errorMessage(err).includes('invalid_grant')) {
        throw new InvalidGrantError('Gmail OAuth grant is no longer valid — reconnect required');
      }
      throw new TransientError(`Gmail token refresh failed: ${errorMessage(err)}`);
    }
    if (!token) {
      throw new InvalidGrantError('Gmail OAuth client returned no access token');
    }
    return token;
  }
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
    return (await res.text()).slice(0, 200);
  } catch {
    return '<unreadable>';
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
