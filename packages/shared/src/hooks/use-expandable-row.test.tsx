// Tests for the D198 useExpandableRow headless hook.
//
// The shared package's vitest is wired to `environment: 'node'` with no
// jsdom toolchain, so we cannot rerender on state changes here. We test
// in two layers instead:
//
//  1. The pure `nextExpandedRowId` reducer covers every state
//     transition (initial expand, switching rows, toggle-collapse,
//     explicit collapse with null, generic over id type).
//  2. A `react-dom/server` smoke render confirms the hook initializes
//     with the seed value and that the consumer can read `isExpanded`
//     against it.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { nextExpandedRowId, useExpandableRow } from './use-expandable-row';

describe('nextExpandedRowId — accordion reducer (D198)', () => {
  it('expands a row from collapsed', () => {
    expect(nextExpandedRowId(null, 'row-1')).toBe('row-1');
  });

  it('switches to a different row, collapsing the previous', () => {
    expect(nextExpandedRowId('row-1', 'row-2')).toBe('row-2');
  });

  it('toggles the same row closed', () => {
    expect(nextExpandedRowId('row-1', 'row-1')).toBeNull();
  });

  it('collapses any open row when requested is null', () => {
    expect(nextExpandedRowId('row-1', null)).toBeNull();
  });

  it('is a no-op when both current and requested are null', () => {
    expect(nextExpandedRowId(null, null)).toBeNull();
  });

  it('is generic over numeric ids and treats equal numbers as toggles', () => {
    expect(nextExpandedRowId<number>(7, 7)).toBeNull();
    expect(nextExpandedRowId<number>(7, 8)).toBe(8);
  });

  it('is generic over branded id types', () => {
    type SenderKey = string & { readonly __brand: 'SenderKey' };
    const a = 'sender:a@example.com' as SenderKey;
    const b = 'sender:b@example.com' as SenderKey;
    expect(nextExpandedRowId<SenderKey>(a, b)).toBe(b);
    expect(nextExpandedRowId<SenderKey>(a, a)).toBeNull();
  });
});

describe('useExpandableRow — initial render (D198)', () => {
  function Probe({ initial, queryRowId }: { initial: string | null; queryRowId: string }) {
    const { expandedRowId, isExpanded } = useExpandableRow<string>(initial);
    return (
      <div>
        <span data-testid="expanded">{expandedRowId ?? 'none'}</span>
        <span data-testid="is-expanded">{String(isExpanded(queryRowId))}</span>
      </div>
    );
  }

  it('defaults to no expanded row when no seed is supplied', () => {
    function Default() {
      const { expandedRowId } = useExpandableRow<string>();
      return <span>{expandedRowId ?? 'none'}</span>;
    }
    const html = renderToStaticMarkup(<Default />);
    expect(html).toContain('none');
  });

  it('seeds the expanded row when an initial id is provided', () => {
    const html = renderToStaticMarkup(<Probe initial="row-1" queryRowId="row-1" />);
    expect(html).toContain('row-1');
    // isExpanded for the seeded row → true
    expect(html).toContain('>true<');
  });

  it('isExpanded returns false for non-seeded rows', () => {
    const html = renderToStaticMarkup(<Probe initial="row-1" queryRowId="row-2" />);
    expect(html).toContain('row-1');
    expect(html).toContain('>false<');
  });
});
