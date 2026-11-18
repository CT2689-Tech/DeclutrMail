import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import type { ActionJobStatus } from '@declutrmail/db';
import { actionPreviewFacts } from '@declutrmail/shared/actions';
import { decodeCursor, encodeCursor } from '@declutrmail/shared/contracts';

import { ActionsService } from '../actions/actions.service.js';
import { EntitlementsService } from '../common/entitlements/entitlements.service.js';
import { TOKEN_BUCKET_STORE } from '../common/rate-limit/rate-limit.interceptor.js';
import {
  BUCKET_DEFAULTS,
  type ResolvedRateLimit,
  type TokenBucketStore,
} from '../common/rate-limit/rate-limit.types.js';
import {
  canonicalizeGmailProviderAccountId,
  MailboxAccountsService,
} from '../mailboxes/mailbox-accounts.service.js';
import { SendersPolicyService } from '../senders/senders-policy.service.js';
import { encodeCursorKey, takePage } from '../senders/senders.controller.js';
import { SendersReadService } from '../senders/senders.read-service.js';
import type { SenderFacts } from '../senders/senders.types.js';
import { SyncService } from '../sync/sync.service.js';
import { revertDecision } from '../undo/revert-decision.js';
import { UndoService } from '../undo/undo.service.js';
import {
  ActionPreviewsService,
  type DescribedSkip,
  type PreviewDetail,
  type PreviewOwner,
} from './action-previews.service.js';
import { webUrl } from './mcp-config.js';
import {
  MCP_TOOLS,
  type McpToolInput,
  type McpToolName,
  type McpToolOutput,
} from './mcp-tool-contract.js';
import { billingUrl, exceptionCode, McpToolError, settingsUrl } from './mcp-tool-errors.js';
import type { McpPrincipal } from './mcp-token.guard.js';

/** A looping assistant cannot fill the previews table (spec §6). */
const PREVIEWS_PER_GRANT: ResolvedRateLimit = { bucket: 'default', limit: 60, windowSec: 60 };

interface ResolvedMailbox {
  id: string;
  email: string;
}

type Handlers = {
  [N in McpToolName]: (principal: McpPrincipal, args: McpToolInput<N>) => Promise<McpToolOutput<N>>;
};

/**
 * The ten tools (docs/spec/mcp-connector.md §2).
 *
 * Each handler validates, calls the service the web app calls, and
 * shapes the answer — no mail logic of its own (ADR-0048). What leaves
 * is exactly what `mcp-tool-contract.ts` declares: `McpServerService`
 * parses every result through the tool's output schema.
 */
@Injectable()
export class McpToolsService {
  private readonly logger = new Logger(McpToolsService.name);

  constructor(
    private readonly mailboxes: MailboxAccountsService,
    private readonly sync: SyncService,
    private readonly senders: SendersReadService,
    private readonly policy: SendersPolicyService,
    private readonly actions: ActionsService,
    private readonly undo: UndoService,
    private readonly entitlements: EntitlementsService,
    private readonly previews: ActionPreviewsService,
    @Optional() @Inject(TOKEN_BUCKET_STORE) private readonly buckets: TokenBucketStore | null,
  ) {}

  /** Run one tool for one principal. Throws `McpToolError` or what a service threw. */
  async run<N extends McpToolName>(
    name: N,
    principal: McpPrincipal,
    args: McpToolInput<N>,
  ): Promise<McpToolOutput<N>> {
    // Reads and writes draw from the budgets the web app's own routes
    // use, keyed by user, so one person has one allowance (spec §6).
    const bucket = MCP_TOOLS[name].budget === 'write' ? 'gmail-action' : 'triage-load';
    await this.spend(`${bucket}:user:${principal.userId}`, { bucket, ...BUCKET_DEFAULTS[bucket] });
    return this.handlers[name](principal, args);
  }

