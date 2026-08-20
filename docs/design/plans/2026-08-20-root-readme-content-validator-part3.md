# Root README Content Validator Implementation Plan — Part 3: Call Sites and Repair

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** wire `checks readme` into the two places that should surface it — release preflight and the `pre-push` hook — both advisory, and repair the README so the check ships green.

**Architecture:** A `warn` release-preflight row reusing `docSurfaceRow`, widened with an optional notes channel and a severity option. An advisory `pre-push` lefthook job. Both registries that enumerate preflight rows without type-guarding get the same edit, and both `templates/` twins are mirrored.

**Tech Stack:** TypeScript (ESM), vitest, lefthook YAML, markdown.

**Prerequisite:** Parts 1 and 2 — this part imports `checkReadme` and calls the `checks readme` command they build.

**Ships:** the check running automatically at push and at release, and a README with no findings.

> **Every Commit step below must carry a body.** The blocking pre-push
> `summary-body` gate rejects any outgoing commit whose message is subject plus
> trailers only — verified on this branch, where three such commits had to be
> reworded before the range would push. Write the message to a file with `Why —`,
> `How —` and `What —` paragraphs and commit with `git commit -F <file>`; keep
> `Noldor-FD` (and any sibling-scope trailer) in one trailing paragraph, because
> a separate `-m` starts a new paragraph and `git interpret-trailers --parse`
> then returns only the last one.

---

## File Structure

- `src/release/preflight-types.ts` — **Modify.** Add `'readme'` to `PreflightRowId`.
- `src/release/preflight-probes.ts` — **Modify.** Widen `docSurfaceRow` with an optional `notes` channel and a `severity` option; add the `readme` probe; add `'readme'` to `ALL_ROW_IDS`.
- `src/release/__tests__/preflight-probes.test.ts` — **Modify.** Add `'readme'` to the row-order assertion list; add the warn and override cases.
- `lefthook/noldor.yml` — **Modify.** Advisory `readme` job on `pre-push`.
- `templates/lefthook/noldor.yml` — **Modify.** Byte-identical twin.
- `docs/noldor/script-catalog.md` — **Modify.** Add `readme` to the preflight row-id prose. (The `check:readme` entry itself lands in Part 1 Task 4, beside the manifest registration the pre-commit job globs.)
- `templates/docs/noldor/script-catalog.md` — **Modify.** Byte-identical twin.
- `README.md` — **Modify.** Link `docs/architecture/` and `docs/adr/` from `## Docs`.

---

## Task 1: Release-preflight row

**Files:**
- Modify: `src/release/preflight-types.ts`, `src/release/preflight-probes.ts`
- Test: `src/release/__tests__/preflight-probes.test.ts`

- [ ] **Step 1: Add `'readme'` to the row-order assertion in `src/release/__tests__/preflight-probes.test.ts`.**

In the hand-written id list, insert `'readme',` immediately after `'adr',`.

- [ ] **Step 2: Run the test to verify it FAILS.**

```bash
npx vitest run src/release/__tests__/preflight-probes.test.ts
```

Expected output: the row-order test fails — the expected list now contains `readme` while `ALL_ROW_IDS` does not.

- [ ] **Step 3: Add `'readme'` to the `PreflightRowId` union in `src/release/preflight-types.ts`.**

Insert `  | 'readme'` immediately after the `  | 'adr'` member.

- [ ] **Step 4: Widen `docSurfaceRow` in `src/release/preflight-probes.ts`.**

Replace the existing signature and body with:

