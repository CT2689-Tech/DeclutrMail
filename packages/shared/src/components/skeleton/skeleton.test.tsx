// Tests for the D166 Skeleton primitive + composite skeletons.
//
// The shared package's vitest runs in `environment: 'node'` (see
// `vitest.config.ts`) — no jsdom toolchain. We assert behaviour by
// rendering to static markup via `react-dom/server` and inspecting
// the output for the structural and accessibility contracts.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { Skeleton, SkeletonLines } from './skeleton';
import { TriageQueueSkeleton, TriageRowCardSkeleton } from './triage-queue-skeleton';
import { SenderRowSkeleton, SendersListSkeleton } from './sender-row-skeleton';
import {
  SenderDetailChartsSkeleton,
  SenderDetailHeaderSkeleton,
  SenderDetailMessagesSkeleton,
  SenderDetailSkeleton,
  SenderDetailStatsSkeleton,
} from './sender-detail-skeleton';

describe('Skeleton — primitive variants (D166)', () => {
  it('renders the text variant by default with the `dm-skeleton` animation', () => {
    const html = renderToStaticMarkup(<Skeleton />);
    expect(html).toContain('data-dm-skeleton="text"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('dm-skeleton');
  });

  it('renders the circle variant with a 50% border-radius default', () => {
    const html = renderToStaticMarkup(<Skeleton variant="circle" />);
    expect(html).toContain('data-dm-skeleton="circle"');
    expect(html).toContain('border-radius:50%');
  });

  it('renders the rect variant with a non-zero default height', () => {
    const html = renderToStaticMarkup(<Skeleton variant="rect" />);
    expect(html).toContain('data-dm-skeleton="rect"');
    expect(html).toContain('height:80px');
  });

  it('respects numeric width + height props as pixel values', () => {
    const html = renderToStaticMarkup(<Skeleton variant="rect" width={200} height={48} />);
    expect(html).toContain('width:200px');
    expect(html).toContain('height:48px');
  });

  it('passes string width + height props through unchanged', () => {
    const html = renderToStaticMarkup(<Skeleton variant="text" width="42%" height="1em" />);
    expect(html).toContain('width:42%');
    expect(html).toContain('height:1em');
  });

  it('respects a borderRadius override', () => {
    const html = renderToStaticMarkup(<Skeleton variant="rect" borderRadius={2} />);
    expect(html).toContain('border-radius:2px');
  });

  it('is always aria-hidden — semantics belong to the parent region', () => {
    const html = renderToStaticMarkup(<Skeleton variant="circle" />);
    expect(html).toContain('aria-hidden="true"');
    // Must NOT carry its own role / aria-live announcements.
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('aria-live');
  });
});

describe('SkeletonLines — paragraph helper (D166)', () => {
  it('renders the default 3 lines', () => {
    const html = renderToStaticMarkup(<SkeletonLines />);
    const count = (html.match(/data-dm-skeleton="text"/g) ?? []).length;
    expect(count).toBe(3);
  });

  it('renders the requested number of lines', () => {
    const html = renderToStaticMarkup(<SkeletonLines lines={5} />);
    const count = (html.match(/data-dm-skeleton="text"/g) ?? []).length;
    expect(count).toBe(5);
  });

  it('makes the last line narrower than the others when lines > 1', () => {
    const html = renderToStaticMarkup(<SkeletonLines lines={3} lastLineWidth="40%" />);
    expect(html).toContain('width:40%');
  });

  it('clamps zero / negative line counts to 1 row', () => {
    const zero = renderToStaticMarkup(<SkeletonLines lines={0} />);
    const negative = renderToStaticMarkup(<SkeletonLines lines={-3} />);
    expect((zero.match(/data-dm-skeleton="text"/g) ?? []).length).toBe(1);
    expect((negative.match(/data-dm-skeleton="text"/g) ?? []).length).toBe(1);
  });

  it('forwards a custom gap to the wrapper', () => {
    const html = renderToStaticMarkup(<SkeletonLines gap={24} />);
    expect(html).toContain('gap:24px');
  });
});

describe('TriageQueueSkeleton — composite (D166)', () => {
  it('announces itself as a loading region for assistive tech', () => {
    const html = renderToStaticMarkup(<TriageQueueSkeleton />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="Loading triage queue"');
  });

  it('renders the requested number of row cards', () => {
    const html = renderToStaticMarkup(<TriageQueueSkeleton rows={3} />);
    const count = (html.match(/data-dm-skeleton-composite="triage-queue"/g) ?? []).length;
    expect(count).toBe(1);
    // Each row card has its own avatar circle — count circles as a proxy.
    const circles = (html.match(/data-dm-skeleton="circle"/g) ?? []).length;
    expect(circles).toBe(3);
  });

  it('defaults to 5 rows when `rows` is omitted', () => {
    const html = renderToStaticMarkup(<TriageQueueSkeleton />);
    const circles = (html.match(/data-dm-skeleton="circle"/g) ?? []).length;
    expect(circles).toBe(5);
  });

  it('renders a single row card without surrounding region semantics', () => {
    const html = renderToStaticMarkup(<TriageRowCardSkeleton />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="status"');
  });
});

describe('SendersListSkeleton — composite (D166)', () => {
  it('announces itself as a loading region with a senders-specific label', () => {
    const html = renderToStaticMarkup(<SendersListSkeleton />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Loading senders"');
  });

  it('renders the requested number of sender rows', () => {
    const html = renderToStaticMarkup(<SendersListSkeleton rows={4} />);
    const rows = (html.match(/data-dm-skeleton-composite="sender-row"/g) ?? []).length;
    expect(rows).toBe(4);
  });

  it('renders a single sender row in isolation without an announcing region', () => {
    const html = renderToStaticMarkup(<SenderRowSkeleton />);
    expect(html).toContain('data-dm-skeleton-composite="sender-row"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="status"');
  });
});

describe('SenderDetailSkeleton — composite (D166)', () => {
  it('announces itself as a loading region for the detail page', () => {
    const html = renderToStaticMarkup(<SenderDetailSkeleton />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading sender details"');
  });

  it('renders all four sub-regions (header, stats, charts, messages)', () => {
    const html = renderToStaticMarkup(<SenderDetailSkeleton />);
    // Header avatar (56x56 circle).
    expect(html).toContain('width:56px');
    // Stats strip = 3 metric cards in a grid.
    expect(html).toContain('grid-template-columns:repeat(3, minmax(0, 1fr))');
    // Charts area = a 140px-tall rect.
    expect(html).toContain('height:140px');
  });

  it('exposes each sub-region as an independently mountable piece', () => {
    expect(renderToStaticMarkup(<SenderDetailHeaderSkeleton />)).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<SenderDetailStatsSkeleton />)).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<SenderDetailChartsSkeleton />)).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<SenderDetailMessagesSkeleton rows={2} />)).toContain(
      'aria-hidden="true"',
    );
  });
});
