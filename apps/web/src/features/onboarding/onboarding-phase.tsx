import { tokens } from '@declutrmail/shared';

export type OnboardingPhaseName = 'connect' | 'scan' | 'review';

/** Orientation, not a step counter: onboarding branches by account and goal. */
export function OnboardingPhase({ phase }: { phase: OnboardingPhaseName }) {
  return (
    <ol
      aria-label="Getting started"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: '8px 16px',
        listStyle: 'none',
        padding: 0,
        margin: '0 0 20px',
        fontFamily: tokens.font.sans,
        fontSize: 12,
      }}
    >
      {(
        [
          { id: 'connect', label: 'Connect' },
          { id: 'scan', label: 'Scan' },
          { id: 'review', label: 'First decision' },
        ] as const
      ).map((item) => (
        <li
          key={item.id}
          aria-current={phase === item.id ? 'step' : undefined}
          style={{
            color: phase === item.id ? tokens.color.primary : tokens.color.fgMuted,
            fontWeight: phase === item.id ? 650 : 400,
            borderBottom:
              phase === item.id ? `2px solid ${tokens.color.primary}` : '2px solid transparent',
            paddingBottom: 4,
          }}
        >
          {item.label}
        </li>
      ))}
    </ol>
  );
}
