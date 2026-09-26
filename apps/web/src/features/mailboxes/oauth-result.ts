import type { ToastTone } from '@declutrmail/shared';
import { ERROR_CODES, GMAIL_ACCESS_MISSING_RESULT } from '@declutrmail/shared/contracts';

/**
 * The closed results a Gmail connection returns with, and the one line
 * each shows (D108). Read on Settings, by the app chrome and on
 * /onboarding. Someone who has not finished onboarding reaches Settings
 * only to be sent to /onboarding, so every line has to be true on both
 * screens. None names a control only one of them has.
 *
 * Privacy-safe by construction: values are closed, and no provider error,
 * mailbox id or email address from the URL is ever echoed.
 */
export type OAuthResultCopy = {
  message: string;
  tone: ToastTone;
  liveRole: 'status' | 'alert';
};

/** `?reconnect_result=`: a targeted reconnect or reactivation. */
export type ReconnectResult =
  | 'success'
  | 'account_mismatch'
  | 'target_invalid'
  | 'cancelled'
  | 'failed'
  | typeof GMAIL_ACCESS_MISSING_RESULT;

/** `?connect_start_result=`: adding a mailbox, or a start that failed. */
export type ConnectStartResult =
  | 'target_invalid'
  | 'inbox_limit'
  | 'session_retry'
  | 'rate_limited'
  | 'failed'
  | typeof GMAIL_ACCESS_MISSING_RESULT;

export const RECONNECT_RESULT_COPY: Record<ReconnectResult, OAuthResultCopy> = {
  success: {
    message: 'Gmail reconnected.',
    tone: 'success',
    liveRole: 'status',
  },
  account_mismatch: {
    message: 'That was a different Google account. Reconnect with the account you meant.',
    tone: 'danger',
    liveRole: 'alert',
  },
  target_invalid: {
    message: 'Could not match that recovery request to the mailbox you chose. Try again.',
    tone: 'danger',
    liveRole: 'alert',
  },
  cancelled: {
    message: 'Gmail reconnect was cancelled. Nothing changed.',
    tone: 'info',
    liveRole: 'status',
  },
  failed: {
    message: 'Could not reconnect Gmail. Try again.',
    tone: 'danger',
    liveRole: 'alert',
  },
  [GMAIL_ACCESS_MISSING_RESULT]: {
    message: 'DeclutrMail needs Gmail access. Reconnect and allow it on Google’s screen.',
    tone: 'warn',
    liveRole: 'status',
  },
};

export const CONNECT_START_RESULT_COPY: Record<ConnectStartResult, OAuthResultCopy> = {
  target_invalid: {
    message: 'That Gmail recovery request is no longer available. Try again.',
    tone: 'danger',
    liveRole: 'alert',
  },
  inbox_limit: {
    message:
      'Your plan’s Gmail limit is in use. Review your plan or disconnect a mailbox, then try again.',
    tone: 'warn',
    liveRole: 'status',
  },
  session_retry: {
    message: 'We couldn’t verify your session for that Gmail connection. Try again.',
    tone: 'warn',
    liveRole: 'status',
  },
  rate_limited: {
    message: 'Too many Gmail connection attempts. Wait a moment, then try again.',
    tone: 'warn',
    liveRole: 'status',
  },
  [GMAIL_ACCESS_MISSING_RESULT]: {
    message: 'DeclutrMail needs Gmail access. Try again and allow it on Google’s screen.',
    tone: 'warn',
    liveRole: 'status',
  },
  failed: {
    message: 'Could not connect Gmail. Try again.',
    tone: 'danger',
    liveRole: 'alert',
  },
};

/**
 * `?connect_error=` on the plain "connect a Gmail account" return
 * (`google-oauth.controller.ts` → `/triage?connect_error=<code>`).
 *
 * QA-onboarding-20260828-05: `reconnect_account_mismatch` /
 * `reconnect_target_invalid` were dead entries — no code path on this
 * redirect emits them (the Reconnect flow exits through
 * `?reconnect_result=` instead). `MAILBOX_DATA_DELETION_IN_PROGRESS` is a
 * real, reachable code that had no entry and fell to the generic line.
 */
export const CONNECT_ERROR_COPY: Record<string, string> = {
  MAILBOX_OWNED_BY_OTHER_WORKSPACE: ERROR_CODES.MAILBOX_OWNED_BY_OTHER_WORKSPACE.message,
  MAILBOX_DATA_DELETION_IN_PROGRESS: ERROR_CODES.MAILBOX_DATA_DELETION_IN_PROGRESS.message,
  connect_failed: 'Could not connect that Gmail account. Try again.',
};

export function reconnectResultOf(value: string | null): ReconnectResult | null {
  switch (value) {
    case 'success':
    case 'account_mismatch':
    case 'target_invalid':
    case 'cancelled':
    case 'failed':
    case GMAIL_ACCESS_MISSING_RESULT:
      return value;
    default:
      return null;
  }
}

export function connectStartResultOf(value: string | null): ConnectStartResult | null {
  switch (value) {
    case 'target_invalid':
    case 'inbox_limit':
    case 'session_retry':
    case 'rate_limited':
    case 'failed':
    case GMAIL_ACCESS_MISSING_RESULT:
      return value;
    default:
      return null;
  }
}

/** The one closed OAuth result a URL carries, with its copy. */
export function oauthResultIn(
  search: string,
): { param: string; value: string; copy: OAuthResultCopy } | null {
  const params = new URLSearchParams(search);
  const reconnect = reconnectResultOf(params.get('reconnect_result'));
  if (reconnect) {
    return { param: 'reconnect_result', value: reconnect, copy: RECONNECT_RESULT_COPY[reconnect] };
  }
  const connectStart = connectStartResultOf(params.get('connect_start_result'));
  if (connectStart) {
    return {
      param: 'connect_start_result',
      value: connectStart,
      copy: CONNECT_START_RESULT_COPY[connectStart],
    };
  }
  const connectError = params.get('connect_error');
  if (connectError !== null && Object.hasOwn(CONNECT_ERROR_COPY, connectError)) {
    return {
      param: 'connect_error',
      value: connectError,
      copy: { message: CONNECT_ERROR_COPY[connectError]!, tone: 'danger', liveRole: 'alert' },
    };
  }
  return null;
}

/**
 * Where the onboarding gate sends someone who has not finished onboarding,
 * keeping a closed OAuth result so /onboarding can still say what happened.
 * Anything else in the URL stays behind.
 */
export function onboardingPathKeepingOAuthResult(search: string): string {
  const result = oauthResultIn(search);
  if (!result) return '/onboarding';
  return `/onboarding?${new URLSearchParams({ [result.param]: result.value }).toString()}`;
}

/** The query params a one-shot OAuth result arrives in. */
export const OAUTH_RESULT_PARAMS = ['reconnect_result', 'connect_start_result', 'connect_error'];
