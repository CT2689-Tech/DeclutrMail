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
import { useActionFeedbackStore } from '@/features/undo/feedback-store';
import { cleanup, screen, waitFor } from '@testing-library/react';
import type { ByRoleOptions } from '@testing-library/dom';
import { resetFetchStub } from './fetch-stub';

// Irreversible sheets use role=alertdialog. Testing Library matches that
// role exactly, so existing "is the sheet open" queries for dialog would
// miss them. A dialog query matches either role; alertdialog stays exact.
const getByRole = screen.getByRole.bind(screen);
const queryByRole = screen.queryByRole.bind(screen);
const getAllByRole = screen.getAllByRole.bind(screen);
const queryAllByRole = screen.queryAllByRole.bind(screen);
const findByRole = screen.findByRole.bind(screen);

function isDialog(role: unknown): role is 'dialog' {
  return role === 'dialog';
}

screen.getByRole = ((role: string, options?: ByRoleOptions) => {
  if (!isDialog(role)) return getByRole(role, options);
  return queryByRole('alertdialog', options) ?? getByRole('dialog', options);
}) as typeof screen.getByRole;

screen.queryByRole = ((role: string, options?: ByRoleOptions) => {
  if (!isDialog(role)) return queryByRole(role, options);
  return queryByRole('alertdialog', options) ?? queryByRole('dialog', options);
}) as typeof screen.queryByRole;

screen.getAllByRole = ((role: string, options?: ByRoleOptions) => {
  if (!isDialog(role)) return getAllByRole(role, options);
  const all = [...queryAllByRole('alertdialog', options), ...queryAllByRole('dialog', options)];
  if (all.length === 0) return getAllByRole('dialog', options);
  return all;
}) as typeof screen.getAllByRole;

screen.queryAllByRole = ((role: string, options?: ByRoleOptions) => {
  if (!isDialog(role)) return queryAllByRole(role, options);
  return [...queryAllByRole('alertdialog', options), ...queryAllByRole('dialog', options)];
}) as typeof screen.queryAllByRole;

screen.findByRole = ((role: string, options?: ByRoleOptions, waitOptions?: object) => {
  if (!isDialog(role)) return findByRole(role, options, waitOptions);
  return waitFor(() => {
    const found = queryByRole('alertdialog', options) ?? queryByRole('dialog', options);
    if (!found) throw new Error('Unable to find a dialog');
    return found;
  }, waitOptions);
}) as typeof screen.findByRole;

afterEach(() => {
  useActionFeedbackStore.setState({ scopes: {} });
  cleanup();
  resetFetchStub();
});
