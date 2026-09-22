'use client';

import Link from 'next/link';
import { tokens } from '@declutrmail/shared';
import { SenderDetailRoute } from './sender-detail-page';
import styles from '../sender-workspace.module.css';

const { color, motion, radius } = tokens;

/**
 * Sender Detail as a side pane of the Senders list. Same content, same
 * data hooks, same action → preview → mutation → undo flow as the full
 * page (`SenderDetailRoute` renders both); only the frame differs — a
 * raised card (the parent insets it from the edges) with its own scroll
 * and a sticky, blurred close / full-page bar.
 *
 * The parent owns placement (grid column, drawer, sheet); this fills the
 * height it is given.
 */
export function SenderDetailPane({ senderId, onClose }: { senderId: string; onClose: () => void }) {
  return (
    <aside aria-label="Sender details" data-testid="sender-detail-pane" className={styles.pane}>
      <div className={styles.paneBar}>
        <div>
          <span className={styles.paneBarLabel}>Sender details</span>
          <Link href={`/senders/${encodeURIComponent(senderId)}?from=senders_table`}>
            Open full page
          </Link>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close sender details"
          className="dm-sender-detail-pane-close"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            border: 'none',
            borderRadius: radius.pill,
            background: 'transparent',
            color: color.fgSoft,
            cursor: 'pointer',
            transition: `background ${motion.fast} ${motion.ease}`,
          }}
        >
          <svg
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {/* Keyed by sender so picking another row remounts the content —
          pending previews, receipts and optimistic flips never carry over
          to a different sender. */}
      <SenderDetailRoute key={senderId} id={senderId} layout="pane" onClose={onClose} />
      <style>{`.dm-sender-detail-pane-close:hover{background:${color.fill}}
@media (max-width: 480px){.dm-sender-detail-pane-close{width:44px !important;height:44px !important}}`}</style>
    </aside>
  );
}
