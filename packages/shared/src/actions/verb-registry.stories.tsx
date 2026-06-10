// packages/shared/src/actions/verb-registry.stories.tsx
//
// Visual reference for the K/A/U/L/D Verb Registry (ADR-0019). Renders
// each verb as it would appear in the ActionPopover — full word label,
// `kbd` shortcut chip, tone-colored chip background, optional divider
// above (Delete). Per D210 — every new shared primitive ships with
// Storybook coverage of its variants.
//
// Storybook itself is seeded in PR 3 (D210). Until then this file
// uses locally-declared lightweight CSF types so it typechecks
// without `@storybook/react` installed. When the seed lands, swap
// the local `StoryMeta` / `Story` shims for the real imports.

import type React from 'react';
import { VERB_REGISTRY, deriveDefaultPrimary, type VerbSpec } from './verb-registry';
import { tokens } from '../tokens/tokens';

const { color, font, radius } = tokens;

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
  title: 'Primitives/VerbRegistry',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'K/A/U/L/D verb set (ADR-0019). Single declarative source of truth for FE-presentation metadata across every Senders surface. See verb-registry.ts header for the BE vs FE registry split.',
      },
    },
  },
};
export default meta;

/** Render-as-popover-row for one verb. Mirrors what ActionPopover ships. */
function VerbRow({ verb }: { verb: VerbSpec }) {
  const toneColor = TONE_TO_COLOR[verb.tone];
  return (
    <>
      {verb.separator === true && (
        <div
          style={{
            height: 1,
            background: color.line,
            margin: '6px 0',
          }}
        />
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '20px 1fr auto',
          gap: 10,
          alignItems: 'center',
          padding: '8px 12px',
          borderRadius: radius.sm,
          fontFamily: font.sans,
          fontSize: 13,
          color: toneColor,
          background: 'transparent',
          cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 14, lineHeight: 1 }}>{verb.icon}</span>
        <span style={{ fontWeight: 500 }}>{verb.label}</span>
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 10,
            color: color.fgMuted,
            background: color.mutedBg,
            padding: '2px 6px',
            borderRadius: radius.sm,
            letterSpacing: '0.04em',
          }}
        >
          ⌨ {verb.shortcut}
        </span>
      </div>
    </>
  );
}

const TONE_TO_COLOR: Record<VerbSpec['tone'], string> = {
  neutral: color.fg,
  dark: color.fg,
  amber: color.amber,
  primary: color.primary,
  danger: '#DC2626',
};

export const Popover: Story = {
  render: () => (
    <div
      style={{
        width: 220,
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: radius.md,
        padding: 6,
        fontFamily: font.sans,
        boxShadow: '0 8px 24px -8px rgba(20,30,50,0.10), 0 2px 6px -2px rgba(20,30,50,0.05)',
      }}
    >
      {VERB_REGISTRY.map((verb) => (
        <VerbRow key={verb.id} verb={verb} />
      ))}
    </div>
  ),
};

export const DerivedPrimaryRules: Story = {
  render: () => {
    const cases: Array<{ label: string; sender: Parameters<typeof deriveDefaultPrimary>[0] }> = [
      {
        label: 'Protected sender',
        sender: { protected: true, unsubReady: false, lastSeenDays: 30 },
      },
      {
        label: 'Unsub-ready sender (not protected)',
        sender: { protected: false, unsubReady: true, lastSeenDays: 5 },
      },
      {
        label: 'Dormant sender (>180d)',
        sender: { protected: false, unsubReady: false, lastSeenDays: 250 },
      },
      {
        label: 'Active sender (no rules match)',
        sender: { protected: false, unsubReady: false, lastSeenDays: 10 },
      },
    ];
    return (
      <div
        style={{
          fontFamily: font.sans,
          fontSize: 13,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {cases.map(({ label, sender }) => {
          const verb = deriveDefaultPrimary(sender);
          return (
            <div
              key={label}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 100px',
                gap: 12,
                padding: '10px 12px',
                background: color.card,
                border: `1px solid ${color.line}`,
                borderRadius: radius.md,
              }}
            >
              <span>{label}</span>
              <span style={{ fontWeight: 600, color: color.primary }}>{verb}</span>
            </div>
          );
        })}
      </div>
    );
  },
};

export const FullTable: Story = {
  render: () => (
    <div
      style={{
        fontFamily: font.sans,
        fontSize: 12,
        display: 'grid',
        gridTemplateColumns:
          'minmax(0,90px) minmax(0,140px) minmax(0,60px) minmax(0,80px) minmax(0,90px) minmax(0,90px) minmax(0,100px)',
        gap: 8,
        alignItems: 'center',
      }}
    >
      <Th>id</Th>
      <Th>label</Th>
      <Th>kbd</Th>
      <Th>tone</Th>
      <Th>destructive</Th>
      <Th>reversible</Th>
      <Th>canBePrimary</Th>
      {VERB_REGISTRY.map((v) => (
        <RowCell key={v.id} verb={v} />
      ))}
    </div>
  ),
};

function Th({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        color: color.fgMuted,
        paddingBottom: 6,
        borderBottom: `1px solid ${color.line}`,
      }}
    >
      {children}
    </div>
  );
}

function RowCell({ verb }: { verb: VerbSpec }) {
  return (
    <>
      <Td>{verb.id}</Td>
      <Td>{verb.label}</Td>
      <Td mono>{verb.shortcut}</Td>
      <Td mono color={TONE_TO_COLOR[verb.tone]}>
        {verb.tone}
      </Td>
      <Td>{verb.destructive ? '✓' : '—'}</Td>
      <Td>{verb.reversible ? '✓' : '—'}</Td>
      <Td>{verb.canBePrimary ? '✓' : '—'}</Td>
    </>
  );
}

function Td({
  children,
  mono,
  color: colorOverride,
}: {
  children: React.ReactNode;
  mono?: boolean;
  color?: string;
}) {
  return (
    <div
      style={{
        fontFamily: mono === true ? font.mono : font.sans,
        fontSize: 12,
        color: colorOverride ?? color.fg,
        padding: '8px 0',
      }}
    >
      {children}
    </div>
  );
}
