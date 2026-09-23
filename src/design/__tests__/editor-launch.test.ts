// @tests: auto-open-design-artifacts
import { describe, expect, it } from 'vitest';

import { appBundleFor, countVsCodeWindows } from '../editor-launch.js';

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

describe('countVsCodeWindows', () => {
  const renderer = (id: string, pid: number): string =>
    `${pid} /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Renderer).app/Contents/MacOS/Code Helper (Renderer) --type=renderer --vscode-window-config=vscode:${id} --enable-sandbox`;

  // Measured 2026-09-24: five renderers, two windows (`code --status` agreed).
  // A webview renderer carries its window's id, so the pen.dev canvas alone
  // would double-count a single window.
  it('counts distinct window ids, not renderer processes', () => {
    const out = [
      renderer('0ac60f1a-ed37-4564-a644-f0ca1d4ce4b6', 1),
      renderer('0ac60f1a-ed37-4564-a644-f0ca1d4ce4b6', 2),
      renderer('22209645-4931-46ec-85d1-a929b89ca644', 3),
      renderer('22209645-4931-46ec-85d1-a929b89ca644', 4),
      renderer('22209645-4931-46ec-85d1-a929b89ca644', 5),
    ].join('\n');
    expect(countVsCodeWindows(out)).toBe(2);
  });

  it('reads one window with a webview as one', () => {
    expect(countVsCodeWindows(`${renderer('a1', 1)}\n${renderer('a1', 2)}\n`)).toBe(1);
  });

  // pgrep -f matches its pattern anywhere in argv, so a shell grepping for it
  // shows up too; without a `vscode:<id>` value it is not a window.
  it('ignores a match that carries no window id', () => {
    expect(countVsCodeWindows('77 grep -- --vscode-window-config=[^ ]+\n')).toBe(0);
    expect(countVsCodeWindows('')).toBe(0);
  });
});
