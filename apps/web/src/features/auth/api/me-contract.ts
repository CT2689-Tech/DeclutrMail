import type {
  MailboxDataDeletionView,
  MailboxIndexedDataState,
  SyncReadiness,
} from '@declutrmail/shared/contracts';
import type { TierId } from '@declutrmail/shared/entitlements';

/**
 * Workspace billing tier as served by `/api/auth/me` (D19). Team and
 * enterprise rank at Pro for feature gates.
 */
export type Tier = TierId;

export interface MeUser {
  id: string;
  email: string;
  workspaceId: string;
  /** IANA timezone used for local Brief generation; null until captured. */
  timezone: string | null;
}

export interface MeMailbox {
  id: string;
  email: string;
  status: 'active' | 'disconnected';
  connectedAt: string | null;
  /** Initial-sync readiness; `null` until the first sync row exists (D116). */
  readiness: SyncReadiness | null;
  /**
   * The Gmail grant is revoked and re-consent is the only fix (D224).
   * Server-computed with the same rule as `syncStatusNeedsReconnect`, so
   * the chrome can gate every broken mailbox — not only the active one —
   * without a per-mailbox status poll on every page.
   *
   * Optional during a rolling API/web deploy (D245), same as
   * `indexedDataState`: absent reads as "no reconnect needed", so the
   * banner stays quiet rather than false-alarming on a stale API.
   */
  needsReconnect?: boolean;
  /** Optional during a rolling API/web deploy (D245). */
  indexedDataState?: MailboxIndexedDataState;
  /** Latest indexed-data deletion request, when any. */
  dataDeletion?: MailboxDataDeletionView | null;
}

export interface Me {
  user: MeUser;
  mailboxes: MeMailbox[];
  activeMailboxId: string | null;
  /** Workspace billing tier (D19) used by frontend entitlement gates. */
  tier: Tier;
  /** Cleanup actions left this period; `null` means unlimited. */
  cleanupRemaining: number | null;
  /** Server-computed next reset instant; the browser never derives it. */
  cleanupResetsAt?: string | null;
}

export const ME_QUERY_KEY = ['auth', 'me'] as const;
