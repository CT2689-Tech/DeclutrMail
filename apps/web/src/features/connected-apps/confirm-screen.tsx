'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  Card,
  Disclosure,
  ErrorState,
  Logo,
  tokens,
  type ButtonTone,
} from '@declutrmail/shared';
import { actionPreviewFacts, verbById, type VerbTone } from '@declutrmail/shared/actions';
import type {
  ActionPreviewOutcome,
  ActionPreviewSkipped,
  ActionPreviewView,
} from '@declutrmail/shared/contracts';
import { CONFIRM_PREVIEW_ID } from '@declutrmail/shared/contracts/app-navigation';

import { ApiError, apiErrorCode } from '@/lib/api/client';
import { useActionPreview, useConfirmActionPreview } from './api/use-action-preview';
import { appDisplayName } from './scope-copy';

const { color, font, text } = tokens;

/** Why the last press did not go through — each maps to one sentence pair. */
export type ConfirmFailure =
  'limit' | 'plan' | 'mailbox' | 'unsubscribe_off' | 'not_started' | 'unknown';

export type ConfirmCardState =
  | { kind: 'loading' }
  /**
   * Another person's request, a made-up id, a disconnected app, or the
   * connector switched off. The API answers all four alike on purpose,
   * so the page names none of them.
   */
  | { kind: 'unavailable' }
  /**
   * The 15 minutes ran out. `confirmedEarlier` is the rare case where the
   * person DID press in time but nothing was recorded as started: the
   * page cannot say whether any of it ran, so it must not read as
   * "nothing happened".
   */
  | { kind: 'expired'; confirmedEarlier: boolean }
  | { kind: 'error'; onRetry: () => void }
  | {
      kind: 'ready';
      preview: ActionPreviewView;
      confirming: boolean;
      failure: ConfirmFailure | null;
      onConfirm: () => void;
    }
  | { kind: 'applied'; preview: ActionPreviewView; outcome: ActionPreviewOutcome };

const pageStyle = {
  minHeight: '100dvh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 24,
  padding: '32px 16px',
  background: color.bg,
  fontFamily: font.sans,
  color: color.fg,
} as const;

const headingStyle = { margin: 0, fontSize: text.xl, overflowWrap: 'anywhere' } as const;
const subheadingStyle = { margin: '20px 0 0', fontSize: text.md } as const;
const mutedStyle = { margin: 0, fontSize: text.sm, color: color.fgMuted } as const;
const listStyle = {
  margin: '8px 0 0',
  paddingLeft: 20,
  fontSize: text.md,
  lineHeight: 1.6,
  overflowWrap: 'anywhere',
} as const;
const linkStyle = { color: color.fg, fontSize: text.md, textDecoration: 'underline' } as const;

const BUTTON_TONE: Record<VerbTone, ButtonTone> = {
  neutral: 'primary',
  primary: 'primary',
  dark: 'dark',
  amber: 'warn',
  danger: 'danger',
};

const FAILURE_COPY: Record<ConfirmFailure, string> = {
  limit: 'You have reached this month’s limit on your plan.',
  plan: 'Your plan does not include this.',
  mailbox: 'This Gmail account is not connected to DeclutrMail.',
  unsubscribe_off: 'Unsubscribe requests cannot be sent right now. Try again later.',
  not_started: 'DeclutrMail could not start this. Try again in a minute.',
  unknown: 'That did not go through. Try again.',
};

const FAILURE_LINK: Partial<Record<ConfirmFailure, { href: string; label: string }>> = {
  limit: { href: '/billing', label: 'See plans' },
  plan: { href: '/billing', label: 'See plans' },
  mailbox: { href: '/settings', label: 'Open Settings' },
};

const SKIP_REASON: Record<ActionPreviewSkipped['reason'], string> = {
  protected: 'Protected, so it was skipped.',
  not_found: 'No longer in this Gmail account.',
  in_progress: 'Another change is already running for it.',
  mailto: 'Unsubscribes by email. Send the draft from Gmail.',
  no_channel: 'Offers no unsubscribe link.',
  unknown: 'Not checked for an unsubscribe link yet.',
  failed: 'Could not be started.',
};

