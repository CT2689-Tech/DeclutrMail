import type { ReactNode } from 'react';

/** One line under a screen name. The id is the aria-describedby target. */
export function FeatureExplainer({ id, children }: { id: string; children: ReactNode }) {
  return <p id={id}>{children}</p>;
}
