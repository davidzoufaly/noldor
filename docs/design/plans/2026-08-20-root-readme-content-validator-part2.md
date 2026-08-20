# Root README Content Validator Implementation Plan — Part 2: Command Resolution

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** extend `pnpm noldor checks readme` so it also reports every command the root `README.md` quotes that does not resolve against the CLI manifest or root `package.json` `scripts`.

**Architecture:** Two more pure units in `src/docs/readme-content.ts` — a MANIFEST-unaware lexer and a resolver that reads the manifest's own leaf/group shape — then `checkReadme` composes their findings alongside the surface findings Part 1 shipped.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), vitest, `flattenManifest` from `src/cli/manifest.ts`.

**Prerequisite:** Part 1 (`docs/design/plans/2026-08-20-root-readme-content-validator-part1.md`) — this part extends the module and the `checkReadme` façade it created.

**Ships:** the same command, now catching a renamed subcommand or a missing script that the README still quotes.

---

## File Structure

- `src/docs/readme-content.ts` — **Modify.** Add `parseReadmeCommands` and `resolveCommands`; extend `checkReadme` to read `package.json` and merge command findings.
- `src/docs/__tests__/readme-content.test.ts` — **Modify.** Add lexer, resolver, and extended-façade cases.

---

## Task 1: Command extraction

**Files:**
- Modify: `src/docs/readme-content.ts`
- Test: `src/docs/__tests__/readme-content.test.ts`

- [ ] **Step 1: Append the failing tests for `parseReadmeCommands`.**

Extend the import to include `parseReadmeCommands` and append:

