import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { fetchSenderRules } from '@/lib/api/autopilot-sender-rules';

export const SENDER_RULES_SUPPORT_PROBE_MS = 15_000;

/** Only a missing sender-rule endpoint selects the older preset surface. */
export function isSenderRulesUnsupported(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export function senderRulesSupportProbeInterval(error: unknown): number | false {
  return isSenderRulesUnsupported(error) ? SENDER_RULES_SUPPORT_PROBE_MS : false;
}

/** The route keeps this observer mounted while the older API is serving. */
export function useSenderRules(mailboxId: string | undefined, entitled: boolean) {
  return useQuery({
    queryKey: ['autopilot-sender-rules', mailboxId],
    queryFn: ({ signal }) => fetchSenderRules(signal, mailboxId),
    retry: false,
    enabled: mailboxId !== undefined && entitled,
    refetchInterval: (query) => senderRulesSupportProbeInterval(query.state.error),
  });
}
