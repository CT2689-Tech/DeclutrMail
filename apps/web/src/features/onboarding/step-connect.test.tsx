import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { StepConnect } from './step-connect';

describe('StepConnect privacy boundary', () => {
  it('distinguishes the per-message storage list from the full lifecycle inventory', () => {
    const { container } = render(<StepConnect />);
    const text = container.textContent ?? '';

    expect(text).toMatch(/complete per-message storage list/i);
    expect(text).toMatch(/connection, derived, and retained audit data/i);
    expect(text).toContain('Full bodies fetched: 0');
    expect(text).not.toMatch(/whole list|exactly this list/i);
  });
});