```ts
describe('parseReadmeCommands', () => {
  it('reads fenced and inline commands, keeping only pnpm', async () => {
    const cmds = parseReadmeCommands(
      ['```bash', 'pnpm noldor doctor', 'node bin/x.mjs', '```', 'run `pnpm test` now'].join('\n'),
    );
    expect(cmds.map((c) => c.argv.join(' '))).toEqual(['pnpm noldor doctor', 'pnpm test']);
    expect(cmds[0]?.line).toBe(2);
    expect(cmds[1]?.line).toBe(5);
  });

  it('strips a prompt prefix and a trailing comment', () => {
    const cmds = parseReadmeCommands(['```bash', '$ pnpm noldor init  # scaffold', '```'].join('\n'));
    expect(cmds).toHaveLength(1);
    expect(cmds[0]?.argv).toEqual(['pnpm', 'noldor', 'init']);
  });

  it('splits on shell operators', () => {
    const cmds = parseReadmeCommands(['```bash', 'pnpm build && pnpm test', '```'].join('\n'));
    expect(cmds.map((c) => c.argv.join(' '))).toEqual(['pnpm build', 'pnpm test']);
  });

  it('joins a backslash continuation and attributes the first line', () => {
    const cmds = parseReadmeCommands(['```bash', 'pnpm noldor \\', '  doctor', '```'].join('\n'));
    expect(cmds).toHaveLength(1);
    expect(cmds[0]?.argv).toEqual(['pnpm', 'noldor', 'doctor']);
    expect(cmds[0]?.line).toBe(2);
  });

  it('drops a command carrying a placeholder token', () => {
    const cmds = parseReadmeCommands(['```bash', 'pnpm noldor cr orchestrate --slug <slug>', '```'].join('\n'));
    expect(cmds).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it FAILS.**

```bash
npx vitest run src/docs/__tests__/readme-content.test.ts
```

Expected output: collection fails on the missing `parseReadmeCommands` export.

- [ ] **Step 3: Add the extractor to `src/docs/readme-content.ts`.**

Append:

```ts
/** Leading shell prompt in a documented command. */
const PROMPT_RE = /^\s*[$>]\s+/;
/** A token documenting a shape rather than an invocation, e.g. `<slug>`. */
const PLACEHOLDER_RE = /[<>]/;
const INLINE_CODE_RE = /`([^`]+)`/g;
const FENCE_RE = /^\s*```/;

/** One command as written in the README. */
export interface QuotedCommand {
  /** The command as written, for diagnostics. */
  readonly raw: string;
  /** Whitespace-split tokens, prompt prefix and comment removed. */
  readonly argv: readonly string[];
  /** 1-based line in `README.md`. */
  readonly line: number;
}

/**
 * Lex every `pnpm` command the README quotes, from fenced blocks and inline
 * code alike.
 *
 * Deliberately MANIFEST-unaware: it cannot know whether the token after a group
 * is a subcommand or a positional argument, so it does not try. Resolution owns
 * that, reading the manifest's own shape.
 *
 * @param content - Raw `README.md` body
 * @returns One entry per lexed `pnpm` command, in document order
 */
export function parseReadmeCommands(content: string): readonly QuotedCommand[] {
  const out: QuotedCommand[] = [];

  const emit = (text: string, line: number): void => {
    const commentIndex = text.indexOf('#');
    const withoutComment = commentIndex === -1 ? text : text.slice(0, commentIndex);
    for (const piece of withoutComment.replace(PROMPT_RE, '').split(/&&|\|\||;|\|/)) {
      const argv = piece.trim().split(/\s+/).filter((t) => t.length > 0);
      if (argv[0] !== 'pnpm') continue;
      if (argv.some((t) => PLACEHOLDER_RE.test(t))) continue;
      out.push({ raw: piece.trim(), argv, line });
    }
  };

  const lines = content.split('\n');
  let inFence = false;
  let pending = '';
  let pendingLine = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      pending = '';
      continue;
    }
    if (inFence) {
      const trimmed = line.replace(/\s+$/, '');
      if (trimmed.endsWith('\\')) {
        if (pending === '') pendingLine = i + 1;
        pending += `${trimmed.slice(0, -1)} `;
        continue;
      }
      const at = pending === '' ? i + 1 : pendingLine;
      const full = pending + line;
      pending = '';
      emit(full, at);
      continue;
    }
    const re = new RegExp(INLINE_CODE_RE.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(line)) !== null) {
      emit(match[1] ?? '', i + 1);
    }
  }

  return out;
}
```

- [ ] **Step 4: Run the test to verify it PASSES.**

```bash
npx vitest run src/docs/__tests__/readme-content.test.ts
```

Expected output: `Test Files  1 passed (1)` with 20 passing tests.

- [ ] **Step 5: Commit.**

```bash
git add src/docs/readme-content.ts src/docs/__tests__/readme-content.test.ts
git commit -m "feat(docs): lex the pnpm commands the README quotes" -m "Noldor-FD: root-readme-content-validator"
```

---

---

## Task 2: Command resolution

**Files:**
- Modify: `src/docs/readme-content.ts`
- Test: `src/docs/__tests__/readme-content.test.ts`

- [ ] **Step 1: Append the failing tests for `resolveCommands`.**

Extend the import to include `resolveCommands` and append:

```ts
describe('resolveCommands', () => {
  const manifest = new Set(['doctor', 'init', 'docs architecture', 'validate features']);
  const scripts = new Set(['test', 'build']);
  const parse = (body: string) => parseReadmeCommands(['```bash', body, '```'].join('\n'));

  it('accepts a leaf group, a group with a sub, and a known script', () => {
    const cmds = parse('pnpm noldor doctor');
    expect(resolveCommands(cmds, manifest, scripts)).toEqual([]);
    expect(resolveCommands(parse('pnpm noldor docs architecture'), manifest, scripts)).toEqual([]);
    expect(resolveCommands(parse('pnpm test'), manifest, scripts)).toEqual([]);
  });

  it('skips flag tokens wherever they sit', () => {
    expect(resolveCommands(parse('pnpm noldor docs architecture --check'), manifest, scripts)).toEqual([]);
    expect(resolveCommands(parse('pnpm noldor --help'), manifest, scripts)).toEqual([]);
  });

  it('reports a bad subcommand but treats a leaf group extra token as positional', () => {
    const bad = resolveCommands(parse('pnpm noldor docs typo'), manifest, scripts);
    expect(bad).toHaveLength(1);
    expect(bad[0]?.message).toContain('docs typo');
    expect(resolveCommands(parse('pnpm noldor doctor extra'), manifest, scripts)).toEqual([]);
  });

  it('validates pnpm run and ignores package-manager passthrough verbs', () => {
    const bad = resolveCommands(parse('pnpm run nope'), manifest, scripts);
    expect(bad).toHaveLength(1);
    expect(bad[0]?.message).toContain('nope');
    expect(resolveCommands(parse('pnpm add -D @scope/pkg'), manifest, scripts)).toEqual([]);
    expect(resolveCommands(parse('pnpm install'), manifest, scripts)).toEqual([]);
  });

  it('reports every quoted script when scripts is empty but skips when it is null', () => {
    expect(resolveCommands(parse('pnpm test'), manifest, new Set())).toHaveLength(1);
    expect(resolveCommands(parse('pnpm test'), manifest, null)).toEqual([]);
  });

  it('deduplicates a command quoted more than once, citing the first line', () => {
    const body = ['```bash', 'pnpm noldor docs typo', 'pnpm noldor docs typo', '```'].join('\n');
    const found = resolveCommands(parseReadmeCommands(body), manifest, scripts);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('README.md:2');
  });
});
```

- [ ] **Step 2: Run the test to verify it FAILS.**

```bash
npx vitest run src/docs/__tests__/readme-content.test.ts
```

Expected output: collection fails on the missing `resolveCommands` export.

- [ ] **Step 3: Add the resolver to `src/docs/readme-content.ts`.**

Append:

```ts
/**
 * `pnpm` verbs whose arguments are package specifiers or external binaries
 * rather than repo-owned names, so nothing local can resolve them.
 */
const PM_PASSTHROUGH: ReadonlySet<string> = new Set(['add', 'install', 'dlx', 'exec']);

/** One thing the README claims that does not resolve. */
export interface Finding {
  readonly message: string;
}

/**
 * Resolve every lexed command against the manifest and the root scripts.
 *
 * Direction is README → registry only: a manifest entry the README never
 * mentions is not a finding, because `## CLI reference` declares itself a
 * non-exhaustive subset.
 *
 * The group branch reads the manifest's own leaf/group shape rather than
 * falling back from a longest match — a fallback cannot tell a positional
 * argument from a mistyped subcommand, and this can.
 *
 * @param cmds - From {@link parseReadmeCommands}
 * @param manifestCommands - `flattenManifest()` leaf command strings
 * @param scriptNames - Root script names; empty means none declared, `null`
 *   means the source was unavailable and script resolution is skipped
 * @returns One finding per distinct unresolved command, citing its first line
 */
export function resolveCommands(
  cmds: readonly QuotedCommand[],
  manifestCommands: ReadonlySet<string>,
  scriptNames: ReadonlySet<string> | null,
): readonly Finding[] {
  const leafGroups = new Set<string>();
  const subGroups = new Set<string>();
  for (const command of manifestCommands) {
    const space = command.indexOf(' ');
    if (space === -1) leafGroups.add(command);
    else subGroups.add(command.slice(0, space));
  }

  const findings: Finding[] = [];
  const seen = new Set<string>();
  const report = (key: string, message: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ message });
  };

  for (const cmd of cmds) {
    const words = cmd.argv.filter((t) => !t.startsWith('-'));
    const verb = words[1];
    if (verb === undefined || PM_PASSTHROUGH.has(verb)) continue;
    const at = `README.md:${cmd.line}`;

    if (verb === 'run') {
      const name = words[2];
      if (name === undefined || scriptNames === null) continue;
      if (!scriptNames.has(name)) {
        report(`run ${name}`, `${at}: \`pnpm run ${name}\` — no such script in root package.json`);
      }
      continue;
    }

    if (verb === 'noldor') {
      const group = words[2];
      if (group === undefined) continue; // `pnpm noldor --help`
      const sub = words[3];
      if (subGroups.has(group)) {
        if (sub === undefined) {
          report(`noldor ${group}`, `${at}: \`pnpm noldor ${group}\` — needs a subcommand`);
        } else if (!manifestCommands.has(`${group} ${sub}`)) {
          report(
            `noldor ${group} ${sub}`,
            `${at}: \`pnpm noldor ${group} ${sub}\` — no such subcommand`,
          );
        }
        continue;
      }
      if (leafGroups.has(group)) continue; // any further token is a positional
      report(`noldor ${group}`, `${at}: \`pnpm noldor ${group}\` — no such command group`);
      continue;
    }

    if (scriptNames === null) continue;
    if (!scriptNames.has(verb)) {
      report(`script ${verb}`, `${at}: \`pnpm ${verb}\` — no such script in root package.json`);
    }
  }

  return findings;
}
```

- [ ] **Step 4: Run the test to verify it PASSES.**

```bash
npx vitest run src/docs/__tests__/readme-content.test.ts
```

Expected output: `Test Files  1 passed (1)` with 26 passing tests.

- [ ] **Step 5: Commit.**

```bash
git add src/docs/readme-content.ts src/docs/__tests__/readme-content.test.ts
git commit -m "feat(docs): resolve README commands against the manifest and scripts" -m "Noldor-FD: root-readme-content-validator"
```

---

---

## Task 3: Merge command findings into `checkReadme`

**Files:**
- Modify: `src/docs/readme-content.ts`
- Test: `src/docs/__tests__/readme-content.test.ts`

- [ ] **Step 1: Append the failing tests for the extended façade.**

Append to the existing `describe('checkReadme', …)` block:

```ts
  it('reports a quoted command that does not resolve', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', '`pnpm noldor nosuchgroup`');
    await write(root, 'package.json', '{}');
    const report = await checkReadme(root);
    expect(report.status).toBe('findings');
    expect(report.findings[0]?.message).toContain('nosuchgroup');
  });

  it('notes an unreadable package.json and still checks surfaces', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', '`pnpm test`');
    await write(root, 'package.json', 'not json');
    const report = await checkReadme(root);
    expect(report.notes.some((n) => n.includes('package.json'))).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.status).toBe('ok');
  });

  it('reports a quoted script when package.json declares none', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', '`pnpm test`');
    await write(root, 'package.json', '{}');
    const report = await checkReadme(root);
    expect(report.status).toBe('findings');
    expect(report.findings[0]?.message).toContain('pnpm test');
  });