const plural = (count: number, one: string, many: string): string =>
  `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

/**
 * The request in a verb or two: "Archive", or "Unsubscribe + Archive"
 * when Unsubscribe also clears the senders' existing email. A missing
 * `alsoVerb` (an API older than this page) reads as none.
 */
function requestLabel(preview: ActionPreviewView): string {
  const verb = verbById(preview.verb).label;
  const also = preview.alsoVerb ?? null;
  // The web app's own unsubscribe dialog names it the same way.
  return also === null ? verb : `${verb} + ${verbById(also).label}`;
}

/** The verbs that move email already in the inbox; the others have no count to show. */
const movesEmail = (verb: ActionPreviewView['verb']): boolean =>
  verb === 'archive' || verb === 'later' || verb === 'delete';

function formatWhen(iso: string, withDate: boolean): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // The person's own clock. Never part of server-rendered HTML: the
  // screen shows a request only after it has mounted and loaded one.
  return new Intl.DateTimeFormat(
    'en-US',
    withDate ? { dateStyle: 'medium', timeStyle: 'short' } : { timeStyle: 'short' },
  ).format(date);
}

/**
 * A skipped sender's compose link becomes an `href` only when it is a
 * Gmail compose page. The API builds it, but it is built from an address
 * the SENDER published, and this page will not turn anything else into
 * something to press.
 */
export function gmailComposeHref(url: string | null): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const isGmail =
    parsed.protocol === 'https:' &&
    parsed.hostname === 'mail.google.com' &&
    parsed.port === '' &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.pathname === '/mail/' &&
    parsed.searchParams.get('view') === 'cm';
  return isGmail ? parsed.href : null;
}

/**
 * The confirm page (ADR-0048 rule 1, docs/spec/mcp-connector.md §3): an
 * assistant prepared a cleanup; this is the one place a person says yes.
 *
 * A page, not the fixed-overlay `PreviewSheet`: there is no screen behind
 * it to return to, and nothing here should look dismissible by clicking
 * away. It owes the same three things a preview does — the count, where
 * the email goes, how to undo — each once (CLAUDE.md §2.3), in the words
 * the assistant was given (`actionPreviewFacts`).
 *
 * The app's name and every sender name are text other people wrote.
 * They are rendered as text and never become markup or a link.
 */
export function ConfirmCard({ state }: { state: ConfirmCardState }) {
  return (
    <main style={pageStyle}>
      <Logo />
      <Card padding={24} style={{ width: '100%', maxWidth: 480 }}>
        {state.kind === 'loading' ? (
          <p role="status" style={mutedStyle}>
            Loading request…
          </p>
        ) : state.kind === 'unavailable' ? (
          <div role="alert">
            <h1 style={headingStyle}>This request is not available</h1>
            <p style={{ ...mutedStyle, marginTop: 8 }}>Ask your assistant to prepare it again.</p>
          </div>
        ) : state.kind === 'expired' ? (
          <div role="alert">
            <h1 style={headingStyle}>This request expired</h1>
            {state.confirmedEarlier ? (
              <>
                <p style={{ ...mutedStyle, marginTop: 8 }}>
                  It was confirmed but never recorded as started. Check Activity before asking
                  again.
                </p>
                <p style={{ margin: '16px 0 0' }}>
                  <Link href="/activity" style={linkStyle}>
                    Open Activity
                  </Link>
                </p>
              </>
            ) : (
              <p style={{ ...mutedStyle, marginTop: 8 }}>Ask your assistant to prepare it again.</p>
            )}
          </div>
        ) : state.kind === 'error' ? (
          <ErrorState
            headingLevel={2}
            title="Could not load this request"
            description="Try again in a moment."
            onRetry={state.onRetry}
          />
        ) : state.kind === 'applied' ? (
          <Receipt preview={state.preview} outcome={state.outcome} />
        ) : (
          <ReadyPreview state={state} />
        )}
      </Card>
    </main>
  );
}

/** The part of Later's shared destination line that a known wake time replaces. */
const LATER_PLACEHOLDER = 'until the time you pick';

/** Names shown before the full list has to be opened. */
const NAMED_SENDERS = 5;

/**
 * Who the request covers. The assistant chose the senders, so the page
 * has to be able to show every one of them: a long request must not be
 * able to carry a sender nobody saw. The first five are always listed;
 * past that, one disclosure opens the whole list in a region that
 * scrolls and takes keyboard focus.
 *
 * `total` is the request's own count. `names` can be shorter when a
 * sender has left the index since — the count shown stays the true one.
 */
function SenderList({ names, total }: { names: readonly string[]; total: number }) {
  const [showingAll, setShowingAll] = useState(false);
  if (names.length === 0) return null;
  const unnamed = total - names.length;
  const remainder = unnamed > 0 && <li>and {unnamed.toLocaleString('en-US')} more</li>;
  // Names can repeat; position is the only stable key.
  const items = (list: readonly string[]) => list.map((name, index) => <li key={index}>{name}</li>);
  if (names.length <= NAMED_SENDERS) {
    return (
      <>
        <h2 style={subheadingStyle}>Senders</h2>
        <ul style={listStyle}>
          {items(names)}
          {remainder}
        </ul>
      </>
    );
  }
  return (
    <>
      <h2 style={subheadingStyle}>Senders</h2>
      {/* Hidden once the full list is open, so no name is listed twice. */}
      {!showingAll && <ul style={listStyle}>{items(names.slice(0, NAMED_SENDERS))}</ul>}
      <Disclosure
        summary={`Show all ${total.toLocaleString('en-US')} senders`}
        onToggle={(event) => setShowingAll(event.currentTarget.open)}
        style={{ marginTop: 8 }}
      >
        <div
          role="region"
          aria-label="All senders"
          // Focusable so the list scrolls from the keyboard too.
          tabIndex={0}
          style={{ maxHeight: 240, overflowY: 'auto' }}
        >
          <ul style={{ ...listStyle, marginTop: 0 }}>
            {items(names)}
            {remainder}
          </ul>
        </div>
      </Disclosure>
    </>
  );
}

function ReadyPreview({ state }: { state: Extract<ConfirmCardState, { kind: 'ready' }> }) {
  const { preview, confirming, failure } = state;
  const verb = verbById(preview.verb);
  const alsoVerb = preview.alsoVerb ?? null;
  const label = requestLabel(preview);
  const facts = actionPreviewFacts(preview.verb, alsoVerb);
  // A Delete in the request colours the button, whichever verb leads it.
  const tone = alsoVerb === 'delete' ? verbById('delete').tone : verb.tone;
  const failureLink = failure ? FAILURE_LINK[failure] : undefined;
  // Later's shared line ends "until the time you pick"; here the time is
  // already picked. If that wording ever changes, fall back to two lines.
  const laterWhen =
    preview.wakeAt !== null && facts.destination.includes(LATER_PLACEHOLDER)
      ? formatWhen(preview.wakeAt, true)
      : null;
  return (
    <>
      <h1 style={headingStyle}>
        {label} {plural(preview.senderCount, 'sender', 'senders')}?
      </h1>
      <p style={{ ...mutedStyle, marginTop: 8, overflowWrap: 'anywhere' }}>
        <strong style={{ color: color.fg }}>{appDisplayName(preview.appName)}</strong> asked for
        this in <strong style={{ color: color.fg }}>{preview.mailboxEmail}</strong>.
      </p>
      {preview.state === 'confirmed' && failure === null && (
        // Pressed earlier, and the server has no result on record. Whether
        // any of it began is not something this page can see.
        <p role="status" style={{ ...mutedStyle, marginTop: 12 }}>
          Confirmed earlier, with no record that it started. Press {label} to try again.
        </p>
      )}

      <SenderList names={preview.senderNames} total={preview.senderCount} />

      <h2 style={subheadingStyle}>What happens</h2>
      <ul style={listStyle}>
        {(movesEmail(preview.verb) || alsoVerb !== null) && (
          <li>
            {plural(preview.emailCount, 'email', 'emails')} in your inbox
            {preview.olderThanDays !== null && `, older than ${preview.olderThanDays} days`}
          </li>
        )}
        {laterWhen === null ? (
          <>
            <li>{facts.destination}</li>
            {preview.wakeAt !== null && (
              <li>Returns to your inbox {formatWhen(preview.wakeAt, true)}.</li>
            )}
          </>
        ) : (
          // The assistant picked the time, so say the time — once.
          <li>{facts.destination.replace(LATER_PLACEHOLDER, `until ${laterWhen}`)}</li>
        )}
        {facts.alsoTrue.map((line) => (
          <li key={line}>{line}</li>
        ))}
        <li>{facts.undo}</li>
      </ul>

      {failure !== null && (
        <p role="alert" style={{ margin: '16px 0 0', fontSize: text.sm, color: color.dangerText }}>
          {FAILURE_COPY[failure]}
          {failureLink && (
            <>
              {' '}
              <Link href={failureLink.href} style={{ color: 'inherit' }}>
                {failureLink.label}
              </Link>
            </>
          )}
        </p>
      )}

      <div
        // The button's label changes to "Confirming…"; say so to a screen reader.
        aria-live="polite"
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginTop: 24 }}
      >
        <Button tone={BUTTON_TONE[tone]} size="lg" inert={confirming} onClick={state.onConfirm}>
          {confirming ? 'Confirming…' : label}
        </Button>
        {/* Leaving changes nothing: the request stays unconfirmed and expires. */}
        <Link href="/home" style={linkStyle}>
          Not now
        </Link>
      </div>
      <p style={{ ...mutedStyle, marginTop: 12 }}>
        This request expires at {formatWhen(preview.expiresAt, false)}.
      </p>
    </>
  );
}

function Receipt({
  preview,
  outcome,
}: {
  preview: ActionPreviewView;
  outcome: ActionPreviewOutcome;
}) {
  if (outcome.actionStatus === 'failed') {
    // Never a receipt: the job behind this confirmation ended as failed.
    // That covers one that never ran and one that stopped part-way, so
    // the page claims neither and points at the record.
    return (
      <div role="alert">
        <h1 style={headingStyle}>This did not complete</h1>
        <p style={{ ...mutedStyle, marginTop: 8 }}>
          Activity shows what happened. Ask your assistant to prepare it again.
        </p>
        <p style={{ margin: '16px 0 0' }}>
          <Link href="/activity" style={linkStyle}>
            Open Activity
          </Link>
        </p>
      </div>
    );
  }
  const { appliedSenders, requestedEmails, skipped } = outcome;
  const label = requestLabel(preview);
  const alsoVerb = preview.alsoVerb ?? null;
  const began = preview.verb === 'keep' ? 'recorded' : 'started';
  const summary =
    appliedSenders === 0
      ? `${label} was not ${began} for any sender.`
      : appliedSenders === preview.senderCount
        ? `${label} ${began} for ${plural(appliedSenders, 'sender', 'senders')}.`
        : `${label} ${began} for ${appliedSenders.toLocaleString('en-US')} of ${plural(preview.senderCount, 'sender', 'senders')}.`;
  return (
    <>
      {/* "Confirmed" would read as success when no sender was acted on. */}
      <h1 style={headingStyle}>{appliedSenders === 0 ? 'Nothing was started' : 'Confirmed'}</h1>
      <p role="status" style={{ margin: '8px 0 0', fontSize: text.md, lineHeight: 1.6 }}>
        {summary}
        {requestedEmails > 0 && ` It covers ${plural(requestedEmails, 'email', 'emails')}.`}
        {/* Only what the server recorded: a queued job is not "running". */}
        {outcome.actionStatus === 'done' && ' It has finished.'}
      </p>

      {skipped.length > 0 && (
        <>
          {/* With a paired move, these are the senders not unsubscribed;
              their email may still have moved, and each line says so. */}
          <h2 style={subheadingStyle}>{alsoVerb === null ? 'Skipped' : 'Not unsubscribed'}</h2>
          <ul style={listStyle}>
            {skipped.map((sender) => {
              const compose =
                sender.reason === 'mailto' ? gmailComposeHref(sender.composeUrl) : null;
              return (
                <li key={sender.senderId}>
                  <strong>{sender.name ?? 'A sender no longer listed'}</strong>:{' '}
                  {sender.emailMoved === true &&
                    (alsoVerb === 'delete' ? 'Deleted. ' : 'Archived. ')}
                  {SKIP_REASON[sender.reason]}
                  {compose && (
                    <>
                      {' '}
                      <a href={compose} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                        Open Gmail draft
                      </a>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* The assistant learns the outcome only when it asks again. */}
      <p style={{ margin: '20px 0 0', overflowWrap: 'anywhere' }}>
        Go back to {preview.appName?.trim() || 'your assistant'} and tell it you confirmed.
      </p>
      <p style={{ margin: '12px 0 0' }}>
        <Link href="/activity" style={linkStyle}>
          Open Activity
        </Link>
      </p>
    </>
  );
}

const status = (error: unknown): number | null => (error instanceof ApiError ? error.status : null);

/** Signed out: the API client is already sending the browser to sign-in and back. */
const isSignedOut = (error: unknown): boolean => status(error) === 401;

/** Not this person's to see, or not there at all — one answer, by design. */
const isUnavailable = (error: unknown): boolean =>
  status(error) === 404 || apiErrorCode(error) === 'PREVIEW_NOT_FOUND';

const isExpired = (error: unknown): boolean =>
  status(error) === 410 || apiErrorCode(error) === 'PREVIEW_EXPIRED';

/** Branch on the code first: a status alone does not name a cause. */
function failureOf(error: unknown): ConfirmFailure {
  const code = apiErrorCode(error);
  if (code === 'FREE_CAP_REACHED') return 'limit';
  if (code === 'ACTION_TIER_REQUIRED') return 'plan';
  if (code === 'NO_ACTIVE_MAILBOX') return 'mailbox';
  if (code === 'UNSUB_SEND_DISABLED') return 'unsubscribe_off';
  if (status(error) === 503) return 'not_started';
  return 'unknown';
}

/** The live confirm page for `/confirm/<previewId>`. */
export function ConfirmScreen({ previewId }: { previewId: string }) {
  const id = CONFIRM_PREVIEW_ID.test(previewId) ? previewId : null;
  const preview = useActionPreview(id);
  const confirm = useConfirmActionPreview(id);
  // Match the server render (which has no query result) on first paint.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  let state: ConfirmCardState;
  if (id === null) state = { kind: 'unavailable' };
  else if (!mounted || preview.isPending) state = { kind: 'loading' };
  // A signed-out visitor is mid-redirect to sign-in; an error card would
  // flash a cause that is not true.
  else if (preview.isError && isSignedOut(preview.error)) state = { kind: 'loading' };
  else if (preview.isError) {
    state = isUnavailable(preview.error)
      ? { kind: 'unavailable' }
      : isExpired(preview.error)
        ? { kind: 'expired', confirmedEarlier: false }
        : { kind: 'error', onRetry: () => void preview.refetch() };
  } else if (confirm.isError && isSignedOut(confirm.error)) state = { kind: 'loading' };
  else if (confirm.isError && isUnavailable(confirm.error)) state = { kind: 'unavailable' };
  else if ((confirm.isError && isExpired(confirm.error)) || preview.data.state === 'expired') {
    // `confirmedAt` is what the server recorded when the request was read:
    // a press that was itself refused as expired was never recorded.
    state = { kind: 'expired', confirmedEarlier: preview.data.confirmedAt !== null };
  } else if (preview.data.state === 'applied') {
    // The server always sends what an applied request did. If it ever did
    // not, the page must not offer the verb again.
    state =
      preview.data.outcome === null
        ? { kind: 'error', onRetry: () => void preview.refetch() }
        : { kind: 'applied', preview: preview.data, outcome: preview.data.outcome };
  } else {
    state = {
      kind: 'ready',
      preview: preview.data,
      confirming: confirm.isPending,
      failure: confirm.isError ? failureOf(confirm.error) : null,
      // One confirmation per press: the button is inert while one is in
      // flight, and this refuses a second even if something reaches it.
      onConfirm: () => {
        if (!confirm.isPending) confirm.mutate();
      },
    };
  }
  return <ConfirmCard state={state} />;
}
