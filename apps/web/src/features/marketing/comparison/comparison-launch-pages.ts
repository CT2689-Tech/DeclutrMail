import { WS3_COPY } from '@declutrmail/shared/copy/launch';

import type {
  ComparisonCell,
  ComparisonDefinition,
  ComparisonSlug,
  EvidenceState,
} from './comparison-data';

type DeclutrCells = {
  focus: ComparisonCell;
  providers: ComparisonCell;
  existingMail: ComparisonCell;
  futureMail: ComparisonCell;
  unsubscribe: ComparisonCell;
  recovery: ComparisonCell;
  data: ComparisonCell;
  price: ComparisonCell;
};

const UNKNOWN: ComparisonCell = {
  summary: 'Not publicly stated',
  detail: 'Not publicly stated in the reviewed pages.',
  state: 'unknown',
};

function parsedCells(lines: readonly string[]): Map<string, ComparisonCell> {
  const cells = new Map<string, ComparisonCell>();
  for (const line of lines) {
    const parts = line.split(' | ');
    const head = parts[0];
    if (!head) continue;
    const detail = parts[1] ?? '';
    const splitAt = head.indexOf(': ');
    if (splitAt < 0) continue;
    const key = head.slice(0, splitAt);
    const summary = head.slice(splitAt + 2);
    const state: EvidenceState = /its claim/i.test(`${summary} ${detail}`)
      ? 'limited'
      : 'supported';
    cells.set(key, { summary, detail, state });
  }
  return cells;
}

function competitor(cells: Map<string, ComparisonCell>, key: string): ComparisonCell {
  return cells.get(key) ?? UNKNOWN;
}

function page(
  slug: ComparisonSlug,
  cells: DeclutrCells,
  lines: readonly string[],
  meta: readonly string[],
  facts: readonly string[],
  chooseCompetitor: readonly string[],
  chooseDeclutr: readonly string[],
  sources: readonly string[],
  verdict: string,
): ComparisonDefinition {
  const parsed = parsedCells(lines);
  const description = meta[3] ?? '';
  const firstSentence = description.split('. ')[0];
  return {
    slug,
    name: meta[0] ?? slug,
    category: meta[1] ?? '',
    verifiedIso: '2026-10-11',
    title: meta[2] ?? `${meta[0]} vs DeclutrMail`,
    description,
    metaTitle: `${meta[2]} — compared, October 2026`,
    ...(description.length > 160 && firstSentence ? { metaDescription: `${firstSentence}.` } : {}),
    verdict,
    indexSummary: facts[3]?.replace(/^indexSummary: /, '') ?? '',
    primaryUnit: facts[0]?.replace(/^primaryUnit: /, '') ?? '',
    providerScope: facts[1]?.replace(/^providerScope: /, '') ?? '',
    publicEntryPoint: facts[2]?.replace(/^publicEntryPoint: /, '') ?? '',
    chooseCompetitor: {
      headline: chooseCompetitor[0] ?? '',
      points: chooseCompetitor.slice(1),
    },
    chooseDeclutrMail: {
      headline: chooseDeclutr[0] ?? '',
      points: chooseDeclutr.slice(1),
    },
    rows: [
      { label: 'Core approach', declutrMail: cells.focus, competitor: UNKNOWN },
      {
        label: 'Mailbox support',
        declutrMail: cells.providers,
        competitor: competitor(parsed, 'providers'),
      },
      {
        label: 'Existing-mail cleanup',
        declutrMail: cells.existingMail,
        competitor: competitor(parsed, 'existingMail'),
      },
      {
        label: 'Future-mail automation',
        declutrMail: cells.futureMail,
        competitor: competitor(parsed, 'futureMail'),
      },
      {
        label: 'Unsubscribe',
        declutrMail: cells.unsubscribe,
        competitor: competitor(parsed, 'unsubscribe'),
      },
      { label: 'Preview and recovery', declutrMail: cells.recovery, competitor: UNKNOWN },
      {
        label: 'Email-data posture',
        declutrMail: cells.data,
        competitor: competitor(parsed, 'data'),
      },
      {
        label: 'Public starting point',
        declutrMail: cells.price,
        competitor: competitor(parsed, 'price'),
      },
    ],
    sources: sources.map((source) => {
      const [label, url, note] = source.split(' | ');
      return { label: label ?? '', url: url ?? '', note: note ?? '' };
    }),
  };
}

export function buildLaunchComparisons(cells: DeclutrCells): readonly ComparisonDefinition[] {
  return [
    page(
      'mailstrom',
      cells,
      WS3_COPY['ws3.vsNew.mailstrom.cells'],
      WS3_COPY['ws3.vsNew.mailstrom.meta'],
      WS3_COPY['ws3.vsNew.mailstrom.facts'],
      WS3_COPY['ws3.vsNew.mailstrom.chooseCompetitor'],
      WS3_COPY['ws3.vsNew.mailstrom.chooseDeclutr'],
      WS3_COPY['ws3.vsNew.mailstrom.sources'],
      WS3_COPY['ws3.vs.mailstrom.verdict'],
    ),
    page(
      'inboxpurge',
      cells,
      WS3_COPY['ws3.vsNew.inboxpurge.cells'],
      WS3_COPY['ws3.vsNew.inboxpurge.meta'],
      WS3_COPY['ws3.vsNew.inboxpurge.facts'],
      WS3_COPY['ws3.vsNew.inboxpurge.chooseCompetitor'],
      WS3_COPY['ws3.vsNew.inboxpurge.chooseDeclutr'],
      WS3_COPY['ws3.vsNew.inboxpurge.sources'],
      WS3_COPY['ws3.vs.inboxpurge.verdict'],
    ),
    page(
      'mailmop',
      cells,
      WS3_COPY['ws3.vsNew.mailmop.cells'],
      WS3_COPY['ws3.vsNew.mailmop.meta'],
      WS3_COPY['ws3.vsNew.mailmop.facts'],
      WS3_COPY['ws3.vsNew.mailmop.chooseCompetitor'],
      WS3_COPY['ws3.vsNew.mailmop.chooseDeclutr'],
      WS3_COPY['ws3.vsNew.mailmop.sources'],
      WS3_COPY['ws3.vs.mailmop.verdict'],
    ),
  ];
}
