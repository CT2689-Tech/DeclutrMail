import type { Metadata } from 'next';

import '@/features/marketing/product-story/product-story.css';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import {
  ActionLifecycleFigure,
  AutomationBoundaryFigure,
  ConfirmCardFigure,
  DataBoundaryFigure,
  DecisionsTable,
  FinalStoryCta,
  ProductStoryShell,
  SenderDecisionFigure,
  StorySection,
} from '@/features/marketing/product-story';
import { HeroWorkspace } from '@/features/marketing/landing/hero-workspace';

export const metadata: Metadata = marketingPageMetadata({
  title: 'How DeclutrMail works with Gmail — DeclutrMail',
  description:
    'How DeclutrMail groups email by sender, previews manual Gmail changes, and keeps one-time cleanup separate from Autopilot rules you enable.',
  path: '/how-it-works',
});

export default function HowItWorksPage() {
  return (
    <ProductStoryShell
      title="See the sender. Know what will change."
      lede="DeclutrMail puts recurring senders and their recent email in one place. Open the right-hand inspector, then preview the exact scope before moving mail."
      visual={<HeroWorkspace />}
    >
      <nav className="dm-story-jumps dm-story-shell" aria-label="Explore how it works">
        <span>Jump to</span>
        <a href="#walkthrough">Sender view</a>
        <a href="#gmail-actions">Five decisions</a>
        <a href="#past-email">Past email</a>
        <a href="#manual-versus-automation">Automation</a>
        <a href="#connect-boundary">Privacy & control</a>
      </nav>
      <StorySection
        id="gmail-stays-home"
        layout="side"
        title="Your inbox doesn’t move."
        intro={
          <p>
            DeclutrMail is a companion to Gmail, not a replacement email client. Gmail remains where
            you read, reply, compose, and search.
          </p>
        }
      >
        <div className="dm-story-split">
          <div>
            <h3>Keep doing in Gmail</h3>
            <p>
              Read full messages, reply, compose, search, use labels, and manage conversations.
              Gmail remains the source of truth for the mailbox.
            </p>
          </div>
          <div>
            <h3>Do faster in DeclutrMail</h3>
            <p>
              Review senders, see why an action is suggested, preview the affected emails, confirm,
              and use Undo from Activity when it is available.
            </p>
          </div>
        </div>
        <p className="dm-story-note">
          Overview shows your next step. Clean up contains Senders, Triage and New senders.
          Automations contains Autopilot and Quiet hours. Activity records outcomes and available
          Undo. Recent subject links return to Gmail when you need the full conversation.
        </p>
      </StorySection>

      <StorySection
        id="walkthrough"
        layout="side"
        title="One decision per sender."
        intro={
          <p>
            After you connect Gmail, a first scan groups email by sender. DeclutrMail shows progress
            as it goes; the time depends on mailbox size and Gmail&rsquo;s limits. Every plan
            includes the ranked Senders view and the focused Triage queue.
          </p>
        }
      >
        <SenderDecisionFigure />
      </StorySection>

      <StorySection
        id="gmail-actions"
        title="The five decisions."
        intro={
          <p>
            Keep, Archive, Unsubscribe, Later, and Delete are available in Triage, Senders, and
            Sender Detail on every plan. Delete is never recommended for you: you pick it yourself,
            and it always shows a full preview first.
          </p>
        }
      >
        <DecisionsTable />
      </StorySection>

      <StorySection
        id="preview-first"
        layout="side"
        title="Preview before email moves."
        intro={
          <p>
            Archive, Later, Delete, and unsubscribe requests have a confirmation step. Keep is an
            inline sender decision. For mail-moving actions, the affected-email preview comes before
            you confirm. Activity updates only after Gmail confirms the change, or the sender
            reports the result of a one-click unsubscribe request.
          </p>
        }
        aside={<ConfirmCardFigure />}
      >
        <ActionLifecycleFigure />
      </StorySection>

      <StorySection
        id="past-email"
        layout="side"
        title="Unsubscribe is also a choice about past email."
        intro={
          <p>
            An unsubscribe request asks a sender to stop future mail. The email already in Gmail
            stays where it is unless you choose a separate cleanup action.
          </p>
        }
      >
        <div className="dm-story-split">
          <div>
            <h3>Leave it alone</h3>
            <p>Keep past email in place while the unsubscribe request is sent.</p>
          </div>
          <div>
            <h3>Archive or Delete it</h3>
            <p>
              Choose how far back to act. For Delete, choose Inbox only or Inbox + archived. The
              affected count updates in the preview before you confirm.
            </p>
          </div>
        </div>
        <p className="dm-story-note">
          The sent unsubscribe request cannot be recalled. Archive and Delete have their own Undo in
          Activity when past email moves.
        </p>
      </StorySection>

      <StorySection
        id="manual-versus-automation"
        layout="side"
        title="Manual cleanup is not a hidden rule."
        intro={
          <p>
            Manual actions affect only the email shown before you confirm; a manual Archive, Later,
            or Delete does not quietly decide what happens to future mail. Autopilot rules are
            separate and must be turned on: you see what a rule would do first, and only a rule you
            deliberately turn on acts without asking.
          </p>
        }
      >
        <AutomationBoundaryFigure />
        <div id="beyond-manual" className="dm-story-beyond">
          <p>
            Free covers every action above, up to a monthly cleanup limit. Plus adds the Screener,
            which lists unfamiliar senders for review while their email still arrives in Gmail, the
            whole Autopilot system for rules you turn on yourself, and Quiet hours, which decide
            when those rules may run. Pro adds the Daily Brief, a once-a-day summary of what needs
            your attention, and Follow-ups, a queue for senders you replied to but haven&rsquo;t
            heard back from. <a href="/pricing">See every plan</a>.
          </p>
        </div>
      </StorySection>

      <StorySection
        id="connect-boundary"
        layout="side"
        title="What Connect Gmail means."
        intro={
          <p>
            DeclutrMail requests <code>gmail.modify</code>, because archiving, labeling, and moving
            email to Trash change the mailbox. It also requests basic identity scopes so the
            connected account can be identified.
          </p>
        }
        aside={
          <>
            <h3 className="dm-story-subhead">You can leave cleanly</h3>
            <p className="dm-story-body">
              Revoke Gmail access or disconnect an inbox from the account menu, export your
              DeclutrMail data, or schedule whole-account deletion from Settings. Disconnecting
              keeps historical DeclutrMail records so reconnecting can restore context; Gmail itself
              is untouched. More on <a href="/methodology">privacy and control</a> and{' '}
              <a href="/security">security</a>.
            </p>
          </>
        }
      >
        <DataBoundaryFigure />
      </StorySection>

      <FinalStoryCta
        title="Bring the sender view to your Gmail."
        body="Connect Gmail, let the first scan finish, and make your first decision with the affected emails in view."
      />
    </ProductStoryShell>
  );
}
