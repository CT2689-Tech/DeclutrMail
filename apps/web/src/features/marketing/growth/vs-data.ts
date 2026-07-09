/**
 * Comparison pages data (D142–D145).
 *
 * One source feeds `/compare` hub cards + each `/vs/*` page table +
 * honest "choose them if" callouts. Cells are plain English — no bare
 * ✓/✗ (D143). Tone is balanced buyer-guide, not sales (D142).
 */

export type CompetitorSlug =
  'clean-email' | 'trimbox' | 'sanebox' | 'leave-me-alone' | 'gmail-filters';

export type FeatureRowId =
  | 'focus'
  | 'privacy'
  | 'activity'
  | 'undo'
  | 'autopilot'
  | 'brief'
  | 'multi_inbox'
  | 'free_tier'
  | 'pricing'
  | 'money_back';

export interface FeatureRow {
  id: FeatureRowId;
  label: string;
  declutr: string;
  competitor: string;
}

export interface CompetitorPage {
  slug: CompetitorSlug;
  name: string;
  path: `/vs/${CompetitorSlug}`;
  /** One-line wedge for /compare cards. */
  blurb: string;
  /** D144 honest callout — shown near the top of the /vs page. */
  chooseThemIf: string;
  /** DeclutrMail wedge in one sentence. */
  ourWedge: string;
  rows: readonly FeatureRow[];
}

const SHARED_DECLUTR: Record<FeatureRowId, string> = {
  focus: 'Sender-level: one decision per sender, applied to current and future mail.',
  privacy:
    'Metadata-only. Full bodies fetched: 0. Stores sender, subject, Gmail preview snippet, dates, labels, read/unread.',
  activity: 'Every action is journaled in Activity with uncertain copy until confirmed.',
  undo: 'Preview before every mutation; undo window 7 days (Free/Plus) or 30 days (Pro).',
  autopilot: 'Preset rules start in Observe, then you switch to Active after review.',
  brief: 'Daily Brief on Pro — what changed overnight, not an AI inbox summary of bodies.',
  multi_inbox: 'Multiple Gmail accounts in one workspace (tier-gated inbox count).',
  free_tier: 'Free tier for sender discovery and limited cleanup; paid unlocks bulk + longer undo.',
  pricing: 'Free / Plus / Pro — see /pricing for the current ladder.',
  money_back: '30-day money-back guarantee on every paid plan.',
};

function rows(competitor: Record<FeatureRowId, string>): FeatureRow[] {
  const labels: Record<FeatureRowId, string> = {
    focus: 'Sender vs message focus',
    privacy: 'Privacy posture',
    activity: 'Activity audit log',
    undo: 'Undo',
    autopilot: 'Ongoing automation',
    brief: 'Daily digest',
    multi_inbox: 'Multi-inbox',
    free_tier: 'Free tier',
    pricing: 'Pricing model',
    money_back: 'Money-back guarantee',
  };
  return (Object.keys(labels) as FeatureRowId[]).map((id) => ({
    id,
    label: labels[id],
    declutr: SHARED_DECLUTR[id],
    competitor: competitor[id],
  }));
}

