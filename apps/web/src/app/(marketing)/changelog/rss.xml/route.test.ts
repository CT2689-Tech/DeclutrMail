import { describe, expect, it } from 'vitest';
import { CHANGELOG_ENTRIES } from '@/features/marketing/learn/changelog-content';
import { GET } from './route';

describe('/changelog/rss.xml', () => {
  it('serves one RSS item per update', async () => {
    const response = GET();
    expect(response.headers.get('content-type')).toBe('application/rss+xml; charset=utf-8');
    const xml = await response.text();
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('<atom:link');
    expect(xml.match(/<item>/g)).toHaveLength(CHANGELOG_ENTRIES.length);
    for (const entry of CHANGELOG_ENTRIES) {
      expect(xml).toContain(`<title>${entry.title}</title>`);
      expect(xml).toContain(`/changelog#${entry.id}`);
    }
  });

  // The feed builds its description by concatenating the same entry fields
  // the page renders, so a leak here is as public as a leak there — and it
  // would be easier to miss, since nobody eyeballs an XML route. Positive
  // controls first: an absence assertion over an empty string proves nothing.
  it('leaks no pull-request number, commit hash, or repository link', async () => {
    const xml = await GET().text();
    const receipts = CHANGELOG_ENTRIES.flatMap((entry) => entry.evidence);

    expect(receipts.length).toBeGreaterThan(0);
    expect(xml.match(/<item>/g)).toHaveLength(CHANGELOG_ENTRIES.length);

    // Only unambiguous IDENTIFIERS are asserted. An earlier draft also
    // checked `receipt.summary`, which fails on a false positive: evidence
    // summaries are short human phrases that legitimately collide with
    // public copy — "One name for a Gmail connection" is both an evidence
    // summary and the opening of a real Improved bullet. A leak test that
    // fires on correct content gets deleted, so it must key on things that
    // can only be internal.
    for (const receipt of receipts) {
      expect(xml).not.toContain(receipt.commit);
      expect(xml).not.toContain(`#${receipt.pullRequest}`);
    }
    expect(xml).not.toContain('github.com');
  });
});
