'use client';
// apps/web/src/features/settings/senders-policies/senders-policies-screen.tsx
//
// Phase X3 of the sender-bucketing re-design — lets the user see all
// senders that have standing policies in one place + jump to the
// detail page to toggle them off.
//
// Two standing-policy sections ship here:
//   - Protected: server-filtered via `?protected=true`. User clicks
//     "Manage" -> jumps to /senders/[id], toggles Protect off via the
//     existing detail-page chip (D42/D43).
//   - VIP (U23): server-filtered via `?vip=true` with an inline
//     "Remove" affordance — reuses the existing policy PATCH
//     (`useSetSenderPolicy`, SET-STATE `isVip:false`). Non-destructive
//     (no preview/undo lifecycle per the hook's contract).
//
// Lazy-promoted per ADR-0007: lives in apps/web/src/features/settings/
// because settings is the only consumer. Move to packages/shared/ if
// another feature needs the same "Manage standing policies" pattern
// (mobile settings, billing surface, etc.).

import { useMemo } from 'react';
import Link from 'next/link';
import {
  Avatar,
  Button,
  EmptyState,
  ErrorState as RecoverableErrorState,
  Eyebrow,
  toast,
  tokens,
} from '@declutrmail/shared';
import { useSenders } from '@/features/senders/api/use-senders';
import { useSetSenderPolicy } from '@/features/senders/api/use-sender-policy';
import { adaptSenderListRow } from '@/features/senders/api/adapters';
import type { Sender } from '@/features/senders/data';
import { ApiError } from '@/lib/api/client';

const { color, font, space, radius } = tokens;

/**
 * Settings → Senders → standing policies view. Lists every sender with
 * a non-default disposition (Protected + VIP).
 *
 * Pagination (Slice 0 of the senders redesign — ADR-0014 + senders list
 * contract). The BE supports `GET /api/senders?protected=true` so this
 * screen fetches **one** server-filtered page (D202 cursor pagination,
 * `limit=50`) instead of the prior "auto-paginate the entire mailbox +
 * filter client-side" pattern that storms the server at 5k+ senders and
 * makes the on-screen counts visibly animate as pages land. Subsequent
 * pages are loaded on demand via the "Show more" affordance below.
 */
