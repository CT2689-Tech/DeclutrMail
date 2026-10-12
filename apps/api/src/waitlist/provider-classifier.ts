/**
 * Classify a waitlist address without logging it.
 * Consumer domains resolve locally. Anything else uses MX, cached 24h.
 */
import { promises as dns } from 'node:dns';

export type ProviderClass =
  'gmail' | 'google_workspace' | 'microsoft' | 'yahoo_aol' | 'icloud' | 'other' | 'unknown';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MX_TIMEOUT_MS = 1500;

const cache = new Map<string, { at: number; value: ProviderClass }>();

const MICROSOFT = new Set(['outlook.com', 'hotmail.com', 'live.com', 'msn.com']);
const YAHOO_AOL = new Set(['yahoo.com', 'aol.com', 'ymail.com']);
const ICLOUD = new Set(['icloud.com', 'me.com', 'mac.com']);

export function clearProviderClassCache(): void {
  cache.clear();
}

export async function classifyProvider(email: string): Promise<ProviderClass> {
  const domain = domainOf(email);
  if (!domain) return 'unknown';
  const consumer = consumerClass(domain);
  if (consumer) return consumer;

  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const value = await lookupMx(domain);
  cache.set(domain, { at: Date.now(), value });
  return value;
}

function domainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  return email
    .slice(at + 1)
    .trim()
    .toLowerCase();
}

function consumerClass(domain: string): ProviderClass | null {
  if (domain === 'gmail.com' || domain === 'googlemail.com') return 'gmail';
  if (MICROSOFT.has(domain)) return 'microsoft';
  if (YAHOO_AOL.has(domain)) return 'yahoo_aol';
  if (ICLOUD.has(domain)) return 'icloud';
  return null;
}

async function lookupMx(domain: string): Promise<ProviderClass> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('mx-timeout')), MX_TIMEOUT_MS);
      }),
    ]);
    return classFromMx(records.map((record) => record.exchange.toLowerCase()));
  } catch {
    return 'unknown';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function classFromMx(hosts: readonly string[]): ProviderClass {
  const normalized = hosts.map((host) => (host.endsWith('.') ? host.slice(0, -1) : host));
  if (normalized.length === 0) return 'unknown';
  if (
    normalized.some(
      (host) =>
        host === 'google.com' ||
        host.endsWith('.google.com') ||
        host === 'googlemail.com' ||
        host.endsWith('.googlemail.com'),
    )
  ) {
    return 'google_workspace';
  }
  if (normalized.some((host) => host === 'outlook.com' || host.endsWith('.outlook.com'))) {
    return 'microsoft';
  }
  if (normalized.some((host) => host === 'yahoodns.net' || host.endsWith('.yahoodns.net'))) {
    return 'yahoo_aol';
  }
  if (normalized.some((host) => host === 'icloud.com' || host.endsWith('.icloud.com'))) {
    return 'icloud';
  }
  return 'other';
}