```ts
async function docSurfaceRow(
  id: PreflightRowId,
  envVar: string,
  check: () => Promise<{
    status: string;
    findings: readonly { message: string }[];
    notes?: readonly string[];
  }>,
  details: { absent: string; ok: string; blocking: string; fix: string },
  opts?: { severity?: 'blocking' | 'warn' },
): Promise<PreflightRow> {
  if (process.env[envVar] === '1') {
    return overrideSkip(id, envVar);
  }
  const report = await check();
  // Notes ride the detail, or a degraded check renders as clean.
  const suffix =
    report.notes !== undefined && report.notes.length > 0 ? ` — ${report.notes.join('; ')}` : '';
  if (report.status === 'absent') {
    return { id, status: 'skipped', detail: details.absent + suffix };
  }
  if (report.status === 'ok') {
    return { id, status: 'ok', detail: details.ok + suffix };
  }
  return {
    id,
    status: opts?.severity ?? 'blocking',
    detail: (report.findings[0]?.message ?? details.blocking) + suffix,
    fix: details.fix,
  };
}
```

Both existing call sites (`architecture`, `adr`) pass four arguments and are unchanged — the new parameter is optional and trailing.

- [ ] **Step 5: Add the probe and the row id in `src/release/preflight-probes.ts`.**

Add `import { checkReadme } from '../docs/readme-content.js';` beside the existing `checkAdr` / `checkArchitecture` imports. Insert `  'readme',` into `ALL_ROW_IDS` immediately after `'adr',`. Then add to `PROBES`, after the `adr` entry:

```ts
  /**
   * README content drift. `warn`, never blocking: the README is consumer-owned
   * and sits outside `RELEASE_SWEEP_GLOBS`, so a stale line must not withhold a
   * release.
   */
  readme: (ctx) =>
    docSurfaceRow(
      'readme',
      'RELEASE_SKIP_README',
      () => checkReadme(ctx.cwd),
      {
        absent: 'no readable README.md',
        ok: 'README commands and doc-surface links resolve',
        blocking: 'README content drift',
        fix: 'Run `pnpm noldor checks readme` and repair each reported line.',
      },
      { severity: 'warn' },
    ),
```

- [ ] **Step 6: Append a warn-and-override test to `src/release/__tests__/preflight-probes.test.ts`.**

```ts
describe('readme row', () => {
  it('renders warn on findings and is excluded from blockingIds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preflight-readme-'));
    await writeFile(join(root, 'README.md'), 'no links', 'utf8');
    await mkdir(join(root, 'docs', 'architecture'), { recursive: true });
    await writeFile(join(root, 'docs', 'architecture', 'context.md'), '# c', 'utf8');
    const row = await runProbe('readme', makeProbeContext({ cwd: root, nowMs: 0 }));
    expect(row.status).toBe('warn');
    expect(blockingIds([row])).toEqual([]);
    await rm(root, { recursive: true, force: true });
  });

  it('skips under RELEASE_SKIP_README with the override recorded', async () => {
    process.env.RELEASE_SKIP_README = '1';
    try {
      const row = await runProbe('readme', makeProbeContext({ cwd: process.cwd(), nowMs: 0 }));
      expect(row.status).toBe('skipped');
      expect(row.override).toBe('RELEASE_SKIP_README=1');
    } finally {
      delete process.env.RELEASE_SKIP_README;
    }
  });
});
```

Reuse whatever `runProbe` / `makeProbeContext` / `blockingIds` imports and context-construction helper the file already uses; add only the node:fs/promises and node:os imports the new block needs.

- [ ] **Step 7: Run the tests to verify they PASS.**

```bash
npx vitest run src/release/__tests__/preflight-probes.test.ts && npx tsc --noEmit
```

Expected output: every test in the file passes, including the row-order assertion and both new cases; `tsc` prints nothing.

- [ ] **Step 8: Commit.**

```bash
git add src/release/preflight-types.ts src/release/preflight-probes.ts src/release/__tests__/preflight-probes.test.ts
git commit -F <(printf '%s\n\n%s\n\n%s\n' \
  "feat(release): add an advisory readme preflight row" \
  "Why — …  How — …  What — … (three paragraphs, see the note at the top)" \
  "Noldor-FD: root-readme-content-validator")
```

---

## Task 2: Hook wiring, catalog, and both twins

**Files:**
- Modify: `lefthook/noldor.yml`, `templates/lefthook/noldor.yml`, `docs/noldor/script-catalog.md`, `templates/docs/noldor/script-catalog.md`

