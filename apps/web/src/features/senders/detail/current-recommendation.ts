import type { Recommendation, SenderDetail } from './types';

type CurrentSenderFacts = Pick<SenderDetail, 'isProtected' | 'policyType' | 'unsubStatus'> & {
  inboxCount: number | null | undefined;
  archivedCount: number | null | undefined;
};

/** Historical engine reads remain intact; only offer actions current facts still support. */
export function currentRecommendation<T extends Pick<Recommendation, 'verdict'>>(
  recommendation: T | null,
  facts: CurrentSenderFacts,
): T | null {
  if (recommendation === null || facts.isProtected || facts.policyType === 'keep') return null;

  switch (recommendation.verdict) {
    case 'unsubscribe':
      if (facts.policyType === 'unsubscribe' && facts.unsubStatus === null) return null;
      // Follow-up and uncertainty have their own lifecycle/callout. Neither
      // a pending request nor a manual draft is proof that email stopped.
      switch (facts.unsubStatus) {
        case 'requested':
        case 'endpoint_accepted':
        case 'unconfirmed':
        case 'action_required':
        case 'draft_opened':
        case 'user_marked_sent':
        case 'unavailable':
          return null;
      }
      break;
    case 'archive':
    case 'later':
      // Both move inbox mail. A partial cleanup can leave this positive;
      // missing counts never justify treating the suggestion as fulfilled.
      if (facts.inboxCount === 0) return null;
      break;
    case 'delete':
      if (facts.inboxCount === 0 && facts.archivedCount === 0) return null;
      break;
    case 'keep':
      if (facts.policyType === 'unsubscribe') return null;
      break;
  }
  return recommendation;
}
