'use client';
import dynamic from 'next/dynamic';
import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
function LinkDownloadFailure({ children }: { children: ReactNode }) {
  const router = useRouter();
  const search = useSearchParams();
  if (!search.has('mailbox')) return children;
  return (
    <main style={{ maxWidth: 540, margin: '80px auto', padding: 24 }}>
      <p role="alert">We couldn’t open this inbox link. Reload to try again.</p>
      <button type="button" onClick={() => window.location.reload()}>
        Reload
      </button>
      <button type="button" onClick={() => router.replace('/settings#mailboxes')}>
        Open Gmail accounts
      </button>
    </main>
  );
}
const Resolver = dynamic(
  () =>
    import('./mailbox-link-resolver')
      .then((module) => module.MailboxLinkResolver)
      .catch(() => LinkDownloadFailure),
  { ssr: false, loading: () => <p role="status">Opening the inbox from your link…</p> },
);
export function MailboxLinkBoundary({ children }: { children: ReactNode }) {
  const search = useSearchParams();
  const targetPresent = search.has('mailbox');
  const [usedResolver, setUsedResolver] = useState(targetPresent);
  useEffect(() => {
    if (targetPresent) setUsedResolver(true);
  }, [targetPresent]);
  return targetPresent || usedResolver ? <Resolver>{children}</Resolver> : children;
}
