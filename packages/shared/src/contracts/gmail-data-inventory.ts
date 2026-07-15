/**
 * D245 cumulative Gmail-data inventory.
 *
 * This is the machine-readable source of truth for what the Gmail adapter
 * fetches, what the database persists or derives, where data is transmitted,
 * what exports contain, and how long each dataset remains. Public privacy
 * copy and adapter allowlists must be generated from this registry rather
 * than maintained as separate prose lists.
 */

export const GMAIL_DATA_RETENTION = {
  mailboxIndex:
    "Until the user deletes this mailbox's indexed data or deletes their DeclutrMail account.",
  mailboxIdentity:
    'The disconnected Gmail address and mailbox deletion status remain until the DeclutrMail account is deleted, so the user can identify and reconnect the mailbox.',
  connection: 'Until the Gmail account is disconnected or the DeclutrMail account is deleted.',
  derivedMailboxData:
    "Until the user deletes this mailbox's indexed data or deletes their DeclutrMail account.",
  undoJournal:
    'Until the plan-based Undo window expires, followed by the operational cleanup period.',
} as const;

export type GmailDataCategory = 'connection' | 'message' | 'derived';
export type GmailDataExportFormat = 'json' | 'csv' | 'senders-csv' | 'decisions-csv';
export type GmailDataProcessor = 'DeclutrMail' | 'Anthropic';
export type GmailDataRemovalTrigger =
  'disconnect' | 'delete-indexed-data' | 'delete-account' | 'retention-policy';

export const GMAIL_OAUTH_ACCESS = [
  {
    scope: 'https://www.googleapis.com/auth/gmail.modify',
    label: 'Read Gmail data and change Gmail labels',
    usedFor:
      'Fetch only the registry fields below; archive, label, move to Trash, and reverse eligible label changes.',
  },
  {
    scope: 'openid email',
    label: 'Identify the connected Google account',
    usedFor: 'Verify and store the connected Gmail address.',
  },
] as const;

export const GMAIL_DATA_PROCESSORS = {
  DeclutrMail: {
    purpose: 'Index the listed Gmail data and provide the product features the user requests.',
    retention: GMAIL_DATA_RETENTION.mailboxIndex,
    privacyUrl: '/privacy',
  },
  Anthropic: {
    purpose:
      'Generate optional Brief narrative and sender-suggestion explanations from selected listed fields.',
    retention:
      'Anthropic states that standard API inputs and outputs are deleted within 30 days, except where longer retention is required for usage-policy enforcement or law, or different contract terms apply.',
    privacyUrl:
      'https://privacy.anthropic.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data',
  },
} as const;

export interface GmailDataInventoryItem {
  /** Stable identifier used by copy, tests, and deletion/export manifests. */
  id: string;
  category: GmailDataCategory;
  /** Plain-language label safe to render directly to users. */
  label: string;
  /** Gmail API envelope fields or headers read to obtain this dataset. */
  fetchedFrom: readonly string[];
  /** Database table.column references that persist this dataset. */
  storageRefs: readonly string[];
  /** Whether the stored value is calculated from fetched Gmail data. */
  derived: boolean;
  /** Product reason for fetching or deriving the dataset. */
  purpose: string;
  /** Exact product retention rule; never an aspirational TTL. */
  retention: string;
  /** User action that removes this dataset from DeclutrMail. */
  removalTrigger: GmailDataRemovalTrigger;
  /** Download formats that currently contain at least part of this dataset. */
  exportedIn: readonly GmailDataExportFormat[];
  /** External processors that receive this dataset in production paths. */
  transmittedTo: readonly GmailDataProcessor[];
  /** Include this item in the public per-message storage list. */
  showInMessageStorageList: boolean;
}

