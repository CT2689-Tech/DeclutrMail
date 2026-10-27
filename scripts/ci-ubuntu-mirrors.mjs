import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Keep APT mirror priorities/constraints; change only the known failing origin. */
export function ubuntuMirrorFallback(source) {
  return source
    .split('\n')
    .map((line) =>
      line.replace(
        /^https?:\/\/azure\.archive\.ubuntu\.com\/ubuntu\/?(?=$|[ \t\r])/,
        'https://archive.ubuntu.com/ubuntu/',
      ),
    )
    .join('\n');
}

export function useUbuntuMirrorFallback({
  env = process.env,
  arch = process.arch,
  exists = existsSync,
  read = readFileSync,
  write = writeFileSync,
} = {}) {
  if (env.GITHUB_ACTIONS !== 'true' || env.RUNNER_OS !== 'Linux' || arch !== 'x64') return false;
  const file = '/etc/apt/apt-mirrors.txt';
  if (!exists(file)) return false;
  const source = read(file, 'utf8');
  const fallback = ubuntuMirrorFallback(source);
  if (fallback === source) return false;
  write(file, fallback);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const changed = useUbuntuMirrorFallback();
  console.log(
    changed
      ? 'Using official Ubuntu HTTPS mirror for dependency retry'
      : 'APT mirror list unchanged',
  );
}
