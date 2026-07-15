import { CHANGELOG_ENTRIES } from '@/features/marketing/learn/changelog-content';
import { siteUrl } from '@/features/marketing/landing/urls';

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function GET() {
  const origin = siteUrl();
  const items = CHANGELOG_ENTRIES.map((entry) => {
    const description = [
      entry.summary,
      ...entry.added.map((item) => `Added: ${item}`),
      ...entry.improved.map((item) => `Improved: ${item}`),
      ...entry.fixed.map((item) => `Fixed: ${item}`),
    ].join(' ');

    return `
      <item>
        <title>${escapeXml(entry.title)}</title>
        <link>${origin}/changelog#${entry.id}</link>
        <guid isPermaLink="true">${origin}/changelog#${entry.id}</guid>
        <pubDate>${new Date(`${entry.date}T00:00:00.000Z`).toUTCString()}</pubDate>
        <description>${escapeXml(description)}</description>
      </item>`;
  }).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
      <channel>
        <title>DeclutrMail build log</title>
        <link>${origin}/changelog</link>
        <description>Evidence-linked user-facing changes from DeclutrMail repository history.</description>
        <language>en-US</language>
        <atom:link href="${origin}/changelog/rss.xml" rel="self" type="application/rss+xml" />
        ${items}
      </channel>
    </rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  });
}
