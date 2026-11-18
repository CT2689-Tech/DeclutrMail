import { z } from 'zod';

/**
 * The connector's tool contract (docs/spec/mcp-connector.md §2, §5).
 *
 * Every field a tool can return is declared here, and every one is
 * tagged with the Gmail-data registry dataset it belongs to (ADR-0048
 * rule 3). `mcp-tool-contract.spec.ts` walks these schemas and fails by
 * name on a field with no tag, or a tag whose dataset is not marked
 * `ai-assistant` in `gmail-data-inventory.ts`. A tool's handler parses
 * its result through its schema before returning, so a field that is
 * not declared here cannot leave.
 *
 * Text a sender wrote (names, subjects) is returned only as a field in
 * structured content — never inside a description or an instruction.
 */

/** A registry dataset id, or a value that is not derived from Gmail. */
export type McpFieldDataset =
  | 'gmail-account-identity'
  | 'gmail-sync-state'
  | 'sender-identity'
  | 'sender-profile-and-stats'
  | 'subject'
  | 'received-date'
  | 'gmail-labels'
  | 'unsubscribe-channels'
  | 'choices-rules-and-suggestions'
  | 'actions-activity-and-undo'
  | 'action-previews'
  /** Plan, usage and DeclutrMail links: not Gmail data. */
  | 'not-gmail-data';

/** Field → dataset. A private registry, so the tags never reach the wire schema. */
export const MCP_FIELD_DATASETS = z.registry<{ dataset: McpFieldDataset }>();

function tag<T extends z.ZodType>(schema: T, dataset: McpFieldDataset): T {
  MCP_FIELD_DATASETS.add(schema, { dataset });
  return schema;
}

const iso = (): z.ZodString => z.string();

/* ─────────────────────────────── inputs ─────────────────────────────── */

const mailboxArg = z
  .string()
  .max(320)
  .optional()
  .describe(
    'Gmail address to act on. Omit to use the active one. See list_mailboxes for the addresses.',
  );
const uuid = (): z.ZodString =>
  z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'must be an id');

export const MCP_VERBS = ['keep', 'archive', 'unsubscribe', 'later', 'delete'] as const;
export const MCP_OLDER_THAN_DAYS = [30, 90, 180, 365] as const;
export const MCP_GMAIL_TABS = ['primary', 'promotions', 'social', 'updates', 'forums'] as const;
export const MCP_SENDERS_MAX = 1000;

const inputs = {
  list_mailboxes: z.object({}).strict(),
  list_senders: z
    .object({
      mailbox: mailboxArg,
      sort: z.enum(['total', 'last_seen']).optional().describe('Default: total.'),
      q: z.string().max(200).optional().describe('Match on sender name or address.'),
      gmail_tab: z.enum(MCP_GMAIL_TABS).optional(),
      protected_only: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional().describe('Default: 25.'),
      cursor: z.string().max(512).optional().describe('next_cursor from the previous page.'),
    })
    .strict(),
  get_sender: z.object({ mailbox: mailboxArg, sender_id: uuid() }).strict(),
  get_usage: z.object({}).strict(),
  preview_cleanup: z
    .object({
      mailbox: mailboxArg,
      verb: z.enum(MCP_VERBS),
      sender_ids: z.array(uuid()).min(1).max(MCP_SENDERS_MAX),
      older_than_days: z
        .literal([...MCP_OLDER_THAN_DAYS])
        .optional()
        .describe('Archive, Later and Delete only: act on email older than this many days.'),
      wake_at: z
        .string()
        .datetime({ offset: true })
        .optional()
        .describe('Later only, and required for it: when the email returns to the inbox.'),
    })
    .strict(),
  apply_cleanup: z.object({ mailbox: mailboxArg, preview_id: uuid() }).strict(),
  get_action_status: z
    .object({
      mailbox: mailboxArg,
      action_id: uuid().optional(),
      batch_id: uuid().optional(),
    })
    .strict(),
  list_recent_actions: z
    .object({ mailbox: mailboxArg, limit: z.number().int().min(1).max(50).optional() })
    .strict(),
  undo: z.object({ mailbox: mailboxArg, undo_token: uuid() }).strict(),
  protect_sender: z.object({ mailbox: mailboxArg, sender_id: uuid() }).strict(),
} as const;

