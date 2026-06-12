/**
 * `useRulePreview` — D103/D192 dry-run preview
 * (`POST /api/autopilot/rules/:id/preview`).
 *
 * Modelled as a mutation despite being read-only: the endpoint is a
 * POST the user triggers explicitly per rule ("Preview matches"), the
 * result is ephemeral panel state, and nothing should refetch it in
 * the background. No cache invalidation — the dry-run mutates nothing.
 */

import { useMutation } from '@tanstack/react-query';
import { postRulePreview } from '@/lib/api/autopilot';

export function useRulePreview() {
  return useMutation({
    mutationFn: (ruleId: string) => postRulePreview(ruleId).then((env) => env.data),
  });
}
