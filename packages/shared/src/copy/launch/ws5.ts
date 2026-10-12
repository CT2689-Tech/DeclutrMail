import deck from './deck/ws5.json' with { type: 'json' };

/**
 * WS5 copy. The object is the checked-in deck section, word for word.
 * Surfaces read keys from here; they do not write their own sentences.
 */
export const WS5_COPY = deck;

export type PluralCopy = { readonly one: string; readonly other: string };

export function isPluralCopy(value: unknown): value is PluralCopy {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as { one?: unknown; other?: unknown };
  return typeof row.one === 'string' && typeof row.other === 'string';
}

/** Substitute `{token}` placeholders. Unknown tokens stay visible. */
export function fillCopy(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match,
  );
}

/** `n === 1` selects `one`; every other count selects `other`. */
export function pluralCopy(
  copy: PluralCopy,
  n: number,
  vars: Record<string, string | number> = {},
): string {
  return fillCopy(n === 1 ? copy.one : copy.other, { n, ...vars });
}
