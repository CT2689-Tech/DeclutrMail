// revamp-lab fixtures — THROWAWAY (DQ15 direction lab, senders-lab precedent).
// Pure client-side data; no API, no persistence. Deletable folder.
//
// Product truth kept intact even here: K/A/U/L/D verbs come from the real
// VERB_REGISTRY, privacy copy from the locked module, preview-before-mutation
// (D226) is modeled in every direction's flow. Everything visual is
// intentionally OFF-CONSTITUTION (fonts/palette/layout) — that is the point
// of the lab and why this route never links from product nav.

import type { VerbId } from '@declutrmail/shared/actions';

export interface LabSender {
  id: string;
  name: string;
  email: string;
  domain: string;
  /** messages in the last 30 days */
  perMonth: number;
  /** 0..1 read rate over 90d */
  readRate: number;
  /** days since last received message */
  lastSeenDays: number;
  lifetime: number;
  /** engine recommendation (varied confidence on purpose — see audit W4) */
  recommended: VerbId;
  confidence: number;
  reasoning: string;
  signals: string[];
  /** unsubscribe channel; null = no channel (drives disabled-verb-with-reason) */
  unsubChannel: 'one-click' | 'mailto' | null;
  protected?: boolean;
}

export const LAB_SENDERS: LabSender[] = [
  {
    id: 'amazon',
    name: 'Amazon.com',
    email: 'store-news@amazon.com',
    domain: 'amazon.com',
    perMonth: 18,
    readRate: 0,
    lastSeenDays: 2,
    lifetime: 555,
    recommended: 'unsubscribe',
    confidence: 95,
    reasoning:
      'Heavy promotional volume you never open — 555 lifetime, none read in 90 days, one-click unsubscribe available.',
    signals: [
      'Read rate 0% over 90 days',
      '18 messages/month',
      'RFC 8058 one-click channel present',
    ],
    unsubChannel: 'one-click',
  },
  {
    id: 'uber',
    name: 'Uber Receipts',
    email: 'noreply@uber.com',
    domain: 'uber.com',
    perMonth: 4,
    readRate: 0.05,
    lastSeenDays: 6,
    lifetime: 213,
    recommended: 'archive',
    confidence: 82,
    reasoning:
      'Receipts you rarely open but may want on file — archiving keeps them searchable without cluttering the inbox.',
    signals: ['Read rate 5%', 'Transactional pattern (receipts)', 'No promotional headers'],
    unsubChannel: null,
  },
  {
    id: 'hdfc',
    name: 'HDFC Bank InstaAlerts',
    email: 'alerts@hdfcbank.net',
    domain: 'hdfcbank.net',
    perMonth: 32,
    readRate: 0.12,
    lastSeenDays: 0,
    lifetime: 1209,
    recommended: 'keep',
    confidence: 88,
    reasoning:
      'Bank transaction alerts — transactional senders are damped away from Unsubscribe even at high volume. Keeping is the safe default.',
    signals: ['Transactional damping rule applied', '32 messages/month', 'No unsubscribe channel'],
    unsubChannel: null,
    protected: false,
  },
  {
    id: 'linkedin',
    name: 'LinkedIn Notifications',
    email: 'notifications@linkedin.com',
    domain: 'linkedin.com',
    perMonth: 47,
    readRate: 0.02,
    lastSeenDays: 1,
    lifetime: 1874,
    recommended: 'unsubscribe',
    confidence: 91,
    reasoning:
      'Highest-volume sender in the queue with a 2% read rate — notification digests you already see in the app itself.',
    signals: ['47 messages/month', 'Read rate 2%', 'Mailto unsubscribe channel'],
    unsubChannel: 'mailto',
  },
  {
    id: 'retailmenot',
    name: 'RetailMeNot',
    email: 'mail@mail.retailmenot.com',
    domain: 'retailmenot.com',
    perMonth: 22,
    readRate: 0.01,
    lastSeenDays: 1,
    lifetime: 689,
    recommended: 'unsubscribe',
    confidence: 94,
    reasoning: 'Daily deal blasts, effectively never read. One-click channel available.',
    signals: ['22 messages/month', 'Read rate 1%', 'One-click channel present'],
    unsubChannel: 'one-click',
  },
  {
    id: 'medium',
    name: 'Medium Daily Digest',
    email: 'noreply@medium.com',
    domain: 'medium.com',
    perMonth: 30,
    readRate: 0.34,
    lastSeenDays: 0,
    lifetime: 912,
    recommended: 'later',
    confidence: 61,
    reasoning:
      'You read about a third of these — not noise, not urgent. Later moves them out of the inbox into a batch you review on your schedule.',
    signals: ['Read rate 34%', 'Daily cadence', 'Engagement trending down 8 weeks'],
    unsubChannel: 'one-click',
  },
  {
    id: 'github',
    name: 'GitHub',
    email: 'notifications@github.com',
    domain: 'github.com',
    perMonth: 12,
    readRate: 0.78,
    lastSeenDays: 0,
    lifetime: 3401,
    recommended: 'keep',
    confidence: 97,
    reasoning: 'High engagement — 78% read rate. This is mail you act on.',
    signals: ['Read rate 78%', 'You replied 14 times', 'Work-pattern cadence'],
    unsubChannel: 'mailto',
    protected: true,
  },
  {
    id: 'nykaa',
    name: 'Nykaa',
    email: 'promo@nykaa.com',
    domain: 'nykaa.com',
    perMonth: 26,
    readRate: 0.03,
    lastSeenDays: 3,
    lifetime: 431,
    recommended: 'unsubscribe',
    confidence: 89,
    reasoning: 'Promotional cadence with near-zero engagement — 3% read over 90 days.',
    signals: ['26 messages/month', 'Read rate 3%', 'One-click channel present'],
    unsubChannel: 'one-click',
  },
];

