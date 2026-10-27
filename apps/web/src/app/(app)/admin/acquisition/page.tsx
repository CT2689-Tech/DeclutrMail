import type { Metadata } from 'next';
import { AdminAcquisitionReport } from '@/features/admin-acquisition/acquisition-report';

export const metadata: Metadata = {
  title: 'Source answers — DeclutrMail',
  robots: { index: false, follow: false },
};

export default function AdminAcquisitionPage() {
  return <AdminAcquisitionReport />;
}
