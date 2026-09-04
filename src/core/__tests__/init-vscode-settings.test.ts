// @tests: pendev-ui-design-phase
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PENCIL_VIEW_TYPE } from '../design-artifact-names.js';
import {
  EDITOR_ASSOCIATIONS_KEY,
  PEN_GLOB,
  VSCODE_SETTINGS_PATH,
  ensureVscodeEditorAssociation,
  renderVscodeSettingsOutcome,
} from '../init-vscode-settings.js';

// A real directory per case: the filesystem is a boundary the house rules say to
// use for real, so every case writes actual JSON rather than scripting a reader.
let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'init-vscode-'));
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

/** The settings file's parsed contents. */
function settings(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repo, VSCODE_SETTINGS_PATH), 'utf8')) as Record<
    string,
    unknown
  >;
}

/** Write `.vscode/settings.json` with the given raw text, creating the dir. */
function given(raw: string): void {
  mkdirSync(join(repo, '.vscode'), { recursive: true });
  writeFileSync(join(repo, VSCODE_SETTINGS_PATH), raw);
}

describe('ensureVscodeEditorAssociation — from nothing', () => {
  it('creates the file and the association, directory included', () => {
    expect(ensureVscodeEditorAssociation(repo)).toEqual({ kind: 'created' });
    expect(settings()).toEqual({ [EDITOR_ASSOCIATIONS_KEY]: { [PEN_GLOB]: PENCIL_VIEW_TYPE } });
  });

  it('is idempotent — a second run changes nothing', () => {
    ensureVscodeEditorAssociation(repo);
    const before = readFileSync(join(repo, VSCODE_SETTINGS_PATH), 'utf8');
    expect(ensureVscodeEditorAssociation(repo)).toEqual({ kind: 'unchanged' });
    expect(readFileSync(join(repo, VSCODE_SETTINGS_PATH), 'utf8')).toBe(before);
  });
});

describe('ensureVscodeEditorAssociation — merging into a file the consumer owns', () => {
  // The whole reason this is a merge and not a scaffold-only template copy: the
  // repos that already have a settings.json are the repos being worked in, which
  // are the repos with `.pen` files in them.
  it('keeps every unrelated key', () => {
    given(JSON.stringify({ 'liveServer.settings.port': 5501, 'editor.tabSize': 2 }));
    expect(ensureVscodeEditorAssociation(repo)).toEqual({ kind: 'added' });
    expect(settings()).toEqual({
      'liveServer.settings.port': 5501,
      'editor.tabSize': 2,
      [EDITOR_ASSOCIATIONS_KEY]: { [PEN_GLOB]: PENCIL_VIEW_TYPE },
    });
  });

  it('keeps other globs inside an existing associations block', () => {
    given(JSON.stringify({ [EDITOR_ASSOCIATIONS_KEY]: { '*.csv': 'gc-excelviewer-csv-preview' } }));
    expect(ensureVscodeEditorAssociation(repo)).toEqual({ kind: 'added' });
    expect(settings()[EDITOR_ASSOCIATIONS_KEY]).toEqual({
      '*.csv': 'gc-excelviewer-csv-preview',
      [PEN_GLOB]: PENCIL_VIEW_TYPE,
    });
  });

  // An operator pointing `.pen` somewhere else has made a decision — perhaps at
  // a fork of the extension, perhaps deliberately at the text editor. Silently
  // overwriting it would undo that with no trace.
  it('never overwrites a foreign .pen association, and reports what it found', () => {
    given(
      JSON.stringify({
        [EDITOR_ASSOCIATIONS_KEY]: { [PEN_GLOB]: 'workbench.editors.files.textFileEditor' },
      }),
    );
    expect(ensureVscodeEditorAssociation(repo)).toEqual({
      kind: 'conflict',
      found: 'workbench.editors.files.textFileEditor',
    });
    expect(settings()[EDITOR_ASSOCIATIONS_KEY]).toEqual({
      [PEN_GLOB]: 'workbench.editors.files.textFileEditor',
    });
  });
});

