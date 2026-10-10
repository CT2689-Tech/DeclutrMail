/** Account controls remain available even before Gmail is ready. */
export function isUserScopedAppPath(pathname: string): boolean {
  return [
    '/settings',
    '/settings/privacy',
    '/settings/help',
    '/billing',
    '/admin/security',
  ].includes(pathname);
}
