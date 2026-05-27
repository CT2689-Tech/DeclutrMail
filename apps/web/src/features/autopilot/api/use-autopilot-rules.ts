/**
 * `useAutopilotRules` — TanStack Query hook for the rule list (D99-D105).
 *
 * Powers both the "is anything still running?" check that gates the
 * pause-all CTA (D105) and the rules list itself. At V2 only preset
 * rules return (D197, D234) — custom rules are flag-disabled.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchAutopilotRules } from '@/lib/api/autopilot';
import { autopilotKeys } from './query-keys';

export function useAutopilotRules() {
  return useQuery({
    queryKey: autopilotKeys.rules(),
    queryFn: ({ signal }) => fetchAutopilotRules(signal).then((env) => env.data),
  });
}