export const GMAIL_MESSAGE_DATA_INVENTORY = [
  {
    id: 'message-identifiers',
    category: 'message',
    label: 'Gmail message and thread IDs',
    fetchedFrom: ['message.id', 'message.threadId'],
    storageRefs: ['mail_messages.provider_message_id', 'mail_messages.provider_thread_id'],
    derived: false,
    purpose:
      'Prevent duplicate indexing, group messages, open the original email, and apply actions.',
    retention: GMAIL_DATA_RETENTION.mailboxIndex,
    removalTrigger: 'delete-indexed-data',
    exportedIn: [],
    transmittedTo: ['DeclutrMail'],
    showInMessageStorageList: true,
  },
  {
    id: 'sender-identity',
    category: 'message',
    label: 'Sender name and email address',
    fetchedFrom: ['header.From'],
    storageRefs: [
      'mail_messages.sender_key',
      'senders.sender_key',
      'senders.email',
      'senders.display_name',
      'senders.domain',
    ],
    derived: false,
    purpose: 'Group email by sender and show who sent it.',
    retention: GMAIL_DATA_RETENTION.mailboxIndex,
    removalTrigger: 'delete-indexed-data',
    exportedIn: ['json', 'csv', 'senders-csv', 'decisions-csv'],
    transmittedTo: ['DeclutrMail', 'Anthropic'],
    showInMessageStorageList: true,
  },
  {
    id: 'subject',
    category: 'message',
    label: 'Subject',
    fetchedFrom: ['header.Subject'],
    storageRefs: ['mail_messages.subject'],
    derived: false,
    purpose: 'Identify messages in previews, Brief, and sender details.',
    retention: GMAIL_DATA_RETENTION.mailboxIndex,
    removalTrigger: 'delete-indexed-data',
    exportedIn: ['json', 'csv'],
    transmittedTo: ['DeclutrMail', 'Anthropic'],
    showInMessageStorageList: true,
  },
  {
    id: 'gmail-preview',
    category: 'message',
    label: 'Gmail Preview (the short snippet shown in your inbox list)',
    fetchedFrom: ['message.snippet'],
    storageRefs: ['mail_messages.snippet'],
    derived: false,
    purpose: 'Give enough context to review a message without fetching its body.',
    retention: GMAIL_DATA_RETENTION.mailboxIndex,
    removalTrigger: 'delete-indexed-data',
    exportedIn: ['json', 'csv'],
    transmittedTo: ['DeclutrMail', 'Anthropic'],
    showInMessageStorageList: true,
  },
  {
    id: 'received-date',
    category: 'message',
    label: 'Received date',
    fetchedFrom: ['message.internalDate'],
    storageRefs: ['mail_messages.internal_date'],
    derived: false,
    purpose: 'Sort email, apply time ranges, and calculate sender activity.',
    retention: GMAIL_DATA_RETENTION.mailboxIndex,
    removalTrigger: 'delete-indexed-data',
    exportedIn: ['json', 'csv'],
    transmittedTo: ['DeclutrMail'],
    showInMessageStorageList: true,
  },
  {
    id: 'gmail-labels',
    category: 'message',
    label: 'Gmail labels',
    fetchedFrom: ['message.labelIds'],
    storageRefs: ['mail_messages.label_ids'],
    derived: false,
    purpose: 'Determine inbox state and apply or reverse label changes.',
    retention: GMAIL_DATA_RETENTION.mailboxIndex,
    removalTrigger: 'delete-indexed-data',
    exportedIn: ['json', 'csv'],
    transmittedTo: ['DeclutrMail'],
    showInMessageStorageList: true,
  },
  {
    id: 'read-state',
    category: 'message',
    label: 'Read or unread state',
    fetchedFrom: ['message.labelIds'],
    storageRefs: ['mail_messages.is_unread'],
    derived: true,
    purpose: 'Show engagement facts and calculate sender-level read rates.',
    retention: GMAIL_DATA_RETENTION.mailboxIndex,
    removalTrigger: 'delete-indexed-data',
    exportedIn: ['json', 'csv'],
    transmittedTo: ['DeclutrMail', 'Anthropic'],
    showInMessageStorageList: true,
  },
  {
    id: 'outbound-state',
    category: 'message',
    label: 'Whether a message was sent by you',
    fetchedFrom: ['message.labelIds'],
    storageRefs: ['mail_messages.is_outbound'],
    derived: true,
    purpose: 'Separate sent mail from received mail and support reply and follow-up features.',
    retention: GMAIL_DATA_RETENTION.mailboxIndex,
    removalTrigger: 'delete-indexed-data',
    exportedIn: [],
    transmittedTo: ['DeclutrMail'],
    showInMessageStorageList: true,
  },
  {
    id: 'outbound-recipients',
    category: 'message',
    label: 'Recipient email addresses from To and Cc on mail you sent',
    fetchedFrom: ['header.To', 'header.Cc'],
    storageRefs: ['mail_messages.recipient_emails'],
    derived: false,
    purpose: 'Attribute replies and show follow-ups for sent mail.',
    retention: GMAIL_DATA_RETENTION.mailboxIndex,
    removalTrigger: 'delete-indexed-data',
    exportedIn: [],
    transmittedTo: ['DeclutrMail'],
    showInMessageStorageList: true,
  },
  {
    id: 'unsubscribe-channels',
    category: 'message',
    label: 'Unsubscribe links and whether one-click unsubscribe is supported',
    fetchedFrom: ['header.List-Unsubscribe', 'header.List-Unsubscribe-Post'],
    storageRefs: [
      'mail_messages.unsubscribe_url',
      'mail_messages.unsubscribe_mailto_url',
      'mail_messages.unsubscribe_one_click',
    ],
    derived: true,
    purpose: 'Offer a supported one-click request or open a prefilled Gmail draft.',
    retention: GMAIL_DATA_RETENTION.mailboxIndex,
    removalTrigger: 'delete-indexed-data',
    exportedIn: [],
    transmittedTo: ['DeclutrMail'],
    showInMessageStorageList: true,
  },
  {
    id: 'message-size-estimate',
    category: 'message',
    label: 'Gmail message size estimate',
    fetchedFrom: ['message.sizeEstimate'],
    storageRefs: ['mail_messages.size_bytes'],
    derived: false,
    purpose: 'Show the approximate encoded size of a message.',
    retention: GMAIL_DATA_RETENTION.mailboxIndex,
    removalTrigger: 'delete-indexed-data',
    exportedIn: [],
    transmittedTo: ['DeclutrMail'],
    showInMessageStorageList: true,
  },
] as const satisfies readonly GmailDataInventoryItem[];

