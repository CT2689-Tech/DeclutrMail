'use client';
// revamp-lab — direction switcher shell (DQ15, senders-lab precedent).
// THROWAWAY: fixtures only, no API, deletable folder. Three from-scratch
// directions sharing one product truth: K/A/U/L/D from VERB_REGISTRY,
// D226 preview-before-mutation, locked privacy copy. Visuals deliberately
// off-constitution — that is what the lab exists to test.

import { useEffect, useState } from 'react';
import { Inter_Tight, Newsreader, Space_Grotesk } from 'next/font/google';
import { StackDirection } from './stack';
import { ConsoleDirection } from './console';
import { StudyDirection } from './study';
import { LAB_SCREENS, type LabScreen } from './screens';

const grotesk = Space_Grotesk({ subsets: ['latin'], variable: '--lab-grotesk', display: 'swap' });
const interTight = Inter_Tight({
  subsets: ['latin'],
  variable: '--lab-intertight',
  display: 'swap',
});
const newsreader = Newsreader({
  subsets: ['latin'],
  variable: '--lab-newsreader',
  style: ['normal', 'italic'],
  display: 'swap',
});

type DirectionId = 'stack' | 'console' | 'study';

const DIRECTIONS: Array<{ id: DirectionId; label: string; tagline: string }> = [
  { id: 'stack', label: '1 · The Stack', tagline: 'one decision at a time — momentum ritual' },
  {
    id: 'console',
    label: '2 · The Console',
    tagline: 'whole system on one screen — operator control',
  },
  { id: 'study', label: '3 · The Study', tagline: 'the app as a morning edition — reading calm' },
];

function parseHash(): { dir: DirectionId; screen: LabScreen } {
  if (typeof window === 'undefined') return { dir: 'stack', screen: 'today' };
  const raw = window.location.hash.replace('#', '');
  const [d, s] = raw.split('.');
  const dir = (DIRECTIONS.find((x) => x.id === d)?.id ?? 'stack') as DirectionId;
  const screen = (LAB_SCREENS.find((x) => x.id === s)?.id ?? 'today') as LabScreen;
  return { dir, screen };
}

export default function RevampLabPage() {
  const [dir, setDir] = useState<DirectionId>('stack');
  const [screen, setScreen] = useState<LabScreen>('today');
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const sync = () => {
      const parsed = parseHash();
      setDir(parsed.dir);
      setScreen(parsed.screen);
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  // Direction tabs reset to that direction's default screen (Today);
  // in-direction nav (Landing/Senders/Brief/…) uses plain hash links.
  const pick = (id: DirectionId) => {
    setDir(id);
    setScreen('today');
    window.location.hash = id;
  };

  const active = DIRECTIONS.find((d) => d.id === dir)!;
  const body =
    dir === 'stack' ? (
      <StackDirection mobile={mobile} screen={screen} />
    ) : dir === 'console' ? (
      <ConsoleDirection mobile={mobile} screen={screen} />
    ) : (
      <StudyDirection mobile={mobile} />
    );

  return (
    <div
      className={`${grotesk.variable} ${interTight.variable} ${newsreader.variable}`}
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background: '#1A1A1A',
      }}
    >
      {/* Lab chrome — deliberately neutral so no direction inherits it */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '10px 16px',
          background: '#1A1A1A',
          color: '#D7D3CB',
          fontFamily: 'var(--dm-font-mono), monospace',
          fontSize: 11,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            background: '#F2C744',
            color: '#1A1A1A',
            fontWeight: 700,
            padding: '3px 8px',
            borderRadius: 3,
          }}
        >
          REVAMP LAB
        </span>
        <span style={{ opacity: 0.7 }}>
          DQ15 · throwaway · verbs + preview + privacy copy locked, visuals free
        </span>
        <nav style={{ display: 'flex', gap: 6, marginLeft: 'auto' }} aria-label="Directions">
          {DIRECTIONS.map((d) => (
            <button
              key={d.id}
              onClick={() => pick(d.id)}
              aria-pressed={dir === d.id}
              style={{
                background: dir === d.id ? '#F2C744' : 'transparent',
                color: dir === d.id ? '#1A1A1A' : '#D7D3CB',
                border: '1px solid ' + (dir === d.id ? '#F2C744' : '#3A3A3A'),
                borderRadius: 4,
                padding: '5px 12px',
                fontFamily: 'inherit',
                fontSize: 11,
                fontWeight: dir === d.id ? 700 : 400,
                cursor: 'pointer',
              }}
            >
              {d.label}
            </button>
          ))}
          <button
            onClick={() => setMobile((m) => !m)}
            aria-pressed={mobile}
            title="Preview inside a 390px phone frame"
            style={{
              background: mobile ? '#D7D3CB' : 'transparent',
              color: mobile ? '#1A1A1A' : '#D7D3CB',
              border: '1px solid ' + (mobile ? '#D7D3CB' : '#3A3A3A'),
              borderRadius: 4,
              padding: '5px 12px',
              fontFamily: 'inherit',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            📱 mobile
          </button>
        </nav>
        <span style={{ width: '100%', opacity: 0.55 }}>{active.tagline}</span>
      </div>

      {/* Direction canvas */}
      {mobile ? (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: '24px 0 40px' }}>
          <div
            style={{
              position: 'relative',
              width: 390,
              height: 780,
              maxHeight: 'calc(100dvh - 120px)',
              overflow: 'hidden',
              borderRadius: 32,
              border: '6px solid #000',
              boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
              background: '#fff',
            }}
          >
            {body}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1 }}>{body}</div>
      )}
    </div>
  );
}
