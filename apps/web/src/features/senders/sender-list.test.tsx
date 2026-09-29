import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { rollupByDomain } from './domain-rollup';
import { SenderList, type SenderListProps } from './sender-list';
import { makeSender } from './testing/make-sender';

const solo = ['a', 'b', 'c'].map((id) =>
  makeSender({ id, displayName: `Solo ${id}`, email: `${id}@${id}.com`, domain: `${id}.com` }),
);
const brand = ['g1', 'g2', 'g3'].map((id) =>
  makeSender({ id, displayName: `Brand ${id}`, email: `${id}@brand.com`, domain: 'brand.com' }),
);

function renderList(props: Partial<SenderListProps> = {}, senders = solo) {
  const onOpen = vi.fn();
  const utils = render(
    <SenderList
      entries={rollupByDomain(senders)}
      selectedIds={new Set()}
      onToggleSelect={() => {}}
      onAction={() => {}}
      onOpen={onOpen}
      activeId={null}
      compact={false}
      followKeys
      {...props}
    />,
  );
  return { onOpen, ...utils };
}

describe('<SenderList /> — domain groups (D51)', () => {
  it('collapses ≥3 senders of one domain into a header, members hidden until expanded', () => {
    renderList({}, [...brand, ...solo]);
    expect(screen.queryByText('Brand g1')).not.toBeInTheDocument();
    expect(screen.getByText('Solo a')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('domain-group-brand.com'));
    expect(screen.getByText('Brand g1')).toBeInTheDocument();
    expect(screen.getByTestId('domain-group-brand.com')).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByTestId('domain-group-brand.com'));
    expect(screen.queryByText('Brand g1')).not.toBeInTheDocument();
  });

  it('flags the list when anything is selected, so every checkbox shows', () => {
    const { rerender } = renderList();
    expect(screen.getByTestId('sender-list')).not.toHaveAttribute('data-any-selected');
    rerender(
      <SenderList
        entries={rollupByDomain(solo)}
        selectedIds={new Set(['a'])}
        onToggleSelect={() => {}}
        onAction={() => {}}
        onOpen={() => {}}
        activeId={null}
        compact={false}
        followKeys
      />,
    );
    expect(screen.getByTestId('sender-list')).toHaveAttribute('data-any-selected', 'true');
  });
});

describe('<SenderList /> — j/k/↑/↓ follow the rows', () => {
  it('j opens the first row when nothing is open, then the next', () => {
    const { onOpen } = renderList();
    fireEvent.keyDown(window, { key: 'j' });
    expect(onOpen).toHaveBeenLastCalledWith('a');
  });

  it('scrolls the matching row inside this list, including selector punctuation', () => {
    const id = 'sender:with-punctuation';
    const unrelated = document.createElement('div');
    unrelated.dataset.senderId = id;
    unrelated.scrollIntoView = vi.fn();
    document.body.prepend(unrelated);
    try {
      const { container, onOpen } = renderList({}, [makeSender({ id })]);
      const row = container.querySelector<HTMLElement>('[data-sender-id]')!;
      row.scrollIntoView = vi.fn();
      fireEvent.keyDown(window, { key: 'j' });
      expect(onOpen).toHaveBeenCalledWith(id);
      expect(row.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
      expect(unrelated.scrollIntoView).not.toHaveBeenCalled();
    } finally {
      unrelated.remove();
    }
  });

  it('moves from the open row and stops at the ends', () => {
    const { onOpen } = renderList({ activeId: 'b' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(onOpen).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(window, { key: 'k' });
    expect(onOpen).toHaveBeenLastCalledWith('a');
  });

  it('does not re-open the row it is already on', () => {
    const { onOpen } = renderList({ activeId: 'c' });
    fireEvent.keyDown(window, { key: 'j' });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('skips members of a collapsed group', () => {
    const { onOpen } = renderList({ activeId: 'a' }, [solo[0]!, ...brand, solo[1]!]);
    fireEvent.keyDown(window, { key: 'j' });
    expect(onOpen).toHaveBeenLastCalledWith('b');
  });

  it('j/k stand down while a selection exists (K is the Keep verb there); arrows still move', () => {
    const { onOpen } = renderList({ selectedIds: new Set(['a']), activeId: 'a' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'j' });
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(onOpen).toHaveBeenLastCalledWith('b');
  });

  it('is inert while typing, and where opening would leave the page', () => {
    const typing = renderList();
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'j' });
    expect(typing.onOpen).not.toHaveBeenCalled();
    input.remove();
    typing.unmount();

    const narrow = renderList({ followKeys: false });
    fireEvent.keyDown(window, { key: 'j' });
    expect(narrow.onOpen).not.toHaveBeenCalled();
  });
});
