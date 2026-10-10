'use client';

import { useEffect, useId, useRef } from 'react';
import { Button, Kbd, Tooltip, tokens } from '@declutrmail/shared';
import { unsubscribeUnavailableReason } from '@declutrmail/shared/actions';
import {
  canArchive,
  canDelete,
  canLater,
  canUnsubscribe,
  type ActionRequest,
  type ActionVerb,
  type Sender,
} from '../data';
import { isTypingTarget } from '../keyboard';
import {
  isRowBusy,
  RowActivityPill,
  RowActivityStatus,
  rowStatusColor,
  rowStatusLabel,
  STATUS_BUTTON_STYLE,
  takesButtonSlot,
  useRowActivity,
} from '../row-activity';
import type { Verdict } from './types';

const { color, font } = tokens;

/**
 * The canonical verb set — K/A/U/L/D (CLAUDE.md §2.2, ADR-0019).
 *
 * Delete was absent here until 2026-07-26. D40's 2026-05-18 patch
 * enumerated this toolbar as K/A/U/L, but ADR-0019 postdates it and adds
 * Delete as canonical, and CLAUDE.md §3 ranks §2 above D-decisions —
 * ruled stale by the founder. The gap was user-visible in the worst way:
 * a note under every triage queue told users "deleting a sender's mail
 * lives on Senders and Sender Detail", and it did not live here. (That
 * note is gone: the 2026-08-06 amendment to ADR-0019 put Delete in
 * Triage too, so it described a constraint that no longer exists.) Because this toolbar is the only producer of
 * an ActionRequest on the page, the entire Delete branch below it was
 * unreachable.
 *
 * Delete's destructive tone is carried by the mandatory D226 confirm
 * modal (`isDeleteVerb`, red consequence copy), exactly as it is for
 * Archive and Later — the toolbar itself stays tonally uniform.
 *
 * Protect is not in the toolbar; it lives in the header. The
 * "Always-Keep" button is intentionally absent; Protect already serves
 * that safety intent more clearly.
 */
const VERBS: ReadonlyArray<{ verb: ActionVerb; shortcut: string; verdict: Verdict }> = [
  { verb: 'Keep', shortcut: 'K', verdict: 'keep' },
  { verb: 'Archive', shortcut: 'A', verdict: 'archive' },
  { verb: 'Unsubscribe', shortcut: 'U', verdict: 'unsubscribe' },
  { verb: 'Later', shortcut: 'L', verdict: 'later' },
  { verb: 'Delete', shortcut: 'D', verdict: 'delete' },
] as const;

/**
 * Action toolbar (D39 #3, D40 patched by D227).
 *
 * Clicking Archive / Unsubscribe / Later routes through the existing
 * `onAction` callback — which in `senders-screen.tsx` opens the
 * mandatory `<ConfirmActionModal>` (the action preview per D226).
 * Keep applies immediately and records `sender_policy(policy_type=keep)`.
 *
 * All actions have equal emphasis. The separately labelled suggestion
 * explains its own reasoning and freshness without changing action order.
 *
 * `shortcuts` binds K/A/U/L/D to the same `onAction` a click uses and
 * shows the key hints. The full page turns it on; the list's side pane
 * leaves it off — the list owns those keys there — and then shows no
 * hints either, so a key is never advertised where it does nothing.
 */
export function ActionToolbar({
  sender,
  onAction,
  shortcuts = false,
}: {
  sender: Sender;
  onAction: (req: ActionRequest) => void;
  shortcuts?: boolean;
}) {
  const reasonId = useId();
  const unavailableReason = unsubscribeUnavailableReason(sender.unsubscribeMethod);
  // This sender's own in-flight / finished action (see `row-activity`).
  const activity = useRowActivity(sender.id);
  const busy = isRowBusy(activity);

  // Latest values for the key handler, so the listener binds once.
  const live = useRef({ sender, onAction, busy });
  live.current = { sender, onAction, busy };
  useEffect(() => {
    if (!shortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target)) return;
      // Inert while the preview (or any other dialog / menu) is open —
      // same guards as the Senders list's selection shortcuts.
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const entry = VERBS.find((v) => v.shortcut.toLowerCase() === e.key.toLowerCase());
      if (!entry) return;
      const { sender: s, onAction: act, busy: isBusy } = live.current;
      if (isBusy || isVerbUnavailable(entry.verb, s)) return;
      e.preventDefault();
      act({ verb: entry.verb, senders: [s] });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcuts]);

  return (
    <div
      role="toolbar"
      aria-label="Sender actions"
      className="dm-action-toolbar"
      aria-busy={busy || undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        fontFamily: font.sans,
      }}
    >
      {VERBS.map(({ verb, shortcut }) => {
        const disabled = isVerbUnavailable(verb, sender);
        const reason = verb === 'Unsubscribe' ? unavailableReason : null;
        const status =
          activity && takesButtonSlot(activity) && activity.verb === verb.toLowerCase()
            ? activity
            : null;
        const again = status?.phase === 'done';
        const button = (describedBy?: string) => (
          <Button
            tone={status ? 'ghost' : 'default'}
            size="md"
            inert={busy || disabled}
            style={{
              ...(verb === 'Delete' && !disabled ? { color: color.dangerText } : {}),
              ...(status
                ? {
                    ...STATUS_BUTTON_STYLE,
                    color: rowStatusColor(status),
                    ...(again ? { cursor: 'pointer' } : {}),
                  }
                : {}),
            }}
            {...(describedBy ? { ariaDescribedBy: describedBy } : {})}
            onClick={() => onAction({ verb, senders: [sender] })}
            {...(status || !shortcuts
              ? {}
              : {
                  iconRight: (
                    <span className="dm-key-hint">
                      <Kbd>{shortcut}</Kbd>
                    </span>
                  ),
                })}
            ariaLabel={
              status
                ? again
                  ? `${rowStatusLabel(status)} — ${verb} again${shortcuts ? ` (${shortcut})` : ''}`
                  : rowStatusLabel(status)
                : shortcuts
                  ? `${verb} (${shortcut})`
                  : verb
            }
          >
            {status ? <RowActivityStatus activity={status} /> : verb}
          </Button>
        );
        return (
          <span key={verb} data-action={verb.toLowerCase()}>
            {reason ? (
              <Tooltip content={reason}>{({ describedBy }) => button(describedBy)}</Tooltip>
            ) : (
              button()
            )}
          </span>
        );
      })}
      {unavailableReason && (
        <span
          id={reasonId}
          role="note"
          className="dm-action-reason"
          style={{
            flexBasis: '100%',
            gridColumn: '1 / -1',
            fontSize: tokens.text.sm,
            color: color.fgMuted,
          }}
        >
          {unavailableReason}
        </span>
      )}
      {activity && !takesButtonSlot(activity) && <RowActivityPill activity={activity} />}
    </div>
  );
}

function isVerbUnavailable(verb: ActionVerb, sender: Sender): boolean {
  return (
    (verb === 'Archive' && !canArchive(sender)) ||
    (verb === 'Unsubscribe' && !canUnsubscribe(sender)) ||
    (verb === 'Later' && !canLater(sender)) ||
    (verb === 'Delete' && !canDelete(sender))
  );
}
