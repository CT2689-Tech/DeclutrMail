import { Profiler } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { SenderList } from './sender-list';
import { makeSender } from './testing/make-sender';
import { rollupByDomain } from './domain-rollup';

const renders = vi.hoisted(() => vi.fn());
vi.mock('./sender-row', () => ({
  SenderRow: (props: { s: { id: string }; onOpen: () => void }) => {
    renders(props.s.id);
    return (
      <button data-sender-id={props.s.id} onClick={props.onOpen}>
        {props.s.id}
      </button>
    );
  },
  DomainGroupRow: () => null,
}));

it.each([250, 1000])(
  'renders only changed selection/active rows in a %i-row loaded collection',
  (count) => {
    renders.mockClear();
    const entries = rollupByDomain(
      Array.from({ length: count }, (_, i) =>
        makeSender({ id: `${i}`, domain: `sender${i}.test` }),
      ),
    );
    const base = {
      entries,
      onToggleSelect: vi.fn(),
      onAction: vi.fn(),
      onOpen: vi.fn(),
      compact: false,
      followKeys: true,
    };
    const commits = vi.fn();
    const view = render(<SenderList {...base} selectedIds={new Set()} activeId={null} />, {
      wrapper: ({ children }) => (
        <Profiler id="sender-list" onRender={commits}>
          {children}
        </Profiler>
      ),
    });
    expect(renders).toHaveBeenCalledTimes(count);
    renders.mockClear();
    view.rerender(<SenderList {...base} selectedIds={new Set(['2'])} activeId={null} />);
    expect(renders.mock.calls).toEqual([['2']]);
    renders.mockClear();
    view.rerender(<SenderList {...base} selectedIds={new Set(['2'])} activeId="7" />);
    expect(renders.mock.calls).toEqual([['7']]);
    expect(commits).toHaveBeenCalledTimes(3); // mount, selection, inspector selection
  },
);

describe('inspector intent', () => {
  it('waits for deliberate hover/focus and cancels abandoned/unmounted intent', () => {
    vi.useFakeTimers();
    try {
      const onIntent = vi.fn();
      const view = render(
        <SenderList
          entries={rollupByDomain([makeSender({ id: 'intent' })])}
          selectedIds={new Set()}
          activeId={null}
          compact={false}
          followKeys
          onOpen={vi.fn()}
          onAction={vi.fn()}
          onToggleSelect={vi.fn()}
          onIntent={onIntent}
        />,
      );
      const button = view.getByRole('button');
      fireEvent.mouseOver(button);
      act(() => vi.advanceTimersByTime(99));
      expect(onIntent).not.toHaveBeenCalled();
      fireEvent.mouseLeave(view.getByRole('list'));
      act(() => vi.advanceTimersByTime(100));
      expect(onIntent).not.toHaveBeenCalled();
      fireEvent.focus(button);
      act(() => vi.advanceTimersByTime(100));
      expect(onIntent).toHaveBeenCalledExactlyOnceWith('intent');
      fireEvent.mouseOver(button);
      view.unmount();
      act(() => vi.advanceTimersByTime(100));
      expect(onIntent).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
