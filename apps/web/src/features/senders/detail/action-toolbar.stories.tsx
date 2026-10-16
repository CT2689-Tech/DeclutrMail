// Storybook CSF3 stories for the Sender Detail action toolbar (D210).
//
// Actions keep their names; progress and results render separately in every state.
import { useState, type ReactElement } from 'react';

import { makeSender } from '../testing/make-sender';
import { RowActivityProvider, type SenderRowActivity } from '../row-activity';
import { ToastHost, toast, UndoTray, tokens } from '@declutrmail/shared';
import { SenderList } from '../sender-list';
import workspaceStyles from '../sender-workspace.module.css';
import { LaunchFilterRow } from '../launch-filter-row';
import { ActionToolbar } from './action-toolbar';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story = { render: () => ReactElement };

const meta: StoryMeta<typeof ActionToolbar> = {
  title: 'Senders/Detail/ActionToolbar',
  component: ActionToolbar,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
};

export default meta;

const sender = makeSender({ id: 'toolbar-1', displayName: 'Robinhood' });

const withActivity = (activity: SenderRowActivity | null): ReactElement => (
  <RowActivityProvider value={new Map(activity ? [[sender.id, activity]] : [])}>
    <ActionToolbar sender={sender} onAction={() => {}} />
  </RowActivityProvider>
);

export const Idle: Story = { render: () => withActivity(null) };

export const RequestAccepted: Story = {
  render: () => (
    <ActionToolbar
      sender={makeSender({
        ...sender,
        unsubscribeMethod: 'one_click',
        policyType: 'unsubscribe',
        unsubStatus: 'endpoint_accepted',
      })}
      onAction={() => {}}
      shortcuts
    />
  ),
};

export const ManualMarkedSent: Story = {
  render: () => (
    <ActionToolbar
      sender={makeSender({
        ...sender,
        unsubscribeMethod: 'mailto',
        policyType: 'unsubscribe',
        unsubStatus: 'user_marked_sent',
      })}
      onAction={() => {}}
    />
  ),
};

/** Progress is separate; every verb is inert while the job runs. */
export const Working: Story = {
  render: () => withActivity({ phase: 'working', verb: 'archive' }),
};

/** Done: count the result separately and retain the available actions. */
export const Done: Story = {
  render: () => withActivity({ phase: 'done', verb: 'archive', affectedCount: 12 }),
};

/** Past the deadline or a lost poll: the job may still be running, so it stays locked. */
export const NotConfirmed: Story = {
  render: () => withActivity({ phase: 'unconfirmed', verb: 'delete' }),
};

/** Ended badly: the verb stays live for a retry; the failure sits beside the verbs. */
export const Failed: Story = {
  render: () => withActivity({ phase: 'failed', verb: 'delete' }),
};

