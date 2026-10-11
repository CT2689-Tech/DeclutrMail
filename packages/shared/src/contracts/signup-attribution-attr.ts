/**
 * First-touch campaign cookie. Set once, 30 days, first-party.
 * Holds utm_source, utm_medium, utm_campaign, ref, and the landing path.
 * No third-party ids and no email addresses.
 */
import {
  parseSignupAttributionRef,
  resolveFirstTouchRef,
  type SignupAttributionRef,
} from './signup-attribution-ref.js';

export const DM_ATTR_COOKIE = 'dm_attr';
export const DM_ATTR_MAX_AGE_SEC = 60 * 60 * 24 * 30;

const UTM = /^[A-Za-z0-9._-]{1,64}$/;
const LANDING = /^\/[A-Za-z0-9._~/-]{0,199}$/;

export interface SignupCampaign {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  landingPath?: string;
  ref?: SignupAttributionRef;
}

type ParamSource = { get(name: string): string | null };

/** Parse a stored cookie. Undefined when it has no usable field. */
export function parseDmAttr(value: unknown): SignupCampaign | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return undefined;
  if (value.includes('@')) return undefined;
  return campaignOrUndefined(campaignFromParams(new URLSearchParams(value)));
}

export function serializeDmAttr(campaign: SignupCampaign): string {
  const params = new URLSearchParams();
  if (campaign.utmSource) params.set('utm_source', campaign.utmSource);
  if (campaign.utmMedium) params.set('utm_medium', campaign.utmMedium);
  if (campaign.utmCampaign) params.set('utm_campaign', campaign.utmCampaign);
  if (campaign.ref) params.set('ref', campaign.ref);
  if (campaign.landingPath) params.set('landing', campaign.landingPath);
  return params.toString();
}

/**
 * Set-once. An existing valid cookie is never overwritten, including by
 * a later utm. Returns the cookie value to set, or undefined to leave
 * the response alone.
 */
export function resolveFirstTouchCampaign(input: {
  existing: string | undefined;
  searchParams: ParamSource;
  pathname: string;
}): string | undefined {
  if (parseDmAttr(input.existing)) return undefined;
  const ref = resolveFirstTouchRef({
    existing: undefined,
    queryRef: input.searchParams.get('ref'),
    pathname: input.pathname,
  });
  const campaign = campaignOrUndefined(
    fields({
      utmSource: narrowUtm(input.searchParams.get('utm_source')),
      utmMedium: narrowUtm(input.searchParams.get('utm_medium')),
      utmCampaign: narrowUtm(input.searchParams.get('utm_campaign')),
      ref,
    }),
  );
  if (!campaign) return undefined;
  const landingPath = narrowLanding(input.pathname);
  return serializeDmAttr(landingPath ? { ...campaign, landingPath } : campaign);
}

/** Query-string fallback for hosts that cannot read the shared cookie. */
export function campaignFromQuery(input: {
  utmSource?: unknown;
  utmMedium?: unknown;
  utmCampaign?: unknown;
  ref?: unknown;
}): SignupCampaign | undefined {
  return campaignOrUndefined(
    fields({
      utmSource: narrowUtm(input.utmSource),
      utmMedium: narrowUtm(input.utmMedium),
      utmCampaign: narrowUtm(input.utmCampaign),
      ref: parseSignupAttributionRef(input.ref),
    }),
  );
}

/** Drop any field the users CHECK would reject. */
export function narrowSignupCampaign(campaign: SignupCampaign | undefined): SignupCampaign {
  if (!campaign) return {};
  return fields({
    utmSource: narrowUtm(campaign.utmSource),
    utmMedium: narrowUtm(campaign.utmMedium),
    utmCampaign: narrowUtm(campaign.utmCampaign),
    landingPath: narrowLanding(campaign.landingPath),
    ref: campaign.ref,
  });
}

function campaignFromParams(params: URLSearchParams): SignupCampaign {
  return fields({
    utmSource: narrowUtm(params.get('utm_source')),
    utmMedium: narrowUtm(params.get('utm_medium')),
    utmCampaign: narrowUtm(params.get('utm_campaign')),
    landingPath: narrowLanding(params.get('landing')),
    ref: parseSignupAttributionRef(params.get('ref')),
  });
}

function fields(input: {
  utmSource?: string | undefined;
  utmMedium?: string | undefined;
  utmCampaign?: string | undefined;
  landingPath?: string | undefined;
  ref?: SignupAttributionRef | undefined;
}): SignupCampaign {
  return {
    ...(input.utmSource ? { utmSource: input.utmSource } : {}),
    ...(input.utmMedium ? { utmMedium: input.utmMedium } : {}),
    ...(input.utmCampaign ? { utmCampaign: input.utmCampaign } : {}),
    ...(input.landingPath ? { landingPath: input.landingPath } : {}),
    ...(input.ref ? { ref: input.ref } : {}),
  };
}

function campaignOrUndefined(campaign: SignupCampaign): SignupCampaign | undefined {
  return campaign.utmSource ||
    campaign.utmMedium ||
    campaign.utmCampaign ||
    campaign.landingPath ||
    campaign.ref
    ? campaign
    : undefined;
}

function narrowUtm(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return UTM.test(trimmed) ? trimmed : undefined;
}

function narrowLanding(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return LANDING.test(value) ? value : undefined;
}
