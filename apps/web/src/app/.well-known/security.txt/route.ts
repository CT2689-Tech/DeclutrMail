import { securityContactEmail } from '@declutrmail/shared/copy/launch';

export function GET(): Response {
  const expires = new Date();
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  const body = [
    `Contact: mailto:${securityContactEmail()}`,
    `Expires: ${expires.toISOString()}`,
    'Preferred-Languages: en',
    'Canonical: https://declutrmail.com/.well-known/security.txt',
    '',
  ].join('\n');
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
