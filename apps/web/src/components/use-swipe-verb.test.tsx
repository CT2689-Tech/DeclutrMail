// DOM-event behaviour of the shared swipe hook (ADR-0048).
//
// The pure mapping is pinned in packages/shared (no DOM there). What needs
// a DOM, and lives here: a control inside the surface owns its own gesture,
// and a verb that cannot run on this item neither fires nor hints.

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { useSwipeVerb, type SwipeVerb } from '@declutrmail/shared';

function SwipeHarness({
  children,
  onVerb,
  isAvailable,
}: {
  children: ReactNode;
  onVerb: (verb: SwipeVerb) => void;
  isAvailable?: (verb: SwipeVerb) => boolean;
}) {
  const { drag, handlers } = useSwipeVerb({
    enabled: true,
    onVerb,
    ...(isAvailable ? { isAvailable } : {}),
  });
  return createElement(
    'div',
    { ...handlers, 'data-testid': 'harness', 'data-hint': drag?.wouldResolve ?? '' },
    children,
  );
}

const touch = { pointerType: 'touch', pointerId: 1 };

/** A left drag: 200 → 80. */
function dragLeft(target: Element): void {
  fireEvent.pointerDown(target, { ...touch, clientX: 200, clientY: 100 });
  fireEvent.pointerUp(target, { ...touch, clientX: 80, clientY: 100 });
}

describe('useSwipeVerb: interactive descendants', () => {
  it.each(['button', 'a', 'input', 'select', 'textarea', 'summary'])(
    'leaves gestures on %s to the control',
    (tag) => {
      const onVerb = vi.fn();
      const hasText = ['button', 'a', 'summary'].includes(tag);
      const control = createElement(
        tag,
        { 'data-testid': 'control' },
        hasText ? createElement('span', { 'data-testid': 'control-text' }, 'Read details') : null,
      );
      render(
        createElement(SwipeHarness, {
          onVerb,
          children: tag === 'summary' ? createElement('details', null, control) : control,
        }),
      );
      dragLeft(screen.getByTestId(hasText ? 'control-text' : 'control'));
      expect(onVerb).not.toHaveBeenCalled();
    },
  );

  it.each(['true', '', 'plaintext-only'])(
    'leaves an editable host (%s) and nested text to the editor',
    (value) => {
      const onVerb = vi.fn();
      render(
        createElement(SwipeHarness, {
          onVerb,
          children: createElement(
            'div',
            { 'data-testid': 'editor' },
            createElement('span', { 'data-testid': 'text' }, 'Editable text'),
          ),
        }),
      );
      screen.getByTestId('editor').setAttribute('contenteditable', value);
      dragLeft(screen.getByTestId('text'));
      expect(onVerb).not.toHaveBeenCalled();
    },
  );

  it('keeps a noneditable card surface swipeable', () => {
    const onVerb = vi.fn();
    render(
      createElement(SwipeHarness, {
        onVerb,
        children: createElement('div', { 'data-testid': 'surface', contentEditable: false }),
      }),
    );
    dragLeft(screen.getByTestId('surface'));
    expect(onVerb).toHaveBeenCalledExactlyOnceWith('Unsubscribe');
  });

  it('leaves selection of disclosed identity text to the disclosure', () => {
    const onVerb = vi.fn();
    render(
      createElement(SwipeHarness, {
        onVerb,
        children: createElement(
          'details',
          { open: true },
          createElement('summary', null, 'Sender details'),
          createElement('p', { 'data-testid': 'identity' }, 'Synthetic full identity'),
        ),
      }),
    );
    dragLeft(screen.getByTestId('identity'));
    expect(onVerb).not.toHaveBeenCalled();
  });

  it('preserves the list row header as an intended swipe surface', () => {
    const onVerb = vi.fn();
    render(
      createElement(SwipeHarness, {
        onVerb,
        children: createElement('div', { role: 'button', 'data-testid': 'header' }),
      }),
    );
    dragLeft(screen.getByTestId('header'));
    expect(onVerb).toHaveBeenCalledExactlyOnceWith('Unsubscribe');
  });
});

describe('useSwipeVerb: each direction fires its verb', () => {
  it.each([
    ['right', 200, 100, 330, 100, 'Keep'],
    ['left', 200, 100, 80, 100, 'Unsubscribe'],
    ['up', 200, 300, 200, 170, 'Delete'],
  ] as const)('%s → %s', (_dir, x0, y0, x1, y1, verb) => {
    const onVerb = vi.fn();
    render(createElement(SwipeHarness, { onVerb, children: createElement('div') }));
    const surface = screen.getByTestId('harness');
    fireEvent.pointerDown(surface, { ...touch, clientX: x0, clientY: y0 });
    fireEvent.pointerUp(surface, { ...touch, clientX: x1, clientY: y1 });
    expect(onVerb).toHaveBeenCalledExactlyOnceWith(verb);
  });

  it('ignores a downward swipe and a mouse drag', () => {
    const onVerb = vi.fn();
    render(createElement(SwipeHarness, { onVerb, children: createElement('div') }));
    const surface = screen.getByTestId('harness');
    fireEvent.pointerDown(surface, { ...touch, clientX: 200, clientY: 100 });
    fireEvent.pointerUp(surface, { ...touch, clientX: 200, clientY: 260 });
    fireEvent.pointerDown(surface, {
      pointerType: 'mouse',
      pointerId: 2,
      clientX: 200,
      clientY: 100,
    });
    fireEvent.pointerUp(surface, { pointerType: 'mouse', pointerId: 2, clientX: 80, clientY: 100 });
    expect(onVerb).not.toHaveBeenCalled();
  });
});

describe('useSwipeVerb: availability', () => {
  it('an unavailable verb neither fires on release nor shows a hint while dragging', () => {
    const onVerb = vi.fn();
    render(
      createElement(SwipeHarness, {
        onVerb,
        isAvailable: (verb: SwipeVerb) => verb !== 'Unsubscribe',
        children: createElement('div'),
      }),
    );
    const surface = screen.getByTestId('harness');
    fireEvent.pointerDown(surface, { ...touch, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(surface, { ...touch, clientX: 120, clientY: 100 });
    expect(surface).toHaveAttribute('data-hint', '');
    fireEvent.pointerUp(surface, { ...touch, clientX: 80, clientY: 100 });
    expect(onVerb).not.toHaveBeenCalled();
  });

  it('an available verb is named while dragging and fires on release', () => {
    const onVerb = vi.fn();
    render(createElement(SwipeHarness, { onVerb, children: createElement('div') }));
    const surface = screen.getByTestId('harness');
    fireEvent.pointerDown(surface, { ...touch, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(surface, { ...touch, clientX: 120, clientY: 100 });
    expect(surface).toHaveAttribute('data-hint', 'Unsubscribe');
    fireEvent.pointerUp(surface, { ...touch, clientX: 80, clientY: 100 });
    expect(onVerb).toHaveBeenCalledExactlyOnceWith('Unsubscribe');
  });

  it('one unavailable verb does not disable the others', () => {
    const onVerb = vi.fn();
    render(
      createElement(SwipeHarness, {
        onVerb,
        isAvailable: (verb: SwipeVerb) => verb !== 'Unsubscribe',
        children: createElement('div'),
      }),
    );
    const surface = screen.getByTestId('harness');
    fireEvent.pointerDown(surface, { ...touch, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(surface, { ...touch, clientX: 230, clientY: 100 });
    expect(onVerb).toHaveBeenCalledExactlyOnceWith('Keep');
  });
});
