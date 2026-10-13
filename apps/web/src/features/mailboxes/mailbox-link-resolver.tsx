'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button, ErrorState } from '@declutrmail/shared';
import { useAuth } from '@/features/auth/auth-provider';
import { useSetActiveMailbox } from './api/use-set-active-mailbox';

/** Resolve emailed inbox targets before any mailbox-scoped screen mounts. */
export function MailboxLinkResolver({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const target = search.get('mailbox');
  const attempted = useRef<string | null>(null);
  const switchMailbox = useSetActiveMailbox();
  const owned = me.mailboxes.find(
    (mailbox) => mailbox.id === target && mailbox.status === 'active',
  );
  const invalid = target !== null && (!owned || search.getAll('mailbox').length !== 1);
  const resolved = target !== null && !invalid && me.activeMailboxId === target;

  useEffect(() => {
    // A previously requested target can still commit on the server. Let that
    // mutation and its cache reset finish before resolving the newest URL.
    if (switchMailbox.isPending) return;
    if (target === null) {
      attempted.current = null;
      return;
    }
    if (resolved) {
      const query = new URLSearchParams(search.toString());
      query.delete('mailbox');
      router.replace(`${pathname}${query.size ? `?${query}` : ''}${window.location.hash}`);
    } else if (!invalid && attempted.current !== target) {
      attempted.current = target;
      switchMailbox.mutate(target);
    }
  }, [
    target,
    resolved,
    invalid,
    pathname,
    search,
    router,
    switchMailbox.mutate,
    switchMailbox.isPending,
  ]);

  if (target === null && !switchMailbox.isPending) return children;
  const dismiss = () => {
    const query = new URLSearchParams(search.toString());
    query.delete('mailbox');
    router.replace(`${pathname}${query.size ? `?${query}` : ''}`);
  };
  return (
    <MailboxLinkView
      phase={
        switchMailbox.isPending
          ? 'opening'
          : invalid
            ? 'invalid'
            : switchMailbox.isError && attempted.current === target
              ? 'error'
              : 'opening'
      }
      retry={() => (invalid ? router.refresh() : target && switchMailbox.mutate(target))}
      settings={() => router.replace('/settings#mailboxes')}
      dismiss={dismiss}
    />
  );
}

export function MailboxLinkView({
  phase,
  retry,
  settings,
  dismiss,
}: {
  phase: 'invalid' | 'error' | 'opening';
  retry: () => void;
  settings: () => void;
  dismiss: () => void;
}) {
  return (
    <main style={{ maxWidth: 540, margin: '80px auto', padding: 24 }}>
      {phase === 'invalid' ? (
        <>
          <ErrorState
            onRetry={retry}
            title="This link is for another Gmail account"
            description="Switch to that account in Settings, or keep going with this one."
          />
          <Button tone="ghost" onClick={settings}>
            Open Gmail accounts
          </Button>
        </>
      ) : phase === 'error' ? (
        <ErrorState
          title="We couldn’t open this inbox"
          description="Try again to select the inbox linked in your email."
          onRetry={retry}
        />
      ) : (
        <p role="status">Opening…</p>
      )}
      <Button tone="ghost" disabled={phase === 'opening'} onClick={dismiss}>
        Keep using this account
      </Button>
    </main>
  );
}
