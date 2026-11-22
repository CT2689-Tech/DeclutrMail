// /connect — use DeclutrMail from an AI assistant over MCP.
//
// Public marketing route: static prose plus one client island (the Copy
// buttons). Must stay prerenderable — no per-request reads.
//
// CONTENT CONTRACT (CLAUDE.md Tier 1b):
// - "What you can ask" is the `ask` text of the ten tools in
//   apps/api/src/mcp/mcp-tool-contract.ts; page.test.tsx reads that file
//   and fails if the two drift.
// - The safety block restates docs/spec/mcp-connector.md §3–§4 and the
//   tool descriptions: preview + confirm (in the chat when the client
//   can ask, otherwise on DeclutrMail), Protected
//   senders skipped, undo for Archive/Later/Delete, unsubscribe requests
//   final, Disconnect in Settings → Connected apps.
// - "Every plan" is spec §11 founder decision 3.
// - Each client's steps were read from that vendor's own docs on
//   CLIENT_STEPS_CHECKED_ON and link to them. Grok is left off: xAI's
//   connector docs (docs.x.ai/grok/connectors) do not say whether custom
//   connectors can complete an OAuth sign-in, and this server needs one.

import type { Metadata } from 'next';
import Link from 'next/link';

import {
  PRIVACY_BADGE_HEADLINE,
  PRIVACY_STORAGE_ITEMS,
  PRIVACY_STORAGE_LABEL,
} from '@declutrmail/shared';

import '@/features/marketing/product-story/product-story.css';
import '@/features/marketing/connect/connect.css';
import {
  CLIENT_STEPS_CHECKED_ON,
  MCP_SERVER_URL,
  TOOL_ASKS,
} from '@/features/marketing/connect/connect-content';
import { CopyField } from '@/features/marketing/connect/copy-field';
import { DocPage, DocSection, FinalStoryCta } from '@/features/marketing/product-story';
import { PAGE_LAST_UPDATED } from '@/features/marketing/page-dates';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Use DeclutrMail from Claude, ChatGPT, Codex or Cursor — DeclutrMail',
  description:
    'Connect DeclutrMail to your AI assistant over MCP. Ask who sends you the most email, then clean up by sender after you confirm a preview.',
  path: '/connect',
});

const TOC = [
  { id: 'what-you-can-ask', label: 'What you can ask' },
  { id: 'safety', label: 'Nothing changes without you' },
  { id: 'what-it-sees', label: 'What your assistant sees' },
  { id: 'server-url', label: 'Server URL' },
  { id: 'claude', label: 'Claude' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'codex', label: 'Codex' },
  { id: 'cursor', label: 'Cursor' },
] as const;

const CURSOR_CONFIG = JSON.stringify({ mcpServers: { declutrmail: { url: MCP_SERVER_URL } } });

function Source({ href, vendor }: { href: string; vendor: string }) {
  return (
    <p className="dm-connect-source">
      Steps from{' '}
      <a href={href} rel="noopener noreferrer">
        {vendor}&rsquo;s documentation
      </a>
      , checked {CLIENT_STEPS_CHECKED_ON}.
    </p>
  );
}

