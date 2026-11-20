import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server';

/**
 * What a connected client can do, read from one request. Measured before
 * building in-chat confirmation (elicitation): it only helps clients that
 * speak the 2026-07-28 protocol, which carries capabilities on every
 * request. A 2025-era client sent them once, at `initialize`, on a
 * request this stateless server never sees again — so for those the
 * answer is `unknown`, never a guessed `no`.
 */
export interface McpClientProfile {
  /** A protocol revision date, `other` for anything not date-shaped, `unknown` when absent. */
  protocol: string;
  elicitation: 'yes' | 'no' | 'unknown';
}

const REVISION = /^\d{4}-\d{2}-\d{2}$/;

export function clientProfile(envelope: unknown, protocolHeader: unknown): McpClientProfile {
  const meta = envelope !== null && typeof envelope === 'object' ? envelope : {};
  const fromEnvelope = (meta as Record<string, unknown>)[PROTOCOL_VERSION_META_KEY];
  const raw = typeof fromEnvelope === 'string' ? fromEnvelope : protocolHeader;
  // Client-chosen text: keep only the shape a revision has.
  const protocol = typeof raw !== 'string' ? 'unknown' : REVISION.test(raw) ? raw : 'other';
  const capabilities = (meta as Record<string, unknown>)[CLIENT_CAPABILITIES_META_KEY];
  if (capabilities === null || typeof capabilities !== 'object') {
    return { protocol, elicitation: 'unknown' };
  }
  return { protocol, elicitation: 'elicitation' in capabilities ? 'yes' : 'no' };
}

/** `PREVIEW_EXPIRED` → `PreviewExpired`: the shape `error_class` accepts in product events. */
export function errorClassOf(code: string): string {
  return code
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');
}
