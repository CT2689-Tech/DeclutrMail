import { HttpException } from '@nestjs/common';

import { AppException } from '../common/app-exception.js';
import { webUrl } from './mcp-config.js';

/**
 * What a tool tells the assistant when it cannot do what was asked
 * (docs/spec/mcp-connector.md §8). A closed set: the assistant branches
 * on `code`, and relays `message` to the person.
 */
export type McpToolErrorCode =
  | 'INVALID_REQUEST'
  | 'RATE_LIMITED'
  | 'NO_ACTIVE_MAILBOX'
  | 'MAILBOX_NOT_FOUND'
  | 'MAILBOX_RECONNECT_REQUIRED'
  | 'SENDER_NOT_FOUND'
  | 'NO_ACTIONABLE_SENDERS'
  | 'PREVIEW_NOT_FOUND'
  | 'PREVIEW_EXPIRED'
  | 'QUOTA_EXHAUSTED'
  | 'UPGRADE_REQUIRED'
  | 'QUEUE_UNAVAILABLE'
  | 'UNSUBSCRIBE_UNAVAILABLE'
  | 'ACTION_NOT_FOUND'
  | 'UNDO_NOT_FOUND'
  | 'UNDO_EXPIRED'
  | 'UNDO_UNSUPPORTED'
  | 'INTERNAL_ERROR';

type Details = Record<string, string | number | boolean | null | readonly unknown[]>;

export class McpToolError extends Error {
  constructor(
    readonly code: McpToolErrorCode,
    message: string,
    readonly details: Details = {},
  ) {
    super(message);
  }
}

export const settingsUrl = (): string => `${webUrl()}/settings`;
export const billingUrl = (): string => `${webUrl()}/billing`;

/** The `code` a service put on its HTTP exception, if it put one. */
export function exceptionCode(error: unknown): string | null {
  if (error instanceof AppException) return error.code;
  if (!(error instanceof HttpException)) return null;
  const body = error.getResponse();
  if (typeof body === 'object' && body !== null && 'code' in body) {
    const code = (body as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

function exceptionMessage(error: HttpException): string {
  const body = error.getResponse();
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const message = (body as { message: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return error.message;
}

/**
 * Turn whatever a wrapped service threw into a tool error.
 *
 * Only codes named here pass a service's own message through: those are
 * written for people. Anything else — a driver error, a bug — becomes
 * `INTERNAL_ERROR` with a fixed message, because the SDK would otherwise
 * hand the raw exception text to the assistant. Returns `null` for that
 * case so the caller can log what it was.
 */
export function toToolError(error: unknown): McpToolError | null {
  if (error instanceof McpToolError) return error;
  if (!(error instanceof HttpException)) return null;
  const message = exceptionMessage(error);
  switch (exceptionCode(error)) {
    case 'SENDER_NOT_FOUND':
      return new McpToolError('SENDER_NOT_FOUND', message);
    case 'FREE_CAP_REACHED': {
      const details = error instanceof AppException ? (error.details ?? {}) : {};
      return new McpToolError('QUOTA_EXHAUSTED', message, {
        limit: numberOrNull(details.limit),
        used: numberOrNull(details.used),
        remaining: numberOrNull(details.remaining),
        resets_at: typeof details.resetsAt === 'string' ? details.resetsAt : null,
        upgrade_url: billingUrl(),
      });
    }
    case 'ACTION_TIER_REQUIRED':
      return new McpToolError('UPGRADE_REQUIRED', message, { upgrade_url: billingUrl() });
    case 'QUEUE_UNAVAILABLE':
    case 'ACTION_QUEUE_UNAVAILABLE':
    case 'ENQUEUE_FAILED':
      return new McpToolError(
        'QUEUE_UNAVAILABLE',
        'DeclutrMail could not start this right now. Try again in a minute.',
      );
    case 'NO_ACTIONABLE_SENDERS':
      return new McpToolError('NO_ACTIONABLE_SENDERS', message);
    case 'UNSUB_SEND_DISABLED':
      return new McpToolError('UNSUBSCRIBE_UNAVAILABLE', message);
    case 'ACTION_NOT_FOUND':
      return new McpToolError('ACTION_NOT_FOUND', 'No action with that id in this Gmail account.');
    case 'UNSUPPORTED_UNDO':
      return new McpToolError('UNDO_UNSUPPORTED', 'This kind of action cannot be undone.');
    case 'LATER_WAKE_TIME_REQUIRED':
    case 'LATER_WAKE_TIME_INVALID':
    case 'WAKE_TIME_NOT_APPLICABLE':
    case 'BAD_REQUEST':
      return new McpToolError('INVALID_REQUEST', message);
    default:
      // A 400 with no code of its own is a validation message written for
      // the caller (a cursor from another sort, say).
      return error.getStatus() === 400 ? new McpToolError('INVALID_REQUEST', message) : null;
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
