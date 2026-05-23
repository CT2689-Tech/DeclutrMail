/**
 * Vitest setup — runs once before every test file.
 *
 * Two things happen here:
 *
 *   1. `@testing-library/jest-dom` extends `expect` with DOM matchers
 *      (toBeInTheDocument, toHaveAttribute, etc.). Without this, tests
 *      that assert on rendered output have to do brittle string
 *      comparisons.
 *
 *   2. `afterEach` cleans up the DOM and resets any `fetch` stub so
 *      tests are properly isolated — no leaking handlers between
 *      cases.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetFetchStub } from './fetch-stub';

afterEach(() => {
  cleanup();
  resetFetchStub();
});