/* ─────────────────────────────── outputs ────────────────────────────── */

const mailboxOut = (): z.ZodString => tag(z.string(), 'gmail-account-identity');
const SYNC_STATES = ['queued', 'syncing', 'ready', 'failed', 'needs_reconnect'] as const;

/** How fresh the counts are. `partial` is true until the first full scan is done. */
const freshness = {
  sync_state: tag(z.enum(SYNC_STATES), 'gmail-sync-state'),
  as_of: tag(iso().nullable(), 'gmail-sync-state'),
  partial: tag(z.boolean(), 'gmail-sync-state'),
};

const UNSUBSCRIBE_METHODS = ['one_click', 'mailto', 'none', 'unknown'] as const;

const senderRow = z.object({
  id: tag(z.string(), 'sender-identity'),
  name: tag(z.string(), 'sender-identity'),
  address: tag(z.string(), 'sender-identity'),
  domain: tag(z.string(), 'sender-identity'),
  gmail_tab: tag(z.enum([...MCP_GMAIL_TABS, 'unknown']), 'gmail-labels'),
  total_received: tag(z.number().int(), 'sender-profile-and-stats'),
  inbox_count: tag(z.number().int(), 'sender-profile-and-stats'),
  first_seen_at: tag(iso(), 'sender-profile-and-stats'),
  last_seen_at: tag(iso(), 'sender-profile-and-stats'),
  /** Share of this sender's email that was opened, 0–1; null when unknown. */
  read_rate: tag(z.number().nullable(), 'sender-profile-and-stats'),
  protected: tag(z.boolean(), 'choices-rules-and-suggestions'),
  unsubscribe_method: tag(z.enum(UNSUBSCRIBE_METHODS), 'unsubscribe-channels'),
});

export const MCP_SKIP_REASONS = [
  'protected',
  'not_found',
  'in_progress',
  'mailto',
  'no_channel',
  'unknown',
  'failed',
] as const;

const skipped = z.array(
  z.object({
    sender_id: tag(z.string(), 'sender-identity'),
    reason: tag(z.enum(MCP_SKIP_REASONS), 'action-previews'),
    /**
     * `mailto` only: a Gmail compose link the person sends themself. It
     * also names the mailbox (`authuser=`), which every result already
     * returns as `mailbox`.
     */
    compose_url: tag(z.string().nullable(), 'unsubscribe-channels'),
  }),
);

