import type { ReactNode } from 'react';
import { tokens } from '@declutrmail/shared';

import { GLOSSARY_TERMS, type GlossaryTermId } from './glossary-content';

const { color, font, radius } = tokens;

/**
 * Small, native disclosure for help beside a specific decision.
 *
 * Consumers provide one concrete question and only the facts needed at that
 * point. Native details/summary keeps keyboard, focus, and expanded-state
 * semantics without another client-side popover implementation.
 */
export function ContextualHelp({ question, children }: { question: string; children: ReactNode }) {
  return (
    <details
      style={{
        border: `1px solid ${color.lineSoft}`,
        borderRadius: radius.md,
        background: color.paper,
        padding: '10px 12px',
        fontFamily: font.sans,
      }}
    >
      <summary
        style={{
          color: color.primary,
          cursor: 'pointer',
          fontSize: 12.5,
          fontWeight: 600,
          lineHeight: 1.5,
        }}
      >
        {question}
      </summary>
      <div
        style={{
          color: color.fgSoft,
          fontSize: 12.5,
          lineHeight: 1.6,
          padding: '8px 2px 1px',
        }}
      >
        {children}
      </div>
    </details>
  );
}

/** Canonical glossary definitions presented beside one specific decision. */
export function GlossaryContextualHelp({
  question,
  termIds,
}: {
  question: string;
  termIds: readonly GlossaryTermId[];
}) {
  return (
    <ContextualHelp question={question}>
      <dl style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: 0 }}>
        {termIds.map((id) => {
          const entry = GLOSSARY_TERMS[id];
          return (
            <div key={id}>
              <dt style={{ color: color.fg, fontWeight: 600 }}>{entry.term}</dt>
              <dd style={{ margin: '2px 0 0' }}>{entry.definition}</dd>
            </div>
          );
        })}
      </dl>
    </ContextualHelp>
  );
}