- [ ] **Step 1: Add the advisory job to `lefthook/noldor.yml`.**

At the end of the `pre-push:` `jobs:` list, after the `noldor-clones` job, add:

```yaml
    # ADVISORY: `|| true` is deliberate. The check reports README drift, but the
    # README is consumer-owned and this block ships byte-identical to every
    # consumer, so a red must not gate their push. `checks readme` itself still
    # exits 1, so anyone who wants it to gate can call it directly.
    - name: readme
      run: pnpm noldor checks readme || true
```

- [ ] **Step 2: Mirror it into the template twin.**

```bash
cp lefthook/noldor.yml templates/lefthook/noldor.yml
diff lefthook/noldor.yml templates/lefthook/noldor.yml && echo IDENTICAL
```

Expected output: `IDENTICAL`.

- [ ] **Step 3: Add `readme` to the preflight row-id prose in `docs/noldor/script-catalog.md`.**

The `### \`check:readme\`` entry itself already landed in Part 1 Task 4 — the pre-commit `script-catalog` job globs `src/cli/manifest.ts`, so it had to accompany the registration. Only the preflight row-id list is outstanding here.

On the release-preflight `- **Outputs:**` line, insert `` `readme`, `` into the row-id list immediately after `` `architecture`, ``.

- [ ] **Step 4: Mirror the catalog into its twin.**

```bash
cp docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md
diff docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md && echo IDENTICAL
```

Expected output: `IDENTICAL`.

- [ ] **Step 5: Verify the catalog gate and the template gate.**

```bash
node bin/noldor.mjs validate script-catalog && node bin/noldor.mjs checks template-sync
```

Expected output: both commands exit 0 — the catalog cites the new entrypoint and no template has drifted.

- [ ] **Step 6: Commit.**

```bash
git add lefthook/noldor.yml templates/lefthook/noldor.yml docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md
git commit -F <(printf '%s\n\n%s\n\n%s\n' \
  "feat(checks): wire checks readme as an advisory pre-push job" \
  "Why — …  How — …  What — … (three paragraphs, see the note at the top)" \
  "Noldor-FD: root-readme-content-validator")
```

---

## Task 3: Repair the README and verify green

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Confirm which surfaces are unreachable.**

```bash
node bin/noldor.mjs checks readme
```

Expected output: exit 1, one line naming `docs/adr` and one naming `docs/architecture`. `docs/user` must NOT appear — it is already reached via `docs/noldor/README.md` → `docs/noldor/triage.md` → `../user/how-to/index.md`.

- [ ] **Step 2: Link both surfaces from the `## Docs` section of `README.md`.**

Replace the single paragraph under `## Docs` with:

```markdown
The framework rule pages live under [`docs/noldor/`](docs/noldor/README.md) — that index is the single source of truth, keyed by what you are trying to do.

Two further surfaces sit beside it: the four architecture pages under [`docs/architecture/`](docs/architecture/context.md) (context, containers, modules, flows) and the decision records under [`docs/adr/`](docs/adr/).
```

- [ ] **Step 3: Verify the check is now green.**

```bash
node bin/noldor.mjs checks readme
```

Expected output: `readme: 0 finding(s)` and exit 0.

- [ ] **Step 4: Verify the links resolve and the full suite passes.**

```bash
node bin/noldor.mjs docs check && pnpm lint && npx tsc --noEmit && npx vitest run
```

Expected output: `docs check` reports only the pre-existing broken link in `docs/features/specs-cr-gate-multi-reviewer.md` (line 143, `../../src/cr/codex-spawn.ts`) and exits 1 on that alone — unrelated to this feature and not to be fixed here. `pnpm lint`, `tsc` and the vitest suite all pass.

- [ ] **Step 5: Commit.**

```bash
git add README.md
git commit -F <(printf '%s\n\n%s\n\n%s\n' \
  "docs(readme): link the architecture and ADR surfaces from ## Docs" \
  "Why — …  How — …  What — … (three paragraphs, see the note at the top)" \
  "Noldor-FD: root-readme-content-validator")
```
