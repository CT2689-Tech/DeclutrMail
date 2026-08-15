// packages/shared/src/components/avatar.stories.tsx
//
// Visual reference for `Avatar` (ADR-0024 monogram + ADR-0034 brand
// logos). Per D210 — every shared component ships Storybook coverage
// of its states.
//
// Storybook renders with `brandLogos` OFF (its env carries no
// `NEXT_PUBLIC_DM_FLAG_BRAND_LOGOS`, and there is no icon endpoint to
// answer), so every story below shows the MONOGRAM. That is the
// intended reference: the monogram is the floor every avatar falls
// back to, so it is the state worth pinning visually. The logo layer
// composites into the same rounded square at the same inset, opaque so
// a loaded mark covers the initial rather than sitting on it — see the
// `SizeScale` note for why nothing below 24px ever carries one.
//
// Storybook itself is seeded in PR 3 (D210). Until then this file uses
// locally-declared lightweight CSF types so it typechecks without
// `@storybook/react` installed.

import { Avatar, LOGO_MIN_SIZE } from './avatar';
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

const meta: StoryMeta<typeof Avatar> = {
  title: 'Primitives/Avatar',
  component: Avatar,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Sender identity anchor. One silhouette everywhere: rounded square, hairline border, a single initial on a deterministic per-domain tint (ADR-0024). With `brandLogos` on (ADR-0034), a brand mark from our first-party /api/icons endpoint layers over that monogram — the monogram itself never stops rendering, so no failure path yields an empty box and the component stays JS-free. Decorative by contract: always aria-hidden, with the sender name adjacent.',
      },
    },
  },
};

export default meta;

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 220 }}>{children}</div>
    <span style={{ fontFamily: font.mono, fontSize: 11, color: color.fgMuted }}>{label}</span>
  </div>
);

/** The default 28px avatar as it appears beside a sender name. */
export const Default: Story<typeof Avatar> = {
  args: { name: 'Groupon', domain: 'groupon.com' },
};

/**
 * Tint is derived from the BRAND ROOT, so every bulk-mail subdomain a
 * sender rotates through resolves to one identity — and, with logos on,
 * to one cached row and one outbound fetch.
 */
export const StableAcrossSubdomains: Story<typeof Avatar> = {
  render: () => (
    <div>
      <Row label="brand.com">
        <Avatar name="Brand" domain="brand.com" size={40} />
      </Row>
      <Row label="mail1.brand.com — same tint">
        <Avatar name="Brand" domain="mail1.brand.com" size={40} />
      </Row>
      <Row label="news.brand.com — same tint">
        <Avatar name="Brand" domain="news.brand.com" size={40} />
      </Row>
    </div>
  ),
};

/** Different domains must read as different identities, not decoration. */
export const DistinctPerDomain: Story<typeof Avatar> = {
  render: () => (
    <div style={{ display: 'flex', gap: 10 }}>
      {['chase.com', 'united.com', 'acme.io', 'groupon.com', 'figma.com'].map((domain) => (
        <Avatar
          key={domain}
          name={domain[0]!.toUpperCase() + domain.slice(1)}
          domain={domain}
          size={40}
        />
      ))}
    </div>
  ),
};

/**
 * The sizes in use. `LOGO_MIN_SIZE` (24px) is the legibility floor:
 * table rows draw at 22px and stay monogram-only, because a downscaled
 * brand mark is exactly the mixed-fidelity problem ADR-0024 diagnosed.
 */
export const SizeScale: Story<typeof Avatar> = {
  render: () => (
    <div>
      <Row label="22px — table row (never carries a logo)">
        <Avatar name="Chase" domain="chase.com" size={22} />
      </Row>
      <Row label={`${LOGO_MIN_SIZE}px — logo floor`}>
        <Avatar name="Chase" domain="chase.com" size={LOGO_MIN_SIZE} />
      </Row>
      <Row label="28px — default">
        <Avatar name="Chase" domain="chase.com" size={28} />
      </Row>
      <Row label="40px — grid card / detail header">
        <Avatar name="Chase" domain="chase.com" size={40} />
      </Row>
    </div>
  ),
};

/** Fallbacks: no domain, and a name that yields no usable initial. */
export const Fallbacks: Story<typeof Avatar> = {
  render: () => (
    <div>
      <Row label="no domain — tint derives from the name">
        <Avatar name="Sarah Chen" size={40} />
      </Row>
      <Row label="empty name — never an empty glyph">
        <Avatar name="" size={40} />
      </Row>
    </div>
  ),
};
