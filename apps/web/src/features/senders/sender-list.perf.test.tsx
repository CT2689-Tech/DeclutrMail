import { Profiler, useCallback, useState, type ProfilerOnRenderCallback } from 'react';
import { describe, it, expect } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { SenderList } from './sender-list';
import { makeSender } from './testing/make-sender';
import { rollupByDomain } from './domain-rollup';

// Opt-in development benchmark: synthetic senders only; no network or telemetry.
// React render cost in happy-dom, NOT browser paint/layout or production latency.
describe.skipIf(process.env.DM_RENDER_BENCH !== '1')('SenderList render benchmark', () => {
  it.each([50, 500, 2000])(
    '%i loaded rows',
    (count) => {
      const entries = rollupByDomain(
        Array.from({ length: count }, (_, i) =>
          makeSender({
            id: `synthetic-${i}`,
            displayName: `Synthetic ${i}`,
            email: `sender@synthetic-${i}.example`,
            domain: `synthetic-${i}.example`,
            brandMark: false,
          }),
        ),
      );
      const selectedIds = new Set<string>();
      const noop = () => {};
      const commits: number[] = [];
      const onRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
        commits.push(actualDuration);
      };
      function Harness() {
        const [activeId, setActiveId] = useState<string | null>(null);
        const open = useCallback((id: string) => setActiveId(id), []);
        return (
          <Profiler id="list" onRender={onRender}>
            <SenderList
              entries={entries}
              selectedIds={selectedIds}
              onToggleSelect={noop}
              onAction={noop}
              onOpen={open}
              activeId={activeId}
              compact={false}
              followKeys
            />
          </Profiler>
        );
      }
      const mountedAt = performance.now();
      const view = render(<Harness />);
      const mountMs = performance.now() - mountedAt;
      const keys: number[] = [];
      for (let i = 0; i < 10; i++) {
        const before = performance.now();
        fireEvent.keyDown(window, { key: 'j' });
        keys.push(performance.now() - before);
      }
      expect(view.container.querySelector('[data-active]')).toHaveAttribute(
        'data-sender-id',
        'synthetic-9',
      );
      const mean = (values: number[]) =>
        Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
      process.stdout.write(
        JSON.stringify({
          syntheticRows: count,
          mountMs: Math.round(mountMs),
          mountRenderMs: commits[0],
          selectionRenderMeanMs: mean(commits.slice(1)),
          keyEventMeanMs: mean(keys),
          domElements: view.container.querySelectorAll('*').length,
        }) + '\n',
      );
    },
    30000,
  );
});
