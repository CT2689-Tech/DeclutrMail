// packages/shared/src/components/numeric-display.stories.tsx
//
// Visual reference for the four `NumericDisplay` variants. Per
// ADR-0016 §A1 + D210 — every new shared component ships with
// Storybook coverage of its variants.
//
// Storybook itself is seeded in PR 3 (D210). Until then this file
// uses locally-declared lightweight CSF types so it typechecks
// without `@storybook/react` installed. When the seed lands, swap
// the local `StoryMeta` / `Story` shims for the real imports —
// story shapes do not change.

import { NumericDisplay } from './numeric-display';
import { tokens } from '../tokens/tokens';

const { color, font } = tokens;

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
  parameters?: Record<string, unknown>;
  render?: (args: Parameters<C>[0]) => ReturnType<C>;
};

const meta: StoryMeta<typeof NumericDisplay> = {
  title: 'Primitives/NumericDisplay',
  component: NumericDisplay,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Single shared primitive for primary numerics on the Senders + Sender-Detail surfaces (ADR-0016 §A1). Variants encode the size + weight + tracking pairing. Always tabular-nums.',
      },
    },
  },
};
export default meta;

export const Hero: Story<typeof NumericDisplay> = {
  args: { value: '1247', suffix: 'in last 30d', variant: 'hero' },
};

export const Display: Story<typeof NumericDisplay> = {
  args: { value: 'LinkedIn', variant: 'display' },
};

export const Stat: Story<typeof NumericDisplay> = {
  args: { value: '24/mo', variant: 'stat' },
};

export const Data: Story<typeof NumericDisplay> = {
  args: { value: '13%', variant: 'data' },
};

export const AllVariants: Story<typeof NumericDisplay> = {
  render: () => (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 32,
        padding: 24,
        background: color.bg,
        fontFamily: font.sans,
      }}
    >
      <Row label="hero (Fraunces 40 / 300)">
        <NumericDisplay value="1247" suffix="in last 30d" variant="hero" />
      </Row>
      <Row label="display (Fraunces 28 / 400)">
        <NumericDisplay value="LinkedIn" variant="display" />
      </Row>
      <Row label="stat (Fraunces 20 / 500)">
        <NumericDisplay value="24/mo" variant="stat" />
      </Row>
      <Row label="data (Geist Mono 13 / 500)">
        <NumericDisplay value="13%" variant="data" />
      </Row>
    </div>
  ),
};

export const AllTones: Story<typeof NumericDisplay> = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 32,
        padding: 24,
        background: color.bg,
        fontFamily: font.sans,
      }}
    >
      {(['default', 'primary', 'amber', 'muted'] as const).map((tone) => (
        <div key={tone} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Eyebrow>{tone}</Eyebrow>
          <NumericDisplay value="247" variant="stat" tone={tone} />
        </div>
      ))}
    </div>
  ),
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 24 }}>
      <Eyebrow>{label}</Eyebrow>
      <div>{children}</div>
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: 10,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: color.fgMuted,
        minWidth: 280,
      }}
    >
      {children}
    </div>
  );
}
