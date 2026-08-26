import { describe, expect, it } from 'vitest';
import {
  citedEvidencePath,
  closedDecisions,
  composeRow,
  decisionsOwnedBy,
  deriveShippedBy,
  isImplementing,
} from './derive';
import type { Decision, Fragment, PrRef } from './types';

const D: Decision = { num: 46, title: 'Decision history' };
const noEvidenceFiles = () => 'no-path' as const;
const evidenceExists = () => 'exists' as const;
const evidenceMissing = () => 'missing' as const;

function pr(number: number, body: string, files = ['src/a.ts']): PrRef {
  return { number, body, files: files.map((path) => ({ path })) };
}

describe('deriveShippedBy — one citation, the one that shipped it', () => {
  /**
   * The growing citation list was the churn this replaced: D49 collected
   * fourteen PR references, and every merge that appended one rewrote
   * that row and conflicted with whatever else was in flight.
   */
  it('keeps the first implementing PR and ignores later ones', () => {
    const shipped = deriveShippedBy([
      pr(300, 'Closes D46'),
      pr(115, 'Closes D46'),
      pr(569, 'Closes D46'),
    ]);
    expect(shipped.get(46)).toBe(115);
  });

  it('ignores a docs-only PR — recording a decision is not shipping it', () => {
    const shipped = deriveShippedBy([pr(248, 'Closes D248', ['docs/execution/plan.md'])]);
    expect(shipped.size).toBe(0);
  });

  it('counts a PR that touches code alongside docs', () => {
    expect(isImplementing(pr(1, '', ['README.md', 'src/a.ts']))).toBe(true);
    expect(isImplementing(pr(1, '', ['README.md', 'docs/b.md']))).toBe(false);
  });
});

describe('closedDecisions — trailers, not prose', () => {
  it('reads line-anchored trailers, list-marked or bare', () => {
    expect(closedDecisions('Closes D46\n- Closes D59')).toEqual([46, 59]);
  });

  it('ignores a quoted mention mid-line', () => {
    // The generator's first post-merge run flagged its own PR: the body
    // quoted `Closes D248` while explaining the rule.
    expect(closedDecisions('the PR that says `Closes D248` must not flip it')).toEqual([]);
  });

  it('does not double-count a decision closed twice', () => {
    expect(closedDecisions('Closes D46\nCloses D46')).toEqual([46]);
  });
});

describe('composeRow', () => {
  it('is Not started with nothing derived and nothing recorded', () => {
    const row = composeRow(D, undefined, undefined, noEvidenceFiles, '2026-08-19', []);
    expect(row.status).toBe('⬜');
    expect(row.pr).toBe('');
  });

  it('is Shipped, citing the PR that shipped it', () => {
    const row = composeRow(D, undefined, 115, noEvidenceFiles, '2026-08-19', []);
    expect(row.status).toBe('🔵');
    expect(row.pr).toBe('#115');
  });

  it('lets a recorded terminal state win over the derivation', () => {
    for (const status of ['🚫', '⏸️', '🔴', '🟡'] as const) {
      const row = composeRow(D, { num: 46, status }, 115, noEvidenceFiles, '2026-08-19', []);
      expect(row.status).toBe(status);
    }
  });

  it('keeps Verified when the evidence cites a file that exists', () => {
    const fragment: Fragment = { num: 46, status: '🟢', verifiedBy: 'src/a.spec.ts — D46 limit' };
    const row = composeRow(D, fragment, 115, evidenceExists, '2026-08-19', []);
    expect(row.status).toBe('🟢');
  });

  it('demotes Verified when the evidence file is gone, and says so', () => {
    const demotions: string[] = [];
    const fragment: Fragment = { num: 46, status: '🟢', verifiedBy: 'src/gone.spec.ts' };
    const row = composeRow(D, fragment, 115, evidenceMissing, '2026-08-19', demotions);
    expect(row.status).toBe('🔵');
    expect(row.notes).toMatch(/no longer exists/);
    expect(demotions).toHaveLength(1);
  });

  it('demotes Verified recorded with no evidence at all', () => {
    const demotions: string[] = [];
    for (const verifiedBy of ['', 'manual', 'MANUAL']) {
      const row = composeRow(
        D,
        { num: 46, status: '🟢', verifiedBy },
        115,
        noEvidenceFiles,
        '2026-08-19',
        demotions,
      );
      expect(row.status).toBe('🔵');
    }
    expect(demotions).toHaveLength(3);
  });

  it('trusts a pre-trailer citation only when nothing was derived', () => {
    const legacy: Fragment = { num: 46, status: '🔵', pr: '#30' };
    const alone = composeRow(D, legacy, undefined, noEvidenceFiles, '2026-08-19', []);
    expect(alone.status).toBe('🔵');
    expect(alone.pr).toBe('#30');

    // Once the decision has a derived citation, the recorded one steps
    // aside — otherwise the column starts growing again.
    const derived = composeRow(D, legacy, 115, noEvidenceFiles, '2026-08-19', []);
    expect(derived.pr).toBe('#115');
  });
});

