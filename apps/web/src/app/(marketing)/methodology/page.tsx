import type { Metadata } from 'next';

import '@/features/marketing/product-story/product-story.css';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import {
  ActionLifecycleFigure,
  AutomationBoundaryFigure,
  DataBoundaryFigure,
  DocPage,
  DocSection,
  FinalStoryCta,
  RecommendationCascadeFigure,
} from '@/features/marketing/product-story';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Privacy and control — DeclutrMail',
  description:
    'What DeclutrMail stores from Gmail, how suggestions are made, what changes before you confirm, and when automation can run.',
  path: '/methodology',
});

const TOC = [
  { id: 'walkthrough', label: 'What we store' },
  { id: 'recommendations', label: 'How suggestions work' },
  { id: 'brief-boundary', label: 'What a Pro Brief sends' },
  { id: 'action-method', label: 'Preview before changes' },
  { id: 'automation-method', label: 'Manual versus automatic' },
  { id: 'access-and-control', label: 'Gmail permission' },
  { id: 'honest-limits', label: 'Limits' },
] as const;

export default function MethodologyPage() {
  return (
    <DocPage
      title="What DeclutrMail can see and change."
      lede="DeclutrMail uses a limited set of Gmail details, shows you each manual change before it happens, and keeps those decisions separate from automatic rules. Gmail remains where you read and reply."
      toc={TOC}
      highlights={[
        {
          id: 'walkthrough',
          label: 'Limited Gmail details',
          detail: 'See the exact stored-data list',
        },
        {
          id: 'action-method',
          label: 'Preview before moving',
          detail: 'See the count and destination',
        },
        {
          id: 'automation-method',
          label: 'Rules are separate',
          detail: 'You choose what runs later',
        },
      ]}
      after={
        <FinalStoryCta
          title="See these safeguards in the product."
          body="Connect Gmail, review the details DeclutrMail stores, and confirm only the changes that make sense for your inbox."
        />
      }
    >
      <DocSection id="walkthrough" title="We store only the Gmail details we need.">
        <p>
          The list below covers the Gmail details DeclutrMail stores. We also keep the account
          information, preferences, decisions, Activity history, and billing records needed to run
          your account. We do not store full card numbers.
        </p>
        <DataBoundaryFigure />
        <details>
          <summary>What the Gmail preview snippet contains</summary>
          <p>
            This is the short text Gmail already shows in your inbox list. DeclutrMail receives it
            directly from Gmail and does not download the full email to create it.
          </p>
        </details>
      </DocSection>

      <DocSection
        id="recommendations"
        title="Suggestions come from clear rules, not guessed categories."
      >
        <p>
          Protected senders are handled first. New or low-volume senders are suggested for Later.
          For the rest, DeclutrMail compares Archive and Unsubscribe using facts such as volume and
          read rate. It does not use machine learning to guess email categories.
        </p>
        <RecommendationCascadeFigure />
        <details>
          <summary>Where language generation fits</summary>
          <p>
            Anthropic may turn the selected sender facts into a short explanation. It receives the
            sender, suggested action, volume, read rate, and Gmail&rsquo;s own category label. It
            does not receive subject lines, preview snippets, or full email contents for this
            explanation. If Anthropic is unavailable, DeclutrMail shows a standard explanation.
          </p>
        </details>
      </DocSection>

      <DocSection id="brief-boundary" title="What Anthropic receives for a Pro Brief.">
        <p>
          DeclutrMail can send the sender, subject line, and Gmail preview snippet to Anthropic to
          draft a Pro Brief. Full email contents, attachments, embedded images, and raw email source
          are not sent. If Anthropic is unavailable, DeclutrMail uses a standard summary.
        </p>
        <div
          className="dm-story-table-wrap"
          role="region"
          tabIndex={0}
          aria-label="What the Pro Brief sends to Anthropic"
        >
          <table className="dm-story-table">
            <caption className="dm-story-sr-only">What the Pro Brief sends to Anthropic</caption>
            <tbody>
              <tr>
                <th scope="row">Sent for the Brief</th>
                <td>
                  Sender, subject line, Gmail preview snippet, and the small set of facts needed to
                  draft the summary.
                </td>
              </tr>
              <tr>
                <th scope="row">Never sent for the Brief</th>
                <td>
                  Full email contents, email HTML, attachments, embedded images, raw email source,
                  and other email headers.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="dm-story-callout">
          Anthropic sets its own retention and training terms. DeclutrMail&rsquo;s{' '}
          <a href="/privacy">privacy policy</a> links to those terms and explains when Anthropic
          receives data.
        </p>
      </DocSection>

      <DocSection id="action-method" title="Mail-moving actions wait for their preview.">
        <p>
          Before you confirm, DeclutrMail shows how many emails are affected, a sample when
          available, and what will change in Gmail. If that preview cannot load, the action cannot
          run. Keep is an inline sender decision; enabled Autopilot rules can act on future matches
          without a separate confirmation each time. Activity records the result after Gmail or the
          sender confirms it.
        </p>
        <ActionLifecycleFigure />
      </DocSection>

      <DocSection
        id="automation-method"
        title="A manual decision does not create an automatic rule."
      >
        <p>
          Archive, Later, and Delete affect only the email shown before you confirm. Autopilot is
          separate: only rules you deliberately turn on handle future matches, and you see what a
          rule would do before you turn it on.
        </p>
        <AutomationBoundaryFigure />
      </DocSection>

      <DocSection id="access-and-control" title="Why DeclutrMail asks to organize Gmail.">
        <p>
          Google names this permission <code>gmail.modify</code>. It lets DeclutrMail move email out
          of Inbox, add labels, and move email to Trash. DeclutrMail requests only the listed Gmail
          details, encrypts the Google access token, and never sends that token to your browser.
        </p>
        <p>
          You stay in control: revoke Google access, disconnect an inbox from the account menu,
          export your data, or schedule deletion of the whole DeclutrMail account from Settings.
          Disconnecting preserves historical DeclutrMail records for reconnection.
        </p>
        <p>
          The <a href="/security">Security page</a> explains OAuth and encryption. The{' '}
          <a href="/privacy">Privacy Policy</a> covers stored account data, the other companies that
          help provide the service, access controls, and deletion.
        </p>
      </DocSection>

      <DocSection id="honest-limits" title="Limits you should know.">
        <p>DeclutrMail is explicit about what it cannot guarantee.</p>
        <ul className="dm-doc-list">
          <li>
            <strong>Gmail, on the web</strong>
            <span>
              DeclutrMail is currently a web companion for Gmail. It is not a universal mailbox or a
              replacement Gmail reader.
            </span>
          </li>
          <li>
            <strong>Sync time varies</strong>
            <span>
              Mailbox size and Gmail&rsquo;s limits affect the first scan. DeclutrMail shows
              progress instead of promising a fixed completion time.
            </span>
          </li>
          <li>
            <strong>Unsubscribe is a request</strong>
            <span>
              A sender can ignore or delay an unsubscribe request. Once a one-click request is
              delivered, DeclutrMail cannot recall it.
            </span>
          </li>
          <li>
            <strong>Suggestions are optional</strong>
            <span>
              You can always choose a different action. Protect remains a separate control that
              keeps a sender out of bulk and automatic changes.
            </span>
          </li>
        </ul>
      </DocSection>
    </DocPage>
  );
}
