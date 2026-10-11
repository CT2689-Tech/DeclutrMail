/**
 * Pricing copy formatters. Sentences come from the launch deck.
 * Amounts, limits, names and the refund window come from config.
 */

import { CONNECTION_TERM } from '../copy/screen-decisions';
import { WS1_COPY } from '../copy/launch/ws1';
import {
  INBOXES,
  METER,
  OFFERS,
  PLUS_ANNUAL_2026_10,
  POLICY,
  TIER_MANIFEST,
} from './pricing.config';
import type { PricePoint, TierId } from './types';

export interface QuotaExceededMessageInput {
  used: number;
  limit: number;
  resetAt: string;
  requested: number;
}

/** Server env `PRICING_V2`. Not a public Next.js env flag. */
export function isPricingV2(): boolean {
  return process.env.PRICING_V2 === 'true';
}

/** Server env `METER_V2`. Not a public Next.js env flag. */
export function isMeterV2(): boolean {
  return process.env.METER_V2 === 'true';
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (token, key: string) => {
    const value = values[key];
    return value === undefined ? token : String(value);
  });
}

function grouped(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

export function connectionTerm(count: number): string {
  if (count === 1) return CONNECTION_TERM;
  return CONNECTION_TERM.endsWith('account') ? `${CONNECTION_TERM}s` : CONNECTION_TERM;
}

export function meterNoun(n: number): string {
  if (n === 1) return WS1_COPY['meter.noun.one'];
  return fill(WS1_COPY['meter.noun.other'], { n: grouped(n) });
}

export function freeAllowanceLine(): string {
  return fill(WS1_COPY['meter.freeAllowanceLine'], { allowance: grouped(METER.free.limit) });
}

export function refundLine(): string {
  return fill(WS1_COPY['pricing.refundLine'], { refundDays: POLICY.refundWindowDays });
}

export function planName(tier: TierId | 'pass'): string {
  if (tier === 'pass') return WS1_COPY['planName.pass'];
  return TIER_MANIFEST[tier].name;
}

export function priceLine(price: PricePoint, locale: 'usd' | 'inr'): string {
  if (locale === 'inr') {
    const paise = price.inr?.paise ?? price.inrPaise;
    const amount = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(paise / 100);
    return `${amount} ${WS1_COPY['price.inrSuffix']}`;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(price.usdCents / 100);
}

function resetDate(resetAt: string): string {
  const parsed = new Date(resetAt);
  if (Number.isNaN(parsed.getTime())) return resetAt;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

export const WINDOW_PRESET_DAYS = [30, 90, 180, 365] as const;

/** Largest window preset whose preview count fits the remaining allowance. */
export function suggestedWindowPreset(
  remaining: number,
  counts: Partial<Record<number, number>>,
): number | null {
  let best: number | null = null;
  for (const days of WINDOW_PRESET_DAYS) {
    const count = counts[days];
    if (count === undefined || count <= 0 || count > remaining) continue;
    if (best === null || days > best) best = days;
  }
  return best;
}

export function quotaUnitsForEnqueue(input: {
  tier: TierId;
  verb: string;
  requestedCount: number;
}): number {
  if (!isMeterV2() || input.tier !== 'free') return 0;
  const counts = METER.countsVerbs[input.verb as keyof typeof METER.countsVerbs];
  if (!counts) return 0;
  return Math.max(0, input.requestedCount);
}

export function meterChipLine(input: {
  remaining: number;
  limit: number;
  resetAt: string;
  compact?: boolean;
}): { text: string; aria: string } {
  const values = {
    remaining: grouped(input.remaining),
    allowance: grouped(input.limit),
    resetDate: resetDate(input.resetAt),
  };
  const text =
    input.remaining <= 0
      ? fill(WS1_COPY['meter.chip.empty'], values)
      : input.compact
        ? fill(WS1_COPY['meter.chip.compact'], values)
        : fill(WS1_COPY['meter.chip'], values);
  return { text, aria: fill(WS1_COPY['meter.chip.aria'], values) };
}

export function meterPreviewText(requested: number, remaining: number): string {
  if (requested > remaining) {
    return fill(WS1_COPY['meter.preview.over'], {
      requested: grouped(requested),
      remaining: grouped(remaining),
    });
  }
  if (requested === 1) {
    return fill(WS1_COPY['meter.preview.fits.one'], { remaining: grouped(remaining) });
  }
  return fill(WS1_COPY['meter.preview.fits.other'], {
    requested: grouped(requested),
    remaining: grouped(remaining),
  });
}

export function quotaExceededMessage(input: QuotaExceededMessageInput): string {
  const remaining = Math.max(0, input.limit - input.used);
  return fill(WS1_COPY['cap.api.message'], {
    requested: grouped(input.requested),
    remaining: grouped(remaining),
    allowance: grouped(input.limit),
    resetDate: resetDate(input.resetAt),
  });
}

export function pricePromiseLines(): readonly string[] {
  const passName = planName('pass');
  return [
    WS1_COPY['pricing.promise.keep'],
    fill(WS1_COPY['pricing.promise.pass'], { passName }),
    WS1_COPY['pricing.promise.free'],
    refundLine(),
  ];
}

/** Listed offers only. Empty of paid plans while their Paddle ids are placeholders. */
export function buildOffersJsonLd(): object[] {
  if (!isPricingV2()) return [];
  const offers: object[] = [
    {
      '@type': 'Offer',
      name: planName('free'),
      price: 0,
      priceCurrency: 'USD',
      url: '/pricing',
    },
  ];
  if (PLUS_ANNUAL_2026_10.listed) {
    offers.push({
      '@type': 'Offer',
      name: planName('plus'),
      price: PLUS_ANNUAL_2026_10.usdCents / 100,
      priceCurrency: 'USD',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: PLUS_ANNUAL_2026_10.usdCents / 100,
        priceCurrency: 'USD',
        billingDuration: 'P1Y',
      },
    });
  }
  if (OFFERS.backlogPass.price.listed) {
    offers.push({
      '@type': 'Offer',
      name: planName('pass'),
      price: OFFERS.backlogPass.price.usdCents / 100,
      priceCurrency: 'USD',
    });
  }
  return offers;
}

/** Shared by `/pricing.md` and WS3's `/llms.txt`. */
export function renderPricingMarkdown(): string {
  if (!isPricingV2()) return '';
  const lines = [
    `# ${planName('free')}`,
    '',
    freeAllowanceLine(),
    `${planName('free')} includes ${INBOXES.free} ${connectionTerm(INBOXES.free)}.`,
    '',
    refundLine(),
  ];
  return lines.join('\n');
}

/** Null outside the promo window. `startsAt` lands with the pricing page. */
export function promoBanner(now: Date): string | null {
  void now;
  return null;
}

export function proNotPurchasableMessage(): string {
  return fill(WS1_COPY['gate.inbox.plus.body'], { proName: planName('pro') });
}

export function proWaitlistCta(): string {
  return fill(WS1_COPY['gate.inbox.plus.cta'], { proName: planName('pro') });
}

export function proWaitlistJoined(): string {
  return fill(WS1_COPY['waitlist.joined'], { proName: planName('pro') });
}

export function plusConnectCta(): string {
  return fill(WS1_COPY['gate.inbox.free.cta'], { plusName: planName('plus') });
}

export function plusInboxLimitTitle(): string {
  return fill(WS1_COPY['gate.inbox.plus.title'], {
    plusInboxes: INBOXES.plus,
    CONNECTION_TERM_PLURAL: connectionTerm(INBOXES.plus),
  });
}

export function inboxLimitReachedMessage(tier: TierId): string {
  if (tier === 'plus') {
    return fill(WS1_COPY['gate.inbox.plus.body'], { proName: planName('pro') });
  }
  return fill(WS1_COPY['gate.inbox.free.body'], {
    freeName: planName('free'),
    freeInboxes: INBOXES.free,
    plusName: planName('plus'),
    plusInboxes: INBOXES.plus,
    CONNECTION_TERM: connectionTerm(INBOXES.free),
  });
}