export const GMAIL_CONNECTION_DATA_INVENTORY = [
  {
    id: 'gmail-account-identity',
    category: 'connection',
    label: 'Connected Gmail address and connection status',
    fetchedFrom: ['Google sign-in profile', 'OAuth connection result'],
    storageRefs: ['mailbox_accounts.provider_account_id', 'mailbox_accounts.status'],
    derived: false,
    purpose: 'Identify, switch, disconnect, and reconnect a mailbox.',
    retention: GMAIL_DATA_RETENTION.mailboxIdentity,
    removalTrigger: 'delete-account',
    exportedIn: ['json', 'csv', 'senders-csv', 'decisions-csv'],
    transmittedTo: ['DeclutrMail'],
    showInMessageStorageList: false,
  },
  {
    id: 'oauth-credential',
    category: 'connection',
    label: 'Encrypted Google OAuth credential',
    fetchedFrom: ['Google OAuth token response'],
    storageRefs: [
      'mailbox_accounts.encrypted_refresh_token',
      'mailbox_accounts.dek_encrypted',
      'mailbox_accounts.key_version',
    ],
    derived: false,
    purpose: 'Sync and change Gmail only while the account is connected.',
    retention: GMAIL_DATA_RETENTION.connection,
    removalTrigger: 'disconnect',
    exportedIn: [],
    transmittedTo: ['DeclutrMail'],
    showInMessageStorageList: false,
  },
  {
    id: 'gmail-sync-state',
    category: 'connection',
    label: 'Gmail sync cursors, watch expiry, and last-sync status',
    fetchedFrom: ['profile.historyId', 'watch.historyId', 'watch.expiration'],
    storageRefs: [
      'mailbox_accounts.quiet_state.gmail_watch',
      'provider_sync_state.last_history_id',
      'provider_sync_state.last_synced_at',
      'provider_sync_state.readiness_status',
    ],
    derived: false,
    purpose: 'Resume incremental sync without rescanning the full mailbox.',
    retention: GMAIL_DATA_RETENTION.derivedMailboxData,
    removalTrigger: 'delete-indexed-data',
    exportedIn: [],
    transmittedTo: ['DeclutrMail'],
    showInMessageStorageList: false,
  },
] as const satisfies readonly GmailDataInventoryItem[];

