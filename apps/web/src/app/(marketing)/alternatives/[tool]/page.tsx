import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import '@/features/marketing/landing/landing.css';
import '@/features/marketing/comparison/comparison.css';

import { AlternativesScreen } from '@/features/marketing/comparison/alternatives-screen';
import {
  ALTERNATIVES_SLUGS,
  alternativesFor,
} from '@/features/marketing/comparison/comparison-data';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

interface AlternativesPageProps {
  readonly params: Promise<{ tool: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return ALTERNATIVES_SLUGS.map((tool) => ({ tool }));
}

export async function generateMetadata({ params }: AlternativesPageProps): Promise<Metadata> {
  const { tool } = await params;
  const page = alternativesFor(tool);
  if (!page) return {};

  return marketingPageMetadata({
    // Titled for the query, without "best". The page deliberately does
    // not rank its entries, so promising a winner in the title would
    // contradict the badge under it.
    title: `${page.subject.name} alternatives, compared honestly`,
    description: `Source-backed alternatives to ${page.subject.name} for email cleanup. What each tool is for, when to stay with ${page.subject.name}, and where DeclutrMail fits. No rankings, no affiliate links.`,
    path: `/alternatives/${page.slug}`,
  });
}

export default async function AlternativesRoute({ params }: AlternativesPageProps) {
  const { tool } = await params;
  const page = alternativesFor(tool);
  if (!page) notFound();

  return <AlternativesScreen page={page} />;
}
