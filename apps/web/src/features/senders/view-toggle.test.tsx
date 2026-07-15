import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useSendersStore } from './store';
import { ViewToggle } from './view-toggle';

describe('ViewToggle accessibility', () => {
  beforeEach(() => useSendersStore.setState({ view: 'grid' }));

  it('names the control for the Senders display and preserves pressed state', () => {
    render(<ViewToggle />);

    expect(screen.getByRole('group', { name: 'Senders display view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Table' }));

    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
  });
});
