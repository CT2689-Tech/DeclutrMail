/**
 * Pricing copy formatters. Sentences come from the launch deck.
 * Amounts, limits, names and the refund window come from config.
 */

import {
  BACKLOG_PASS_NAME,
  BILLING_NAME,
  BRIEF_NAME,
  CONNECTION_TERM,
} from '../copy/screen-decisions';
import { WS1_COPY } from '../copy/launch/ws1';
import { INR_NEW_PURCHASES_PAUSED } from '../contracts/billing-availability';
import {
  INBOXES,
  METER,
  OFFERS,
  PLUS_ANNUAL_2026_10,
  POLICY,
  PROMO,
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

/** Server env `BILLING_PASS_ENABLED`. Default off. Not a public Next flag. */
export function isBillingPassEnabled(): boolean {
  return process.env.BILLING_PASS_ENABLED === 'true';
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (token, key: string) => {
    const value = values[key];
    return value === undefined ? token : String(value);
  });
}

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Western thousands separators. en-US grouping is a comma on every runtime. */
function groupWestern(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Indian grouping: last three digits, then pairs. ₹1,09,999, not ₹109,999. */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}`;
}

function grouped(n: number): string {
  const rounded = Math.round(n);
  const body = groupWestern(String(Math.abs(rounded)));
  return rounded < 0 ? `-${body}` : body;
}

/**
 * Whole currency units with a pinned symbol. Intl's currency format puts a
 * NBSP or narrow NBSP between the symbol and the digits on one runtime and
 * nothing on the other, which is a different text node (React #418).
 */
function stableCurrency(minor: number, locale: 'usd' | 'inr'): string {
  const rounded = Math.round(minor / 100);
  const body = (locale === 'inr' ? groupIndian : groupWestern)(String(Math.abs(rounded)));
  const symbol = locale === 'inr' ? '₹' : '$';
  return `${rounded < 0 ? '-' : ''}${symbol}${body}`;
}

function utcMonthDay(iso: string): string | null {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${SHORT_MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCDate()}`;
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
  if (tier === 'pass') return BACKLOG_PASS_NAME;
  return TIER_MANIFEST[tier].name;
}

/** Amount only. The INR tax suffix stays on `priceLine`, not in sentence tokens. */
export function moneyAmount(minor: number, locale: 'usd' | 'inr'): string {
  return stableCurrency(minor, locale);
}

export function plusAmount(locale: 'usd' | 'inr'): string {
  const minor =
    locale === 'inr'
      ? (PLUS_ANNUAL_2026_10.inr?.paise ?? PLUS_ANNUAL_2026_10.inrPaise)
      : PLUS_ANNUAL_2026_10.usdCents;
  return moneyAmount(minor, locale);
}

export function passAmount(locale: 'usd' | 'inr'): string {
  const price = OFFERS.backlogPass.price;
  const minor = locale === 'inr' ? (price.inr?.paise ?? price.inrPaise) : price.usdCents;
  return moneyAmount(minor, locale);
}

/** "Nov 3, 11:59 PM PT". The zone label is always PT, never PST or PDT. */
function zonedClock(iso: string, timeZone: string): string | null {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12',
  }).formatToParts(parsed);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const month = Number(read('month'));
  const day = Number(read('day'));
  const minute = read('minute');
  let hour = Number(read('hour'));
  const period = (read('dayPeriod') ?? '').replace(/\./g, '').toUpperCase();
  if (
    !SHORT_MONTHS[month - 1] ||
    !minute ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    (period !== 'AM' && period !== 'PM')
  ) {
    return null;
  }
  if (hour === 0) hour = 12;
  // No year: the existing label is "Nov 3, 11:59 PM PT".
  return `${SHORT_MONTHS[month - 1]} ${day}, ${hour}:${minute.padStart(2, '0')} ${period}`;
}

export function promoEndLabel(endsAt: string = PROMO.endsAt): string {
  return `${zonedClock(endsAt, 'America/Los_Angeles') ?? endsAt} PT`;
}

export function passEndLabel(iso: string): string {
  return utcMonthDay(iso) ?? iso;
}

export function storyValues(locale: 'usd' | 'inr'): Record<string, string | number> {
  return {
    freeName: planName('free'),
    plusName: planName('plus'),
    passName: planName('pass'),
    proName: planName('pro'),
    allowance: grouped(METER.free.limit),
    freeInboxes: INBOXES.free,
    plusInboxes: INBOXES.plus,
    CONNECTION_TERM: connectionTerm(INBOXES.free),
    CONNECTION_TERM_PLURAL: connectionTerm(INBOXES.plus),
    passDays: OFFERS.backlogPass.durationDays,
    refundDays: POLICY.refundWindowDays,
    plusPrice: plusAmount(locale),
    passPrice: passAmount(locale),
    BILLING_NAME,
    BRIEF_NAME,
    promoCode: PROMO.code,
    promoPercent: PROMO.percentOff,
    promoEnd: promoEndLabel(),
  };
}

export function fillStory(
  template: string,
  locale: 'usd' | 'inr' = 'usd',
  extra?: Record<string, string | number>,
): string {
  return fill(template, extra ? { ...storyValues(locale), ...extra } : storyValues(locale));
}

export function fillStoryList(lines: readonly string[], locale: 'usd' | 'inr' = 'usd'): string[] {
  return lines.map((line) => fillStory(line, locale));
}

