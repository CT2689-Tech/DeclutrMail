import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/features/marketing/landing/landing.css'),
  'utf8',
);

const DEMO_ANIMATIONS = ['verbs', 'press', 'preview', 'result'] as const;

/** `animation: dm-mkt-<name> <duration>s <delay>s 1 both` → [duration, delay]. */
function timing(name: string): [number, number] {
  const match = css.match(new RegExp(`animation: dm-mkt-${name} ([\\d.]+)s ([\\d.]+)s 1 both;`));
  if (!match) throw new Error(`no one-shot animation declared for dm-mkt-${name}`);
  return [Number(match[1]), Number(match[2])];
}

describe('landing motion contract', () => {
  it('runs the illustrative action once instead of looping indefinitely', () => {
    for (const animation of DEMO_ANIMATIONS) {
      expect(css).not.toMatch(new RegExp(`dm-mkt-${animation}[^;]*infinite`));
      expect(() => timing(animation)).not.toThrow();
    }
  });

  // The demo ships with no Pause control. WCAG 2.2.2 allows that only while
  // the auto-playing motion ends within five seconds of starting.
  it('finishes within five seconds, so it needs no pause mechanism', () => {
    for (const animation of DEMO_ANIMATIONS) {
      const [duration, delay] = timing(animation);
      expect(duration + delay).toBeLessThanOrEqual(5);
    }
  });

  it('shares one timeline across every frame', () => {
    const timings = DEMO_ANIMATIONS.map((animation) => timing(animation).join('/'));
    expect(new Set(timings).size).toBe(1);
  });

  it('settles on the result frame, with the decisions and preview gone', () => {
    const finalFrame = (name: string) => {
      const keyframes = css.slice(css.indexOf(`@keyframes dm-mkt-${name} {`));
      return keyframes.slice(0, keyframes.indexOf('\n}\n')).match(/100% \{[^}]*\}/)?.[0] ?? '';
    };
    expect(finalFrame('result')).toMatch(/opacity:\s*1;/);
    expect(finalFrame('verbs')).toMatch(/opacity:\s*0;/);
    expect(finalFrame('preview')).toMatch(/opacity:\s*0;/);
  });
});
