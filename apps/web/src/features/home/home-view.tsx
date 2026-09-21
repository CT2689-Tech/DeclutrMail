'use client';

import Link from 'next/link';
import { EmptyState, ErrorState, ScreenIntro, Skeleton, tokens } from '@declutrmail/shared';

import { loadErrorDescription } from '@/lib/load-error-copy';
import { SYNC_FAILED_ACTION, type HomeAction, type HomeStat, type HomeState } from './home-state';

const { color, font, motion, shadow, text, radius } = tokens;

/** The screen's single display number — the one size off the `text` scale. */
const HERO_SIZE = 'clamp(72px, 9vw, 120px)';
/** Skeleton stand-in for the hero line box (the clamp's floor). */
const HERO_SKELETON_PX = 72;

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
        // Every state is one centred composition: the block sits in the
        // middle of the space under the 56px top bar, nudged up so it
        // reads as optically centred rather than sagging.
        minHeight: 'calc(100dvh - 56px - var(--dm-tabbar-inset, 0px))',
        boxSizing: 'border-box',
        padding: '24px clamp(16px, 4vw, 32px) 72px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: font.sans,
      }}
    >
      <style>{`
        .dm-home-primary { background: ${color.primary}; }
        .dm-home-primary:hover { background: ${color.primaryDeep}; }
      `}</style>
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
        <div style={{ width: '100%', maxWidth: 720 }}>
          <ErrorState
            title="We couldn't load Home"
            description={loadErrorDescription(state.error)}
            onRetry={state.retry}
          />
        </div>
      );
    case 'empty':
      return (
        <div style={{ width: '100%' }}>
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
        <div style={{ width: '100%' }}>
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
            width: '100%',
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
              fontSize: HERO_SIZE,
              fontWeight: 300,
              lineHeight: 1,
              letterSpacing: '-0.04em',
              fontVariantNumeric: 'tabular-nums',
              color: color.fg,
            }}
          >
            {state.hero.value.toLocaleString('en-US')}
          </span>
          <p style={{ margin: '16px 0 0', fontSize: text.lg, color: color.fgMuted }}>
            {state.hero.label}
            {state.since ? ` since ${formatSince(state.since)}` : ''}
          </p>
          {state.secondary.length > 0 && <SecondaryRow stats={state.secondary} />}
          <div style={{ marginTop: 48 }}>
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
        margin: '48px 0 0',
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: '20px clamp(32px, 6vw, 64px)',
      }}
    >
      {stats.map((stat) => (
        <div key={stat.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <dd
            style={{
              margin: 0,
              fontSize: text.xl,
              fontWeight: 600,
              letterSpacing: '-0.01em',
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
      // `data-dm-button` gives the link the shared press-scale (tokens.css).
      data-dm-button=""
      className="dm-home-primary"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 50,
        padding: '0 28px',
        color: color.fgInverse,
        borderRadius: radius.pill,
        boxShadow: shadow.button,
        fontSize: text.lg,
        fontWeight: 600,
        letterSpacing: '-0.006em',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        transition: `background ${motion.fast} ${motion.ease}, transform ${motion.fast} ${motion.ease}`,
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
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <Skeleton variant="rect" width={240} height={HERO_SKELETON_PX} />
      <div style={{ marginTop: 20 }}>
        <Skeleton variant="text" width={180} />
      </div>
      <div style={{ marginTop: 48, display: 'flex', gap: 48 }}>
        <Skeleton variant="rect" width={72} height={40} />
        <Skeleton variant="rect" width={72} height={40} />
        <Skeleton variant="rect" width={72} height={40} />
      </div>
      <div style={{ marginTop: 48 }}>
        <Skeleton variant="pill" width={188} height={50} />
      </div>
    </div>
  );
}

/** "Mar 2026" — fixed locale so the label does not shift per browser. */
function formatSince(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
