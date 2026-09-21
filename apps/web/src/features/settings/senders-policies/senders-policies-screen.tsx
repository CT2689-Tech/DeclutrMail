'use client';
// apps/web/src/features/settings/senders-policies/senders-policies-screen.tsx
//
// Phase X3 of the sender-bucketing re-design, now the STANDING
// protection review (D245).
//
// Onboarding's step 5 reviews at most five weak protections once and is
// then gone forever; a real mailbox carries dozens. This is where the
// rest stay reachable — every protected sender, the exact reason each
// one is protected (CLAUDE.md §2.6), what that protection is shielding,
// and Unprotect in place.
//
// The section is server-filtered via `?protected=true`. "Manage" still
// jumps to /senders/[id] for the full picture; removing protection no
// longer requires the trip.
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
  toast,
  tokens,
  useIsAtMost,
} from '@declutrmail/shared';
import { normalizeProtectionReason, protectionReasonLabel } from '@declutrmail/shared/copy';
import { useSenders } from '@/features/senders/api/use-senders';
import { useSetSenderPolicy } from '@/features/senders/api/use-sender-policy';
import { captureFeatureException } from '@/lib/sentry';

import { enrichSenderRow, type Sender } from '@/features/senders/data';
import { PageHeader } from '../settings-list';

const { color, font, space, radius, text } = tokens;

/**
 * Settings → Senders → standing policies view. Lists every sender with
 * the standing Protected safety state.
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
  const { fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError, data } =
    sendersQuery;

  // Every row the server returns is already a Protected sender — we
  // just adapt + sort for display. No client-side filter (the previous
  // `.filter(s => s.protected === true)` is gone with the server-side
  // `protected=true` filter).
  //
  // Ordered by the UNREAD inbox mail each protection is shielding, so
  // the costliest wrong protection leads — the same ordering the
  // onboarding review uses, because it is the same question. It sorts
  // what is LOADED, not the whole query: the list is keyset-paginated
  // and the sort key is a correlated subquery, so a server-side sort
  // would need a new cursor encoding. The header says which it is
  // rather than implying a global ranking.
  const protectedSenders = useMemo<Sender[]>(() => {
    const pages = data?.pages ?? [];
    return pages.flatMap((p) => p.data.map((row) => enrichSenderRow(row))).sort(byShieldedMail);
  }, [data]);

  // The BE-honest count of protected senders, query-wide rather than
  // cursor-scoped (ADR-0014). `protectedSenders.length` is only what this
  // page happens to have loaded, so it would render the `limit=50` cap as
  // a total. Page 1's value is authoritative for the whole scroll.
  const queryMeta = data?.pages[0]?.meta.query;
  const totalMatching = queryMeta?.totalMatching;

  if (sendersQuery.isLoading) return <LoadingState />;
  // Gated on `data == null`, not bare `isError`. In TanStack v5 the
  // query-wide `isError` also flips on a failed BACKGROUND refetch (a
  // window-focus refetch, or a failed "Show more") while data is
  // retained — so the bare gate replaced a fully-loaded list with
  // "couldn't load protected senders", a false statement that also
  // discards the rows. Same fix `activity-screen.tsx` documents; the
  // footer below owns the next-page failure instead.
  if (sendersQuery.isError && data == null) {
    return <PoliciesErrorState onRetry={() => void sendersQuery.refetch()} />;
  }

  return (
    <div
      className="dm-settings-page"
      style={{
        padding: '20px 24px 40px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 880,
        margin: '0 auto',
        fontFamily: font.sans,
      }}
    >
      <style>{`@media (max-width: 480px) { .dm-settings-page { padding-left: 16px !important; padding-right: 16px !important; } }`}</style>
      <PageHeader title="Protected senders" backToSettings>
        <span
          style={{ fontSize: text.sm, color: color.fgMuted, fontVariantNumeric: 'tabular-nums' }}
        >
          {/* Without a server total, a capped page cannot claim one — say
              what is on screen instead (the Autopilot "latest N" posture). */}
          {totalMatching !== undefined
            ? `${totalMatching.toLocaleString('en-US')} ${totalMatching === 1 ? 'sender' : 'senders'}`
            : hasNextPage
              ? `Showing ${protectedSenders.length.toLocaleString('en-US')}`
              : `${protectedSenders.length.toLocaleString('en-US')} ${
                  protectedSenders.length === 1 ? 'sender' : 'senders'
                }`}
        </span>
      </PageHeader>
      {/* Describe the GUARD, never an outcome we do not control:
          protection stops OUR bulk and automatic actions
          (actions.service.ts), it is not a delivery guarantee, and a
          single action the user takes still applies. Each row carries
          its own reason, so the page does not enumerate them. */}
      <p style={{ fontSize: text.sm, color: color.fgMuted, margin: 0 }}>
        Bulk and automatic actions skip these senders; an action you take on one sender yourself
        still applies.
      </p>

      <section style={{ borderTop: `1px solid ${color.line}` }}>
        {protectedSenders.length === 0 ? (
          <div style={{ padding: `${space[5]}px 0` }}>
            <EmptyState
              title="No protected senders yet"
              /* Must not say protection is something you set by hand:
                 three of the four reasons are AUTOMATIC, and this is the
                 same claim the page's intro paragraph was already fixed
                 for. Naming the automatic triggers also stops an empty
                 result reading as a broken scan. */
              description="Senders you've written to at least three times, starred, or that Gmail keeps marking important are protected automatically."
              action={
                <Link href="/senders" style={{ textDecoration: 'none' }}>
                  <Button size="sm">Browse senders</Button>
                </Link>
              }
            />
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {protectedSenders.map((s) => (
              <PolicyRow key={s.id} sender={s} />
            ))}
          </ul>
        )}
        {hasNextPage && (
          <footer
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: space[3],
              padding: `${space[3]}px 0`,
            }}
          >
            {/* Next-page-scoped failure signal (`isFetchNextPageError`),
                same as `activity-screen.tsx`: the query-wide `isError`
                also flips on a failed background refetch while data is
                retained, which is precisely why the whole-screen error
                above no longer owns this case. */}
            {isFetchNextPageError && (
              <span role="status" style={{ fontSize: text.sm, color: color.amber }}>
                Couldn&rsquo;t load more.
              </span>
            )}
            <Button
              size="sm"
              onClick={() => {
                if (!isFetchingNextPage) void fetchNextPage();
              }}
              disabled={isFetchingNextPage}
              ariaLabel="Show more protected senders"
            >
              {isFetchingNextPage ? 'Loading…' : isFetchNextPageError ? 'Try again' : 'Show more'}
            </Button>
          </footer>
        )}
      </section>
    </div>
  );
}

