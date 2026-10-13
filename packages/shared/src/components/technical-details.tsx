import type { CSSProperties, ReactNode } from 'react';

import { Disclosure } from './disclosure';

/**
 * Reusable progressive disclosure for protocol names, identifiers, and
 * support-only diagnostics. The required summary stays in plain language so
 * the disclosure makes sense before a user opens it.
 */
export function TechnicalDetails({
  summary,
  children,
  defaultOpen = false,
  style,
}: {
  /** Contextual action label, e.g. "Show Google permission details". */
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
  style?: CSSProperties;
}) {
  return (
    <Disclosure data-dm-technical-details summary={summary} defaultOpen={defaultOpen} style={style}>
      {children}
    </Disclosure>
  );
}
