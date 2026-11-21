import { createHmac } from 'node:crypto';

import {
  createRequestStateCodec,
  inputResponse,
  type RequestStateCodec,
  type ServerContext,
} from '@modelcontextprotocol/server';

import { actionPreviewFacts, ACTION_SEMANTICS } from '@declutrmail/shared/actions';

import type { McpPrincipal } from './mcp-token.guard.js';

/**
 * In-chat confirmation (spec §3, ADR-0048 rule 1): on a client that can
 * show a form (MCP elicitation, protocol 2026-07-28), `apply_cleanup`
 * answers a waiting preview with a prompt the client shows the person.
 * Their Accept is the confirmation; the confirm page stays the path for
 * every other client.
 *
 * The answer comes back on a new request, so the prompt carries a signed
 * `requestState`: which preview it was for, bound to the person and the
 * app, ten minutes long. An Accept counts only when it answers a prompt
 * this server sent for that preview — never one a client made up or
 * moved to another preview.
 */
export const CONFIRM_KEY = 'confirm';

const STATE_KEY_CONTEXT = 'declutrmail.mcp.chat-confirm.v1';

interface ChatConfirmState {
  previewId: string;
}

let codec: RequestStateCodec<ChatConfirmState> | null = null;

/**
 * Keyed from the mandatory `JWT_ACCESS_SECRET` with its own label, like
 * the OAuth cookie key: every instance derives the same key and no new
 * secret is provisioned.
 */
export function chatConfirmCodec(): RequestStateCodec<ChatConfirmState> {
  if (!codec) {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('JWT_ACCESS_SECRET is missing or shorter than 32 bytes.');
    }
    codec = createRequestStateCodec<ChatConfirmState>({
      key: createHmac('sha256', secret).update(STATE_KEY_CONTEXT).digest(),
      ttlSeconds: 600,
      bind: (ctx) => {
        const principal = ctx.http?.authInfo?.extra?.principal as McpPrincipal | undefined;
        return `${ctx.mcpReq.method}\0${principal?.userId ?? ''}\0${principal?.grantId ?? ''}`;
      },
    });
  }
  return codec;
}

/** Tests change the secret between files. */
export function resetChatConfirmCodec(): void {
  codec = null;
}

/** What the person answered this round, for this preview. */
export type ChatAnswer = 'accepted' | 'declined' | 'none';

export function chatAnswer(ctx: ServerContext, previewId: string): ChatAnswer {
  const answer = inputResponse(ctx.mcpReq.inputResponses, CONFIRM_KEY);
  // Verified by the SDK before the handler ran (`requestState.verify`).
  const state = ctx.mcpReq.requestState<ChatConfirmState>();
  if (answer.kind !== 'elicit' || state?.previewId !== previewId) return 'none';
  return answer.action === 'accept' ? 'accepted' : 'declined';
}

export interface PromptFacts {
  verb: Parameters<typeof actionPreviewFacts>[0];
  alsoVerb: 'archive' | 'delete' | null;
  senderCount: number;
  emailCount: number;
  mailbox: string;
}

/**
 * The preview's own copy, written by the server, never by the model:
 * the count, where the email goes, how to undo — once each (§2.3).
 */
export function chatConfirmMessage(facts: PromptFacts): string {
  const { destination, undo, alsoTrue } = actionPreviewFacts(facts.verb, facts.alsoVerb);
  const senders = `${facts.senderCount.toLocaleString('en-US')} ${facts.senderCount === 1 ? 'sender' : 'senders'}`;
  const emails = `${facts.emailCount.toLocaleString('en-US')} ${facts.emailCount === 1 ? 'email' : 'emails'}`;
  const label = ACTION_SEMANTICS[facts.verb].label;
  return [
    `${label} ${emails} from ${senders} in ${facts.mailbox}?`,
    destination,
    ...alsoTrue,
    undo,
  ].join(' ');
}