describe('decisionsOwnedBy — what a PR is answerable for', () => {
  it('owns the decisions it closes', () => {
    expect([...decisionsOwnedBy('Closes D46\nCloses D59', [])]).toEqual([46, 59]);
  });

  it('owns a decision whose recorded state it edits', () => {
    expect([...decisionsOwnedBy('', ['.impl-log/D46.md'])]).toEqual([46]);
  });

  it('owns nothing for an unrelated change', () => {
    expect([...decisionsOwnedBy('Fixes a typo', ['apps/web/src/page.tsx'])]).toEqual([]);
  });
});

describe('citedEvidencePath', () => {
  // Both branches below are regression tests for demotions that actually
  // happened. Neither had a test before, which is why the first ran for
  // a month over every recorded 🟢.
  it('keeps the x on a .tsx path — alternation is ordered longest-first', () => {
    expect(
      citedEvidencePath('apps/web/src/features/brief/noise-archive.test.tsx — Done marks'),
    ).toBe('apps/web/src/features/brief/noise-archive.test.tsx');
    expect(
      citedEvidencePath('apps/web/src/features/triage/triage-screen.stories.tsx — RowExpanded'),
    ).toBe('apps/web/src/features/triage/triage-screen.stories.tsx');
  });

  it('still resolves the other cited extensions', () => {
    expect(citedEvidencePath('packages/db/migrations/0074_purge.sql applied')).toBe(
      'packages/db/migrations/0074_purge.sql',
    );
    expect(citedEvidencePath('scripts/dev-up.sh runs clean')).toBe('scripts/dev-up.sh');
    expect(citedEvidencePath('docs/adr/0019-verb-registry-and-kauld.md')).toBe(
      'docs/adr/0019-verb-registry-and-kauld.md',
    );
    expect(citedEvidencePath('packages/workers/src/reasoning.test.ts — exhaustiveness')).toBe(
      'packages/workers/src/reasoning.test.ts',
    );
  });

  it('treats a verify-d cmd receipt as no citation at all', () => {
    // The path inside is relative to the FILTERED WORKSPACE, not the repo
    // root, so reading it as a citation demotes the row whose evidence is
    // strongest — a command that ran and exited 0 at a recorded commit.
    expect(
      citedEvidencePath(
        'cmd: `pnpm --filter @declutrmail/web exec vitest run src/features/triage/action-sheet.test.tsx` → exit 0 @ 2b7b57e 2026-08-26',
      ),
    ).toBeNull();
  });

  it('returns null when the evidence names no file', () => {
    expect(citedEvidencePath('docs/adr/ has template + 6 ADRs')).toBeNull();
    expect(citedEvidencePath('manual')).toBeNull();
    expect(citedEvidencePath('')).toBeNull();
  });
});
