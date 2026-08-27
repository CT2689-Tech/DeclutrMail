import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UNIFORM_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements/undo-window';

import { ReviewSession } from './review-session';
import { makeSender } from './testing/make-sender';

/**
 * ReviewSession has no live mount (see the file's own header comment) and
 * no prior test file — this is a minimal direct-render test proving the
 * commit-bar's undo-window sentence, not a new mocking harness. It uses
 * only the project's existing `makeSender` fixture and a plain RTL render,
 * the same primitives every sibling action-sheet test in this plan uses.
 */
describe('ReviewSession — commit bar (D245)', () => {
  it('states the undo window instead of hedging', () => {
    render(
      <ReviewSession
        open
        kind="protect"
        senders={[makeSender()]}
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(
      screen.queryByText(/Archive, Later, and Delete use your plan's Activity Undo window/i),
    ).not.toBeInTheDocument();
    if (UNIFORM_UNDO_WINDOW_DAYS !== null) {
      expect(
        screen.getByText(
          new RegExp(
            `Archive, Later, and Delete use the ${UNIFORM_UNDO_WINDOW_DAYS}-day Activity Undo window`,
            'i',
          ),
        ),
      ).toBeInTheDocument();
    }
  });
});
