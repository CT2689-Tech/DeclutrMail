import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WS2_COPY, WS5_COPY } from '@declutrmail/shared/copy/launch';

import { ActionReachControl, DELETE_ARCHIVED_HINT } from './action-scope-controls';

const label = WS2_COPY.simplify.confirm.includeArchived;

describe('ActionReachControl', () => {
  it('stays off by default and reports inbox_only or all_mail', () => {
    const onChange = vi.fn();
    render(
      <ActionReachControl value="inbox_only" inboxCount={2} allMailCount={9} onChange={onChange} />,
    );
    const checkbox = screen.getByRole('checkbox', { name: label });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toBeEnabled();
    expect(checkbox).toHaveStyle({ minHeight: '48px' });
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith('all_mail');

    onChange.mockClear();
    render(
      <ActionReachControl value="all_mail" inboxCount={2} allMailCount={9} onChange={onChange} />,
    );
    fireEvent.click(screen.getAllByRole('checkbox', { name: label })[1]!);
    expect(onChange).toHaveBeenCalledWith('inbox_only');
  });

  it('hides the checkbox when the two counts match, including zero', () => {
    const { rerender } = render(
      <ActionReachControl value="inbox_only" inboxCount={4} allMailCount={4} onChange={vi.fn()} />,
    );
    expect(screen.queryByRole('checkbox', { name: label })).toBeNull();
    expect(screen.queryByText(WS2_COPY.simplify.confirm.sameScope)).toBeNull();

    rerender(
      <ActionReachControl value="inbox_only" inboxCount={0} allMailCount={0} onChange={vi.fn()} />,
    );
    expect(screen.queryByRole('checkbox', { name: label })).toBeNull();
  });

  it('disables an unchecked box and explains when archived mail cannot be counted', () => {
    const onChange = vi.fn();
    render(
      <ActionReachControl
        value="inbox_only"
        inboxCount={2}
        allMailCount={null}
        onChange={onChange}
      />,
    );
    const checkbox = screen.getByRole('checkbox', { name: label });
    expect(checkbox).toBeDisabled();
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText(WS5_COPY['f1.preview.archived.unavailable'])).toBeInTheDocument();
    expect(screen.queryByText(WS2_COPY.simplify.confirm.sameScope)).toBeNull();
    fireEvent.click(checkbox);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps a checked box enabled so the choice can return to inbox only', () => {
    const onChange = vi.fn();
    render(
      <ActionReachControl
        value="all_mail"
        inboxCount={2}
        allMailCount={undefined}
        onChange={onChange}
      />,
    );
    const checkbox = screen.getByRole('checkbox', { name: label });
    expect(checkbox).toBeEnabled();
    expect(checkbox).toBeChecked();
    expect(screen.getByText(WS5_COPY['f1.preview.archived.unavailable'])).toBeInTheDocument();
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith('inbox_only');
  });

  it('does not treat two missing counts as a match', () => {
    render(
      <ActionReachControl
        value="inbox_only"
        inboxCount={null}
        allMailCount={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('checkbox', { name: label })).toBeDisabled();
  });
});

describe('DELETE_ARCHIVED_HINT', () => {
  it('uses the archived-email hint from the deck', () => {
    expect(DELETE_ARCHIVED_HINT).toBe(WS5_COPY['f1.preview.archived.hint']);
  });
});
