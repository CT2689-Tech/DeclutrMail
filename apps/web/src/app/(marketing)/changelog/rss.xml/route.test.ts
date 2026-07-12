import { describe, expect, it } from 'vitest';
import { CHANGELOG_ENTRIES } from '@/features/marketing/learn/changelog-content';
import { GET } from './route';

describe('/changelog/rss.xml', () => {
  it('serves one RSS item per evidence-backed repository build', async () => {
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
});
