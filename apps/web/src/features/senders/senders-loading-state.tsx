/**
 * The Senders read-pending skeleton — the shape of the real screen: one
 * header line, the hero number, then hairline list rows.
 *
 * Lives in its own module (no `'use client'`) so BOTH consumers can use
 * it: the client screen's `isLoading` branch, and the route-level
 * `loading.tsx`, which renders on the server.
 */

import { Skeleton, tokens } from '@declutrmail/shared';
import styles from './sender-workspace.module.css';

const { color, radius } = tokens;

const ROWS = 8;

export function SendersLoadingState() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading senders"
      className={`${styles.workspace} ${styles.loadingWorkspace}`}
    >
      <div className={styles.listColumn}>
        <Skeleton variant="text" width={160} height={12} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Skeleton variant="rect" width={120} height={28} />
          <div className={styles.loadingTools}>
            <Skeleton variant="pill" width="100%" height={40} />
            <Skeleton variant="pill" width={76} height={36} />
            <Skeleton variant="pill" width="100%" height={36} />
          </div>
        </div>
        <Skeleton variant="rect" width="min(240px, 100%)" height={44} />
        {/* Same geometry as a row: logo, name over address, count, verb, ⋯. */}
        <div className={styles.results}>
          {Array.from({ length: ROWS }, (_, i) => (
            <div
              key={i}
              className={styles.loadingRow}
              style={{
                display: 'grid',
                gridTemplateColumns: '44px minmax(0,1fr) 72px 96px 32px',
                alignItems: 'center',
                columnGap: 14,
                height: 88,
                padding: '0 12px',
                borderBottom: `1px solid ${color.lineSoft}`,
              }}
            >
              <Skeleton variant="rect" width={44} height={44} borderRadius={radius.lg} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Skeleton variant="text" height={14} width={`${32 + ((i * 7) % 24)}%`} />
                <Skeleton variant="text" height={12} width={`${44 + ((i * 5) % 20)}%`} />
              </div>
              <Skeleton variant="text" height={14} />
              <Skeleton variant="pill" width={96} height={30} />
              <Skeleton variant="circle" width={32} height={32} />
            </div>
          ))}
        </div>
      </div>
      <div className={styles.loadingInspector} aria-hidden="true">
        <Skeleton variant="rect" width={48} height={48} />
        <Skeleton variant="text" width="70%" height={32} />
        <Skeleton variant="text" width="90%" height={14} />
        <Skeleton variant="text" width="75%" height={14} />
      </div>
    </div>
  );
}
