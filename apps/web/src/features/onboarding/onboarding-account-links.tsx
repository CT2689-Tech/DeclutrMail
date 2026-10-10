import Link from 'next/link';
import { tokens } from '@declutrmail/shared';

export function OnboardingAccountLinks() {
  return (
    <nav
      aria-label="Account and scan help"
      style={{
        display: 'flex',
        gap: 16,
        flexWrap: 'wrap',
        justifyContent: 'center',
        marginTop: 24,
      }}
    >
      <Link href="/settings" style={{ color: tokens.color.fgMuted }}>
        Settings
      </Link>
      <Link href="/billing" style={{ color: tokens.color.fgMuted }}>
        Billing
      </Link>
      <Link href="/settings/help" style={{ color: tokens.color.fgMuted }}>
        Get help
      </Link>
    </nav>
  );
}
