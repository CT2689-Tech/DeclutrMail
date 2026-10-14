import { useState } from 'react';
import { tokens } from '@declutrmail/shared';
import { ActionReachControl, ActionWindowControl } from './action-scope-controls';

function ScopeControls({
  state = 'default',
}: {
  state?: 'default' | 'loading' | 'unavailable' | 'empty' | 'equal';
}) {
  const [reach, setReach] = useState<'inbox_only' | 'all_mail'>('inbox_only');
  const [days, setDays] = useState<number | null>(180);
  const windows = [
    { days: null, label: 'All inbox', inbox: 1_700, allMail: 2_000 },
    { days: 30, label: '30 days+', inbox: 1_680, allMail: 1_900 },
    { days: 90, label: '3 months+', inbox: 1_660, allMail: 1_850 },
    { days: 180, label: '6 months+', inbox: 1_654, allMail: 1_810 },
    { days: 365, label: '1 year+', inbox: 800, allMail: 1_000 },
  ];
  const counts = windows.map((window) => ({
    ...window,
    inbox: state === 'loading' ? undefined : state === 'empty' ? 0 : window.inbox,
    allMail:
      state === 'loading' || state === 'unavailable'
        ? undefined
        : state === 'equal'
          ? window.inbox
          : window.allMail,
  }));
  const selected = counts.find((window) => window.days === days);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space[3],
        maxWidth: 400,
      }}
    >
      <ActionReachControl
        value={reach}
        inboxCount={selected?.inbox}
        allMailCount={selected?.allMail}
        onChange={setReach}
      />
      <ActionWindowControl
        value={days}
        onChange={setDays}
        options={counts.map((window) => ({
          days: window.days,
          label: window.days === null && reach === 'all_mail' ? 'All mail' : window.label,
          count: reach === 'all_mail' ? window.allMail : window.inbox,
        }))}
      />
    </div>
  );
}

export default {
  title: 'Actions/ScopeControls',
  component: ScopeControls,
  tags: ['autodocs'],
};

export const Default = { args: { state: 'default' } };
export const Loading = { args: { state: 'loading' } };
export const ArchivedUnavailable = { args: { state: 'unavailable' } };
export const EmptyInbox = { args: { state: 'empty' } };
export const EqualCounts = { args: { state: 'equal' } };
