const URL_RE = /\b(?:https?:\/\/|www\.)[^\s)]+/gi;

/**
 * Instructions aimed at the reader. A mention of a reply in a subject
 * ("needs a reply about Q4") is not one of these.
 */
const INSTRUCTION_RE =
  /\b(?:please\s+)?(?:click|tap)\s+(?:here|this|the link)\b|\b(?:please\s+)?reply\s+to\s+(?:this|the|me)\b|\bfollow\s+(?:this|the)\s+link\b|\bopen\s+this\s+link\b/i;

export type LlmOutputVerdict =
  { ok: true } | { ok: false; reason: 'empty' | 'length' | 'url' | 'instruction' };

export function validateLlmOutput(
  text: string,
  allowedCorpus: string,
  maxWords: number,
): LlmOutputVerdict {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };
  const words = trimmed.split(/\s+/);
  if (words.length > maxWords) return { ok: false, reason: 'length' };
  if (INSTRUCTION_RE.test(trimmed)) return { ok: false, reason: 'instruction' };
  const urls = trimmed.match(URL_RE) ?? [];
  for (const url of urls) {
    const cleaned = url.replace(/[.,;:!?]+$/g, '');
    if (!allowedCorpus.includes(cleaned)) return { ok: false, reason: 'url' };
  }
  return { ok: true };
}
