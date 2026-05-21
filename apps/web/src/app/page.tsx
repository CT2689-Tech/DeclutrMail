'use client';

import {
  AppShell,
  Avatar,
  Button,
  Card,
  EmptyState,
  Eyebrow,
  Kbd,
  Pill,
  ScreenIntro,
  Spark,
  ToastHost,
  toast,
  tokens,
} from '@declutrmail/shared';

const { color, font } = tokens;

/**
 * PR-A foundation preview. Proves the design tokens, fonts, app shell,
 * and primitive library render together. The real screens land in PR-B.
 */
export default function FoundationPage() {
  return (
    <>
      <AppShell
        active="senders"
        onNavigate={(id) => toast(`"${id}" — routes land in PR-B`, 'info')}
        counts={{ senders: 26, brief: 3, screener: 4 }}
      >
        <div
          style={{
            padding: '24px 28px',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            maxWidth: 1100,
          }}
        >
          <div>
            <Eyebrow tone="primary">Foundation · PR-A</Eyebrow>
            <h1
              style={{
                fontFamily: font.sans,
                fontSize: tokens.text['3xl'],
                fontWeight: 600,
                letterSpacing: '-0.02em',
                margin: '6px 0 4px',
              }}
            >
              The design system is live.
            </h1>
            <p style={{ fontSize: tokens.text.md, color: color.fgSoft, margin: 0 }}>
              Next.js app shell, warm-newsprint tokens, and the primitive library — the base the
              Senders screen is built on.
            </p>
          </div>

          <ScreenIntro
            id="foundation"
            title="What this screen is"
            body="A preview of the shared foundation: tokens, fonts, the app shell, and every primitive. It is replaced by the real Senders screen in PR-B."
            tip="Click any sidebar item or trust-strip claim to see the toast bus fire."
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 14,
            }}
          >
            <Card>
              <Eyebrow>Buttons</Eyebrow>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                  marginTop: 10,
                }}
              >
                <Button tone="primary" onClick={() => toast('Primary action', 'success')}>
                  Primary
                </Button>
                <Button tone="dark">Dark</Button>
                <Button tone="default">Default</Button>
                <Button tone="warn">Warn</Button>
                <Button tone="danger">Danger</Button>
                <Button tone="ghost">Ghost</Button>
              </div>
            </Card>

            <Card>
              <Eyebrow>Pills</Eyebrow>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  marginTop: 10,
                }}
              >
                <Pill>Updates</Pill>
                <Pill tone="primary">You read</Pill>
                <Pill tone="amber">↑ 3× spike</Pill>
                <Pill tone="red">0 opened</Pill>
                <Pill tone="emerald">Protected</Pill>
                <Pill tone="dark">VIP</Pill>
              </div>
            </Card>

            <Card>
              <Eyebrow>Senders</Eyebrow>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginTop: 12,
                }}
              >
                <Avatar name="LinkedIn" domain="linkedin.com" size={34} />
                <Avatar name="Groupon" domain="groupon.com" size={34} />
                <Avatar name="Old Navy" size={34} />
                <span style={{ marginLeft: 'auto' }}>
                  <Spark values={[44, 52, 49, 47, 58, 61]} color={color.primary} />
                </span>
              </div>
            </Card>

            <Card>
              <Eyebrow>Keyboard</Eyebrow>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 12,
                  fontSize: tokens.text.sm,
                  color: color.fgMuted,
                }}
              >
                <Kbd>K</Kbd> keep
                <Kbd>A</Kbd> archive
                <Kbd>U</Kbd> unsubscribe
                <Kbd>L</Kbd> later
              </div>
            </Card>
          </div>

          <EmptyState
            title="Primitives ready."
            body="Eyebrow, Pill, Kbd, Card, Avatar, Spark, Button, EmptyState, ScreenIntro, Toast, and the app shell are all exported from @declutrmail/shared."
            action={
              <Button tone="primary" onClick={() => toast('Foundation verified', 'success')}>
                Fire a toast
              </Button>
            }
          />
        </div>
      </AppShell>
      <ToastHost />
    </>
  );
}
