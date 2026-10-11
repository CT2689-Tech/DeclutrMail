/**
 * Pricing copy formatters. Signatures are stable for the other
 * workstreams. Sentence bodies are filled when the catalog lands;
 * prices, limits, and refund windows are never hard-coded here.
 */

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

export function meterNoun(n: number): string {
  void n;
  return '';
}

export function freeAllowanceLine(): string {
  return '';
}

export function refundLine(): string {
  return '';
}

export function planName(tier: TierId | 'pass'): string {
  void tier;
  return '';
}

export function priceLine(price: PricePoint, locale: 'usd' | 'inr'): string {
  void price;
  void locale;
  return '';
}

export function quotaExceededMessage(input: QuotaExceededMessageInput): string {
  void input;
  return '';
}

export function pricePromiseLines(): readonly string[] {
  return [];
}

/** Listed offers only. Empty until the v2 catalog is built. */
export function buildOffersJsonLd(): object[] {
  return [];
}

/** Shared by `/pricing.md` and WS3's `/llms.txt`. */
export function renderPricingMarkdown(): string {
  return '';
}

/** Null outside the promo window. The window is applied with the catalog. */
export function promoBanner(now: Date): string | null {
  void now;
  return null;
}
