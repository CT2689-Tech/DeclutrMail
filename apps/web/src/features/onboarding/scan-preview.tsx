'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@declutrmail/shared';
import { pluralCopy, WS2_COPY } from '@declutrmail/shared/copy/launch';
import { apiGet } from '@/lib/api/client';

const previewCopy = WS2_COPY.liveFix.onboarding.preview;

export interface ScanPreviewSender {
  name: string;
  indexedEmails: number;
}

/** A read-only view inside setup; cleanup still waits for a completed scan. */
export function ScanPreview({ mailboxId }: { mailboxId: string }) {
  const [open, setOpen] = useState(false);
  const preview = useQuery({
    queryKey: ['onboarding', 'scan-preview', mailboxId],
    queryFn: async ({ signal }) =>
      (await apiGet<ScanPreviewSender[]>('/api/onboarding/scan-preview', { mailboxId, signal }))
        .data,
    enabled: open,
    staleTime: 30_000,
  });
  return (
    <ScanPreviewView
      open={open}
      toggle={() => setOpen(!open)}
      data={preview.data}
      state={preview.isPending ? 'loading' : preview.isError ? 'error' : 'ready'}
      refresh={() => void preview.refetch()}
    />
  );
}

export function ScanPreviewView({
  open,
  toggle,
  data,
  state,
  refresh,
}: {
  open: boolean;
  toggle: () => void;
  data?: ScanPreviewSender[] | undefined;
  state: 'loading' | 'error' | 'ready';
  refresh: () => void;
}) {
  return (
    <section aria-label="Scan preview" style={{ marginTop: 24, width: '100%' }}>
      <Button tone="ghost" aria-expanded={open} onClick={toggle}>
        {open ? 'Hide preview' : previewCopy.toggle}
      </Button>
      {open && (
        <>
          <p>{previewCopy.intro}</p>
          {state === 'loading' ? (
            <p role="status">Loading available senders…</p>
          ) : state === 'error' ? (
            <>
              <p>Couldn’t load the saved preview. Try again.</p>
              <Button tone="ghost" onClick={refresh}>
                Try preview again
              </Button>
            </>
          ) : data?.length ? (
            <ul style={{ paddingLeft: 20, textAlign: 'left' }}>
              {data.map((sender, index) => (
                <li key={index}>
                  {pluralCopy(previewCopy.row, sender.indexedEmails, {
                    name: sender.name,
                    n: sender.indexedEmails.toLocaleString('en-US'),
                  })}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              No senders found yet.{' '}
              <Button tone="ghost" onClick={refresh}>
                Refresh preview
              </Button>
            </p>
          )}
        </>
      )}
    </section>
  );
}
