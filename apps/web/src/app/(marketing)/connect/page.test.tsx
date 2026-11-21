import { readFileSync } from 'node:fs';
import path from 'node:path';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PRIVACY_BADGE_HEADLINE, PRIVACY_STORAGE_ITEMS } from '@declutrmail/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MCP_SERVER_URL, TOOL_ASKS } from '@/features/marketing/connect/connect-content';

import ConnectPage, { metadata } from './page';

/** `ask:` lines of the tool contract, read from source so the page cannot drift. */
function contractAsks(): string[] {
  const source = readFileSync(
    path.resolve(process.cwd(), '../api/src/mcp/mcp-tool-contract.ts'),
    'utf8',
  );
  const tools = source.slice(source.indexOf('export const MCP_TOOLS'));
  return [...tools.matchAll(/^\s+ask: '((?:[^'\\]|\\.)*)',$/gm)].map((match) =>
    (match[1] ?? '').replace(/\\'/g, "'"),
  );
}

describe('/connect', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists exactly what the connector tools can do, in contract order', () => {
    const asks = contractAsks();
    // Starve guard: a regex that stops matching must fail, not pass empty.
    expect(asks).toHaveLength(10);
    expect([...TOOL_ASKS]).toEqual(asks);

    render(<ConnectPage />);
    const list = screen.getByRole('heading', { name: 'What you can ask' }).nextElementSibling;
    expect([...(list?.querySelectorAll('li') ?? [])].map((li) => li.textContent)).toEqual(asks);
  });

  it('states the safety model and the scoped visibility claim', () => {
    const { container } = render(<ConnectPage />);
    const copy = container.textContent ?? '';

    expect(copy).toContain('confirm it on DeclutrMail');
    expect(copy).toContain('Protected senders are skipped');
    expect(copy).toContain('Undo puts back an Archive, Later or Delete');
    expect(copy).toContain('cannot be taken back');
    expect(copy).toContain('Settings → Connected apps');
    expect(copy).toContain(
      'Through DeclutrMail, your assistant sees sender names and subject lines — never full emails.',
    );
    // The claim covers our tools only; other connectors are theirs to describe.
    expect(copy).toContain('Other connectors you add to your assistant follow their own rules');
    expect(copy).toContain(PRIVACY_BADGE_HEADLINE);
    for (const item of PRIVACY_STORAGE_ITEMS) expect(copy).toContain(item);
  });

  it('gives each verified client the server URL and a vendor source', () => {
    const { container } = render(<ConnectPage />);
    const copy = container.textContent ?? '';

    for (const name of ['Claude (web and desktop)', 'Claude Code', 'ChatGPT', 'Codex', 'Cursor']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
    // Grok is off the page until xAI documents OAuth for custom connectors.
    expect(copy).not.toContain('Grok');
    expect(copy).toContain(`claude mcp add --transport http declutrmail ${MCP_SERVER_URL}`);
    expect(copy).toContain(`codex mcp add declutrmail --url ${MCP_SERVER_URL}`);
    expect(copy).toContain(`"url":"${MCP_SERVER_URL}"`);
    const sources = [...container.querySelectorAll('.dm-connect-source a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(sources).toHaveLength(5);
    for (const href of sources) expect(href).toMatch(/^https:\/\//);
  });

  it('copies the server URL, and stays usable when the clipboard refuses', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<ConnectPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy server URL' }));
    expect(writeText).toHaveBeenCalledWith(MCP_SERVER_URL);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'server URL copied' })).toHaveTextContent('Copied'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy Claude Code command' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Copy Claude Code command' })).toHaveTextContent(
      'Copy',
    );
  });

  it('declares canonical metadata', () => {
    expect(metadata.alternates?.canonical).toBe('/connect');
  });
});
