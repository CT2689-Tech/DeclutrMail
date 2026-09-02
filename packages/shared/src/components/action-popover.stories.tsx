// packages/shared/src/components/action-popover.stories.tsx
//
// Visual reference for the K/A/U/L/D ActionPopover (ADR-0019). Per
// D210 — every new shared primitive ships with Storybook coverage of
// its variants.
//
// Storybook itself is seeded in PR 3 (D210). Until then this file
// uses locally-declared lightweight CSF types so it typechecks
// without `@storybook/react` installed. When the seed lands, swap
// the local `StoryMeta` / `Story` shims for the real imports —
// story shapes do not change.

import type React from 'react';
import { ActionPopover, ActionPopoverTrigger } from './action-popover';
import { tokens } from '../tokens/tokens';

const { color, font } = tokens;

type StoryMeta = {
  title: string;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story = {
  parameters?: Record<string, unknown>;
  render?: () => React.ReactElement;
};

const meta: StoryMeta = {
  title: 'Primitives/ActionPopover',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'K/A/U/L/D overflow menu surface (ADR-0019). Renders the Verb Registry filtered by per-sender capability + dimmed-already-primary semantics. Keyboard nav (↑↓/Enter), shortcut keys (K/A/U/L/D), ESC close, click-outside close.',
      },
    },
  },
};
export default meta;

const noop = (): void => undefined;

/** Default popover — every verb capable; no dimmed primary. */
export const Default: Story = {
  render: () => (
    <Container>
      <ActionPopover ariaLabel="Actions for Acme Deals" onPick={noop} onClose={noop} />
    </Container>
  ),
};

/** Primary CTA dimmed in popover — the surface already shows Unsub as
 *  the primary button, so the popover row renders at reduced opacity. */
export const DimmedPrimary: Story = {
  render: () => (
    <Container>
      <ActionPopover
        ariaLabel="Actions for Acme Deals"
        dimmedVerb="unsubscribe"
        onPick={noop}
        onClose={noop}
      />
    </Container>
  ),
};

/** Capability-disabled subset — Unsubscribe + Later disabled (sender
 *  has no List-Unsubscribe header; Later requires a label policy not
 *  yet wired). Disabled rows render greyed and are non-clickable. */
export const PartialCapabilities: Story = {
  render: () => (
    <Container>
      <ActionPopover
        ariaLabel="Actions for Acme Deals"
        capabilities={{
          keep: true,
          archive: true,
          unsubscribe: false,
          later: false,
          delete: true,
        }}
        onPick={noop}
        onClose={noop}
      />
    </Container>
  ),
};

/** Delete-suppressed variant — surfaces using the temporary
 *  legacyVerbFromId bridge filter Delete from the popover so users
 *  cannot pick it before the callback widens (Phase 2 PR-FE3). */
export const DeleteSuppressed: Story = {
  render: () => (
    <Container>
      <ActionPopover
        ariaLabel="Actions for Acme Deals"
        verbs={['keep', 'archive', 'unsubscribe', 'later']}
        onPick={noop}
        onClose={noop}
      />
    </Container>
  ),
};

/** SelectionBar bulk variant — equal-weight A/U/L/D, no primary
 *  derivation. (Bulk omits Keep since bulk = move workflow.) */
export const BulkSelection: Story = {
  render: () => (
    <Container>
      <ActionPopover
        verbs={['archive', 'unsubscribe', 'later', 'delete']}
        ariaLabel="Bulk actions"
        onPick={noop}
        onClose={noop}
      />
    </Container>
  ),
};

/** Trigger button affordance — the ⋯ button that opens the popover.
 *  Lives in its own story so a consumer-side review can verify the
 *  tone + size + cursor independently from the popover surface. */
export const Trigger: Story = {
  render: () => (
    <div style={{ padding: 24, background: color.bg, fontFamily: font.sans }}>
      <ActionPopoverTrigger onClick={noop} ariaLabel="More actions for Acme Deals" />
    </div>
  ),
};

/**
 * QA-senders-filtering-20260901-08 / design-system-agent PR #707 —
 * viewport-edge clamping, the same technique implemented for
 * compose-strip.tsx's own Popover in PR #707.
 * `layout: 'fullscreen'` removes Storybook's default padding so the
 * trigger renders flush against the real edge each story tests
 * against; each is pre-opened (no interaction needed) so a visual
 * regression pass catches the clamp. Padding on each story is sized to
 * trip exactly ONE branch of the clamp — see the popover's own
 * ~220×205px footprint below — so a reviewer can attribute a visual
 * diff to a specific edge instead of "somewhere it clamped."
 */

/** Trigger near the viewport TOP only (`paddingLeft` generous enough
 *  that the left clamp never fires here) — the default anchor opens
 *  ABOVE the trigger, so this is the overflow-prone edge for THIS
 *  component (the mirror of compose-strip's bottom-overflow case,
 *  since that Popover opens below by default and this one opens
 *  above). Flips to open below with `maxHeight` capped to the space
 *  actually there, instead of running past the top edge. */
export const NearViewportTopFlipsBelow: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div style={{ paddingTop: 8, paddingLeft: 260, background: color.bg, fontFamily: font.sans }}>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <ActionPopoverTrigger onClick={noop} ariaLabel="More actions for Acme Deals" />
        <ActionPopover ariaLabel="Actions for Acme Deals" onPick={noop} onClose={noop} />
      </div>
    </div>
  ),
};

/** Trigger near the viewport LEFT edge only (`paddingTop` generous
 *  enough that the top flip never fires here) — the default anchor is
 *  `right: 0` (right-aligned to the trigger, extending leftward), so a
 *  trigger close to the viewport's LEFT edge is what overflows, not
 *  one close to the right (a right-anchored popover always has room to
 *  its right by construction). Same bug shape compose-strip's Popover
 *  fixed: "a chip near the LEFT edge... opens a right-anchored 220px
 *  popover that runs off the LEFT edge instead." Clamps to `left: 0`
 *  instead of running past the left edge. */
export const NearViewportLeftEdgeClamps: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div style={{ paddingTop: 280, paddingLeft: 4, background: color.bg, fontFamily: font.sans }}>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <ActionPopoverTrigger onClick={noop} ariaLabel="More actions for Acme Deals" />
        <ActionPopover ariaLabel="Actions for Acme Deals" onPick={noop} onClose={noop} />
      </div>
    </div>
  ),
};

function Container({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 24,
        background: color.bg,
        fontFamily: font.sans,
      }}
    >
      {/* ActionPopover positions itself absolutely (`bottom`/`right`)
          against the nearest `position: relative` ancestor — same
          wiring every real call-site needs around the trigger. The
          generous margin keeps this DEFAULT story clear of both edge
          clamps (dedicated `NearViewport*` stories below cover those)
          so it stays a clean reference for the unclamped anchor. */}
      <div
        style={{ marginTop: 320, marginLeft: 320, position: 'relative', display: 'inline-block' }}
      >
        <ActionPopoverTrigger onClick={noop} ariaLabel="More actions for Acme Deals" />
        {children}
      </div>
    </div>
  );
}
