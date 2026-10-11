'use client';

import { WS2_COPY } from '../../copy/launch/ws2';
import { Button } from '../button';

/**
 * Locked Pro surface. No price, no checkout, no contact promise.
 * Joined and already-joined share one message.
 */
export function ComingWithPro({
  proName,
  title,
  pitch,
  joined,
  busy,
  error,
  onJoin,
}: {
  proName: string;
  title: string;
  pitch: string;
  joined: boolean;
  busy?: boolean;
  error?: boolean;
  onJoin: () => void;
}) {
  const fill = (template: string) => template.replaceAll('{proName}', proName);
  return (
    <section aria-label={fill(WS2_COPY.pro.badge)}>
      <p>{fill(WS2_COPY.pro.badge)}</p>
      <h1>{title}</h1>
      <p>{pitch}</p>
      <p>{fill(WS2_COPY.pro.status)}</p>
      {joined ? (
        <>
          <p>{fill(WS2_COPY.pro.joined)}</p>
          <p>{WS2_COPY.pro.joinedSub}</p>
        </>
      ) : (
        <Button tone="primary" onClick={onJoin} disabled={busy === true}>
          {busy === true ? WS2_COPY.pro.busy : fill(WS2_COPY.pro.cta)}
        </Button>
      )}
      {error === true ? <p role="alert">{WS2_COPY.pro.error}</p> : null}
      <a href="/later">{WS2_COPY.pro.secondary}</a>
    </section>
  );
}
