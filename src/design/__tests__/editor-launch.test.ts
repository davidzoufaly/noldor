// @tests: auto-open-design-artifacts
import { describe, expect, it } from 'vitest';

import { appBundleFor } from '../editor-launch.js';

describe('appBundleFor', () => {
  it.each([
    [
      'the VS Code shim inside its bundle',
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      '/Applications/Visual Studio Code.app',
    ],
    [
      'an Insiders install',
      '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code',
      '/Applications/Visual Studio Code - Insiders.app',
    ],
    [
      'a fork in a non-standard location',
      '/Users/me/Apps/Cursor.app/Contents/Resources/app/bin/code',
      '/Users/me/Apps/Cursor.app',
    ],
    ['the bundle directory itself', '/Applications/Code.app', '/Applications/Code.app'],
  ])('finds the bundle for %s', (_label, bin, expected) => {
    expect(appBundleFor(bin)).toBe(expected);
  });

  it.each([
    ['a Linux system install', '/usr/bin/code'],
    ['a bare relative name', 'code'],
    ['the filesystem root', '/'],
  ])('returns undefined for %s — no bundle, so no background launch', (_label, bin) => {
    expect(appBundleFor(bin)).toBeUndefined();
  });

  // The walk must terminate on every input, since it runs inside a hook.
  it('terminates on a path with no bundle however deep', () => {
    expect(appBundleFor(`/${'a/'.repeat(200)}code`)).toBeUndefined();
  });
});
