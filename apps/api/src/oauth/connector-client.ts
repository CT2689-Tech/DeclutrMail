import type { ConnectorClient } from '@declutrmail/shared/analytics/sanitize-product-event';

const CLAUDE_HOSTS = ['claude.ai', 'claude.com'];
const CHATGPT_HOSTS = ['chatgpt.com', 'openai.com'];
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Which assistant a connected app is, for the product funnel only: read
 * from where its sign-in returns to, never from the name it registered
 * (free text it chose). Nothing is authorized on this; a wrong answer
 * miscounts a chart.
 */
export function connectorClient(redirectUris: readonly string[]): ConnectorClient {
  const hosts = redirectUris.filter((uri) => URL.canParse(uri)).map((uri) => new URL(uri));
  if (hosts.length === 0) return 'other';
  if (hosts.every((url) => onHost(url, CLAUDE_HOSTS))) return 'claude';
  if (hosts.every((url) => onHost(url, CHATGPT_HOSTS))) return 'chatgpt';
  if (hosts.every((url) => LOOPBACK_HOSTS.has(url.hostname) || !url.protocol.startsWith('http'))) {
    return 'local';
  }
  return 'other';
}

function onHost(url: URL, roots: readonly string[]): boolean {
  if (url.protocol !== 'https:') return false;
  return roots.some((root) => url.hostname === root || url.hostname.endsWith(`.${root}`));
}