  private readonly handlers: Handlers = {
    list_mailboxes: async (principal) => {
      const all = await this.mailboxes.listByWorkspace(principal.workspaceId);
      const [active, health, statuses] = await Promise.all([
        this.mailboxes.resolveActiveForRequest(principal),
        this.sync.getMailboxHealth(all.map((m) => m.id)),
        Promise.all(all.map((m) => this.sync.getStatus(m.id))),
      ]);
      return {
        mailboxes: all.map((mailbox, index) => {
          const state = health.get(mailbox.id);
          return {
            address: mailbox.email,
            status: mailbox.status,
            sync_state: state
              ? state.needsReconnect
                ? 'needs_reconnect'
                : state.readiness
              : 'unknown',
            needs_reconnect: state?.needsReconnect ?? false,
            last_synced_at: statuses[index]?.last_synced_at ?? null,
            active: active.kind === 'resolved' && active.id === mailbox.id,
          };
        }),
      };
    },

    list_senders: async (principal, args) => {
      const mailbox = await this.resolveMailbox(principal, args.mailbox);
      const sort = args.sort ?? 'total';
      const limit = args.limit ?? 25;
      const cursor = args.cursor === undefined ? null : decodeCursor(args.cursor);
      if (args.cursor !== undefined && cursor === null) {
        throw new McpToolError('INVALID_REQUEST', 'cursor is not one this tool returned.');
      }
      const [rows, freshness] = await Promise.all([
        this.senders.listSenders({
          mailboxAccountId: mailbox.id,
          category: args.gmail_tab ?? null,
          isProtected: args.protected_only === true ? true : null,
          sort,
          direction: null,
          cursor: cursor ? { key: cursor.key, id: cursor.id } : null,
          limit,
          q: args.q?.trim() || null,
        }),
        this.freshness(mailbox.id),
      ]);
      const { page, nextCursor } = takePage(rows, limit, (row) =>
        encodeCursor({ key: encodeCursorKey(sort, row), id: row.id }),
      );
      return {
        mailbox: mailbox.email,
        ...freshness,
        senders: page.map(senderRow),
        next_cursor: nextCursor,
      };
    },

    get_sender: async (principal, args) => {
      const mailbox = await this.resolveMailbox(principal, args.mailbox);
      const [preview, detail, freshness] = await Promise.all([
        this.actions.previewComposite({ mailboxAccountId: mailbox.id, senderId: args.sender_id }),
        this.senders.getSenderDetail(mailbox.id, args.sender_id),
        this.freshness(mailbox.id),
      ]);
      if (!detail) {
        throw new McpToolError('SENDER_NOT_FOUND', 'No sender with that id in this Gmail account.');
      }
      return {
        mailbox: mailbox.email,
        ...freshness,
        sender: senderRow(detail),
        inbox_email: {
          all: preview.counts.all,
          older_than_30_days: preview.counts.olderThan30d,
          older_than_90_days: preview.counts.olderThan90d,
          older_than_180_days: preview.counts.olderThan180d,
          older_than_365_days: preview.counts.olderThan365d,
        },
        // Subjects and dates only (founder decision 4): never the snippet.
        recent: preview.recentMessages.all.map(({ subject, date }) => ({ subject, date })),
      };
    },

    get_usage: async (principal) => {
      const usage = await this.entitlements.cleanupSummary(principal.workspaceId);
      return {
        plan: usage.tier,
        unit: 'emails',
        limit: usage.limit,
        used: usage.used,
        remaining: usage.remaining,
        resets_at: usage.resetsAt === null ? null : new Date(usage.resetsAt).toISOString(),
      };
    },

    preview_cleanup: async (principal, args) => {
      const mailbox = await this.resolveMailbox(principal, args.mailbox, { forCleanup: true });
      await this.spend(`mcp-preview:grant:${principal.grantId}`, PREVIEWS_PER_GRANT);
      const { preview, skipped } = await this.previews.create({
        owner: owner(principal),
        mailboxAccountId: mailbox.id,
        verb: args.verb,
        alsoVerb: args.existing_email ?? null,
        senderIds: args.sender_ids,
        olderThanDays: args.older_than_days ?? null,
        wakeAt: args.wake_at === undefined ? null : new Date(args.wake_at),
      });
      const facts = actionPreviewFacts(preview.verb, preview.alsoVerb);
      return {
        mailbox: mailbox.email,
        preview_id: preview.id,
        status: 'needs_confirmation',
        confirm_url: confirmUrl(preview.id),
        expires_at: preview.expiresAt.toISOString(),
        verb: preview.verb,
        existing_email: preview.alsoVerb,
        sender_count: preview.senderIds.length,
        email_count: preview.emailCount,
        // With the lines a person would otherwise assume the opposite of
        // (Delete does not stop future email).
        destination: [facts.destination, ...facts.alsoTrue].join(' '),
        undo: facts.undo,
        skipped: skipped.map((skip) => ({
          sender_id: skip.senderId,
          reason: skip.reason,
          compose_url: null,
        })),
      };
    },

    apply_cleanup: async (principal, args) => {
      // A named mailbox must be the preview's own. Unnamed, the preview
      // knows its mailbox, whichever one is active now.
      const named =
        args.mailbox === undefined ? null : await this.resolveMailbox(principal, args.mailbox);
      const detail = await this.previews.apply(
        args.preview_id,
        owner(principal),
        named?.id ?? null,
      );
      return this.appliedOutput(detail);
    },

    get_action_status: async (principal, args) => {
      if ((args.action_id === undefined) === (args.batch_id === undefined)) {
        throw new McpToolError('INVALID_REQUEST', 'Pass exactly one of action_id and batch_id.');
      }
      const mailbox = await this.resolveMailbox(principal, args.mailbox);
      if (args.batch_id !== undefined) {
        const batch = await this.actions.getBatchStatus(args.batch_id, mailbox.id);
        return {
          mailbox: mailbox.email,
          status: batch.status === 'executing' ? 'running' : batch.status,
          requested_emails: batch.requestedCount,
          changed_emails: batch.affectedCount,
          skipped_protected_sender_ids: batch.skippedProtectedSenderIds,
          undo_token: batch.undoToken,
          undo_expires_at: batch.undoExpiresAt,
          undone: batch.undoRevertedAt !== null,
          error_code: batch.failureCodes?.[0] ?? null,
        };
      }
      const action = await this.actions.getStatus(args.action_id!, mailbox.id);
      return {
        mailbox: mailbox.email,
        status: action.status === 'executing' ? 'running' : action.status,
        requested_emails: action.requestedCount,
        changed_emails: action.affectedCount,
        skipped_protected_sender_ids: [],
        undo_token: action.undoToken,
        undo_expires_at: action.undoExpiresAt,
        undone: action.undoRevertedAt !== null,
        error_code: action.errorCode,
      };
    },

    list_recent_actions: async (principal, args) => {
      const mailbox = await this.resolveMailbox(principal, args.mailbox);
      const decisions = await this.undo.listActiveDecisions(mailbox.id, args.limit ?? 20);
      return {
        mailbox: mailbox.email,
        actions: decisions.map((decision) => ({
          undo_token: decision.token,
          verb: decision.actionKind,
          created_at: decision.createdAt.toISOString(),
          undo_expires_at: decision.expiresAt.toISOString(),
          sender_count: decision.senderCount,
          email_count: decision.affectedCount,
          senders: [
            ...new Set(decision.members.flatMap((m) => (m.senderName ? [m.senderName] : []))),
          ].slice(0, 5),
        })),
      };
    },

    undo: async (principal, args) => {
      const mailbox = await this.resolveMailbox(principal, args.mailbox, { forCleanup: true });
      try {
        const result = await revertDecision(
          { undo: this.undo, actions: this.actions },
          mailbox.id,
          args.undo_token,
        );
        return {
          mailbox: mailbox.email,
          undo_token: result.token,
          verb: result.actionKind,
          status: result.reverted ? 'done' : 'queued',
          action_ids: result.actionIds ?? [],
        };
      } catch (error) {
        // The undo route's codes are generic (`NOT_FOUND`, `GONE`); only
        // here is it known what was not found.
        const code = exceptionCode(error);
        if (code === 'NOT_FOUND') {
          throw new McpToolError(
            'UNDO_NOT_FOUND',
            'No action with that undo_token in this Gmail account.',
          );
        }
        if (code === 'GONE') {
          throw new McpToolError('UNDO_EXPIRED', 'The Undo window for this action has closed.');
        }
        throw error;
      }
    },

    protect_sender: async (principal, args) => {
      const mailbox = await this.resolveMailbox(principal, args.mailbox);
      const result = await this.policy.setPolicy({
        mailboxAccountId: mailbox.id,
        senderId: args.sender_id,
        // The literal `true`: this tool cannot unprotect (ADR-0048 rule 2).
        patch: { isProtected: true },
      });
      return {
        mailbox: mailbox.email,
        sender_id: result.senderId,
        protected: true,
        changed: result.changed,
      };
    },
  };

