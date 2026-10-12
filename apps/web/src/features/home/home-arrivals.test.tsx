import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { HomeArrivalsView } from './home-arrivals';
import { ScanPreviewView } from '../onboarding/scan-preview';

const data = {
  visitId: '10000000-0000-4000-8000-000000000001',
  since: '2026-10-09T10:00:00Z',
  until: '2026-10-10T10:00:00Z',
  indexedEmails: 3,
  indexedSenders: 2,
};

describe('r24 visit and scan copy', () => {
  it('uses the since-last deck lines and drops the footnote', () => {
    const { rerender } = render(<HomeArrivalsView data={data} error={false} retry={() => {}} />);
    expect(screen.getByRole('region', { name: 'Since your last visit' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '3 new emails scanned' })).toBeInTheDocument();
    expect(screen.getByText('2 new senders')).toBeInTheDocument();
    expect(screen.queryByText(/retained index|previous visit/)).not.toBeInTheDocument();

    rerender(
      <HomeArrivalsView
        data={{ ...data, indexedEmails: 1, indexedSenders: 1 }}
        error={false}
        retry={() => {}}
      />,
    );
    expect(screen.getByRole('heading', { name: '1 new email scanned' })).toBeInTheDocument();
    expect(screen.getByText('1 new sender')).toBeInTheDocument();

    rerender(
      <HomeArrivalsView
        data={{ ...data, indexedEmails: 0, indexedSenders: 0 }}
        error={false}
        retry={() => {}}
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'No new email since your last visit.' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/new sender/)).not.toBeInTheDocument();
  });

  it('uses the scan-preview deck lines', () => {
    render(
      <ScanPreviewView
        open
        toggle={() => {}}
        state="ready"
        refresh={() => {}}
        data={[
          { name: 'Example Journal', indexedEmails: 1 },
          { name: 'Studio Notes', indexedEmails: 48 },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Hide preview' })).toBeInTheDocument();
    expect(screen.getByText(WS2_COPY.liveFix.onboarding.preview.intro)).toBeInTheDocument();
    expect(screen.getByText('Example Journal — 1 email')).toBeInTheDocument();
    expect(screen.getByText('Studio Notes — 48 emails')).toBeInTheDocument();
    expect(screen.queryByText(/indexed/i)).not.toBeInTheDocument();
  });
});