export function SendersPoliciesScreen() {
  const sendersQuery = useSenders({ isProtected: true, limit: 50 });
  const vipQuery = useSenders({ isVip: true, limit: 50 });
  const { fetchNextPage, hasNextPage, isFetchingNextPage, data } = sendersQuery;

  // Every row the server returns is already a Protected sender — we
  // just adapt + sort for stable display order. No client-side filter
  // (the previous `.filter(s => s.protected === true)` is gone with
  // the server-side `protected=true` filter).
  const protectedSenders = useMemo<Sender[]>(() => {
    const pages = data?.pages ?? [];
    return pages
      .flatMap((p) => p.data.map((row) => adaptSenderListRow(row)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const vipSenders = useMemo<Sender[]>(() => {
    const pages = vipQuery.data?.pages ?? [];
    return pages
      .flatMap((p) => p.data.map((row) => adaptSenderListRow(row)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [vipQuery.data]);

  if (sendersQuery.isLoading) return <LoadingState />;
  if (sendersQuery.isError) {
    return <PoliciesErrorState error={sendersQuery.error} onRetry={() => sendersQuery.refetch()} />;
  }

  return (
    <div
      style={{
        padding: '20px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        maxWidth: 1024,
        margin: '0 auto',
        fontFamily: font.sans,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Eyebrow>Settings · standing policies</Eyebrow>
        <h1
          style={{
            fontFamily: font.display,
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: '-0.018em',
            margin: '4px 0 0',
          }}
        >
          Standing policies
        </h1>
        <p style={{ fontSize: 13.5, color: color.fgSoft, marginTop: 6, maxWidth: 640 }}>
          Senders you've pinned with a standing rule. Protected senders skip auto-rules so they
          always stay in your inbox; VIP senders get priority treatment. Manage either from the
          sender's detail page — VIPs can also be removed right here.
        </p>
      </div>

      <section
        style={{
          background: color.card,
          border: `1px solid ${color.line}`,
          borderRadius: radius.lg,
          padding: '0',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            padding: `${space[4]}px ${space[5]}px`,
            borderBottom: `1px solid ${color.lineSoft}`,
          }}
        >
          <div>
            <h2
              style={{
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: '-0.012em',
                margin: 0,
              }}
            >
              Protected
            </h2>
            <p
              style={{
                fontSize: 12.5,
                color: color.fgMuted,
                margin: '4px 0 0',
              }}
            >
              Auto-rules skip these senders. Mail always lands in your inbox.
            </p>
          </div>
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 11,
              color: color.fgMuted,
            }}
          >
            {protectedSenders.length} {protectedSenders.length === 1 ? 'sender' : 'senders'}
          </span>
        </header>

        {protectedSenders.length === 0 ? (
          <div style={{ padding: `${space[5]}px ${space[5]}px` }}>
            <EmptyState
              title="No protected senders yet"
              description="When you mark a sender as Protected from their detail page, it will appear here. Protected senders are skipped by auto-rules and bulk actions."
            />
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {protectedSenders.map((s, i) => (
              <PolicyRow key={s.id} sender={s} isLast={i === protectedSenders.length - 1} />
            ))}
          </ul>
        )}
        {hasNextPage && (
          <footer
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: `${space[3]}px ${space[5]}px`,
              borderTop: `1px solid ${color.lineSoft}`,
            }}
          >
            <Button
              size="sm"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
              aria-label="Show more protected senders"
            >
              {isFetchingNextPage ? 'Loading…' : 'Show more'}
            </Button>
          </footer>
        )}
      </section>

      {/* VIP section (U23) — server-filtered `?vip=true` + inline remove. */}
      <section
        style={{
          background: color.card,
          border: `1px solid ${color.line}`,
          borderRadius: radius.lg,
          padding: '0',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            padding: `${space[4]}px ${space[5]}px`,
            borderBottom: `1px solid ${color.lineSoft}`,
          }}
        >
          <div>
            <h2
              style={{
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: '-0.012em',
                margin: 0,
              }}
            >
              VIP
            </h2>
            <p
              style={{
                fontSize: 12.5,
                color: color.fgMuted,
                margin: '4px 0 0',
              }}
            >
              Senders you starred as VIP. Quiet hours and Autopilot treat their mail as priority.
            </p>
          </div>
          {!vipQuery.isLoading && !vipQuery.isError && (
            <span
              style={{
                fontFamily: font.mono,
                fontSize: 11,
                color: color.fgMuted,
              }}
            >
              {vipSenders.length} {vipSenders.length === 1 ? 'sender' : 'senders'}
            </span>
          )}
        </header>

        {vipQuery.isLoading ? (
          <div
            role="status"
            aria-live="polite"
            style={{ padding: `${space[4]}px ${space[5]}px`, fontSize: 12.5, color: color.fgMuted }}
          >
            Loading VIP senders…
          </div>
        ) : vipQuery.isError ? (
          <div
            style={{
              padding: `${space[4]}px ${space[5]}px`,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 12.5,
              color: color.fgMuted,
            }}
          >
            <span>We couldn&apos;t load your VIP senders.</span>
            <Button size="sm" onClick={() => void vipQuery.refetch()}>
              Try again
            </Button>
          </div>
        ) : vipSenders.length === 0 ? (
          <div style={{ padding: `${space[5]}px ${space[5]}px` }}>
            <EmptyState
              title="No VIP senders yet"
              description="Mark a sender as VIP from their detail page and they'll appear here for quick review or removal."
            />
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {vipSenders.map((s, i) => (
              <VipRow key={s.id} sender={s} isLast={i === vipSenders.length - 1} />
            ))}
          </ul>
        )}
        {vipQuery.hasNextPage && (
          <footer
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: `${space[3]}px ${space[5]}px`,
              borderTop: `1px solid ${color.lineSoft}`,
            }}
          >
            <Button
              size="sm"
              onClick={() => void vipQuery.fetchNextPage()}
              disabled={vipQuery.isFetchingNextPage}
              ariaLabel="Show more VIP senders"
            >
              {vipQuery.isFetchingNextPage ? 'Loading…' : 'Show more'}
            </Button>
          </footer>
        )}
      </section>
    </div>
  );
}

/**
 * One VIP sender row — inline Remove (SET-STATE `isVip:false` via the
 * existing policy PATCH) + the jump-to-detail Manage link.
 */
function VipRow({ sender, isLast }: { sender: Sender; isLast: boolean }) {
  const setPolicy = useSetSenderPolicy();

  return (
    <li
      style={{
        display: 'grid',
        gridTemplateColumns: '40px minmax(0, 1fr) auto auto',
        gap: space[3],
        alignItems: 'center',
        padding: `${space[3]}px ${space[5]}px`,
        borderBottom: isLast ? 'none' : `1px solid ${color.lineSoft}`,
      }}
    >
      <Avatar name={sender.name} domain={sender.domain} size={32} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontWeight: 500,
            fontSize: 14,
            letterSpacing: '-0.005em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {sender.name}
        </div>
        <div
          style={{
            fontFamily: font.mono,
            fontSize: 11,
            color: color.fgMuted,
            marginTop: 2,
          }}
        >
          {sender.domain} · {sender.monthly}/mo
        </div>
      </div>
      <Button
        size="sm"
        disabled={setPolicy.isPending}
        ariaLabel={`Remove VIP from ${sender.name}`}
        onClick={() =>
          setPolicy.mutate(
            { senderId: sender.id, patch: { isVip: false } },
            {
              onSuccess: () => toast(`Removed VIP from ${sender.name}.`, 'success'),
              onError: () =>
                toast(`Could not remove VIP from ${sender.name}. Try again.`, 'danger'),
            },
          )
        }
      >
        {setPolicy.isPending ? 'Removing…' : 'Remove'}
      </Button>
      <Link
        href={`/senders/${sender.id}`}
        style={{ textDecoration: 'none' }}
        aria-label={`Manage ${sender.name}`}
      >
        <Button size="sm">Manage</Button>
      </Link>
    </li>
  );
}

function PolicyRow({ sender, isLast }: { sender: Sender; isLast: boolean }) {
  return (
    <li
      style={{
        display: 'grid',
        gridTemplateColumns: '40px minmax(0, 1fr) auto',
        gap: space[3],
        alignItems: 'center',
        padding: `${space[3]}px ${space[5]}px`,
        borderBottom: isLast ? 'none' : `1px solid ${color.lineSoft}`,
      }}
    >
      <Avatar name={sender.name} domain={sender.domain} size={32} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontWeight: 500,
            fontSize: 14,
            letterSpacing: '-0.005em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {sender.name}
        </div>
        <div
          style={{
            fontFamily: font.mono,
            fontSize: 11,
            color: color.fgMuted,
            marginTop: 2,
          }}
        >
          {sender.domain} · {sender.monthly}/mo
        </div>
      </div>
      <Link
        href={`/senders/${sender.id}`}
        style={{ textDecoration: 'none' }}
        aria-label={`Manage ${sender.name}`}
      >
        <Button size="sm">Manage</Button>
      </Link>
    </li>
  );
}

function LoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: '20px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 1024,
        margin: '0 auto',
        fontFamily: font.sans,
      }}
    >
      {[60, 200, 60].map((h, i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{
            height: h,
            background: color.card,
            border: `1px solid ${color.lineSoft}`,
            borderRadius: radius.lg,
          }}
        />
      ))}
      <span style={{ position: 'absolute', left: -9999 }}>Loading standing policies</span>
    </div>
  );
}

function PoliciesErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const status = error instanceof ApiError ? `The request returned ${error.status}. ` : '';
  return (
    <div
      style={{
        width: '100%',
        boxSizing: 'border-box',
        maxWidth: 720,
        margin: '0 auto',
        padding: '20px clamp(12px, 4vw, 24px) 28px',
        fontFamily: font.sans,
      }}
    >
      <RecoverableErrorState
        title="We couldn't load standing policies"
        description={`${status}Your existing policies remain active. Try again in a moment.`}
        onRetry={onRetry}
      />
    </div>
  );
}