  /** What `apply_cleanup` answers for a preview, applied or still waiting. */
  private async appliedOutput(detail: PreviewDetail): Promise<McpToolOutput<'apply_cleanup'>> {
    const { preview, mailboxEmail } = detail;
    const result = preview.state === 'applied' ? preview.result : null;
    const [skipped, actionStatus]: [DescribedSkip[], ActionJobStatus | null] = result
      ? await Promise.all([
          this.previews.describeSkipped(preview, mailboxEmail, result.skipped),
          this.previews.actionStatus(preview),
        ])
      : [[], null];
    return {
      mailbox: mailboxEmail,
      preview_id: preview.id,
      status: result
        ? 'applied'
        : preview.state === 'confirmed'
          ? 'in_progress'
          : 'needs_confirmation',
      confirm_url: preview.state === 'pending' ? confirmUrl(preview.id) : null,
      expires_at: preview.expiresAt.toISOString(),
      action_id: result?.handle === 'action' ? preview.actionId : null,
      batch_id: result?.handle === 'batch' ? preview.actionId : null,
      action_status: actionStatus === 'executing' ? 'running' : actionStatus,
      applied_senders: result?.appliedSenders ?? null,
      requested_emails: result?.requestedEmails ?? null,
      skipped: skipped.map((skip) => ({
        sender_id: skip.senderId,
        reason: skip.reason,
        compose_url: skip.composeUrl,
      })),
      refused:
        preview.state === 'pending' && preview.refusedCode !== null
          ? refusalOutput(preview.refusedCode)
          : null,
    };
  }

