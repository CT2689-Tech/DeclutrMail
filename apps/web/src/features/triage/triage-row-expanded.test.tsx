import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TRIAGE_QUEUE } from './fixtures';
import { TriageRowExpanded } from './triage-row-expanded';

describe('expanded recommendation context', () => {
  it('keeps Later evidence without suggesting that the user move email', () => {
    const reasoning = 'Recent activity does not point to a clear action.';
    render(<TriageRowExpanded row={{ ...TRIAGE_QUEUE[0]!, verdict: 'later', reasoning }} />);
    expect(screen.getByText('No clear suggestion')).toBeInTheDocument();
    expect(screen.getByText(reasoning)).toBeInTheDocument();
    expect(screen.queryByText(/Suggested: Later/)).not.toBeInTheDocument();
  });
});
