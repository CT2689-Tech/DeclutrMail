/**
 * The part of a shared semantics sentence after its lead-in, as a value:
 * `Returns to Inbox from Sep 22, 9:00 AM.` → `From Sep 22, 9:00 AM`.
 * Falls back to the whole sentence (minus its period) if the lead-in ever
 * changes, so a copy edit upstream can only make the value longer, never
 * drop a fact.
 *
 * Its own module: every confirm surface's Details list uses it, and
 * importing it from the Triage preview file pulled that whole module into
 * the Screener, Senders and Autopilot route chunks.
 */
export function afterLead(sentence: string, lead: string): string {
  const body = sentence.replace(/\.$/, '');
  if (!body.startsWith(lead)) return body;
  const rest = body.slice(lead.length);
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}
