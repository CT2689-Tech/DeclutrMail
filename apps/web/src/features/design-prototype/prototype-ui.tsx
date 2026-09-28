import type { CSSProperties } from 'react';
import type { SampleSender } from './fixture';

const paths = {
  home: 'm3 10 9-7 9 7v10H3V10Zm6 10v-7h6v7',
  senders:
    'M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8m5 10v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  automation: 'm13 2-9 12h7l-1 8 10-12h-7l1-8Z',
  catchup: 'M3 4h7l2 2 2-2h7v15h-7l-2 2-2-2H3V4Zm9 2v15',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  chevron: 'm9 5 7 7-7 7',
  search: 'm21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  check: 'm5 12 4 4L19 6',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',
  close: 'm6 6 12 12M6 18 18 6',
  moon: 'M20.5 13.5A9 9 0 0 1 10.5 3a9 9 0 1 0 10 10.5Z',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  undo: 'M3 10h11a6 6 0 0 1 0 12M3 10l5-5m-5 5 5 5',
  filter: 'M4 6h16M7 12h10m-7 6h4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  external: 'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7',
  mail: 'M3 5h18v14H3V5Zm0 0 9 8 9-8',
  clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  plus: 'M12 5v14M5 12h14',
};

export function Icon({
  name,
  size = 20,
  className,
}: {
  name: keyof typeof paths;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect x="3" y="8" width="24" height="19" rx="5" stroke="currentColor" strokeWidth="2" />
      <path
        d="m4 10 11 9L29 4"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SenderAvatar({
  sender,
  size = 40,
  className,
}: {
  sender: SampleSender;
  size?: number;
  className?: string;
}) {
  const style: CSSProperties = {
    width: size,
    height: size,
    minWidth: size,
    background: sender.color,
    color: '#fff',
    borderRadius: Math.round(size * 0.26),
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: size * 0.4,
    fontWeight: 600,
    letterSpacing: '-.04em',
    fontFamily: 'var(--dm-font-sans)',
    lineHeight: 1,
  };
  return (
    <span style={style} className={className} aria-hidden="true">
      {sender.initials}
    </span>
  );
}

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const maximum = Math.max(...values, 1);
  const points = values
    .map(
      (value, index) =>
        `${(index * 120) / Math.max(values.length - 1, 1)},${38 - (value / maximum) * 32}`,
    )
    .join(' ');
  return (
    <svg
      viewBox="0 0 120 44"
      width="120"
      height="44"
      fill="none"
      className={className}
      role="img"
      aria-label="Illustrative sender volume over 12 weeks"
    >
      <polyline points={`0,44 ${points} 120,44`} fill="currentColor" opacity=".08" />
      <polyline
        points={points}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
