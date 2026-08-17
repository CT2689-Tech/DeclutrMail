// Storybook CSF3 stories for the brand logo (D255 + ADR-0036).
//
// Storybook itself is seeded in PR 3 (D210). Until then this file uses
// locally-declared lightweight CSF types so it typechecks without
// `@storybook/react` installed. When the seed lands, swap the local
// `Meta` / `StoryObj` shims for the real imports — story shapes do
// not change.
//
// `SizeLadder` and `SmallCut` are the two that earn their keep: the
// mark is drawn at two cuts and the swap happens at 24px, so a
// regression there is invisible in any single-size story.

import type { ComponentProps } from 'react';
import { Logo } from './logo';
import { color } from '../tokens/tokens';

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

const meta: StoryMeta<typeof Logo> = {
  title: 'Brand/Logo',
  component: Logo,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'DeclutrMail identity: an envelope whose frame breaks at the top right, with one unbroken stroke through the gap. Geometry and colour are specification, not theme — see ADR-0036. Colours are literal hexes and do NOT follow the palette; `duo` auto-inverts to paper + mint under `[data-theme="dark"]` via `light-dark()`.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type LogoArgs = ComponentProps<typeof Logo>;

const Surface = ({ children, theme }: { children: React.ReactNode; theme?: 'dark' }) => (
  <div
    data-theme={theme}
    style={{
      background: color.bg,
      padding: 32,
      display: 'flex',
      alignItems: 'center',
      gap: 32,
      flexWrap: 'wrap',
    }}
  >
    {children}
  </div>
);

/** Default — horizontal lockup, duo tone, on the warm-newsprint surface. */
export const Default: Story<typeof Logo> = {
  args: { variant: 'horizontal', tone: 'duo', size: 28 },
  render: (args: LogoArgs) => (
    <Surface>
      <Logo {...args} />
    </Surface>
  ),
};

/**
 * The size at which the marketing header and footer actually render it
 * (27px, matching the placeholder it replaces). Pinning the real
 * production size means a geometry regression shows up here first.
 */
export const HeaderSize: Story<typeof Logo> = {
  args: { size: 27, label: null },
  render: (args: LogoArgs) => (
    <Surface>
      <Logo {...args} />
    </Surface>
  ),
};

/**
 * Dark mode with NO tone prop — this is the story that proves the
 * auto-inversion. `duo` resolves through `light-dark()`, so the same
 * markup that renders ink-on-paper above renders paper-on-ink here.
 * Before this, deep teal on ink measured 2.96:1 and the ink frame
 * 1.01:1 — invisible.
 */
export const DarkMode: Story<typeof Logo> = {
  args: { variant: 'horizontal', tone: 'duo', size: 28 },
  parameters: { backgrounds: { default: 'dark' } },
  render: (args: LogoArgs) => (
    <Surface theme="dark">
      <Logo {...args} />
    </Surface>
  ),
};

/**
 * Size ladder — the two-cut swap happens between 24 and 25px. Anything
 * at or below 24 uses the heavy geometry (stroke 7, shorter tail,
 * wider gap); above it uses the regular cut (stroke 5.5).
 */
export const SizeLadder: Story<typeof Logo> = {
  args: { variant: 'mark' },
  render: (args: LogoArgs) => (
    <Surface>
      {[16, 20, 24, 25, 28, 32, 48, 64, 96].map((size) => (
        <div key={size} style={{ textAlign: 'center' }}>
          <Logo {...args} size={size} label={null} />
          <div style={{ fontSize: 11, color: color.fgMuted, marginTop: 8 }}>{size}px</div>
        </div>
      ))}
    </Surface>
  ),
};

/**
 * The 24/25 boundary, side by side. These two are one pixel apart in
 * size and deliberately different drawings — if they ever look like
 * the same drawing scaled, the two-cut rule has been lost.
 */
export const SmallCut: Story<typeof Logo> = {
  args: { variant: 'mark' },
  render: (args: LogoArgs) => (
    <Surface>
      {[24, 25].map((size) => (
        <div key={size} style={{ textAlign: 'center' }}>
          <Logo {...args} size={size} label={null} />
          <div style={{ fontSize: 11, color: color.fgMuted, marginTop: 8 }}>
            {size}px · {size <= 24 ? 'heavy' : 'regular'}
          </div>
        </div>
      ))}
    </Surface>
  ),
};

/** Every variant at one size. */
export const Variants: Story<typeof Logo> = {
  render: () => (
    <Surface>
      {(['horizontal', 'stacked', 'mark'] as const).map((variant) => (
        <div key={variant} style={{ textAlign: 'center' }}>
          <Logo variant={variant} size={48} label={null} />
          <div style={{ fontSize: 11, color: color.fgMuted, marginTop: 8 }}>{variant}</div>
        </div>
      ))}
    </Surface>
  ),
};

/**
 * The pinned tones. `reversed` and `ink` do NOT follow the theme —
 * they are for surfaces whose background is fixed independently of it
 * (an always-teal card, a one-colour export). Rendered here on a teal
 * block so `reversed` is legible; `ink` is the print cut.
 */
export const PinnedTones: Story<typeof Logo> = {
  render: () => (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      <div style={{ background: '#006B5F', padding: 32 }}>
        <Logo tone="reversed" size={36} label={null} />
      </div>
      <div style={{ background: '#FAFAF7', padding: 32 }}>
        <Logo tone="ink" size={36} label={null} />
      </div>
    </div>
  ),
};
