import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import '@/features/marketing/product-story/product-story.css';
import '@/features/marketing/comparison/comparison.css';

import { COMPARISONS, comparisonBySlug } from '@/features/marketing/comparison/comparison-data';
import { ComparisonDetailScreen } from '@/features/marketing/comparison/comparison-screen';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import { loadPricingFlags } from '@/features/marketing/pricing/load-pricing-flags';

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
    title: comparison.metaTitle ?? `${comparison.title} — compared, October 2026`,
    description: comparison.metaDescription ?? comparison.description,
    path: `/vs/${comparison.slug}`,
  });
}

export default async function ComparisonPage({ params }: ComparisonPageProps) {
  const { competitor } = await params;
  const comparison = comparisonBySlug(competitor);
  if (!comparison) notFound();

  const flags = await loadPricingFlags();
  return (
    <ComparisonDetailScreen
      comparison={comparison}
      pricingV2={flags.pricingV2}
      passEnabled={flags.passEnabled}
    />
  );
}
