// Storybook CSF3 stories for the privacy trust badge (D7 + D228).
//
// Storybook itself is seeded in PR 3 (D210). Until then this file uses
// locally-declared lightweight CSF types so it typechecks without
// `@storybook/react` installed. When the seed lands, swap the local
// `Meta` / `StoryObj` shims for the real imports — story shapes do
// not change.

import type { ComponentProps } from 'react';
import { PrivacyBadge } from './privacy-badge';
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

const meta: StoryMeta<typeof PrivacyBadge> = {
  title: 'Privacy/PrivacyBadge',
  component: PrivacyBadge,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Trust badge locked by D228. Renders the plain-language privacy promise plus the generated stored and never-stored lists. All copy comes from `packages/shared/src/copy/privacy.ts`.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type BadgeArgs = ComponentProps<typeof PrivacyBadge>;

/** Default — card variant on the standard warm-newsprint surface. */
export const Default: Story<typeof PrivacyBadge> = {
  args: { variant: 'card' },
  render: (args: BadgeArgs) => (
    <div style={{ maxWidth: 480, background: color.bg, padding: 24 }}>
      <PrivacyBadge {...args} />
    </div>
  ),
};

/** Inline — compact one-line variant for footers and tooltips. */
export const Inline: Story<typeof PrivacyBadge> = {
  args: { variant: 'inline' },
  render: (args: BadgeArgs) => (
    <div style={{ background: color.bg, padding: 24 }}>
      <PrivacyBadge {...args} />
    </div>
  ),
};

/**
 * Inline on dark — the exact combination that failed WCAG AA.
 *
 * The inline variant sits on its own `primarySoft` tint, not on
 * `color.card` like the card variant, and that tint is what put the
 * storage list at 4.31:1 against the 4.5:1 floor on all 19 public
 * pages. `Inline` above renders on `color.bg` and `DarkMode` below
 * renders the CARD variant, so before this story the failing state had
 * no visual-regression coverage at all (D210).
 */
export const InlineOnDark: Story<typeof PrivacyBadge> = {
  args: { variant: 'inline' },
  parameters: {
    backgrounds: { default: 'dark' },
  },
  render: (args: BadgeArgs) => (
    <div data-theme="dark" style={{ background: color.bg, padding: 24 }}>
      <PrivacyBadge {...args} />
    </div>
  ),
};

/** Dark-mode preview — card variant on an ink surface. */
export const DarkMode: Story<typeof PrivacyBadge> = {
  args: { variant: 'card' },
  parameters: {
    backgrounds: { default: 'dark' },
  },
  render: (args: BadgeArgs) => (
    <div style={{ maxWidth: 480, background: color.fg, padding: 24 }}>
      <PrivacyBadge {...args} />
    </div>
  ),
};

/** Mobile-narrow — card variant constrained to a phone viewport. */
export const MobileNarrow: Story<typeof PrivacyBadge> = {
  args: { variant: 'card' },
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
  render: (args: BadgeArgs) => (
    <div style={{ maxWidth: 320, background: color.bg, padding: 16 }}>
      <PrivacyBadge {...args} />
    </div>
  ),
};
