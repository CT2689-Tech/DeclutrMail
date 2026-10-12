'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AiConsentDecision, AiConsentView } from '@declutrmail/shared/ai-consent';
import type { MeSettings } from '@declutrmail/shared/contracts';

import { apiPost } from '@/lib/api/client';
import { ME_SETTINGS_QUERY_KEY } from '@/features/settings/api/query-options';

/** POST /api/me/ai-consent and fold the returned view into the settings cache. */
export function useDecideAiConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (decision: AiConsentDecision) =>
      apiPost<{ aiConsent: AiConsentView }>('/api/me/ai-consent', decision),
    onSuccess: (envelope) => {
      qc.setQueryData<MeSettings>(ME_SETTINGS_QUERY_KEY, (prev) =>
        prev ? { ...prev, aiConsent: envelope.data.aiConsent } : prev,
      );
    },
  });
}