export function priceLine(price: PricePoint, locale: 'usd' | 'inr'): string {
  if (locale === 'inr') {
    const paise = price.inr?.paise ?? price.inrPaise;
    return `${stableCurrency(paise, 'inr')} ${WS1_COPY['price.inrSuffix']}`;
  }
  return stableCurrency(price.usdCents, 'usd');
}

function resetDate(resetAt: string): string {
  return utcMonthDay(resetAt) ?? resetAt;
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

export interface ListedOfferOverride {
  plus: boolean;
  pass: boolean;
}

/**
 * Listed offers only. Placeholders stay unlisted, so the live function
 * returns Free until a price id is real. Tests pass `listed` to pin the
 * shape Plus and the Pass take once they are listed.
 */
export function buildOffersJsonLd(listed?: ListedOfferOverride): object[] {
  if (!isPricingV2()) return [];
  const plusListed = listed?.plus ?? PLUS_ANNUAL_2026_10.listed === true;
  const passListed = listed?.pass ?? OFFERS.backlogPass.price.listed === true;
  const offers: object[] = [
    {
      '@type': 'Offer',
      name: planName('free'),
      price: 0,
      priceCurrency: 'USD',
      url: '/pricing',
    },
  ];
  if (plusListed) {
    const usd = PLUS_ANNUAL_2026_10.usdCents / 100;
    const inr = (PLUS_ANNUAL_2026_10.inr?.paise ?? PLUS_ANNUAL_2026_10.inrPaise) / 100;
    offers.push({
      '@type': 'Offer',
      name: planName('plus'),
      price: usd,
      priceCurrency: 'USD',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: usd,
        priceCurrency: 'USD',
        billingDuration: 'P1Y',
      },
    });
    offers.push({
      '@type': 'Offer',
      name: planName('plus'),
      price: inr,
      priceCurrency: 'INR',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: inr,
        priceCurrency: 'INR',
        billingDuration: 'P1Y',
      },
    });
  }
  if (passListed) {
    offers.push({
      '@type': 'Offer',
      name: planName('pass'),
      price: OFFERS.backlogPass.price.usdCents / 100,
      priceCurrency: 'USD',
    });
  }
  return offers;
}

/** India FAQ with the Pass clause removed. The deck has no separate pass-off key.
 * The paused line is the India answer only while new INR purchases are paused. */
export function indiaFaqAnswer(
  passEnabled: boolean,
  locale: 'usd' | 'inr' = 'inr',
  purchasesPaused = INR_NEW_PURCHASES_PAUSED,
): string {
  const values = storyValues(locale);
  const template = purchasesPaused
    ? WS1_COPY['pricing.faq.india.a.paused']
    : WS1_COPY['pricing.faq.india.a'];
  const full = fill(template, values);
  if (passEnabled) return full;
  const clause = ` and ${values.passPrice} once for the ${values.passName}`;
  return full.replace(clause, '');
}

/** Deck snapshot keeps the literal 14. Render substitutes `POLICY.dunningDays`. */
export function termsPastDue(): string {
  return WS1_COPY['terms.pastDue'].replace(/\b14\b/, String(POLICY.dunningDays));
}

/**
 * Shared by `/pricing.md` and WS3's `/llms.txt`.
 * `pricingV2` defaults to this process's env. A route that already
 * resolved the public API flags passes that boolean instead.
 */
export function renderPricingMarkdown(
  passEnabled = isBillingPassEnabled(),
  pricingV2 = isPricingV2(),
): string {
  if (!pricingV2) return '';
  const locale = 'usd' as const;
  const values = storyValues(locale);
  const features = (lines: readonly string[]) =>
    fillStoryList(lines, locale)
      .map((line) => `- ${line}`)
      .join('\n');
  const sections = [
    `# ${fillStory(WS1_COPY[passEnabled ? 'pricing.h1.passOn' : 'pricing.h1.passOff'], locale)}`,
    '',
    fillStory(WS1_COPY['pricing.sub'], locale),
    '',
    `## ${values.freeName}`,
    '',
    fillStory(WS1_COPY['pricing.free.tagline'], locale),
    fillStory(WS1_COPY['pricing.free.renewal'], locale),
    features(WS1_COPY['pricing.free.features']),
  ];
  if (passEnabled) {
    sections.push(
      '',
      `## ${values.passName}`,
      '',
      fillStory(WS1_COPY['price.passLine'], locale),
      fillStory(WS1_COPY['pricing.pass.renewal'], locale),
      features(WS1_COPY['pricing.pass.features']),
    );
  }
  sections.push(
    '',
    `## ${values.plusName}`,
    '',
    fillStory(WS1_COPY['price.plusLine'], locale),
    fillStory(WS1_COPY['pricing.plus.renewal'], locale),
    features(WS1_COPY['pricing.plus.features']),
    '',
    `## ${fillStory(WS1_COPY['pricing.counts.title'], locale)}`,
    '',
    ...fillStoryList(WS1_COPY['pricing.counts.body'], locale),
    '',
    fillStory(WS1_COPY['pricing.taxes'], locale),
    '',
    refundLine(),
    '',
    `## ${fillStory(WS1_COPY['pricing.promise.title'], locale)}`,
    '',
    ...pricePromiseLines(),
  );
  return sections.join('\n');
}

/** Shown only while `startsAt <= now < endsAt`. */
export function promoBanner(now: Date, passEnabled = isBillingPassEnabled()): string | null {
  const start = new Date(PROMO.startsAt);
  const end = new Date(PROMO.endsAt);
  if (now < start || now >= end) return null;
  const key = passEnabled ? 'pricing.promo.passOn' : 'pricing.promo.passOff';
  return fill(WS1_COPY[key], storyValues('usd'));
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
