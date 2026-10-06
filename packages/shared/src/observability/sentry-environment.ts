/** Development must opt in even when a pulled deployment env labels it production. */
export function isSentryEnvironmentEnabled(options: {
  runtimeEnvironment: string | undefined;
  deploymentEnvironment?: string | undefined;
  developmentOptIn: string | undefined;
}): boolean {
  const environment = options.deploymentEnvironment ?? options.runtimeEnvironment ?? 'development';
  return (
    (options.runtimeEnvironment !== 'development' && environment !== 'development') ||
    options.developmentOptIn === 'true'
  );
}