function FeedbackReview() {
  const [phase, setPhase] = useState<'idle' | 'working' | 'done' | 'failed'>('idle');
  const [verb, setVerb] = useState<'archive' | 'later' | 'delete'>('later');
  const [compact, setCompact] = useState(false);
  const [protectedSender, setProtectedSender] = useState(false);
  const [kept, setKept] = useState(false);
  const row = makeSender({
    id: 'feedback-review',
    policyType: kept ? 'keep' : null,
    protectionFlags: {
      isProtected: protectedSender,
      protectionReason: protectedSender ? 'user_defined' : null,
      protectionSetAt: null,
    },
    displayName: 'Acme Updates',
    email: 'updates@acme.example',
    inboxCount: phase === 'done' ? 0 : 212,
    archivedCount: phase === 'done' ? 417 : 205,
  });
  const activity: SenderRowActivity | null =
    phase === 'idle'
      ? null
      : phase === 'done'
        ? { phase, verb, affectedCount: 212 }
        : { phase, verb };
  const act = (req: { verb: string }) => {
    if (req.verb === 'Keep') {
      setKept(true);
      toast('Kept Acme Updates', 'success', {
        label: 'Undo',
        onClick: () => {
          setPhase('idle');
          setKept(false);
          toast('Acme Updates is undecided again');
        },
      });
      return;
    }
    if (req.verb === 'Archive' || req.verb === 'Later' || req.verb === 'Delete') {
      setVerb(req.verb.toLowerCase() as typeof verb);
      setPhase('working');
    }
  };
  return (
    <div style={{ padding: 24, maxWidth: 1000, marginInline: 'auto', color: tokens.color.fg }}>
      <h2>Sender feedback states</h2>
      <p>Synthetic fixtures; these controls simulate server outcomes without changing mail.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <button onClick={() => setPhase('working')}>Show progress</button>
        <button onClick={() => setPhase('done')}>Complete action</button>
        <button onClick={() => setPhase('failed')}>Fail action</button>
        <button
          onClick={() => {
            setPhase('idle');
            setKept(false);
          }}
        >
          Reset example
        </button>
        <button onClick={() => setProtectedSender((x) => !x)}>Toggle Protected</button>
        <button onClick={() => setCompact((x) => !x)}>Toggle compact row</button>
        <button onClick={() => toast('Acme Updates is Protected', 'success')}>
          Show protection notification
        </button>
      </div>
      <LaunchFilterRow mailboxId={null} onApply={() => {}} />
      <RowActivityProvider value={new Map(activity ? [[row.id, activity]] : [])}>
        <div className={workspaceStyles.results}>
          <SenderList
            entries={[{ kind: 'sender', sender: row }]}
            compact={compact}
            selectedIds={new Set()}
            onToggleSelect={() => {}}
            onOpen={() => {}}
            onAction={act}
            activeId={null}
            followKeys={false}
          />
        </div>
        <h3>Details actions</h3>
        <ActionToolbar sender={row} onAction={act} />
      </RowActivityProvider>
      {phase === 'working' || phase === 'failed' || phase === 'done' ? (
        <UndoTray
          dataSource={{
            isLoading: false,
            entries:
              phase === 'done'
                ? [
                    {
                      token: 'synthetic',
                      actionKind: verb,
                      affectedCount: 212,
                      createdAt: new Date().toISOString(),
                      expiresAt: new Date(Date.now() + 86400000).toISOString(),
                    },
                  ]
                : [],
            notices:
              phase === 'done'
                ? []
                : [
                    {
                      id: 'synthetic',
                      tone: phase === 'working' ? 'working' : 'attention',
                      label:
                        phase === 'working'
                          ? {
                              archive: 'Archiving…',
                              later: 'Moving to Later…',
                              delete: 'Deleting…',
                            }[verb]
                          : `${verb.charAt(0).toUpperCase()}${verb.slice(1)} failed`,
                      who: 'Acme Updates',
                    },
                  ],
            revert: async () => {
              setPhase('idle');
              toast('Emails restored', 'success');
            },
          }}
        />
      ) : null}
      <ToastHost />
    </div>
  );
}

export const FeedbackConsistency: Story = { render: () => <FeedbackReview /> };

export const NoCurrentMail: Story = {
  render: () => (
    <ActionToolbar
      sender={makeSender({ inboxCount: 0, archivedCount: 0, totalReceived: 565 })}
      onAction={() => {}}
      shortcuts
    />
  ),
};
export const ArchivedMailOnly: Story = {
  render: () => (
    <ActionToolbar
      sender={makeSender({ inboxCount: 0, archivedCount: 21 })}
      onAction={() => {}}
      shortcuts
    />
  ),
};
export const UnknownCurrentMail: Story = {
  render: () => (
    <ActionToolbar
      sender={makeSender({ inboxCount: null, archivedCount: null })}
      onAction={() => {}}
      shortcuts
    />
  ),
};

export const NoUnsubscribeChannel: Story = {
  render: () => (
    <ActionToolbar sender={makeSender({ unsubscribeMethod: 'none' })} onAction={() => {}} />
  ),
};

export const UnsubscribeNotChecked: Story = {
  render: () => (
    <ActionToolbar sender={makeSender({ unsubscribeMethod: null })} onAction={() => {}} />
  ),
};
