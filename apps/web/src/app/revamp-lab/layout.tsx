import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// THROWAWAY lab route (DQ15). Public but never indexed, never linked
// from product nav. Delete this folder after the direction pick hardens.
export const metadata: Metadata = {
  title: 'Revamp Lab — DeclutrMail',
  robots: { index: false, follow: false },
};

export default function RevampLabLayout({ children }: { children: ReactNode }) {
  return children;
}