export default function ConnectPage() {
  return (
    <DocPage
      title="Use DeclutrMail from your AI assistant"
      lede="Ask Claude, ChatGPT, Codex or Cursor who fills your inbox, then clean it up by sender. You confirm every change."
      lastUpdated={PAGE_LAST_UPDATED['/connect']}
      toc={TOC}
      after={
        <FinalStoryCta
          title="Connect Gmail first."
          body="Your assistant works with the senders DeclutrMail has found, so start with a DeclutrMail account and let the first scan finish. Every plan can connect an assistant."
        />
      }
    >
      <DocSection id="what-you-can-ask" title="What you can ask">
        <ul>
          {TOOL_ASKS.map((ask) => (
            <li key={ask}>{ask}</li>
          ))}
        </ul>
      </DocSection>

      <DocSection id="safety" title="Nothing changes without you">
        <ul>
          <li>
            Your assistant prepares a change. You see the preview and confirm it: in the chat if
            your assistant can ask, otherwise on DeclutrMail.
          </li>
          <li>Protected senders are skipped.</li>
          <li>
            Undo puts back an Archive, Later or Delete. A sent unsubscribe request cannot be taken
            back.
          </li>
          <li>
            Disconnect an assistant at any time in Settings &rarr; Connected apps. The free
            plan&rsquo;s monthly cleanup limit applies, as it does in the app.
          </li>
        </ul>
      </DocSection>

      <DocSection id="what-it-sees" title="What your assistant sees">
        <p>
          <strong>
            Through DeclutrMail, your assistant sees sender names and subject lines — never full
            emails.
          </strong>{' '}
          It also sees counts, dates and how to unsubscribe. Other connectors you add to your
          assistant follow their own rules.
        </p>
        <p>
          <strong>{PRIVACY_BADGE_HEADLINE}</strong>
        </p>
        <details>
          <summary>{PRIVACY_STORAGE_LABEL}</summary>
          <ul>
            {PRIVACY_STORAGE_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
        <p>
          More on <Link href="/security">security</Link> and in the{' '}
          <Link href="/privacy">privacy policy</Link>.
        </p>
      </DocSection>

      <DocSection id="server-url" title="Server URL">
        <p>
          Every assistant below uses the same address. When it opens DeclutrMail, sign in and choose
          what it may do.
        </p>
        <CopyField value={MCP_SERVER_URL} label="server URL" />
      </DocSection>

      <DocSection id="claude" title="Claude (web and desktop)">
        <ol>
          <li>
            Open <strong>Customize &rarr; Connectors</strong>, choose <strong>+ Add</strong>, then{' '}
            <strong>Add custom connector</strong>.
          </li>
          <li>Name it DeclutrMail, paste the server URL, and choose Add.</li>
          <li>
            Sign in to DeclutrMail when asked. In a chat, turn it on from + &rarr; Connectors.
          </li>
        </ol>
        <p>
          Free accounts can add one custom connector. On Team and Enterprise, an owner adds it under
          Organization settings &rarr; Connectors first; each member then chooses Connect.
        </p>
        <Source
          vendor="Anthropic"
          href="https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp"
        />
      </DocSection>

      <DocSection id="claude-code" title="Claude Code">
        <CopyField
          value={`claude mcp add --transport http declutrmail ${MCP_SERVER_URL}`}
          label="Claude Code command"
        />
        <p>
          Then run <code>/mcp</code> in Claude Code and sign in to DeclutrMail in the browser.
        </p>
        <Source vendor="Anthropic" href="https://code.claude.com/docs/en/mcp" />
      </DocSection>

      <DocSection id="chatgpt" title="ChatGPT">
        <ol>
          <li>
            In ChatGPT on the web, open <strong>Plugins</strong>, choose <strong>+</strong>, then{' '}
            <strong>Add custom MCP server</strong>.
          </li>
          <li>Name it DeclutrMail, paste the server URL, and choose OAuth sign-in.</li>
          <li>Create it, sign in to DeclutrMail, then type @ in a chat to use it.</li>
        </ol>
        <p>
          OpenAI lists custom MCP servers for Business, Enterprise and Edu workspaces, where an
          admin may need to allow them. On ChatGPT Pro, only the read tools work, so it can show
          your senders but not apply a cleanup.
        </p>
        <Source
          vendor="OpenAI"
          href="https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta"
        />
      </DocSection>

      <DocSection id="codex" title="Codex">
        <CopyField
          value={`codex mcp add declutrmail --url ${MCP_SERVER_URL}`}
          label="Codex command"
        />
        <CopyField value="codex mcp login declutrmail" label="Codex sign-in command" />
        <p>
          The second command opens DeclutrMail to sign in. In the IDE extension, add it from the
          gear menu &rarr; MCP servers &rarr; Add server, as Streamable HTTP.
        </p>
        <Source vendor="OpenAI" href="https://learn.chatgpt.com/docs/extend/mcp?surface=cli" />
      </DocSection>

      <DocSection id="cursor" title="Cursor">
        <p>
          Add this to <code>~/.cursor/mcp.json</code>, or <code>.cursor/mcp.json</code> in a
          project, then sign in to DeclutrMail when Cursor asks.
        </p>
        <CopyField value={CURSOR_CONFIG} label="Cursor configuration" />
        <Source vendor="Cursor" href="https://cursor.com/docs/context/mcp" />
      </DocSection>
    </DocPage>
  );
}
