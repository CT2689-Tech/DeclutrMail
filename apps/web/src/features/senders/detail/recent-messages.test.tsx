import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { QueryWrapper, createTestQueryClient } from '@/test/query-wrapper';
import { RecentMessages } from './recent-messages';
it('decodes Gmail entities once and renders decoded markup only as text', async () => {
  const { container } = render(
    <QueryWrapper client={createTestQueryClient()}>
      <RecentMessages
        mailboxEmail={null}
        senderEmail="sender@synthetic.test"
        messages={[
          {
            id: 'm',
            providerMessageId: 'm',
            threadId: 't',
            subject: 'Synthetic preview',
            snippet:
              'It&#39;s new &amp; ready &lt;img src=x onerror=alert(1)&gt; &amp;lt;b&amp;gt;',
            receivedAt: new Date().toISOString(),
            sizeBytes: 20,
            hasAttachment: false,
            unread: true,
          },
        ]}
      />
    </QueryWrapper>,
  );
  expect(screen.getByText(/It&#39;s new &amp; ready/)).toBeInTheDocument();
  expect(
    await screen.findByText(`It's new & ready <img src=x onerror=alert(1)> &lt;b&gt;`),
  ).toBeInTheDocument();
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('script')).toBeNull();
});