  /**
   * The mailbox a call acts on (spec §2): the named address, or the
   * active one resolved exactly as `CurrentMailboxGuard` resolves it.
   * `forCleanup` also refuses a mailbox Gmail must be reconnected for:
   * a cleanup or an undo there could only fail in the worker.
   */
  private async resolveMailbox(
    principal: McpPrincipal,
    address: string | undefined,
    opts: { forCleanup?: boolean } = {},
  ): Promise<ResolvedMailbox> {
    const all = await this.mailboxes.listByWorkspace(principal.workspaceId);
    let mailbox: ResolvedMailbox | undefined;
    if (address !== undefined) {
      const wanted = canonicalizeGmailProviderAccountId(address);
      const named = all.find((m) => m.email === wanted);
      if (!named) {
        throw new McpToolError(
          'MAILBOX_NOT_FOUND',
          'That Gmail address is not connected to this DeclutrMail account. See list_mailboxes.',
        );
      }
      if (named.status !== 'active') throw reconnectRequired();
      mailbox = named;
    } else {
      const active = await this.mailboxes.resolveActiveForRequest(principal);
      mailbox = active.kind === 'resolved' ? all.find((m) => m.id === active.id) : undefined;
      if (!mailbox) {
        throw new McpToolError(
          'NO_ACTIVE_MAILBOX',
          'No Gmail account is connected to DeclutrMail. Connect one in Settings.',
          { settings_url: settingsUrl() },
        );
      }
    }
    if (opts.forCleanup) {
      const health = await this.sync.getMailboxHealth([mailbox.id]);
      if (health.get(mailbox.id)?.needsReconnect) throw reconnectRequired();
    }
    return { id: mailbox.id, email: mailbox.email };
  }