/** Cohort counts shown in rails/receipts (mirrors real workspace scale). */
export const LAB_COHORTS = {
  decide: LAB_SENDERS.length,
  quiet: 555,
  dormant: 6678,
  protected: 459,
  all: 7914,
} as const;

export interface ResolvedAction {
  sender: LabSender;
  verb: VerbId;
  at: number; // sequence, not wall-clock (lab only)
}

/** What a verb does to a sender's mail — preview copy inputs (D226). */
export function previewCopy(
  verb: VerbId,
  s: LabSender,
): { does: string; doesNot: string; undo: string } {
  const n = s.lifetime.toLocaleString('en-US');
  switch (verb) {
    case 'keep':
      return {
        does: `Marks ${s.name} as decided — future mail lands normally.`,
        doesNot: 'Nothing moves. No labels change.',
        undo: 'Change the decision any time.',
      };
    case 'archive':
      return {
        does: `Archives ${n} messages from ${s.name}. Future mail auto-archives.`,
        doesNot:
          'Does not delete anything. Other senders untouched. Search still finds everything.',
        undo: 'Reversible for 7 days.',
      };
    case 'unsubscribe':
      return {
        does:
          s.unsubChannel === 'one-click'
            ? `Sends the one-click unsubscribe for ${s.name}, then archives ${n} past messages.`
            : `Prepares the unsubscribe email for ${s.name} — you press Send in Gmail. Past messages archive.`,
        doesNot: 'Does not delete anything. Does not touch other senders.',
        undo: 'Archive step reversible for 7 days.',
      };
    case 'later':
      return {
        does: `Moves ${s.name} out of the inbox into your Later batch.`,
        doesNot: 'Does not unsubscribe. Does not delete. Batch surfaces on your schedule.',
        undo: 'Reversible for 7 days.',
      };
    case 'delete':
      return {
        does: `Moves ${n} messages from ${s.name} to Gmail Trash.`,
        doesNot: 'Does not touch other senders.',
        undo: 'Recoverable for 30 days, then Gmail empties Trash.',
      };
  }
}

export function sessionTotals(resolved: ResolvedAction[]) {
  const emails = resolved.reduce((n, r) => n + (r.verb === 'keep' ? 0 : r.sender.lifetime), 0);
  const byVerb = { keep: 0, archive: 0, unsubscribe: 0, later: 0, delete: 0 } as Record<
    VerbId,
    number
  >;
  for (const r of resolved) byVerb[r.verb] += 1;
  return { decided: resolved.length, emails, byVerb };
}

/** Shared keyboard guard — don't steal keys from inputs. */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

// ─────────────────────────────────────────────────────────────
// Extra fixtures for the Senders / Brief / Billing screen builds.
// Kept SEPARATE from LAB_SENDERS on purpose — LAB_SENDERS backs the
// already-verified Today/Triage interaction in all three directions;
// widening it would shift "1/8" progress counts that were smoke-tested.
// The Senders management screen gets its own, larger fixture list.
// ─────────────────────────────────────────────────────────────

