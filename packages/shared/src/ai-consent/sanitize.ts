/**
 * Strip characters a model could treat as instructions or hidden text.
 * Built from a string so the source is not a regex literal (no-control-regex).
 */
const CONTROL_OR_ZW = new RegExp(
  '[' +
    '\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F' +
    '\\u007F-\\u009F' +
    '\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\uFEFF' +
    ']',
  'g',
);

export function sanitizeUntrusted(value: string, maxLen: number): string {
  const cleaned = value.replace(CONTROL_OR_ZW, '').replace(/\s+/g, ' ').trim();
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

/** Quote a field so the model sees it as data. Delimiters cannot appear inside. */
export function quoteUntrusted(value: string, maxLen: number): string {
  const cleaned = sanitizeUntrusted(value, maxLen).replaceAll('«', '').replaceAll('»', '');
  return `«${cleaned}»`;
}
