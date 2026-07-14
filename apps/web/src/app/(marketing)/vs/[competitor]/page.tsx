import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import '@/features/marketing/landing/landing.css';
import '@/features/marketing/comparison/comparison.css';

import { COMPARISONS, comparisonBySlug } from '@/features/marketing/comparison/comparison-data';
import { ComparisonDetailScreen } from '@/features/marketing/comparison/comparison-screen';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

interface ComparisonPageProps {
  readonly params: Promise<{ competitor: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return COMPARISONS.map((comparison) => ({ competitor: comparison.slug }));
}

export async function generateMetadata({ params }: ComparisonPageProps): Promise<Metadata> {
  const { competitor } = await params;
  const comparison = comparisonBySlug(competitor);
  if (!comparison) return {};

  return marketingPageMetadata({
    title: `${comparison.title} — honest 2026 comparison`,
    description: comparison.description,
    path: `/vs/${comparison.slug}`,
  });
}

export default async function ComparisonPage({ params }: ComparisonPageProps) {
  const { competitor } = await params;
  const comparison = comparisonBySlug(competitor);
  if (!comparison) notFound();

  return <ComparisonDetailScreen comparison={comparison} />;
}