export const LAB_ALL_SENDERS: LabSender[] = [
  ...LAB_SENDERS,
  {
    id: 'bestbuy',
    name: 'Best Buy Notifications',
    email: 'notifications@bestbuy.com',
    domain: 'bestbuy.com',
    perMonth: 9,
    readRate: 0.08,
    lastSeenDays: 4,
    lifetime: 302,
    recommended: 'archive',
    confidence: 74,
    reasoning: 'Order + promo mix, opened occasionally around purchases only.',
    signals: ['Read rate 8%', '9 messages/month'],
    unsubChannel: 'one-click',
  },
  {
    id: 'mudfactor',
    name: 'Mud Factor LIVERMORE 2021',
    email: 'info@mudfactor.com',
    domain: 'mudfactor.com',
    perMonth: 0,
    readRate: 0.4,
    lastSeenDays: 420,
    lifetime: 6,
    recommended: 'archive',
    confidence: 90,
    reasoning: 'One-time event mail from 2021 — nothing since.',
    signals: ['Last seen 420 days ago', '6 lifetime messages'],
    unsubChannel: 'one-click',
  },
  {
    id: 'aa',
    name: 'American Airlines AA',
    email: 'aadvantage@aa.com',
    domain: 'aa.com',
    perMonth: 6,
    readRate: 0.22,
    lastSeenDays: 12,
    lifetime: 188,
    recommended: 'keep',
    confidence: 68,
    reasoning: 'Travel account activity — occasional but relevant.',
    signals: ['Read rate 22%', 'AAdvantage account mail'],
    unsubChannel: 'mailto',
  },
  {
    id: 'usps',
    name: 'USPS Informed Delivery',
    email: 'auto-reply@usps.com',
    domain: 'usps.com',
    perMonth: 30,
    readRate: 0.61,
    lastSeenDays: 0,
    lifetime: 2104,
    recommended: 'keep',
    confidence: 93,
    reasoning: 'Daily delivery digest you open most mornings.',
    signals: ['Read rate 61%', 'Daily cadence'],
    unsubChannel: null,
  },
  {
    id: 'venmo',
    name: 'Venmo',
    email: 'venmo@venmo.com',
    domain: 'venmo.com',
    perMonth: 14,
    readRate: 0.55,
    lastSeenDays: 1,
    lifetime: 967,
    recommended: 'keep',
    confidence: 85,
    reasoning: 'Payment notifications — high relevance.',
    signals: ['Read rate 55%', 'Transactional pattern'],
    unsubChannel: null,
  },
  {
    id: 'amex',
    name: 'American Express Travel',
    email: 'travel@americanexpress.com',
    domain: 'americanexpress.com',
    perMonth: 3,
    readRate: 0.1,
    lastSeenDays: 40,
    lifetime: 74,
    recommended: 'unsubscribe',
    confidence: 71,
    reasoning: 'Travel offers, rarely opened.',
    signals: ['Read rate 10%', 'Promotional cadence'],
    unsubChannel: 'one-click',
  },
  {
    id: 'geico',
    name: 'GEICO Claims',
    email: 'claims@geico.com',
    domain: 'geico.com',
    perMonth: 2,
    readRate: 0.3,
    lastSeenDays: 88,
    lifetime: 41,
    recommended: 'keep',
    confidence: 60,
    reasoning: 'Low volume, insurance-relevant when it arrives.',
    signals: ['Read rate 30%', 'Low volume'],
    unsubChannel: 'mailto',
  },
];

/** active <7d · quiet 7-90d · dormant >90d (mirrors the real Senders filters). */
export function activityBucket(s: LabSender): 'active' | 'quiet' | 'dormant' {
  if (s.lastSeenDays < 7) return 'active';
  if (s.lastSeenDays <= 90) return 'quiet';
  return 'dormant';
}

export interface BriefItem {
  sender: string;
  domain: string;
  subject: string;
}

/** Mirrors the real Brief's Reply / FYI / Noise structure (live-verified 2026-07-02). */
export const LAB_BRIEF = {
  reply: [
    {
      sender: 'LinkedIn',
      domain: 'linkedin.com',
      subject: '1 new Lead Member of Technical Staff opening at Amazon Science',
    },
    {
      sender: 'RetailMeNot',
      domain: 'retailmenot.com',
      subject: '✈️ Southwest One-Ways From $59 | Kohl’s Vacay Shop',
    },
    { sender: 'Dennis Gorelik', domain: 'gmail.com', subject: 'Sr. Java Developer — Dallas, TX' },
  ] satisfies BriefItem[],
  fyi: [
    { sender: 'E-Trade', domain: 'etrade.com', subject: 'Dividend payment posted to your account' },
    { sender: 'TripIt', domain: 'tripit.com', subject: 'Hotel receipt confirmed — Tahoe City' },
    { sender: 'Wells Fargo', domain: 'wellsfargo.com', subject: 'Your balance summary is ready' },
  ] satisfies BriefItem[],
  noiseCount: 37,
  noiseSenderCount: 28,
  narrative:
    'Two items worth a look — a Lead Member of Technical Staff opening at Amazon Science, and a Sr. Java Developer listing in Dallas. Everything else settles on its own.',
} as const;

export interface LabTier {
  id: 'free' | 'plus' | 'pro';
  name: string;
  tagline: string;
  priceMonthly: number;
  priceAnnual: number;
  features: string[];
  cta: string;
  popular?: boolean;
}

/** Numbers match the live pricing screen (verified 2026-07-02 walk). */
export const LAB_TIERS: LabTier[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'See what’s noisy.',
    priceMonthly: 0,
    priceAnnual: 0,
    features: ['1 mailbox', 'Unlimited Unsubscribe', '7-day undo', '5 lifetime bulk cleanups'],
    cta: 'Start free',
  },
  {
    id: 'plus',
    name: 'Plus',
    tagline: 'Clean it yourself, unlimited.',
    priceMonthly: 9,
    priceAnnual: 90,
    features: [
      'Unlimited Keep · Archive · Later · Delete',
      '1 mailbox',
      '7-day undo',
      'Autopilot presets',
    ],
    cta: 'Get Plus',
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Let DeclutrMail keep it clean.',
    priceMonthly: 19,
    priceAnnual: 190,
    features: ['Everything in Plus', '2nd mailbox', '30-day undo', 'Autopilot on autopilot'],
    cta: 'Get Pro',
    popular: true,
  },
];

export const LAB_FOUNDING_PRO = { price: 129, regular: 190, seatsLeft: 250 } as const;