describe('ensureVscodeEditorAssociation — a file it must not rewrite', () => {
  // VS Code accepts comments in settings.json. JSON.parse does not, and a file
  // this cannot read is a file it has no business replacing.
  it('leaves a jsonc file untouched and says so', () => {
    const raw = '{\n  // the port the demo server uses\n  "liveServer.settings.port": 5501\n}\n';
    given(raw);
    const out = ensureVscodeEditorAssociation(repo);
    expect(out.kind).toBe('blocked');
    expect(readFileSync(join(repo, VSCODE_SETTINGS_PATH), 'utf8')).toBe(raw);
  });

  it.each([
    ['a JSON array', '[]'],
    ['a bare string', '"nope"'],
  ])('leaves %s untouched and says so', (_label, raw) => {
    given(raw);
    const out = ensureVscodeEditorAssociation(repo);
    expect(out.kind).toBe('blocked');
    expect(readFileSync(join(repo, VSCODE_SETTINGS_PATH), 'utf8')).toBe(raw);
  });

  it('refuses a non-object associations key rather than replacing it', () => {
    const raw = JSON.stringify({ [EDITOR_ASSOCIATIONS_KEY]: 'nonsense' });
    given(raw);
    const out = ensureVscodeEditorAssociation(repo);
    expect(out.kind).toBe('blocked');
    expect(readFileSync(join(repo, VSCODE_SETTINGS_PATH), 'utf8')).toBe(raw);
  });
});

describe('ensureVscodeEditorAssociation — a filesystem that refuses', () => {
  // `noldor init` wraps its whole scaffold in one try/catch that prints
  // `init failed:` and exits 1. A throw here would therefore cost a consumer the
  // rollout marker, the lefthook wiring report and the indirection baseline
  // seed — all over a cosmetic editor association.
  it('reports an unwritable .vscode as blocked instead of throwing', () => {
    // A FILE where the directory must go: mkdirSync then fails with ENOTDIR,
    // which is a real refusal rather than a permission bit root could ignore.
    writeFileSync(join(repo, '.vscode'), 'not a directory');
    const out = ensureVscodeEditorAssociation(repo);
    expect(out.kind).toBe('blocked');
    expect(out).toMatchObject({ reason: expect.stringMatching(/\S/) as unknown as string });
  });

  it('reports a read-only .vscode directory as blocked instead of throwing', () => {
    const dir = join(repo, '.vscode');
    mkdirSync(dir);
    chmodSync(dir, 0o500);
    try {
      // skipIf is not usable here: the condition (running as root, where the
      // mode is ignored) is only knowable at run time. Assert the contract that
      // holds either way — never a throw — and the outcome when the mode bites.
      const out = ensureVscodeEditorAssociation(repo);
      expect(['blocked', 'created']).toContain(out.kind);
    } finally {
      chmodSync(dir, 0o700);
    }
  });
});

describe('renderVscodeSettingsOutcome', () => {
  // Init's log must not narrate a no-op — the summary is already long.
  it('says nothing when there was nothing to do', () => {
    expect(renderVscodeSettingsOutcome({ kind: 'unchanged' })).toBeUndefined();
  });

  it.each([
    ['created', { kind: 'created' } as const],
    ['added', { kind: 'added' } as const],
  ])('names the path and the view type on %s', (_label, outcome) => {
    const line = renderVscodeSettingsOutcome(outcome);
    expect(line).toContain(VSCODE_SETTINGS_PATH);
    expect(line).toContain(PENCIL_VIEW_TYPE);
  });

  it('warns on a conflict, naming the editor it left in place', () => {
    const line = renderVscodeSettingsOutcome({ kind: 'conflict', found: 'someone.else' });
    expect(line).toContain('warn');
    expect(line).toContain('someone.else');
  });

  it('warns on a blocked file, passing the reason through', () => {
    const line = renderVscodeSettingsOutcome({ kind: 'blocked', reason: 'it is a teapot' });
    expect(line).toContain('warn');
    expect(line).toContain('it is a teapot');
  });
});
