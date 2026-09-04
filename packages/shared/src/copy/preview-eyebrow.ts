// QA-archive-20260901-01 — the D226 preview's small eyebrow label was
// written three separate times, once per surface, and drifted: Triage's
// single-sender sheet named the verb ("Preview · Archive"), its batch
// sheet named the verb plus a vague "multiple senders", and the Senders
// confirm modal dropped the verb entirely ("Preview · before anything
// changes"). One shared builder so the three surfaces can't drift again —
// name the verb always, name the sender count only when there's more than
// one to name.
export function previewEyebrowLabel(verb: string, senderCount = 1): string {
  return senderCount > 1 ? `Preview · ${verb} · ${senderCount} senders` : `Preview · ${verb}`;
}