export const GMAIL_DERIVED_DATA_INVENTORY = [
  {
    id: 'sender-profile-and-stats',
    category: 'derived',
    label: 'Sender profiles, categories, volume, read, and reply statistics',
    fetchedFrom: ['sender-identity', 'received-date', 'gmail-labels', 'read-state'],
    storageRefs: ['senders.*', 'sender_timeseries.*'],
    derived: true,
    purpose: 'Summarize who sends mail and show observed activity facts.',
    retention: GMAIL_DATA_RETENTION.derivedMailboxData,
    removalTrigger: 'delete-indexed-data',
    exportedIn: ['json', 'senders-csv'],
    transmittedTo: ['DeclutrMail', 'Anthropic'],
    showInMessageStorageList: false,
  },
  {
    id: 'choices-rules-and-suggestions',
    category: 'derived',
    label: 'Sender choices, protection settings, rules, and generated suggestions',
    fetchedFrom: ['sender-profile-and-stats'],
    storageRefs: [
      'sender_policies.*',
      'triage_decisions.*',
      'automation_rules.*',
      'rule_match_log.*',
      'users.preferences',
    ],
    derived: true,
    purpose: 'Remember user choices and explain or apply explicitly enabled rules.',
    retention: GMAIL_DATA_RETENTION.derivedMailboxData,
    removalTrigger: 'delete-indexed-data',
    exportedIn: ['json', 'senders-csv', 'decisions-csv'],
    transmittedTo: ['DeclutrMail', 'Anthropic'],
    showInMessageStorageList: false,
  },
  {
    id: 'actions-activity-and-undo',
    category: 'derived',
    label: 'Action jobs, Activity records, results, and available Undo data',
    fetchedFrom: ['message-identifiers', 'sender-identity', 'choices-rules-and-suggestions'],
    storageRefs: ['action_jobs.*', 'activity_log.*', 'undo_journal.*'],
    derived: true,
    purpose: 'Run approved changes, show what happened, and reverse eligible actions.',
    retention: `${GMAIL_DATA_RETENTION.derivedMailboxData} Undo payloads use the shorter Undo-journal retention rule.`,
    removalTrigger: 'delete-indexed-data',
    exportedIn: ['json', 'decisions-csv'],
    transmittedTo: ['DeclutrMail'],
    showInMessageStorageList: false,
  },
  {
    id: 'brief-followups-and-screener',
    category: 'derived',
    label: 'Brief snapshots, follow-up status, and Screener quarantine records',
    fetchedFrom: [
      'message-identifiers',
      'sender-identity',
      'subject',
      'gmail-preview',
      'outbound-recipients',
    ],
    storageRefs: ['brief_runs.*', 'followup_tracker.*', 'screener_quarantine.*'],
    derived: true,
    purpose:
      'Build return summaries, track sent-mail replies, and hold unknown senders for review.',
    retention: GMAIL_DATA_RETENTION.derivedMailboxData,
    removalTrigger: 'delete-indexed-data',
    exportedIn: [],
    transmittedTo: ['DeclutrMail', 'Anthropic'],
    showInMessageStorageList: false,
  },
  {
    id: 'processing-and-retry-records',
    category: 'derived',
    label: 'Mailbox processing, delivery, retry, and webhook deduplication records',
    fetchedFrom: ['message-identifiers', 'sender-identity', 'gmail-sync-state'],
    storageRefs: ['outbox_events.*', 'dead_letter_jobs.*', 'webhook_dedup.*'],
    derived: true,
    purpose:
      'Deliver background work once, recover failed jobs, and avoid processing the same Gmail notification twice.',
    retention: GMAIL_DATA_RETENTION.derivedMailboxData,
    removalTrigger: 'delete-indexed-data',
    exportedIn: [],
    transmittedTo: ['DeclutrMail'],
    showInMessageStorageList: false,
  },
] as const satisfies readonly GmailDataInventoryItem[];

