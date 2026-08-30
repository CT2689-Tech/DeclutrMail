import type { Metadata } from 'next';

import '@/features/marketing/product-story/product-story.css';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import {
  ActionLifecycleFigure,
  ActionSemanticsGrid,
  AutomationBoundaryFigure,
  FinalStoryCta,
  GmailBridgeTable,
  ProductStoryShell,
  ProductWalkthroughFigure,
  StorySection,
} from '@/features/marketing/product-story';

export const metadata: Metadata = marketingPageMetadata({
  title: 'How DeclutrMail works with Gmail — DeclutrMail',
  description:
    'How DeclutrMail groups email by sender, previews manual Gmail changes, and keeps one-time cleanup separate from Autopilot rules you enable.',
  path: '/how-it-works',
});

export default function HowItWorksPage() {
  return (
    <ProductStoryShell
      eyebrow="How it works"
      title="A sender-control layer for Gmail."
      lede="Gmail remains where you read, reply, compose, and search. DeclutrMail groups a limited set of Gmail details by sender so you can make fewer decisions. Manual actions affect only the email shown before you confirm; Autopilot rules are separate and must be turned on."
    >
      <StorySection
        id="gmail-stays-home"
        number="01"
        title="Your inbox does not move."
        intro={
          <p>
            DeclutrMail is a companion to Gmail, not a replacement email client. The split is
            deliberate: Gmail handles individual emails; DeclutrMail helps you decide by sender.
          </p>
        }
      >
        <div className="dm-story-prose-grid">
          <article className="dm-story-prose-card">
            <h3>Keep doing in Gmail</h3>
            <p>
              Read full messages, reply, compose, search, use Gmail labels, and manage
              conversations. Gmail remains the source of truth for the mailbox.
            </p>
          </article>
          <article className="dm-story-prose-card">
            <h3>Do faster in DeclutrMail</h3>
            <p>
              Review senders, see why an action is suggested, preview the affected emails, confirm a
              cleanup action, and use Undo from Activity when it is available.
            </p>
          </article>
        </div>
        <p className="dm-story-callout">
          Recent subject links return to Gmail when you need message context. DeclutrMail never
          tries to become the place where you read the full conversation.
        </p>
      </StorySection>

      <StorySection
        id="walkthrough"
        number="02"
        title="One sender decision at a time."
        intro={
          <p>
            After Gmail is connected, a first scan groups email by sender. DeclutrMail shows the
            current step and progress; the time varies with mailbox size and Gmail&rsquo;s limits.
            Every plan includes the ranked Senders view and focused Triage queue.
          </p>
        }
        tone="ink"
      >
        <ProductWalkthroughFigure />
      </StorySection>

      <StorySection
        id="gmail-actions"
        number="03"
        title="The actions, in Gmail terms."
        intro={
          <p>
            Daily Triage offers five decisions: Keep, Archive, Unsubscribe, Later, and Delete. The
            same five are available from Senders and Sender Detail on every plan. Delete is never
            recommended for you — you choose it, and it always shows a full preview first. Keep is
            not Protect: Keep records a decision; Protect is a separate shield against destructive
            and bulk actions.
          </p>
        }
      >
        <ActionSemanticsGrid />
        <GmailBridgeTable />
      </StorySection>

      <StorySection
        id="preview-first"
        number="04"
        title="Preview before the mailbox changes."
        intro={
          <p>
            Some actions ask for options first, but the affected-email preview always appears before
            anything changes. Activity updates only after Gmail confirms a mailbox change or the
            sender reports the result of a one-click unsubscribe request.
          </p>
        }
      >
        <ActionLifecycleFigure />
      </StorySection>

      <StorySection
        id="manual-versus-automation"
        number="05"
        title="Manual cleanup is not a hidden rule."
        intro={
          <p>
            A manual Archive, Later, or Delete applies to the current messages named in its preview.
            It does not quietly decide what happens to future mail. Future automation lives in
            separate Autopilot rules with their own controls: you see what a rule would do before
            you turn it on, and only a rule you deliberately turn on acts without asking.
          </p>
        }
      >
        <AutomationBoundaryFigure />
      </StorySection>

      <StorySection
        id="connect-boundary"
        number="06"
        title="Know what Connect Gmail means."
        intro={
          <p>
            DeclutrMail requests <code>gmail.modify</code> because archiving, labeling, and moving
            messages to Trash require mailbox changes. It also requests basic identity scopes so the
            connected account can be identified.
          </p>
        }
        tone="ink"
      >
        <div className="dm-story-prose-grid">
          <article className="dm-story-prose-card">
            <h3>Limited Gmail details, not full emails</h3>
            <p>
              DeclutrMail stores the sender, subject line, Gmail preview snippet, dates, labels, and
              read or unread state. Full email contents, attachments, embedded images, and raw email
              source are not fetched or stored.
            </p>
          </article>
          <article className="dm-story-prose-card">
            <h3>You can leave cleanly</h3>
            <p>
              Revoke Gmail access or disconnect an inbox from the account menu, export your
              DeclutrMail data, or schedule whole-account deletion from Settings. Disconnect keeps
              historical DeclutrMail records so reconnecting can restore context; Gmail remains
              intact.
            </p>
          </article>
        </div>
      </StorySection>

      <StorySection
        id="beyond-manual"
        number="07"
        title="There's more once manual cleanup isn't enough."
        intro={
          <p>
            Free covers every action above, up to a monthly cleanup limit. Plus adds the Screener,
            which collects new senders for review instead of dropping them straight in your inbox,
            the whole Autopilot system for rules you turn on yourself, and Quiet hours, which decide
            when those rules are allowed to run. Pro adds the Daily Brief, a once-a-day summary of
            what actually needs your attention, and Follow-ups, a queue for the senders you replied
            to but haven&rsquo;t heard back from.
          </p>
        }
      >
        <p className="dm-story-callout">
          See exactly what each plan includes on <a href="/pricing">the pricing page</a>.
        </p>
      </StorySection>

      <FinalStoryCta
        title="Bring the sender view to your Gmail."
        body="Connect Gmail, let the first scan finish, and make your first decision with the affected emails visible before anything changes."
      />
    </ProductStoryShell>
  );
}
