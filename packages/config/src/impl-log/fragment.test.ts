import { describe, expect, it } from 'vitest';
import { fragmentNumber, fragmentPath, parseFragment, renderFragment } from './fragment';

describe('fragment round-trip', () => {
  it('survives a full record unchanged', () => {
    const fragment = {
      num: 46,
      status: '🟢' as const,
      verifiedBy: 'apps/api/src/senders/senders.controller.spec.ts — D46 default limit',
      note: 'Evidence updated 2026-06-11',
      pr: '#30, #43',
    };
    expect(parseFragment(46, renderFragment(fragment))).toEqual(fragment);
  });

  it('omits fields that hold nothing, so a diff is always a real change', () => {
    const rendered = renderFragment({ num: 46, status: '🚫' });
    expect(rendered).toContain('status: 🚫');
    expect(rendered).not.toContain('verified-by:');
    expect(rendered).not.toContain('note:');
  });

  it('reads a hand-written fragment with stray blank lines and prose', () => {
    const parsed = parseFragment(
      12,
      [
        '# D12',
        '',
        'Some human wrote a paragraph here.',
        '',
        'status: ⏸️',
        'note: waiting on D30',
      ].join('\n'),
    );
    expect(parsed).toEqual({ num: 12, status: '⏸️', note: 'waiting on D30' });
  });

  it('ignores a status it does not recognise rather than guessing', () => {
    // ⬜ and any junk are derived-or-nothing; recording them would let a
    // typo assert a state.
    expect(parseFragment(12, 'status: ⬜').status).toBeUndefined();
    expect(parseFragment(12, 'status: probably-done').status).toBeUndefined();
  });

  it('ignores keys it does not know', () => {
    expect(parseFragment(12, 'owner: someone\nstatus: 🟡')).toEqual({ num: 12, status: '🟡' });
  });

  it('treats an empty value as absent', () => {
    expect(parseFragment(12, 'note:   \nstatus: 🟡')).toEqual({ num: 12, status: '🟡' });
  });
});

describe('fragment paths', () => {
  it('maps a decision to one predictable file', () => {
    expect(fragmentPath(46)).toBe('.impl-log/D46.md');
  });

  it('reads the decision back out of a filename', () => {
    expect(fragmentNumber('D46.md')).toBe(46);
    expect(fragmentNumber('README.md')).toBeNull();
    expect(fragmentNumber('D46.txt')).toBeNull();
  });
});
