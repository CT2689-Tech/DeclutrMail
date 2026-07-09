/**
 * Demo inbox for /inbox-simulator (D133 pragmatic slice).
 *
 * Precomputed verdicts — the production cascade lives in workers and is
 * not a web dependency. Fixtures mirror recognizable senders and the
 * same verb set (K/A/U/L/D) the product uses. No bodies (D7).
 */

export type DemoVerdict = 'keep' | 'archive' | 'unsubscribe' | 'later' | 'delete';

export interface DemoSender {
  id: string;
  name: string;
  email: string;
  domain: string;
  monthlyVolume: number;
  totalAllTime: number;
  readRate: number;
  verdict: DemoVerdict;
  confidence: number;
  reasoning: string;
}

export const DEMO_SENDERS: readonly DemoSender[] = [
  {
    id: 'linkedin',
    name: 'LinkedIn',
    email: 'messages-noreply@linkedin.com',
    domain: 'linkedin.com',
    monthlyVolume: 47,
    totalAllTime: 412,
    readRate: 0.08,
    verdict: 'archive',
    confidence: 0.92,
    reasoning: 'High volume, almost never opened — archive keeps All Mail searchable.',
  },
  {
    id: 'notion',
    name: 'Notion',
    email: 'team@makenotion.com',
    domain: 'makenotion.com',
    monthlyVolume: 12,
    totalAllTime: 96,
    readRate: 0.15,
    verdict: 'unsubscribe',
    confidence: 0.88,
    reasoning: 'Product digests you skip — unsubscribe stops the future.',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    email: 'receipts@stripe.com',
    domain: 'stripe.com',
    monthlyVolume: 6,
    totalAllTime: 140,
    readRate: 0.7,
    verdict: 'keep',
    confidence: 0.95,
    reasoning: 'Financial receipts — keep / protect; never bulk-delete.',
  },
  {
    id: 'oldnavy',
    name: 'Old Navy',
    email: 'oldnavy@email.oldnavy.com',
    domain: 'oldnavy.com',
    monthlyVolume: 28,
    totalAllTime: 310,
    readRate: 0.03,
    verdict: 'unsubscribe',
    confidence: 0.91,
    reasoning: 'Promo cadence with near-zero opens.',
  },
  {
    id: 'github',
    name: 'GitHub',
    email: 'noreply@github.com',
    domain: 'github.com',
    monthlyVolume: 60,
    totalAllTime: 2200,
    readRate: 0.25,
    verdict: 'archive',
    confidence: 0.84,
    reasoning: 'Notification firehose — archive inbox, keep searchable in All Mail.',
  },
  {
    id: 'substack',
    name: 'Substack',
    email: 'hello@substack.com',
    domain: 'substack.com',
    monthlyVolume: 18,
    totalAllTime: 90,
    readRate: 0.4,
    verdict: 'later',
    confidence: 0.72,
    reasoning: 'Sometimes read — Later parks them without deleting.',
  },
  {
    id: 'nextdoor',
    name: 'Nextdoor',
    email: 'no-reply@nextdoor.com',
    domain: 'nextdoor.com',
    monthlyVolume: 22,
    totalAllTime: 180,
    readRate: 0.05,
    verdict: 'unsubscribe',
    confidence: 0.9,
    reasoning: 'Neighborhood digests rarely opened.',
  },
  {
    id: 'groupon',
    name: 'Groupon',
    email: 'noreply@groupon.com',
    domain: 'groupon.com',
    monthlyVolume: 35,
    totalAllTime: 400,
    readRate: 0.02,
    verdict: 'delete',
    confidence: 0.86,
    reasoning: 'Promo spam with no engagement — delete backlog after preview.',
  },
  {
    id: 'calendar',
    name: 'Google Calendar',
    email: 'calendar-notification@google.com',
    domain: 'google.com',
    monthlyVolume: 10,
    totalAllTime: 200,
    readRate: 0.85,
    verdict: 'keep',
    confidence: 0.97,
    reasoning: 'Transactional calendar mail you act on.',
  },
  {
    id: 'uber',
    name: 'Uber',
    email: 'uber.receipts@uber.com',
    domain: 'uber.com',
    monthlyVolume: 8,
    totalAllTime: 95,
    readRate: 0.55,
    verdict: 'archive',
    confidence: 0.8,
    reasoning: 'Receipts worth keeping searchable, not in the inbox.',
  },
  {
    id: 'nytimes',
    name: 'The New York Times',
    email: 'nytdirect@nytimes.com',
    domain: 'nytimes.com',
    monthlyVolume: 30,
    totalAllTime: 500,
    readRate: 0.12,
    verdict: 'unsubscribe',
    confidence: 0.83,
    reasoning: 'News digests mostly skipped.',
  },
  {
    id: 'figma',
    name: 'Figma',
    email: 'noreply@figma.com',
    domain: 'figma.com',
    monthlyVolume: 9,
    totalAllTime: 70,
    readRate: 0.35,
    verdict: 'later',
    confidence: 0.7,
    reasoning: 'Occasional product updates — review later.',
  },
  {
    id: 'amazon',
    name: 'Amazon',
    email: 'ship-confirm@amazon.com',
    domain: 'amazon.com',
    monthlyVolume: 14,
    totalAllTime: 320,
    readRate: 0.6,
    verdict: 'archive',
    confidence: 0.78,
    reasoning: 'Ship confirms — archive after delivery, don’t unsubscribe blindly.',
  },
  {
    id: 'spotify',
    name: 'Spotify',
    email: 'noreply@spotify.com',
    domain: 'spotify.com',
    monthlyVolume: 6,
    totalAllTime: 48,
    readRate: 0.1,
    verdict: 'unsubscribe',
    confidence: 0.87,
    reasoning: 'Playlist promos unused.',
  },
  {
    id: 'hr',
    name: 'Priya (HR)',
    email: 'priya@acme-corp.example',
    domain: 'acme-corp.example',
    monthlyVolume: 3,
    totalAllTime: 40,
    readRate: 0.95,
    verdict: 'keep',
    confidence: 0.99,
    reasoning: 'Human coworker — Keep / Protect.',
  },
  {
    id: 'booking',
    name: 'Booking.com',
    email: 'noreply@booking.com',
    domain: 'booking.com',
    monthlyVolume: 11,
    totalAllTime: 88,
    readRate: 0.2,
    verdict: 'unsubscribe',
    confidence: 0.85,
    reasoning: 'Travel deals after one trip.',
  },
] as const;

export const DEMO_STORAGE_KEY = 'dm.inbox-simulator.decisions.v1';

export function verbLabel(v: DemoVerdict): string {
  return v.charAt(0).toUpperCase() + v.slice(1);
}
