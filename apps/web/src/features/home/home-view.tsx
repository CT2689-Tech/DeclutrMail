'use client';

import Link from 'next/link';
import { EmptyState, ErrorState, ScreenIntro, Skeleton, tokens } from '@declutrmail/shared';

import { loadErrorDescription } from '@/lib/load-error-copy';
import { SYNC_FAILED_ACTION, type HomeAction, type HomeStat, type HomeState } from './home-state';

const { color, font, text, radius } = tokens;

/** The screen's single display number — the one size off the `text` scale. */
const HERO_PX = 64;

/**
 * Home — presentational (D198). Props only, so Storybook and tests drive
 * every state without AuthProvider or a QueryClient; `HomeScreen` wires
 * the reads.
 */
export function HomeView({ state }: { state: HomeState }) {
  return (
    <div
      style={{
        maxWidth: 880,
        margin: '0 auto',
        padding: '24px clamp(16px, 4vw, 24px) 40px',
        fontFamily: font.sans,
      }}
    >
      <ScreenIntro id="home" title="How Home works" body="Undone actions are not counted." />
      {/* The number is the page. The heading stays for screen readers and
          the document outline, but a visible "Home" above it says nothing. */}
      <h1
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          margin: -1,
          padding: 0,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        Home
      </h1>
      <HomeBody state={state} />
    </div>
  );
}

function HomeBody({ state }: { state: HomeState }) {
  switch (state.kind) {
    case 'loading':
      return <HomeSkeleton />;
    case 'error':
      return (
        <div style={{ marginTop: 24, maxWidth: 720 }}>
          <ErrorState
            title="We couldn't load Home"
            description={loadErrorDescription(state.error)}
            onRetry={state.retry}
          />
        </div>
      );
    case 'empty':
      return (
        <div style={{ marginTop: 48 }}>
          <EmptyState
            title={state.syncing ? 'Reading your inbox' : 'Nothing cleared yet'}
            action={<PrimaryLink action={state.action} />}
          />
        </div>
      );
    case 'sync-failed':
      // Never "Nothing cleared yet" here: that reads as a healthy, checked
      // mailbox, and a failed scan means it was not.
      return (
        <div style={{ marginTop: 48 }}>
          <EmptyState
            title="Gmail scan failed"
            action={<PrimaryLink action={SYNC_FAILED_ACTION} />}
          />
        </div>
      );
    case 'ready':
      return (
        <section
          aria-label="Your cleanup so far"
          style={{
            marginTop: 72,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
          }}
        >
          <span
            data-testid="home-hero"
            style={{
              fontFamily: font.display,
              fontSize: HERO_PX,
              fontWeight: 300,
              lineHeight: 1,
              letterSpacing: '-0.03em',
              fontVariantNumeric: 'tabular-nums',
              color: color.fg,
            }}
          >
            {state.hero.value.toLocaleString('en-US')}
          </span>
          <p style={{ margin: '12px 0 0', fontSize: text.md, color: color.fgSoft }}>
            {state.hero.label}
            {state.since ? ` since ${formatSince(state.since)}` : ''}
          </p>
          {state.secondary.length > 0 && <SecondaryRow stats={state.secondary} />}
          <div style={{ marginTop: 40 }}>
            <PrimaryLink action={state.action} />
          </div>
        </section>
      );
  }
}

function SecondaryRow({ stats }: { stats: HomeStat[] }) {
  return (
    <dl
      style={{
        margin: '28px 0 0',
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: '12px 32px',
      }}
    >
      {stats.map((stat) => (
        <div key={stat.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <dd
            style={{
              margin: 0,
              fontSize: text.lg,
              fontWeight: 500,
              fontVariantNumeric: 'tabular-nums',
              color: color.fg,
            }}
          >
            {stat.value.toLocaleString('en-US')}
          </dd>
          <dt style={{ fontSize: text.sm, color: color.fgMuted }}>{stat.label}</dt>
        </div>
      ))}
    </dl>
  );
}

/** A link, not a button: it navigates, so it keeps open-in-new-tab. */
function PrimaryLink({ action }: { action: HomeAction }) {
  return (
    <Link
      href={action.href}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: 44,
        padding: '0 22px',
        background: color.primary,
        color: color.fgInverse,
        borderRadius: radius.md,
        fontSize: text.md,
        fontWeight: 600,
        textDecoration: 'none',
      }}
    >
      {action.label}
    </Link>
  );
}

function HomeSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading Home"
      style={{
        marginTop: 72,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
      }}
    >
      <Skeleton variant="rect" width={200} height={HERO_PX} />
      <Skeleton variant="text" width={160} />
      <Skeleton variant="rect" width={168} height={44} />
    </div>
  );
}

/** "Mar 2026" — fixed locale so the label does not shift per browser. */
function formatSince(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
