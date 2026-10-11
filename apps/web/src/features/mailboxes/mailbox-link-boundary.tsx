'use client';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import styles from './mailbox-link-boundary.module.css';
function LinkDownloadFailure({ children }: { children: ReactNode }) {
  const search = useSearchParams();
  if (!search.has('mailbox')) return children;
  return (
    <main className={styles.recovery}>
      <p role="alert">This inbox link couldn’t load. Reload to retry.</p>
      <button type="button" onClick={() => window.location.reload()}>
        Reload
      </button>
      <a href="/settings#mailboxes">Open Gmail accounts</a>
    </main>
  );
}
const Resolver = dynamic(
  () =>
    import('./mailbox-link-resolver')
      .then((module) => module.MailboxLinkResolver)
      .catch(() => LinkDownloadFailure),
  { ssr: false, loading: () => <p role="status">Opening linked inbox…</p> },
);
export function MailboxLinkBoundary({ children }: { children: ReactNode }) {
  const search = useSearchParams();
  const targetPresent = search.has('mailbox');
  const [usedResolver, setUsedResolver] = useState(targetPresent);
  // Remember entry into the resolver before paint; keep it mounted through a
  // query change so an in-flight switch cannot be escaped into mailbox actions.
  if (targetPresent && !usedResolver) setUsedResolver(true);
  return targetPresent || usedResolver ? <Resolver>{children}</Resolver> : children;
}
