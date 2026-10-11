import { WS2_COPY } from '../copy/launch/ws2.js';

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '');
}

/**
 * Rule-based explanation used when stored AI prose must not be shown.
 * Volume is the raw 90-day count divided by 3. A whole number of at
 * least 1 uses the volume line; below 0.5 uses the less-than-one line.
 * No mail in the window uses the no-recent line and omits the read share.
 */
export function plainVolumeExplanation(input: {
  name: string;
  last90Count: number;
  readRate: number | null;
}): string {
  const name = input.name.trim() || 'This sender';
  const copy = WS2_COPY.plainExplain;
  let volume: string;
  if (input.last90Count <= 0) {
    volume = fill(copy.noRecent, { name });
  } else {
    const monthly = input.last90Count / 3;
    if (monthly < 0.5) {
      volume = fill(copy.volumeLessThanOne, { name });
    } else {
      const whole = Math.max(1, Math.round(monthly));
      const template = whole === 1 ? copy.volume.one : copy.volume.other;
      volume = fill(template, { name, monthlyVolume: String(whole) });
    }
  }
  if (input.last90Count <= 0 || input.readRate === null) return volume;
  const readPct = String(Math.round(input.readRate * 100));
  return `${volume} ${fill(copy.readShare, { readPct })}`;
}

export const PLAIN_STALE_CLAIM = WS2_COPY.plainExplain.staleClaim;