export const GMAIL_OPERATIONAL_AUDIT_DATA_INVENTORY = [
  {
    id: 'mailbox-security-and-deletion-audit',
    category: 'connection',
    label: 'Minimal mailbox security and deletion audit records',
    fetchedFrom: ['DeclutrMail connection, security, and deletion lifecycle events'],
    storageRefs: ['mailbox_data_deletion_requests.*', 'security_events.*'],
    derived: true,
    purpose:
      'Investigate security incidents and retain narrowly scoped evidence that a requested deletion ran.',
    retention:
      'These pseudonymous security and compliance records remain after mailbox or account deletion under DeclutrMail operational retention policy; they do not contain message bodies or attachments.',
    removalTrigger: 'retention-policy',
    exportedIn: [],
    transmittedTo: ['DeclutrMail'],
    showInMessageStorageList: false,
  },
] as const satisfies readonly GmailDataInventoryItem[];

export const GMAIL_DATA_INVENTORY = [
  ...GMAIL_CONNECTION_DATA_INVENTORY,
  ...GMAIL_MESSAGE_DATA_INVENTORY,
  ...GMAIL_DERIVED_DATA_INVENTORY,
  ...GMAIL_OPERATIONAL_AUDIT_DATA_INVENTORY,
] as const satisfies readonly GmailDataInventoryItem[];

/** Datasets removed immediately by revoking and nullifying the Gmail connection. */
export const GMAIL_DISCONNECT_DATA_INVENTORY = Object.freeze(
  GMAIL_DATA_INVENTORY.filter((item) => item.removalTrigger === 'disconnect'),
);

/** Remaining mailbox-scoped datasets removed by the durable indexed-data purge. */
export const GMAIL_INDEXED_DATA_DELETION_INVENTORY = Object.freeze(
  GMAIL_DATA_INVENTORY.filter((item) => item.removalTrigger === 'delete-indexed-data'),
);

/** Minimal mailbox records intentionally retained after indexed-data deletion. */
export const GMAIL_INDEXED_DATA_DELETION_RETAINED_INVENTORY = Object.freeze(
  GMAIL_DATA_INVENTORY.filter(
    (item) =>
      item.removalTrigger === 'delete-account' || item.removalTrigger === 'retention-policy',
  ),
);

/** Gmail headers requested by `messages.get?format=metadata`. */
export const GMAIL_METADATA_HEADERS = Object.freeze(
  Array.from(
    new Set(
      GMAIL_MESSAGE_DATA_INVENTORY.flatMap((item) =>
        item.fetchedFrom
          .filter((source) => source.startsWith('header.'))
          .map((source) => source.slice('header.'.length)),
      ),
    ),
  ),
);

/** Public, generated message-storage list used by the trust badge. */
export const GMAIL_MESSAGE_STORAGE_LABELS = Object.freeze(
  GMAIL_MESSAGE_DATA_INVENTORY.filter((item) => item.showInMessageStorageList).map(
    (item) => item.label,
  ),
);

export function gmailDataInventoryItem(id: string): GmailDataInventoryItem | undefined {
  return GMAIL_DATA_INVENTORY.find((item) => item.id === id);
}