const outputs = {
  list_mailboxes: z.object({
    mailboxes: z.array(
      z.object({
        address: mailboxOut(),
        status: tag(z.enum(['active', 'disconnected']), 'gmail-account-identity'),
        sync_state: tag(z.enum([...SYNC_STATES, 'unknown']), 'gmail-sync-state'),
        needs_reconnect: tag(z.boolean(), 'gmail-sync-state'),
        last_synced_at: tag(iso().nullable(), 'gmail-sync-state'),
        active: tag(z.boolean(), 'gmail-account-identity'),
      }),
    ),
  }),
  list_senders: z.object({
    mailbox: mailboxOut(),
    ...freshness,
    senders: z.array(senderRow),
    next_cursor: tag(z.string().nullable(), 'not-gmail-data'),
  }),
  get_sender: z.object({
    mailbox: mailboxOut(),
    ...freshness,
    sender: senderRow,
    /** Email in the inbox now: all of it, and the part older than N days. */
    inbox_email: z.object({
      all: tag(z.number().int(), 'sender-profile-and-stats'),
      older_than_30_days: tag(z.number().int(), 'sender-profile-and-stats'),
      older_than_90_days: tag(z.number().int(), 'sender-profile-and-stats'),
      older_than_180_days: tag(z.number().int(), 'sender-profile-and-stats'),
      older_than_365_days: tag(z.number().int(), 'sender-profile-and-stats'),
    }),
    recent: z.array(
      z.object({
        subject: tag(z.string(), 'subject'),
        date: tag(iso(), 'received-date'),
      }),
    ),
  }),
  get_usage: z.object({
    plan: tag(z.string(), 'not-gmail-data'),
    /** What `limit`, `used` and `remaining` count. */
    unit: tag(z.literal('emails'), 'not-gmail-data'),
    /** null on a plan with no monthly limit. */
    limit: tag(z.number().int().nullable(), 'not-gmail-data'),
    used: tag(z.number().int(), 'not-gmail-data'),
    remaining: tag(z.number().int().nullable(), 'not-gmail-data'),
    resets_at: tag(iso().nullable(), 'not-gmail-data'),
  }),
  preview_cleanup: z.object({
    mailbox: mailboxOut(),
    preview_id: tag(z.string(), 'action-previews'),
    status: tag(z.literal('needs_confirmation'), 'action-previews'),
    /** Where the person confirms. Nothing changes until they do. */
    confirm_url: tag(z.string(), 'not-gmail-data'),
    expires_at: tag(iso(), 'action-previews'),
    verb: tag(z.enum(MCP_VERBS), 'action-previews'),
    sender_count: tag(z.number().int(), 'action-previews'),
    email_count: tag(z.number().int(), 'action-previews'),
    destination: tag(z.string(), 'not-gmail-data'),
    undo: tag(z.string(), 'not-gmail-data'),
    skipped,
  }),
  apply_cleanup: z.object({
    mailbox: mailboxOut(),
    preview_id: tag(z.string(), 'action-previews'),
    /**
     * `in_progress`: the person confirmed and the action is being started
     * by another request; call again in a few seconds.
     */
    status: tag(z.enum(['needs_confirmation', 'in_progress', 'applied']), 'action-previews'),
    /** Set while `needs_confirmation`. */
    confirm_url: tag(z.string().nullable(), 'not-gmail-data'),
    expires_at: tag(iso(), 'action-previews'),
    /** Pass to get_action_status. At most one of the two is set. */
    action_id: tag(z.string().nullable(), 'actions-activity-and-undo'),
    batch_id: tag(z.string().nullable(), 'actions-activity-and-undo'),
    /** The started action right now; `failed` means it did not run. */
    action_status: tag(
      z.enum(['queued', 'running', 'done', 'failed']).nullable(),
      'actions-activity-and-undo',
    ),
    applied_senders: tag(z.number().int().nullable(), 'action-previews'),
    requested_emails: tag(z.number().int().nullable(), 'action-previews'),
    skipped,
  }),
  get_action_status: z.object({
    mailbox: mailboxOut(),
    status: tag(z.enum(['queued', 'running', 'done', 'failed']), 'actions-activity-and-undo'),
    requested_emails: tag(z.number().int(), 'actions-activity-and-undo'),
    changed_emails: tag(z.number().int(), 'actions-activity-and-undo'),
    /** Senders skipped because they became Protected after the confirmation. */
    skipped_protected_sender_ids: z.array(tag(z.string(), 'sender-identity')),
    undo_token: tag(z.string().nullable(), 'actions-activity-and-undo'),
    undo_expires_at: tag(iso().nullable(), 'actions-activity-and-undo'),
    undone: tag(z.boolean(), 'actions-activity-and-undo'),
    error_code: tag(z.string().nullable(), 'actions-activity-and-undo'),
  }),
  list_recent_actions: z.object({
    mailbox: mailboxOut(),
    actions: z.array(
      z.object({
        undo_token: tag(z.string(), 'actions-activity-and-undo'),
        verb: tag(z.string(), 'actions-activity-and-undo'),
        created_at: tag(iso(), 'actions-activity-and-undo'),
        undo_expires_at: tag(iso(), 'actions-activity-and-undo'),
        sender_count: tag(z.number().int(), 'actions-activity-and-undo'),
        email_count: tag(z.number().int().nullable(), 'actions-activity-and-undo'),
        /** Up to five sender names. */
        senders: z.array(tag(z.string(), 'sender-identity')),
      }),
    ),
  }),
  undo: z.object({
    mailbox: mailboxOut(),
    undo_token: tag(z.string(), 'actions-activity-and-undo'),
    verb: tag(z.string(), 'actions-activity-and-undo'),
    status: tag(z.enum(['queued', 'done']), 'actions-activity-and-undo'),
    /** The reverse actions; pass one to get_action_status. */
    action_ids: z.array(tag(z.string(), 'actions-activity-and-undo')),
  }),
  protect_sender: z.object({
    mailbox: mailboxOut(),
    sender_id: tag(z.string(), 'sender-identity'),
    protected: tag(z.literal(true), 'choices-rules-and-suggestions'),
    changed: tag(z.boolean(), 'choices-rules-and-suggestions'),
  }),
} as const;

