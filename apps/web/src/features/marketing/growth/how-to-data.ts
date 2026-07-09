/**
 * Tier 3 how-to SEO pages (D132). One source for route metadata, prose,
 * and HowTo JSON-LD so crawlers never see a different answer than users.
 */

export interface HowToStep {
  name: string;
  text: string;
}

export interface HowToPage {
  slug: string;
  path: `/how-to/${string}`;
  /** Question-style H1. */
  title: string;
  /** Meta description. */
  description: string;
  /** Direct answer in the first 40–60 words (also HowTo description). */
  answer: string;
  steps: readonly HowToStep[];
  /** Related internal links. */
  related: ReadonlyArray<{ href: string; label: string }>;
}

export const HOW_TO_PAGES: readonly HowToPage[] = [
  {
    slug: 'clean-gmail-by-sender',
    path: '/how-to/clean-gmail-by-sender',
    title: 'How to clean Gmail by sender (not by individual emails)',
    description:
      'Clean Gmail faster by deciding once per sender — Keep, Archive, Unsubscribe, Later, or Delete — with a preview before anything moves.',
    answer:
      'The fastest way to clean Gmail is to decide once per sender, not once per message. Rank senders by volume, preview what Archive or Delete will move, then apply the decision with an undo window. DeclutrMail is built for that ritual and never fetches full message bodies.',
    steps: [
      {
        name: 'Connect Gmail',
        text: 'Grant DeclutrMail the gmail.modify scope so it can act on your instructions. Before connect, read the privacy boundary: Full bodies fetched: 0.',
      },
      {
        name: 'Wait for the first sync',
        text: 'DeclutrMail indexes sender metadata, subjects, and Gmail preview snippets — not bodies — then ranks noisy senders.',
      },
      {
        name: 'Open Senders and pick a noisy sender',
        text: 'Start with high monthly volume and low engagement. One decision here can clear hundreds of messages.',
      },
      {
        name: 'Preview, then Archive or Unsubscribe',
        text: 'Every action shows exact counts before it runs. Unsubscribe stops future mail; Archive clears the inbox without deleting.',
      },
      {
        name: 'Use undo if you change your mind',
        text: 'Actions stay reversible for 7 days on Free/Plus and 30 days on Pro.',
      },
    ],
    related: [
      { href: '/help#getting-started', label: 'Getting started' },
      { href: '/methodology', label: 'Methodology' },
      { href: '/inbox-simulator', label: 'Try the demo' },
    ],
  },
  {
    slug: 'bulk-delete-emails-from-one-sender',
    path: '/how-to/bulk-delete-emails-from-one-sender',
    title: 'How to bulk delete emails from one sender in Gmail',
    description:
      'Delete a sender’s mail in bulk with a real preview of counts and a plan-tied undo window — without reading message bodies.',
    answer:
      'To bulk delete one sender in Gmail safely: identify the sender, preview how many messages will move to Trash, confirm Delete, then rely on Gmail’s ~30-day Trash recovery plus DeclutrMail’s undo journal. DeclutrMail never fetches full bodies to do this.',
    steps: [
      {
        name: 'Find the sender',
        text: 'In DeclutrMail Senders (or Gmail search from:address), open the sender that owns the backlog.',
      },
      {
        name: 'Preview Delete',
        text: 'DeclutrMail shows how many messages will move to Trash before anything runs. Adjust time windows if offered.',
      },
      {
        name: 'Confirm Delete',
        text: 'Messages go to Gmail Trash — recoverable in Gmail for about 30 days. DeclutrMail also journals the action for undo.',
      },
      {
        name: 'Optional: Unsubscribe too',
        text: 'Delete clears the past; Unsubscribe (one-click or manual mailto) stops the future. Mailto is never auto-sent.',
      },
    ],
    related: [
      { href: '/help#verbs-in-gmail-terms', label: 'What Delete does' },
      { href: '/help#undo-windows', label: 'Undo windows' },
      { href: '/pricing', label: 'Plans' },
    ],
  },
  {
    slug: 'auto-archive-future-emails-in-gmail',
    path: '/how-to/auto-archive-future-emails-in-gmail',
    title: 'How to auto-archive future emails in Gmail by sender',
    description:
      'Archive a sender once and keep future mail out of the inbox with standing policies and Autopilot — still with Observe mode first.',
    answer:
      'Auto-archive future Gmail from a sender by deciding Archive once, then letting a standing policy or Autopilot rule continue. In DeclutrMail, Autopilot starts in Observe mode so nothing acts until you switch it Active after review.',
    steps: [
      {
        name: 'Archive the sender once',
        text: 'Preview removes from Inbox (mail stays in All Mail). Confirm when the count looks right.',
      },
      {
        name: 'Keep the standing decision',
        text: 'DeclutrMail records the sender policy so new mail from that sender follows the same intent.',
      },
      {
        name: 'Optional: enable Autopilot Observe',
        text: 'Preset rules collect what they would have done for 7 days without acting.',
      },
      {
        name: 'Switch to Active only after review',
        text: 'You approve the rule before it mutates new mail. Pause anytime.',
      },
    ],
    related: [
      { href: '/help#autopilot-modes', label: 'Observe vs Active' },
      { href: '/vs/gmail-filters', label: 'vs Gmail Filters' },
      { href: '/methodology', label: 'How we act' },
    ],
  },
  {
    slug: 'stop-promotional-emails-gmail',
    path: '/how-to/stop-promotional-emails-gmail',
    title: 'How to stop promotional emails in Gmail',
    description:
      'Stop promo mail by unsubscribing or archiving at the sender level — with honest one-click vs mailto paths.',
    answer:
      'Stop promotional Gmail by ranking promo senders, then Unsubscribe where one-click exists or send a prepared mailto yourself. Archive clears the inbox without deleting. DeclutrMail never auto-sends mailto unsubscribes and never reads full bodies.',
    steps: [
      {
        name: 'Filter to promotional / high-volume senders',
        text: 'Use Senders ranked by volume. Gmail’s own category chips are labels, not DeclutrMail ML predictions.',
      },
      {
        name: 'Unsubscribe when available',
        text: 'One-click list-unsubscribe is requested for you; mailto is prepared for you to send from Gmail (D230).',
      },
      {
        name: 'Archive the backlog',
        text: 'Unsubscribe stops the future; Archive clears what’s already in the inbox.',
      },
      {
        name: 'Protect the senders you still want',
        text: 'Keep / Protect VIP senders so cleanup never touches them.',
      },
    ],
    related: [
      { href: '/help#unsubscribe-flow', label: 'How Unsubscribe works' },
      { href: '/security', label: 'Security' },
      { href: '/inbox-simulator', label: 'Practice in the demo' },
    ],
  },
  {
    slug: 'unsubscribe-from-emails-gmail',
    path: '/how-to/unsubscribe-from-emails-gmail',
    title: 'How to unsubscribe from emails in Gmail safely',
    description:
      'Unsubscribe per sender with one-click when available, or a manual mailto you send yourself — plus preview and undo for related cleanup.',
    answer:
      'Safe Gmail unsubscribe is per-sender: use one-click list-unsubscribe when the sender supports it, otherwise send a mailto yourself. DeclutrMail prepares mailto and never auto-sends. Pair with Archive if you also want the backlog out of the inbox.',
    steps: [
      {
        name: 'Open the sender',
        text: 'Decide once for that address/domain rather than hunting individual messages.',
      },
      {
        name: 'Check the unsubscribe method',
        text: 'One-click: DeclutrMail sends the request and tracks the result. Mailto: you send the prepared email from Gmail.',
      },
      {
        name: 'Read Activity honestly',
        text: '“Unsubscribe requested” means the attempt; “Unsubscribe confirmed” means a verified one-click success.',
      },
      {
        name: 'Clean the past separately',
        text: 'Unsubscribe does not move existing mail — Archive or Delete if you want the backlog gone.',
      },
    ],
    related: [
      { href: '/help#unsubscribe-flow', label: 'Unsubscribe FAQ' },
      { href: '/vs/leave-me-alone', label: 'vs Leave Me Alone' },
      { href: '/pricing', label: 'Bulk cleanup on paid plans' },
    ],
  },
] as const;

export function howToBySlug(slug: string): HowToPage | undefined {
  return HOW_TO_PAGES.find((p) => p.slug === slug);
}