/**
 * Order by the unread inbox mail each protection is shielding, so the
 * costliest wrong protection leads.
 *
 * UNKNOWN IS NOT ZERO. Both counts are optional on the wire, and
 * coercing an absent one to 0 ranks a sender we have no measurement for
 * as though we had measured nothing — which buries a possibly-costly
 * protection at the bottom of the very screen built to surface it. The
 * same null→0 fabrication the read rate carried. Unknown sorts LAST,
 * after a known zero, matching the convention the onboarding ranking
 * already uses for an unknown read rate.
 */
function byShieldedMail(a: Sender, b: Sender): number {
  return (
    compareKnownDesc(a.unreadInboxCount, b.unreadInboxCount) ||
    compareKnownDesc(a.inboxCount, b.inboxCount) ||
    a.name.localeCompare(b.name)
  );
}

/** Descending by value; a missing measurement sorts after every known one. */
function compareKnownDesc(left: number | null | undefined, right: number | null | undefined) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return right - left;
}

function PolicyRow({ sender }: { sender: Sender }) {
  const setPolicy = useSetSenderPolicy();
  const reason = normalizeProtectionReason(sender.protectionFlags.protectionReason);
  const evidenceStale = sender.protectionFlags.protectionEvidenceCurrent === false;
  const shielded = sender.unreadInboxCount;
  const isPhone = useIsAtMost('xs');

  return (
    <li
      style={{
        display: 'grid',
        gridTemplateColumns: isPhone ? '40px minmax(0, 1fr)' : '40px minmax(0, 1fr) auto',
        gap: space[3],
        alignItems: 'center',
        padding: `${space[3]}px 0`,
        borderBottom: `1px solid ${color.line}`,
      }}
    >
      <Avatar name={sender.name} domain={sender.domain} size={32} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontWeight: 500,
            fontSize: text.md,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {sender.name}
        </div>
        {/* THE REASON (CLAUDE.md §2.6 / D245 — "show the exact reason").
            This list rendered avatar, name and a Manage button and never
            said WHY, while three of the four reasons are automatic — so
            every row looked like something the user had chosen. The
            data was on the wire the whole time; this was a display gap.
            Wording comes from the one shared source, so it reads the
            same here, in Triage, in the Screener and on Sender Detail. */}
        <div style={{ fontSize: text.sm, color: color.fgSoft, marginTop: 2 }}>
          {/* A `replied` shield whose evidence no longer holds says so
              instead of repeating the old claim. ONLY an explicit
              `false` triggers this: `undefined` (older API) and `null`
              (mailbox with no outbound indexed) both mean "no claim to
              contradict", and treating either as unsupported would
              indict every correspondence shield at once. Nothing has
              been unprotected — the sweep never withdraws one — so the
              line says what to do, not what happened. */}
          {evidenceStale
            ? 'Protected · we can no longer confirm you wrote to them'
            : protectionReasonLabel(reason)}
          {/* What the protection is holding back — omitted when we do
              not know (an API predating the field) or when there is
              nothing in the inbox, rather than printed as a confident
              "shielding 0". */}
          {shielded != null && shielded > 0 && (
            <> · shielding {shielded.toLocaleString('en-US')} unread</>
          )}
        </div>
        <div
          style={{
            fontSize: text.sm,
            color: color.fgMuted,
            marginTop: 2,
          }}
        >
          {/* `null` means no timeseries row, not "0 per month". Rendering
              the unknown as 0/mo is the same null→0 fabrication the read
              rate carried, and on this screen it reads as "this sender
              stopped mailing you" — an argument for unprotecting that
              the data never made. */}
          {sender.domain}
          {sender.monthlyVolume != null && ` · ${sender.monthlyVolume} in last 90d`}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space[2],
          flexWrap: 'wrap',
          gridColumn: isPhone ? '1 / -1' : undefined,
          marginTop: isPhone ? space[1] : 0,
        }}
      >
        {/* Unprotect IN PLACE. Sending the user to the detail page to
            toggle a chip made correcting a wrong protection a
            per-sender errand — on a mailbox with 55 of them that is 55
            round trips, which is why nobody ever did it. Nothing moves
            and there is no undo window, but D245 makes it a STICKY
            override: automatic protection will not re-apply. */}
        <Button
          size="sm"
          disabled={setPolicy.isPending}
          ariaLabel={`Unprotect ${sender.name}`}
          onClick={() =>
            setPolicy.mutate(
              {
                senderId: sender.id,
                patch: { isProtected: false },
                unprotect: {
                  surface: 'settings-senders',
                  reason: normalizeProtectionReason(sender.protectionFlags.protectionReason),
                },
              },
              {
                onSuccess: () => toast(`${sender.name} is no longer Protected.`, 'success'),
                onError: (err) => {
                  captureFeatureException(err, { surface: 'senders', reason: 'unprotect' });
                  toast("Couldn't remove protection — try again.", 'warn');
                },
              },
            )
          }
        >
          {setPolicy.isPending ? 'Removing…' : 'Unprotect'}
        </Button>
        <Link
          href={`/senders/${sender.id}`}
          style={{ textDecoration: 'none' }}
          aria-label={`Manage ${sender.name}`}
        >
          <Button size="sm" tone="ghost">
            Manage
          </Button>
        </Link>
      </div>
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
        maxWidth: 880,
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
      <span style={{ position: 'absolute', left: -9999 }}>Loading protected senders</span>
    </div>
  );
}

function PoliciesErrorState({ onRetry }: { onRetry: () => void }) {
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
        title="We couldn't load protected senders"
        description="Your existing policies remain active. Try again in a moment."
        onRetry={onRetry}
      />
    </div>
  );
}
