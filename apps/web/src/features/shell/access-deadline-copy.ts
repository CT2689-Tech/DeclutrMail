import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import type { BillingSubscription } from '@declutrmail/shared/contracts';

type Subscription = NonNullable<BillingSubscription['subscription']>;

export type AccessDeadlineBanner =
  | { kind: 'past_due'; message: string; deadline: string; showCardUpdate: true }
  | { kind: 'plan_ends'; message: string; deadline: string; showCardUpdate: false };

/** Calendar date of a server ISO timestamp, without shifting it into the browser zone. */
export function serverDeadlineLabel(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utc);
}

/**
 * Past-due and plan-ending chrome copy. The date is the server's
 * `entitlementEndsAt` only. A missing deadline omits the banner.
 * Free workspaces never see it.
 */
export function accessDeadlineCopy(
  workspaceTier: string,
  subscription: Subscription | null,
): AccessDeadlineBanner | null {
  if (workspaceTier === 'free' || subscription === null) return null;
  const deadline = subscription.entitlementEndsAt;
  if (typeof deadline !== 'string') return null;
  const date = serverDeadlineLabel(deadline);
  if (date === null) return null;
  const planName = TIER_MANIFEST[subscription.tier].name;

  if (subscription.status === 'past_due') {
    return {
      kind: 'past_due',
      deadline,
      showCardUpdate: true,
      message: WS2_COPY.banners.pastDue.banner
        .replaceAll('{deadline}', date)
        .replaceAll('{planName}', planName),
    };
  }

  const ending =
    subscription.cancelAtPeriodEnd ||
    subscription.cancelSource === 'refund' ||
    subscription.cancelSource === 'chargeback';
  if (!ending || subscription.status === 'canceled') return null;
  return {
    kind: 'plan_ends',
    deadline,
    showCardUpdate: false,
    message: WS2_COPY.banners.planEnds.banner
      .replaceAll('{planName}', planName)
      .replaceAll('{date}', date),
  };
}

export function accessDeadlineDismissKey(banner: AccessDeadlineBanner): string {
  return `dm.access-deadline.dismissed:${banner.kind}:${banner.deadline}`;
}