/* ──────────────────────────────── tools ─────────────────────────────── */

export type McpToolName = keyof typeof inputs;
export type McpToolInput<N extends McpToolName> = z.infer<(typeof inputs)[N]>;
export type McpToolOutput<N extends McpToolName> = z.infer<(typeof outputs)[N]>;

export interface McpToolSpec<N extends McpToolName = McpToolName> {
  name: N;
  title: string;
  description: string;
  /** OAuth scope the grant must hold. */
  scope: 'read' | 'cleanup';
  /** Which per-user rate budget a call draws from (spec §6). */
  budget: 'read' | 'write';
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    /** DeclutrMail's own data, not the open web. */
    openWorldHint: false;
  };
  input: (typeof inputs)[N];
  output: (typeof outputs)[N];
}

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function spec<N extends McpToolName>(
  name: N,
  rest: Omit<McpToolSpec<N>, 'name' | 'input' | 'output'>,
): McpToolSpec<N> {
  return { name, ...rest, input: inputs[name], output: outputs[name] };
}

/** The ten tools, in the order `tools/list` returns them. */
export const MCP_TOOLS = {
  list_mailboxes: spec('list_mailboxes', {
    title: 'List Gmail accounts',
    description:
      'List the Gmail accounts connected to DeclutrMail, their sync state, and which one is active.',
    scope: 'read',
    budget: 'read',
    annotations: READ_ONLY,
  }),
  list_senders: spec('list_senders', {
    title: 'List senders',
    description:
      'List who sends email to a Gmail account, with counts, read rate, Protected state and unsubscribe method. Sorted by total email by default.',
    scope: 'read',
    budget: 'read',
    annotations: READ_ONLY,
  }),
  get_sender: spec('get_sender', {
    title: 'Get one sender',
    description:
      'Details for one sender: how much of their email is in the inbox by age, and the subjects and dates of their five most recent emails.',
    scope: 'read',
    budget: 'read',
    annotations: READ_ONLY,
  }),
  get_usage: spec('get_usage', {
    title: 'Get plan usage',
    description: 'The DeclutrMail plan, and how many emails of its monthly cleanup limit are used.',
    scope: 'read',
    budget: 'read',
    annotations: READ_ONLY,
  }),
  preview_cleanup: spec('preview_cleanup', {
    title: 'Preview a cleanup',
    description:
      'Prepare Keep, Archive, Unsubscribe, Later or Delete for one or more senders. Changes nothing in Gmail. Returns a preview and a confirm_url: give that link to the person, who confirms in DeclutrMail. Protected senders are skipped.',
    scope: 'cleanup',
    budget: 'read',
    annotations: READ_ONLY,
  }),
  apply_cleanup: spec('apply_cleanup', {
    title: 'Apply a confirmed cleanup',
    description:
      'Apply a preview the person has confirmed in DeclutrMail. Until they confirm, this returns needs_confirmation and the confirm_url, and changes nothing. Calling it again returns the same result; in_progress means it is starting, so call again shortly.',
    scope: 'cleanup',
    budget: 'write',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  }),
  get_action_status: spec('get_action_status', {
    title: 'Get action status',
    description:
      'Progress of an applied cleanup or an undo: status, emails changed, and whether it can still be undone. Pass action_id or batch_id.',
    scope: 'read',
    budget: 'read',
    annotations: READ_ONLY,
  }),
  list_recent_actions: spec('list_recent_actions', {
    title: 'List actions that can be undone',
    description: 'Recent cleanups that can still be undone, newest first, with when Undo expires.',
    scope: 'read',
    budget: 'read',
    annotations: READ_ONLY,
  }),
  undo: spec('undo', {
    title: 'Undo a cleanup',
    description:
      'Put back the email an Archive, Later or Delete moved, using its undo_token. An unsubscribe request cannot be undone.',
    scope: 'cleanup',
    budget: 'write',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }),
  protect_sender: spec('protect_sender', {
    title: 'Protect a sender',
    description:
      'Mark a sender as Protected, so cleanups skip it. Removing protection is done in DeclutrMail, not here.',
    scope: 'cleanup',
    budget: 'write',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }),
} as const satisfies { [N in McpToolName]: McpToolSpec<N> };

export const MCP_TOOL_NAMES = Object.keys(MCP_TOOLS) as McpToolName[];
