/** Keep logout cleanup independent of the review navigation implementation. */
export const GUIDED_REVIEW_STORAGE_KEY = 'dm.guided-review.v1';

export function clearGuidedReviewSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(GUIDED_REVIEW_STORAGE_KEY);
  } catch {
    /* Storage may be unavailable. */
  }
}
