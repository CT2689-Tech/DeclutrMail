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
      <ActionPopover onPick={noop} onClose={noop} />
    </Container>
  ),
};

/** Primary CTA dimmed in popover — the surface already shows Unsub as
 *  the primary button, so the popover row renders at reduced opacity. */
export const DimmedPrimary: Story = {
  render: () => (
    <Container>
      <ActionPopover dimmedVerb="unsubscribe" onPick={noop} onClose={noop} />
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
      <ActionPopoverTrigger onClick={noop} />
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
        display: 'flex',
        justifyContent: 'flex-start',
      }}
    >
      {children}
    </div>
  );
}
