/// <reference lib="dom" />

import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * Assertions shared by the authenticated (`a11y-smoke`) and public
 * (`a11y-public`) accessibility lanes.
 *
 * Extracted rather than duplicated: the two lanes must apply the SAME
 * bar, and a copied threshold is one that drifts.
 */

/**
 * Fail on any serious or critical WCAG 2.1 A/AA violation, reporting
 * every offending node so a failure is actionable without a rerun.
 */
export async function expectNoBlockingAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  const report = blocking
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n` +
        violation.nodes
          .map((node) => `  ${node.target.join(' ')}: ${node.failureSummary}`)
          .join('\n'),
    )
    .join('\n\n');

  expect(blocking, report || 'no serious or critical axe violations').toEqual([]);
}

/**
 * The page must never scroll sideways.
 *
 * This repo has a documented history of horizontal-overflow findings
 * derived from reading CSS rather than rendering it, several of which
 * needed a real viewport to settle either way. This measures the
 * rendered document, so it settles them.
 */
export async function expectNoViewportOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(
    overflow.documentWidth,
    `document width ${overflow.documentWidth}px exceeds viewport ${overflow.viewportWidth}px`,
  ).toBeLessThanOrEqual(overflow.viewportWidth + 1);
}
