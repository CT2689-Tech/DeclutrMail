import { isFeatureEnabled } from '@/lib/flags';

const GMAIL_BASE = 'https://mail.google.com/mail/';

export interface GmailOpenLinkInput {
  mailboxEmail: string;
  gmailMessageId?: string | null;
  senderEmail?: string | null;
  subject?: string | null;
  internalDate?: string | Date | null;
  /** Last time this Gmail resource was confirmed during sync. */
  syncedAt?: string | Date | null;
  /** Test/incident override; normal callers use the D231 feature flag. */
  forceSearchFallback?: boolean;
}

export interface GmailSearchLinkInput {
  mailboxEmail: string;
  query: string;
}

export interface GmailComposeLinkInput {
  mailboxEmail: string;
  to: string;
  subject?: string | null;
  body?: string | null;
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function baseWithAccount(mailboxEmail: string): string | null {
  const account = nonEmpty(mailboxEmail);
  if (!account) return null;
  return `${GMAIL_BASE}?${new URLSearchParams({ authuser: account }).toString()}`;
}

function withFragment(base: string, view: 'all' | 'search', value: string): string {
  return `${base}#${view}/${encodeURIComponent(value)}`;
}

function gmailDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

function parsedDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function quotedSearchValue(value: string): string {
  return `"${value.replace(/([\\"])/g, '\\$1')}"`;
}

function searchFallback(input: GmailOpenLinkInput): string | null {
  const sender = nonEmpty(input.senderEmail);
  if (!sender || input.internalDate == null) return null;

  const received = parsedDate(input.internalDate);
  if (!received) return null;

  const after = new Date(received);
  after.setUTCDate(after.getUTCDate() - 1);
  const before = new Date(received);
  before.setUTCDate(before.getUTCDate() + 1);

  // Quoting turns the entire address into one value, so malformed provider
  // data cannot inject a second Gmail search operator.
  const terms = [`from:${quotedSearchValue(sender)}`];
  const subject = nonEmpty(input.subject);
  if (subject) {
    // Gmail accepts backslash-escaped quotes inside a quoted term.
    terms.push(`subject:${quotedSearchValue(subject)}`);
  }
  terms.push(`after:${gmailDate(after)}`, `before:${gmailDate(before)}`);

  return GmailOpenLinkService.buildSearchLink({
    mailboxEmail: input.mailboxEmail,
    query: terms.join(' '),
  });
}

/**
 * Canonical Gmail navigation boundary (D231).
 *
 * Every URL is bound to the active mailbox with `authuser`; browser tab
 * positions such as `/u/0` are deliberately never used. Direct links target
 * Gmail's all-mail resource route so archived/labeled messages still open.
 * The operational fallback reconstructs a narrow Gmail search from fields
 * DeclutrMail already stores and never requires a Message-ID header.
 */
export const GmailOpenLinkService = {
  buildOpenLink(input: GmailOpenLinkInput): string | null {
    const base = baseWithAccount(input.mailboxEmail);
    if (!base) return null;

    const useSearch =
      input.forceSearchFallback === true || isFeatureEnabled('gmailDeeplinkSearchFallback');
    if (useSearch) return searchFallback(input);

    const syncedAt = parsedDate(input.syncedAt);
    const syncTimestampWasSupplied = input.syncedAt != null;
    const syncAgeMs = syncedAt === null ? null : Date.now() - syncedAt.getTime();
    const isFresh =
      !syncTimestampWasSupplied ||
      (syncAgeMs !== null && syncAgeMs >= -5 * 60 * 1_000 && syncAgeMs <= 24 * 60 * 60 * 1_000);
    if (!isFresh) return searchFallback(input);

    const messageId = nonEmpty(input.gmailMessageId);
    if (messageId) return withFragment(base, 'all', messageId);

    return searchFallback(input);
  },

  buildSearchLink(input: GmailSearchLinkInput): string | null {
    const base = baseWithAccount(input.mailboxEmail);
    const query = nonEmpty(input.query);
    if (!base || !query) return null;
    return withFragment(base, 'search', query);
  },

  buildComposeLink(input: GmailComposeLinkInput): string | null {
    const account = nonEmpty(input.mailboxEmail);
    const to = nonEmpty(input.to);
    if (!account || !to) return null;

    const params = new URLSearchParams({ authuser: account, view: 'cm', fs: '1', to });
    const subject = nonEmpty(input.subject);
    const body = nonEmpty(input.body);
    if (subject) params.set('su', subject);
    if (body) params.set('body', body);
    return `${GMAIL_BASE}?${params.toString()}`;
  },
};