```

- [ ] **Step 2: Run the test to verify it FAILS.**

```bash
npx vitest run src/docs/__tests__/readme-content.test.ts
```

Expected output: the three new cases fail — `checkReadme` currently returns only surface findings and never reads `package.json`, so `status` is `ok` and `notes` is empty.

- [ ] **Step 3: Extend `checkReadme` in `src/docs/readme-content.ts`.**

Add `import { flattenManifest } from '../cli/manifest.js';` to the imports. Replace the body of `checkReadme` with the version below. Note the second `readFile` is deliberately unguarded: `reached.readme === 'ok'` already proves the file was read once in this same call, so a throw here would be a genuine invariant violation rather than an expected I/O failure — exactly the class the never-rejects contract does not swallow.

```ts
export async function checkReadme(cwd: string = process.cwd()): Promise<ReadmeReport> {
  // The walk is the single place README.md is read, and the single place its
  // readability is decided — so absence is classified there, not re-derived.
  const reached = await reachableTargets(cwd);
  if (reached.readme !== 'ok') {
    return { status: 'absent', findings: [], notes: [...reached.notes] };
  }
  const readme = await readFile(join(cwd, 'README.md'), 'utf8');

  const notes: string[] = [...reached.notes];
  let scriptNames: ReadonlySet<string> | null = null;
  try {
    const parsed = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    // An absent `scripts` map means the valid script set is EMPTY, not unknown.
    scriptNames = new Set(Object.keys(parsed.scripts ?? {}));
  } catch {
    notes.push('root package.json missing or invalid — script resolution skipped');
  }

  const manifestCommands = new Set(flattenManifest().map((leaf) => leaf.command));
  const commandFindings = resolveCommands(
    parseReadmeCommands(readme),
    manifestCommands,
    scriptNames,
  );

  const surfaceFindings = unreachableSurfaces(await enumerateDocSurfaces(cwd), reached).map(
    (surface) => ({
      message: `${surface}/ holds documentation but no link from README.md reaches it`,
    }),
  );

  const findings = [...commandFindings, ...surfaceFindings];
  return { status: findings.length > 0 ? 'findings' : 'ok', findings, notes };
}
```

- [ ] **Step 4: Run the test to verify it PASSES.**

```bash
npx vitest run src/docs/__tests__/readme-content.test.ts && npx tsc --noEmit
```

Expected output: `Test Files  1 passed (1)` with 33 passing tests; `tsc` prints nothing.

- [ ] **Step 5: Run the check against this repository.**

```bash
node bin/noldor.mjs checks readme
```

Expected output: exit 1, with a line naming `docs/adr` and a line naming `docs/architecture`, and no command findings — every command this README quotes resolves today. Part 3 repairs the two surfaces.

- [ ] **Step 6: Commit.**

```bash
git add src/docs/readme-content.ts src/docs/__tests__/readme-content.test.ts
git commit -m "feat(docs): resolve README commands inside checkReadme" -m "Noldor-FD: root-readme-content-validator"
```
