/**
 * Facts the /connect page states. They live here because a Next route
 * module may export only its page and route config.
 */

/** The connector's address (docs/runbooks/mcp-connector.md). */
export const MCP_SERVER_URL = 'https://api.declutrmail.com/mcp';

/** The day each client's setup steps were checked against its vendor's docs. */
export const CLIENT_STEPS_CHECKED_ON = '2026-11-20';

/**
 * The `ask` line of each connector tool, in `tools/list` order. Source of
 * truth: `MCP_TOOLS` in apps/api/src/mcp/mcp-tool-contract.ts — the page
 * test reads that file and fails if this list drifts from it.
 */
export const TOOL_ASKS = [
  'See which Gmail accounts are connected and which one is active.',
  'List who sends you email, biggest first, with read rates and how to unsubscribe.',
  'Look closer at one sender: how much is in your inbox, and their recent subject lines.',
  'Check your plan and how much of its monthly limit is used.',
  'Prepare Keep, Archive, Unsubscribe, Later or Delete for one sender or many. Unsubscribe can also archive or delete their existing email. Nothing changes until you confirm it.',
  'Find out whether you confirmed a prepared change, and what it did.',
  'Check how far a change has got.',
  'List recent changes that can still be undone.',
  'Undo an Archive, Later or Delete.',
  'Protect a sender, so cleanups skip it.',
] as const;
