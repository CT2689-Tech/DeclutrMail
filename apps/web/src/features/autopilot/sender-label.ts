/**
 * Sender identity for Autopilot suggestion surfaces.
 *
 * The API normalises a blank `senders.display_name` to `null`
 * (`autopilot.read-service.ts` → `projectMatch`), so a sender whose
 * `From` header carries no display name arrives as
 * `{ senderName: null, senderEmail: 'x@y.com' }`. That is a PERMANENT
 * shape, not the pre-index race the "still syncing" copy describes —
 * falling straight to that string mislabels those rows forever and,
 * worse, hides the only identity we hold on the screens where the user
 * approves a Gmail change (D226). Prefer the address, exactly as the
 * Senders list does, and reserve the syncing copy for the genuine
 * window before `building_sender_index` materialises the senders row,
 * where neither field exists.
 */

export const SENDER_SYNCING_LABEL = 'Sender details still syncing';

export type AutopilotSenderIdentity = {
  senderName?: string | null;
  senderEmail?: string | null;
};

export type ResolvedSenderIdentity = {
  /** Always safe to render — never blank. */
  label: string;
  /** Which field produced `label`; `unknown` means neither existed. */
  source: 'name' | 'email' | 'unknown';
};

export function resolveSenderIdentity(sender: AutopilotSenderIdentity): ResolvedSenderIdentity {
  const name = sender.senderName?.trim();
  if (name != null && name.length > 0) return { label: name, source: 'name' };
  const email = sender.senderEmail?.trim();
  if (email != null && email.length > 0) return { label: email, source: 'email' };
  return { label: SENDER_SYNCING_LABEL, source: 'unknown' };
}