  /** How current a mailbox's counts are (spec §8 "Sync still running"). */
  private async freshness(
    mailboxAccountId: string,
  ): Promise<Pick<McpToolOutput<'list_senders'>, 'sync_state' | 'as_of' | 'partial'>> {
    const [health, status] = await Promise.all([
      this.sync.getMailboxHealth([mailboxAccountId]),
      this.sync.getStatus(mailboxAccountId),
    ]);
    const state = health.get(mailboxAccountId);
    const syncState = state?.needsReconnect ? 'needs_reconnect' : (state?.readiness ?? 'queued');
    return {
      sync_state: syncState,
      as_of: status?.last_synced_at ?? null,
      // Until the first full scan finishes, a count is a lower bound.
      partial: state?.readiness !== 'ready',
    };
  }

  /** Draw one token; fail open on a store error, as the HTTP limiter does. */
  private async spend(key: string, config: ResolvedRateLimit): Promise<void> {
    if (!this.buckets) return;
    let result;
    try {
      result = await this.buckets.consume(key, config, Date.now());
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          kind: 'rate_limit.store_error',
          bucket: config.bucket,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      return;
    }
    if (!result.allowed) {
      throw new McpToolError(
        'RATE_LIMITED',
        `Too many requests. Try again in ${result.retryAfterSec} seconds.`,
        { retry_after_seconds: result.retryAfterSec },
      );
    }
  }
}

function owner(principal: McpPrincipal): PreviewOwner {
  return {
    userId: principal.userId,
    workspaceId: principal.workspaceId,
    grantId: principal.grantId,
  };
}

/** DeclutrMail's own page — the only place a preview can be confirmed. */
export function confirmUrl(previewId: string): string {
  return `${webUrl()}/confirm/${previewId}`;
}

function reconnectRequired(): McpToolError {
  return new McpToolError(
    'MAILBOX_RECONNECT_REQUIRED',
    'This Gmail account needs to be reconnected to DeclutrMail. Reconnect it in Settings.',
    { settings_url: settingsUrl() },
  );
}

function senderRow(row: SenderFacts): McpToolOutput<'get_sender'>['sender'] {
  return {
    id: row.id,
    name: row.displayName.trim() || row.email,
    address: row.email,
    domain: row.domain,
    gmail_tab: row.gmailCategory,
    total_received: row.totalReceived,
    inbox_count: row.inboxCount,
    first_seen_at: row.firstSeenAt,
    last_seen_at: row.lastSeenAt,
    read_rate: row.readRate,
    protected: row.protectionFlags.isProtected,
    unsubscribe_method: row.unsubscribeMethod ?? 'unknown',
  };
}

/**
 * What the assistant is told when the person's last press was refused.
 * Historical, so it stays true after an upgrade: it says why that press
 * did not start anything, and that a new one is needed.
 */
function refusalOutput(code: string): {
  code: string;
  message: string;
  upgrade_url: string | null;
} {
  const again = 'Nothing was started. Only a new confirmation at confirm_url can start it.';
  switch (code) {
    case 'QUOTA_EXHAUSTED':
      return {
        code,
        message: `The person confirmed, but it would go over the plan's monthly limit. ${again} get_usage shows the limit and when it resets.`,
        upgrade_url: billingUrl(),
      };
    case 'UPGRADE_REQUIRED':
      return {
        code,
        message: `The person confirmed, but their plan does not include this. ${again}`,
        upgrade_url: billingUrl(),
      };
    case 'UNSUBSCRIBE_UNAVAILABLE':
      return {
        code,
        message: `The person confirmed, but unsubscribe requests cannot be sent right now. ${again}`,
        upgrade_url: null,
      };
    default:
      return {
        code,
        message: `The person confirmed, but it could not start. ${again}`,
        upgrade_url: null,
      };
  }
}
