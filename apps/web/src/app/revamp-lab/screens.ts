// Shared screen-nav metadata for Stack + Console (DQ15 multi-screen pass).
// Study stays single-screen (Triage only) — deprioritized per founder
// feedback 2026-07-02 ("did not like 3rd option"), not deleted.

export type LabScreen = 'landing' | 'today' | 'senders' | 'brief' | 'billing';

export const LAB_SCREENS: Array<{ id: LabScreen; label: string }> = [
  { id: 'landing', label: 'Landing' },
  { id: 'today', label: 'Today' },
  { id: 'senders', label: 'Senders' },
  { id: 'brief', label: 'Brief' },
  { id: 'billing', label: 'Billing' },
];
