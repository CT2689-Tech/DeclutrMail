'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, Card, ErrorState, Logo, tokens } from '@declutrmail/shared';
import { CONNECT_REQUEST_ID, type ConnectorConsent } from '@declutrmail/shared/contracts';

import { ApiError, apiErrorCode } from '@/lib/api/client';
import { captureErrorBoundaryException } from '@/lib/error-capture';
import {
  useConnectorConsent,
  useDecideConnectorConsent,
  useSwitchAccount,
} from './api/use-connector-consent';
import { SCOPE_LABEL, appDisplayName, orderedScopes } from './scope-copy';

const { color, font, text } = tokens;

export type ConsentCardState =
  | { kind: 'loading' }
  /**
   * This request cannot be decided here: expired, already decided,
   * opened in another browser, connector off, or decided but with no
   * safe way back to the app. The page cannot tell which, so it names
   * none of them.
   */
  | { kind: 'gone' }
  | { kind: 'error'; onRetry: () => void }
  | {
      kind: 'ready';
      consent: ConnectorConsent;
      deciding: 'approve' | 'deny' | null;
      /** One sentence: why the last decision did not go through. */
      decisionError: string | null;
      onApprove: () => void;
      onDeny: () => void;
      /** Sign out and back in as someone else, returning to this request. */
      onSwitchAccount: () => void;
      switching: boolean;
    }
  /** Decision recorded; the browser is on its way back to the app. */
  | { kind: 'returning'; redirectHost: string };

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

const mutedStyle = { margin: 0, fontSize: text.sm, color: color.fgMuted } as const;
const listStyle = {
  margin: '8px 0 0',
  paddingLeft: 20,
  fontSize: text.md,
  lineHeight: 1.6,
} as const;

/**
 * The OAuth consent page (docs/spec/mcp-connector.md §4): which app is
 * asking, where it sends the person afterwards, what it may do, and
 * which Gmail accounts it reaches — then Approve or Deny.
 *
 * The app's NAME is whatever the app called itself when it registered,
 * so the page always shows the host the person returns to beside it:
 * that host is the part an impostor cannot choose.
 */
export function ConsentCard({ state }: { state: ConsentCardState }) {
  return (
    <main style={pageStyle}>
      <Logo />
      <Card padding={24} style={{ width: '100%', maxWidth: 440 }}>
        {state.kind === 'loading' ? (
          <p role="status" style={mutedStyle}>
            Loading connection request…
          </p>
        ) : state.kind === 'gone' ? (
          <div role="alert">
            <h1 style={{ margin: 0, fontSize: text.xl }}>
              This connection request is no longer available
            </h1>
            <p style={{ ...mutedStyle, marginTop: 8 }}>Go back to your app and connect again.</p>
          </div>
        ) : state.kind === 'error' ? (
          <ErrorState
            headingLevel={2}
            title="Could not load this connection request"
            description="Try again in a moment."
            onRetry={state.onRetry}
          />
        ) : state.kind === 'returning' ? (
          <p role="status" style={mutedStyle}>
            Returning to {state.redirectHost}…
          </p>
        ) : (
          <ReadyConsent state={state} />
        )}
      </Card>
    </main>
  );
}

/** Why Approve cannot succeed for the signed-in account, as cause + next action. */
const BLOCKED_COPY = {
  not_available:
    'Connecting apps is not available for this account yet. Switch account or choose Deny.',
  deletion_pending: 'Account deletion is scheduled. Cancel it in Settings to connect an app.',
} as const;

function ReadyConsent({ state }: { state: Extract<ConsentCardState, { kind: 'ready' }> }) {
  const { consent, deciding } = state;
  const name = appDisplayName(consent.appName);
  const busy = deciding !== null || state.switching;
  // Known before the press: leave out a button that can only fail.
  const blockedCopy = consent.blocked === null ? null : BLOCKED_COPY[consent.blocked];
  const decisionError = blockedCopy ?? state.decisionError;
  return (
    <>
      <h1 style={{ margin: 0, fontSize: text.xl, overflowWrap: 'anywhere' }}>
        Connect {name} to DeclutrMail?
      </h1>
      <p style={{ ...mutedStyle, marginTop: 8, overflowWrap: 'anywhere' }}>
        You will return to <strong style={{ color: color.fg }}>{consent.redirectHost}</strong>.
      </p>

      <h2 style={{ margin: '20px 0 0', fontSize: text.md }}>{name} will be able to</h2>
      <ul style={listStyle}>
        {orderedScopes(consent.scopes).map((scope) => (
          <li key={scope}>{SCOPE_LABEL[scope]}</li>
        ))}
      </ul>

      <h2 style={{ margin: '20px 0 0', fontSize: text.md }}>Gmail accounts</h2>
      {consent.mailboxes.length === 0 ? (
        <p style={{ ...mutedStyle, marginTop: 8 }}>No Gmail account is connected yet.</p>
      ) : (
        <ul style={{ ...listStyle, overflowWrap: 'anywhere' }}>
          {consent.mailboxes.map((email) => (
            <li key={email}>{email}</li>
          ))}
        </ul>
      )}

      {consent.signedInAs !== null && (
        <p style={{ ...mutedStyle, marginTop: 16, overflowWrap: 'anywhere' }}>
          Signed in as <strong style={{ color: color.fg }}>{consent.signedInAs}</strong>
        </p>
      )}

      {decisionError != null && (
        <p role="alert" style={{ margin: '16px 0 0', fontSize: text.sm, color: color.dangerText }}>
          {decisionError}
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 24 }}>
        {blockedCopy === null && (
          <Button tone="primary" size="lg" inert={busy} onClick={state.onApprove}>
            {deciding === 'approve' ? 'Approving…' : 'Approve'}
          </Button>
        )}
        <Button tone="default" size="lg" inert={busy} onClick={state.onDeny}>
          {deciding === 'deny' ? 'Denying…' : 'Deny'}
        </Button>
        <Button tone="default" size="lg" inert={busy} onClick={state.onSwitchAccount}>
          {state.switching ? 'Switching…' : 'Switch account'}
        </Button>
      </div>
    </>
  );
}

