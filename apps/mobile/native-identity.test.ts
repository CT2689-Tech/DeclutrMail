import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The native sign-in return link (ADR-0049) only works if five files written
// in four languages agree on the same few strings, and nothing compiles them
// together: a one-character drift ships a build whose sign-in opens the
// browser and never comes back. These tests read the files, not the config
// module, so they pin what the platforms will actually see.

const here = import.meta.dirname;
const repo = join(here, '..', '..');
const read = (...path: string[]) => readFileSync(join(here, ...path), 'utf8');
const readRepo = (...path: string[]) => readFileSync(join(repo, ...path), 'utf8');

function literal(source: string, pattern: RegExp, what: string): string {
  const match = source.match(pattern);
  if (!match?.[1]) throw new Error(`Could not find ${what}.`);
  return match[1];
}

const contract = readRepo('packages', 'shared', 'src', 'contracts', 'native-auth.ts');
const SCHEME = literal(contract, /NATIVE_APP_SCHEME = '([^']+)'/, 'NATIVE_APP_SCHEME');
const HOST = literal(contract, /RETURN_HOST = '([^']+)'/, 'RETURN_HOST');
const PATH = literal(contract, /RETURN_PATH = '([^']+)'/, 'RETURN_PATH');

const config = read('capacitor.config.ts');
const APP_ID = literal(config, /appId: '([^']+)'/, 'appId');

describe('app identity', () => {
  it('uses the scheme as the bundle id, the reverse-domain form RFC 8252 asks for', () => {
    expect(SCHEME).toBe('com.declutrmail.app');
    expect(APP_ID).toBe(SCHEME);
  });

  it('tells the web app it is in the shell with the token the web app looks for', () => {
    const shell = readRepo('apps', 'web', 'src', 'lib', 'native', 'shell.ts');
    expect(literal(config, /appendUserAgent: '([^']+)'/, 'appendUserAgent')).toBe(
      literal(shell, /NATIVE_SHELL_UA_TOKEN = '([^']+)'/, 'NATIVE_SHELL_UA_TOKEN'),
    );
  });
});

describe('iOS', () => {
  it('builds every configuration under the app id', () => {
    const ids = [
      ...read('ios', 'App', 'App.xcodeproj', 'project.pbxproj').matchAll(
        /PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g,
      ),
    ].map((match) => match[1]);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ids)).toEqual(new Set([APP_ID]));
  });

  it('registers exactly the return scheme', () => {
    const plist = read('ios', 'App', 'App', 'Info.plist');
    // The URL *name* also holds the app id, so read the schemes array itself.
    const schemes = literal(
      plist,
      /<key>CFBundleURLSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/,
      'CFBundleURLSchemes',
    );
    expect([...schemes.matchAll(/<string>([^<]+)<\/string>/g)].map((match) => match[1])).toEqual([
      SCHEME,
    ]);
  });

  it('hands opened URLs to Capacitor, which raises appUrlOpen', () => {
    const delegate = read('ios', 'App', 'App', 'SceneDelegate.swift');
    expect(delegate).toContain('openURLContexts');
    expect(delegate).toContain('SceneDelegateProxy.shared.scene(scene, openURLContexts');
  });
});

describe('Android', () => {
  it('builds under the app id', () => {
    const gradle = read('android', 'app', 'build.gradle');
    expect(literal(gradle, /namespace = "([^"]+)"/, 'namespace')).toBe(APP_ID);
    expect(literal(gradle, /applicationId "([^"]+)"/, 'applicationId')).toBe(APP_ID);
  });

  it('keeps the launcher activity in the package the namespace names', () => {
    const source = read(
      'android',
      'app',
      'src',
      'main',
      'java',
      ...APP_ID.split('.'),
      'MainActivity.java',
    );
    expect(literal(source, /^package ([\w.]+);/m, 'package')).toBe(APP_ID);
  });

  it('declares the scheme string the manifest uses', () => {
    const strings = read('android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
    expect(literal(strings, /name="package_name">([^<]+)</, 'package_name')).toBe(APP_ID);
    expect(literal(strings, /name="custom_url_scheme">([^<]+)</, 'custom_url_scheme')).toBe(SCHEME);
  });

  it('opens the app only for the exact return link', () => {
    const manifest = read('android', 'app', 'src', 'main', 'AndroidManifest.xml');
    const filter = literal(
      manifest,
      /(<intent-filter>(?:(?!<\/intent-filter>)[\s\S])*android\.intent\.action\.VIEW[\s\S]*?<\/intent-filter>)/,
      'VIEW intent filter',
    );
    expect(filter).toContain('android.intent.category.BROWSABLE');
    expect(filter).toContain('android.intent.category.DEFAULT');
    expect(filter).toContain('android:scheme="@string/custom_url_scheme"');
    expect(filter).toContain(`android:host="${HOST}"`);
    expect(filter).toContain(`android:pathPrefix="${PATH}"`);
  });

  it('keeps one task, so a return reaches the running activity instead of a second copy', () => {
    const manifest = read('android', 'app', 'src', 'main', 'AndroidManifest.xml');
    expect(manifest).toContain('android:launchMode="singleTask"');
  });
});

describe('plugins', () => {
  it('registers the two plugins sign-in needs on both platforms', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).toEqual(
      expect.arrayContaining(['@capacitor/app', '@capacitor/browser']),
    );
    const gradle = read('android', 'app', 'capacitor.build.gradle');
    expect(gradle).toContain("project(':capacitor-app')");
    expect(gradle).toContain("project(':capacitor-browser')");
    const spm = read('ios', 'App', 'CapApp-SPM', 'Package.swift');
    expect(spm).toContain('"CapacitorApp"');
    expect(spm).toContain('"CapacitorBrowser"');
  });
});
