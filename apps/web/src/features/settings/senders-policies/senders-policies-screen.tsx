'use client';
// apps/web/src/features/settings/senders-policies/senders-policies-screen.tsx
//
// Phase X3 of the sender-bucketing re-design — lets the user see all
// senders that have standing policies in one place + jump to the
// detail page to toggle them off.
//
// Today this surface is READ-ONLY for Protected senders only:
//   - Protected: shipped on the list wire shape (Sender.protected).
//     User clicks "Manage" -> jumps to /senders/[id], toggles Protect
//     off via the existing detail-page chip (D42/D43).
//
// Future iteration (separate PRs):
//   - VIP: needs Sender.vip on the list wire shape (today only on
//     SenderDetail). When wired, add a VIP section here.
//   - One-click "Remove protection" inline (no jump to detail).
//     Needs the senders-mutations slice (TODO(D200) in sender-detail-
//     page.tsx). Until then, the jump-to-detail flow is the safe
//     option — uses the existing mutation path.
//
// Lazy-promoted per ADR-0007: lives in apps/web/src/features/settings/
// because settings is the only consumer. Move to packages/shared/ if
// another feature needs the same "Manage standing policies" pattern
// (mobile settings, billing surface, etc.).

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Avatar, Button, EmptyState, Eyebrow, tokens } from '@declutrmail/shared';
import { useSenders } from '@/features/senders/api/use-senders';
import { adaptSenderListRow } from '@/features/senders/api/adapters';
import type { Sender } from '@/features/senders/data';
import { ApiError } from '@/lib/api/client';

/**
 * Hard cap on auto-paginated page fetches. At the BE-clamped page size
 * of 100 (per `senders.controller.ts` `clampLimit(LIST_LIMIT=100)`),
 * 20 pages = 2000 senders — well above the 90th-percentile mailbox.
 * If a mailbox ever exceeds this, the cap surfaces as a known truncation
 * (visible because the bottom row count won't equal the BE total) and
 * the dedicated `/api/senders?protected=true` endpoint becomes the
 * proper fix (FOUNDER-FOLLOWUPS candidate — see PR #83 review thread).
 */
const MAX_AUTO_PAGES = 20;

const { color, font, space, radius } = tokens;

/**
 * Settings → Senders → standing policies view. Lists every sender
 * with a non-default disposition (Protected today; VIP pending wire).
 *
 * Pagination: this view MUST see every sender to surface every standing
 * policy — a Protected sender on page 2 of the list endpoint is
 * invisible to the user otherwise. The BE clamps `limit` to 100
 * (per `senders.controller.ts` `clampLimit(LIST_LIMIT=100)`), so we
 * auto-fetch every next page until `hasNextPage` flips false. Capped
 * at `MAX_AUTO_PAGES` so a misbehaving cursor cannot infinite-loop.
 * Per Codex review of PR #83 (finding #5) — the prior single-page
 * fetch silently dropped protected senders beyond page 1.
 *
 * Longer term, a dedicated `/api/senders?protected=true` endpoint
 * (BE follow-up) would remove the multi-fetch round-trip entirely.
 */
export function SendersPoliciesScreen() {
  // `limit: 100` matches the BE clamp — passing 200 was silently capped,
  // which made the bug invisible to local testing on small mailboxes.
  const sendersQuery = useSenders({ limit: 100 });
  const { fetchNextPage, hasNextPage, isFetchingNextPage, data } = sendersQuery;

  // Auto-fetch the rest of the pages on mount + whenever a fresh page
  // resolves with `hasNextPage`. TanStack Query dedupes the request so
  // a re-render while one is in flight is harmless. The page cap stops
  // the loop on the rare mailbox that exceeds it.
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    const pageCount = data?.pages.length ?? 0;
    if (pageCount >= MAX_AUTO_PAGES) return;
    void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, data?.pages.length, fetchNextPage]);

  const allSenders = useMemo<Sender[]>(() => {
    const pages = data?.pages ?? [];
    return pages.flatMap((p) => p.data.map((row) => adaptSenderListRow(row)));
  }, [data]);

  const protectedSenders = useMemo(
    () =>
      allSenders.filter((s) => s.protected === true).sort((a, b) => a.name.localeCompare(b.name)),
    [allSenders],
  );

  if (sendersQuery.isLoading) return <LoadingState />;
  if (sendersQuery.isError) {
    return <ErrorState error={sendersQuery.error} onRetry={() => sendersQuery.refetch()} />;
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
          always stay in your inbox. Click a sender to manage its protection from the detail page.
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
      </section>

      {/* Placeholder for VIP section — pending Sender.vip on list wire shape. */}
      <section
        style={{
          background: color.card,
          border: `1px dashed ${color.line}`,
          borderRadius: radius.lg,
          padding: `${space[4]}px ${space[5]}px`,
          color: color.fgMuted,
          fontSize: 12.5,
          fontFamily: font.mono,
        }}
      >
        VIP section coming soon — needs the VIP flag plumbed through the senders list wire shape
        (today VIP is only exposed on the per-sender detail endpoint).
      </section>
    </div>
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

function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message =
    error instanceof ApiError
      ? `We couldn't load your standing policies (${error.status}). Try again in a moment.`
      : "We couldn't load your standing policies right now. Try again in a moment.";
  return (
    <div
      style={{
        padding: '20px 24px 28px',
        maxWidth: 720,
        margin: '0 auto',
        fontFamily: font.sans,
      }}
    >
      <EmptyState
        title="We couldn't load standing policies"
        description={message}
        action={
          <Button tone="primary" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
