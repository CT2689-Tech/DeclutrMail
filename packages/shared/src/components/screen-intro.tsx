'use client';

import { useEffect, type ReactNode } from 'react';
import { useUiStore } from '../state/ui-store';

/**
 * Registers "what is this screen" help for the top bar's `?` button and
 * renders nothing. A screen keeps one `<ScreenIntro>` in its tree; the
 * shell owns the only help UI, so no screen spends layout on an
 * explainer card.
 */
export function ScreenIntro({
  id,
  title,
  body,
  tip,
  learnMore,
}: {
  id: string;
  title: string;
  body: ReactNode;
  tip?: ReactNode;
  learnMore?: {
    href: string;
    label: string;
  };
}) {
  const setScreenHelp = useUiStore((s) => s.setScreenHelp);
  const clearScreenHelp = useUiStore((s) => s.clearScreenHelp);

  // No dependency array on purpose: `body` and `tip` are nodes whose
  // identity changes every render, and a screen may interpolate live
  // values into them. Re-registering per commit keeps the popover
  // current; only the (closed-by-default) help button subscribes.
  useEffect(() => {
    setScreenHelp({
      id,
      title,
      body,
      ...(tip == null ? {} : { tip }),
      ...(learnMore == null ? {} : { learnMore }),
    });
  });

  useEffect(() => () => clearScreenHelp(id), [id, clearScreenHelp]);

  return null;
}
