import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/features/marketing/landing/landing.css'),
  'utf8',
);

/** Every animation in the hero's inbox-collapse sequence. */
const SEQUENCE = ['mail', 'sender', 'focus', 'confirm'] as const;

/** `animation: dm-mkt-<name> <duration>s <delay>s 1 both` → [duration, delay]. */
function timing(name: string): [number, number] {
  const match = css.match(new RegExp(`animation: dm-mkt-${name} ([\\d.]+)s ([\\d.]+)s 1 both;`));
  if (!match) throw new Error(`no one-shot animation declared for dm-mkt-${name}`);
  return [Number(match[1]), Number(match[2])];
}

/** The body of `@keyframes dm-mkt-<name>`. Throws if it is missing. */
function keyframes(name: string): string {
  const at = css.indexOf(`@keyframes dm-mkt-${name} {`);
  if (at < 0) throw new Error(`no @keyframes dm-mkt-${name}`);
  const body = css.slice(at);
  return body.slice(0, body.indexOf('\n}\n'));
}

describe('landing hero motion contract', () => {
  it('runs the sequence once instead of looping', () => {
    for (const name of SEQUENCE) {
      expect(css).not.toMatch(new RegExp(`dm-mkt-${name}[^;]*infinite`));
      expect(() => timing(name)).not.toThrow();
    }
  });

  // The hero ships with no Pause control. WCAG 2.2.2 allows that only while
  // the auto-playing motion ends within five seconds of starting.
  it('finishes within five seconds, so it needs no pause mechanism', () => {
    for (const name of SEQUENCE) {
      const [duration, delay] = timing(name);
      expect(duration + delay).toBeLessThanOrEqual(5);
    }
  });

  it('shares one timeline across every piece', () => {
    const timings = SEQUENCE.map((name) => timing(name).join('/'));
    expect(new Set(timings).size).toBe(1);
  });

  it('settles on the senders and the confirm card, with the emails gone', () => {
    const end = (name: string) => keyframes(name).match(/100% \{[^}]*\}/)?.[0] ?? '';
    expect(end('mail')).toMatch(/opacity:\s*0;/);
    expect(end('sender')).toMatch(/opacity:\s*1;/);
    expect(end('confirm')).toMatch(/opacity:\s*1;/);
  });

  // Reduced motion drops the sequence entirely, which is only correct while
  // the base (un-animated) styles are the final frame.
  it('shows the final frame, not the first, under reduced motion', () => {
    expect(css).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{\s*\.dm-mkt-inbox \*,\s*\.dm-mkt-inbox \*::before\s*\{\s*animation: none !important;/,
    );
    const baseMail = css.slice(css.indexOf('.dm-mkt-inbox-mail {'));
    expect(baseMail.slice(0, baseMail.indexOf('}'))).toMatch(/opacity:\s*0;/);
  });
});
