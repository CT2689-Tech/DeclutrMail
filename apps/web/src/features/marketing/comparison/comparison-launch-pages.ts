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
  funding: ComparisonCell;
  price: ComparisonCell;
};

const EVIDENCE_STATES: readonly EvidenceState[] = [
  'supported',
  'limited',
  'not-supported',
  'unknown',
  'native',
];

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
    // An optional third segment names the state outright, for a cell that
    // is sourced but partial (`| limited`) or a sourced absence (`| unknown`).
    const explicit = EVIDENCE_STATES.find((candidate) => candidate === parts[2]);
    const state: EvidenceState =
      explicit ?? (/its claim/i.test(`${summary} ${detail}`) ? 'limited' : 'supported');
    cells.set(key, { summary, detail, state });
  }
  return cells;
}

function competitor(cells: Map<string, ComparisonCell>, key: string): ComparisonCell {
  return cells.get(key) ?? UNKNOWN;
}

/** Deck cells stored as `summary | detail`, the same split as a competitor cell. */
function valueDetail(line: string): ComparisonCell {
  const splitAt = line.indexOf(' | ');
  return {
    summary: splitAt < 0 ? line : line.slice(0, splitAt),
    detail: splitAt < 0 ? '' : line.slice(splitAt + 3),
    state: 'supported',
  };
}

const DECLUTR_PLATFORM: ComparisonCell = {
  summary: 'DeclutrMail runs on the web, including on your phone',
  state: 'supported',
};

function launchRows(
  cells: DeclutrCells,
  parsed: Map<string, ComparisonCell>,
): ComparisonDefinition['rows'] {
  const rows: ComparisonDefinition['rows'][number][] = [
    { label: 'Core approach', declutrMail: cells.focus, competitor: competitor(parsed, 'focus') },
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
    {
      label: 'Preview and recovery',
      declutrMail: cells.recovery,
      competitor: competitor(parsed, 'recovery'),
    },
    {
      label: 'Email-data posture',
      declutrMail: cells.data,
      competitor: competitor(parsed, 'data'),
    },
  ];
  const funding = parsed.get('funding');
  if (funding) {
    rows.push({
      label: 'How the product is funded',
      declutrMail: cells.funding,
      competitor: funding,
    });
  }
  const platform = parsed.get('platform');
  if (platform) {
    rows.push({ label: 'Platform', declutrMail: DECLUTR_PLATFORM, competitor: platform });
  }
  const license = parsed.get('openSource');
  if (license) {
    rows.push({
      label: 'License',
      declutrMail: valueDetail(WS3_COPY['ws3.vs.mailmop.declutrLicense']),
      competitor: license,
    });
  }
  rows.push({
    label: 'Public starting point',
    declutrMail: cells.price,
    competitor: competitor(parsed, 'price'),
  });
  return rows;
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
  // Per page, because verification is per page (see `comparisonVerifiedLabel`).
  verifiedIso = '2026-10-11',
): ComparisonDefinition {
  const parsed = parsedCells(lines);
  const description = meta[3] ?? '';
  const firstSentence = description.split('. ')[0];
  const verifiedMonth = new Date(verifiedIso).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return {
    slug,
    name: meta[0] ?? slug,
    category: meta[1] ?? '',
    verifiedIso,
    title: meta[2] ?? `${meta[0]} vs DeclutrMail`,
    description,
    metaTitle: `${meta[2]} — compared, ${verifiedMonth}`,
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
    rows: launchRows(cells, parsed),
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
    page(
      'cleanfox',
      cells,
      WS3_COPY['ws3.vsNew.cleanfox.cells'],
      WS3_COPY['ws3.vsNew.cleanfox.meta'],
      WS3_COPY['ws3.vsNew.cleanfox.facts'],
      WS3_COPY['ws3.vsNew.cleanfox.chooseCompetitor'],
      WS3_COPY['ws3.vsNew.cleanfox.chooseDeclutr'],
      WS3_COPY['ws3.vsNew.cleanfox.sources'],
      WS3_COPY['ws3.vs.cleanfox.verdict'],
      '2026-11-16',
    ),
    page(
      'inbox-zapper',
      cells,
      WS3_COPY['ws3.vsNew.inbox-zapper.cells'],
      WS3_COPY['ws3.vsNew.inbox-zapper.meta'],
      WS3_COPY['ws3.vsNew.inbox-zapper.facts'],
      WS3_COPY['ws3.vsNew.inbox-zapper.chooseCompetitor'],
      WS3_COPY['ws3.vsNew.inbox-zapper.chooseDeclutr'],
      WS3_COPY['ws3.vsNew.inbox-zapper.sources'],
      WS3_COPY['ws3.vs.inbox-zapper.verdict'],
      '2026-11-16',
    ),
    page(
      'chuck',
      cells,
      WS3_COPY['ws3.vsNew.chuck.cells'],
      WS3_COPY['ws3.vsNew.chuck.meta'],
      WS3_COPY['ws3.vsNew.chuck.facts'],
      WS3_COPY['ws3.vsNew.chuck.chooseCompetitor'],
      WS3_COPY['ws3.vsNew.chuck.chooseDeclutr'],
      WS3_COPY['ws3.vsNew.chuck.sources'],
      WS3_COPY['ws3.vs.chuck.verdict'],
      '2026-11-16',
    ),
  ];
}