export const COMPETITORS: readonly CompetitorPage[] = [
  {
    slug: 'clean-email',
    name: 'Clean Email',
    path: '/vs/clean-email',
    blurb: 'Multi-provider cleanup with strong rules — vs DeclutrMail’s Gmail-only sender ritual.',
    chooseThemIf:
      'Choose Clean Email if you need Outlook, Yahoo, or iCloud support today. We’re Gmail-only.',
    ourWedge:
      'DeclutrMail is built around a per-sender ritual with mandatory preview, a real undo journal, and a literal metadata-only privacy boundary.',
    rows: rows({
      focus: 'Strong message- and folder-oriented cleanup across providers.',
      privacy: 'Reads message content as part of cleanup workflows (provider-dependent).',
      activity: 'History of cleanups; depth varies by plan.',
      undo: 'Undo exists for many actions; windows and coverage vary.',
      autopilot: 'Rules and recurring cleanups are a core strength.',
      brief: 'Not centered on a daily sender brief.',
      multi_inbox: 'Multi-provider, multi-account support is a headline feature.',
      free_tier: 'Limited free / trial options historically; check their current offer.',
      pricing: 'Subscription with feature tiers across providers.',
      money_back: 'Check Clean Email’s published refund terms.',
    }),
  },
  {
    slug: 'trimbox',
    name: 'Trimbox',
    path: '/vs/trimbox',
    blurb: 'One-time cleanup energy — vs DeclutrMail’s ongoing sender control plane.',
    chooseThemIf:
      'Choose Trimbox if you want a one-time cleanup with no subscription. We’re a recurring product.',
    ourWedge:
      'DeclutrMail keeps working after the first pass: standing policies, Autopilot Observe→Active, and undo that outlives a single session.',
    rows: rows({
      focus: 'Bulk cleanup oriented around clearing backlog quickly.',
      privacy: 'Depends on their access model — verify their current privacy policy.',
      activity: 'Cleanup history; less of a standing ledger of sender decisions.',
      undo: 'Often session-scoped; confirm before large deletes.',
      autopilot: 'Less emphasis on ongoing per-sender automation.',
      brief: 'Not a daily brief product.',
      multi_inbox: 'Varies — often single-account focused.',
      free_tier: 'Often trial / one-shot pricing rather than a lasting free tier.',
      pricing: 'One-time or short-term cleanup pricing is the usual pitch.',
      money_back: 'Check Trimbox’s published refund terms.',
    }),
  },
  {
    slug: 'sanebox',
    name: 'SaneBox',
    path: '/vs/sanebox',
    blurb: 'Mature inbox filtering — vs DeclutrMail’s explicit sender decisions with preview.',
    chooseThemIf:
      'Choose SaneBox if you need 10+ years of company maturity and filtering folders. We’re new.',
    ourWedge:
      'DeclutrMail makes you decide once per sender with a preview of exact impact — not silent folder sorting of mail you never see.',
    rows: rows({
      focus: 'Filtering and training folders (SaneLater, etc.) more than sender cleanup verbs.',
      privacy: 'Processes email to train filters — different trust model than metadata-only.',
      activity: 'Filtering activity; not the same as a destructive-action ledger.',
      undo: 'Moving between Sane folders is reversible in Gmail; destructive cleanup is not the core loop.',
      autopilot: 'Continuous filtering is the product.',
      brief: 'Digests / summaries are part of the SaneBox family of features.',
      multi_inbox: 'Supports multiple accounts; mature multi-account UX.',
      free_tier: 'Trial-led; ongoing free tier is limited.',
      pricing: 'Long-standing subscription pricing.',
      money_back: 'Check SaneBox’s published refund terms.',
    }),
  },
  {
    slug: 'leave-me-alone',
    name: 'Leave Me Alone',
    path: '/vs/leave-me-alone',
    blurb:
      'Unsubscribe credits — vs DeclutrMail’s full Keep/Archive/Unsubscribe/Later/Delete plane.',
    chooseThemIf:
      'Choose Leave Me Alone if you only want unsubscribe-with-credits. We’re a broader sender-control plane.',
    ourWedge:
      'Unsubscribe is one of five verbs. DeclutrMail also archives, deletes, snoozes (Later), and keeps — each with preview and undo.',
    rows: rows({
      focus: 'Unsubscribe-first; less archive/delete ritual.',
      privacy: 'Built around list-unsubscribe flows; confirm their storage claims.',
      activity: 'Unsubscribe history / credit usage.',
      undo: 'Unsubscribes are hard to “undo” once sent; credits model differs.',
      autopilot: 'Not a full Autopilot rules product.',
      brief: 'Not a daily brief product.',
      multi_inbox: 'Typically per connected inbox.',
      free_tier: 'Credit packs / free allowances vary.',
      pricing: 'Credits or subscription for unsubscribe volume.',
      money_back: 'Check Leave Me Alone’s published refund terms.',
    }),
  },
  {
    slug: 'gmail-filters',
    name: 'Gmail Filters',
    path: '/vs/gmail-filters',
    blurb: 'Free, DIY rules — vs DeclutrMail’s guided sender ritual with ledger + undo.',
    chooseThemIf:
      'Choose Gmail Filters if you’re a power user who wants to write filter rules yourself and never wants to pay anything. We do that work for you.',
    ourWedge:
      'Filters are plumbing you write and forget. DeclutrMail is a per-sender ritual with a preview, an Activity ledger, and plan-tied undo.',
    rows: rows({
      focus: 'Message-matching rules you author (from, subject, has words…).',
      privacy: 'Stays inside Gmail — nothing leaves Google. No DeclutrMail-style metadata index.',
      activity: 'No unified cleanup ledger; you inspect filters and All Mail yourself.',
      undo: 'Gmail trash/archive undo is short; no 7–30 day action journal.',
      autopilot: 'Filters run continuously once written — powerful, manual to maintain.',
      brief: 'No daily brief.',
      multi_inbox: 'Per Google account; no cross-inbox workspace.',
      free_tier: 'Free with Gmail.',
      pricing: 'Free.',
      money_back: 'N/A — free.',
    }),
  },
] as const;

export function competitorBySlug(slug: string): CompetitorPage | undefined {
  return COMPETITORS.find((c) => c.slug === slug);
}