/** A 4xx that means "this request cannot be decided here" rather than "try again". */
function isGone(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 404 || error.status === 410 || apiErrorCode(error) === 'CONNECT_REQUEST_GONE')
  );
}

/** Signed out: the API client is already sending the browser to sign-in and back. */
function isSignedOut(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

function decisionErrorCopy(error: unknown): string {
  if (apiErrorCode(error) === 'CONNECT_DELETION_PENDING') {
    return 'Account deletion is scheduled. Cancel it in Settings to connect an app.';
  }
  if (apiErrorCode(error) === 'CONNECT_NOT_AVAILABLE') {
    return 'Connecting apps is not available for your account yet. Choose Deny to go back to the app.';
  }
  return 'That did not go through. Try again.';
}

/**
 * The only place the browser may be sent after a decision is the API's
 * own resume URL. Anything else is refused rather than followed.
 */
export function isApiResumeUrl(target: string, apiBase: string, pageOrigin: string): boolean {
  let parsed: URL;
  let api: URL;
  try {
    parsed = new URL(target);
    api = new URL(apiBase || pageOrigin);
  } catch {
    // Not an absolute URL: not somewhere this page will send anyone.
    return false;
  }
  const [, requestId] = /^\/oauth\/authorize\/([^/]+)$/.exec(parsed.pathname) ?? [];
  return (
    parsed.origin === api.origin &&
    requestId !== undefined &&
    CONNECT_REQUEST_ID.test(requestId) &&
    parsed.search === '' &&
    parsed.hash === ''
  );
}

/** The live consent page: reads `?request=`, loads it, records the decision. */
export function ConsentScreen() {
  const raw = useSearchParams().get('request');
  const requestId = raw !== null && CONNECT_REQUEST_ID.test(raw) ? raw : null;
  const consent = useConnectorConsent(requestId);
  const decide = useDecideConnectorConsent(requestId);
  const switchAccount = useSwitchAccount();
  const [returning, setReturning] = useState(false);
  // The decision was recorded but the API named a place this page will
  // not send anyone. Nothing the person can press here fixes that.
  const [stranded, setStranded] = useState(false);
  // Match the server render (which has no query result) on first paint.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const choose = (decision: 'approve' | 'deny') => {
    decide.mutate(decision, {
      onSuccess: (redirectTo) => {
        if (
          !isApiResumeUrl(redirectTo, process.env.NEXT_PUBLIC_API_URL ?? '', window.location.origin)
        ) {
          // A deployment fault (the API's public origin and this page's
          // idea of it disagree), not something a retry changes. The URL
          // itself is left out of the report: it carries the request id.
          setStranded(true);
          void captureErrorBoundaryException(
            new Error('Consent decision returned a resume URL this page refuses to follow.'),
            { boundary: 'connect' },
          );
          return;
        }
        setReturning(true);
        window.location.assign(redirectTo);
      },
    });
  };

  let state: ConsentCardState;
  if (requestId === null || stranded) state = { kind: 'gone' };
  else if (!mounted || consent.isPending) state = { kind: 'loading' };
  // A signed-out visitor is mid-redirect to sign-in; an error card would
  // flash a cause that is not true.
  else if (consent.isError && isSignedOut(consent.error)) state = { kind: 'loading' };
  else if (consent.isError) {
    state = isGone(consent.error)
      ? { kind: 'gone' }
      : { kind: 'error', onRetry: () => void consent.refetch() };
  } else if (returning) {
    state = { kind: 'returning', redirectHost: consent.data.redirectHost };
  } else if (decide.isError && isSignedOut(decide.error)) {
    // Signed out between load and press: sign-in is taking over.
    state = { kind: 'loading' };
  } else if (decide.isError && isGone(decide.error)) {
    state = { kind: 'gone' };
  } else {
    state = {
      kind: 'ready',
      consent: consent.data,
      deciding: decide.isPending ? (decide.variables ?? null) : null,
      decisionError: decide.isError ? decisionErrorCopy(decide.error) : null,
      onApprove: () => choose('approve'),
      onDeny: () => choose('deny'),
      onSwitchAccount: () => switchAccount.mutate(),
      switching: switchAccount.isPending || switchAccount.isSuccess,
    };
  }
  return <ConsentCard state={state} />;
}
