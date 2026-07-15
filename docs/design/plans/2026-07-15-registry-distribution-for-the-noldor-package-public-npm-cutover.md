# Public npm Cutover Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Cut Noldor over from a private GitHub Packages scoped package (`@davidzoufaly/noldor`) to a public npm package (`noldor`), published on tag by CI via an `NPM_TOKEN` secret with build provenance.
**Architecture:** No new modules. Edit package identity (`package.json`), the publish workflow + its assertion test, the release poller + its test, the config default + its test, and the consumer-facing docs. Two acceptance greps backstop that no private-registry narrative survives.
**Tech Stack:** TypeScript (tsx-on-source), vitest, GitHub Actions, pnpm, Zod.

---

## Operator preconditions (release-time — does NOT block this PR)

The cutover code merges and passes CI with no secret. But **no tagged release can publish** until the operator provisions the npm token — the shipped `publish.yml` authenticates with `${{ secrets.NPM_TOKEN }}`, and `gh secret list` currently shows the repo has **zero** Actions secrets:

1. On npmjs.com (the account that will own `noldor`), create an **automation token** with publish rights.
2. GitHub repo → Settings → Secrets and variables → Actions → add secret **`NPM_TOKEN`** with that value.
3. Do this **before** the first `v*` tag, or the publish job dies with `ENEEDAUTH` / `E401`.

One-time manual step. Intentionally NOT a task below (nothing to commit) and NOT a merge gate (the secret is a release-time dependency, not a code dependency). The first `npm publish` creates `noldor` on npm — the name is free (404-verified).

---

## File Structure

- `package.json` — package identity: `name` → `noldor`, `publishConfig` → npmjs, add `repository`/`homepage`/`bugs` (provenance prerequisite).
- `.github/workflows/publish.yml` — publish executor: npmjs registry, unscoped, `id-token: write`, `npm publish --provenance` via `NPM_TOKEN`.
- `src/release/__tests__/publish-workflow.test.ts` — linchpin test: asserts the NEW workflow shape (full rewrite).
- `src/release/release-publish.ts` — release poller: `DEFAULT_REGISTRY` → npmjs, delete `isRegistryAuthError`, simplify `isVersionOnRegistry`, fix comments.
- `src/release/__tests__/release-publish.test.ts` — whole-file sweep: public-read semantics, drop vestigial test, purge private literals.
- `src/core/config.ts` — `release.publish.registry` Zod default → npmjs, rewrite executor comment.
- `src/core/__tests__/config.test.ts` — whole-file sweep: default value + "GitHub Packages" test title.
- `README.md` — intro + Install + CI note + Contributing `file:` dep name.
- `docs/noldor/adoption-guide.md` **+** `templates/docs/noldor/adoption-guide.md` — identical edits: install from npm, drop `.npmrc`/token.
- `docs/noldor/versioning.md` **+** `templates/docs/noldor/versioning.md` — identical edits: public npm publish narrative.
- `docs/backlog.md` — remove the obsolete private-GH-Packages follow-up block.

---

## Task 1: package.json identity + provenance prerequisites

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Rename the package and repoint publishConfig at npmjs.** In `package.json`, change line 2 `"name": "@davidzoufaly/noldor",` to `"name": "noldor",`. Change the `publishConfig` block:
  ```json
  "publishConfig": {
    "registry": "https://registry.npmjs.org"
  },
  ```
  (was `"registry": "https://npm.pkg.github.com"`). Leave `"private": false` as-is.

- [ ] **Step 2: Add repository/homepage/bugs (required for `--provenance`).** Insert these three keys immediately after the `"version"` line in `package.json` (npm aborts `--provenance` with `EUSAGE` if `repository.url` is absent):
  ```json
  "repository": {
    "type": "git",
    "url": "git+https://github.com/davidzoufaly/noldor.git"
  },
  "homepage": "https://github.com/davidzoufaly/noldor#readme",
  "bugs": "https://github.com/davidzoufaly/noldor/issues",
  ```

- [ ] **Step 3: Verify the identity fields.** Run:
  ```bash
  node -e "const p=require('./package.json'); console.log(p.name, '|', p.publishConfig.registry, '|', p.repository.url, '|', p.publishConfig.access ?? 'no-access-key')"
  ```
  Expected output:
  ```
  noldor | https://registry.npmjs.org | git+https://github.com/davidzoufaly/noldor.git | no-access-key
  ```

- [ ] **Step 4: Confirm the root name is not baked into the lockfile.** Run:
  ```bash
  grep -c "@davidzoufaly/noldor" pnpm-lock.yaml || true
  ```
  Expected output: `0` (pnpm keys the root importer by `.`, not by name — no reinstall needed). If non-zero, run `pnpm install --lockfile-only` and stage `pnpm-lock.yaml` in the commit below.

- [ ] **Step 5: Commit.**
  ```bash
  git add package.json
  git commit -m "build(release): rename package @davidzoufaly/noldor → noldor + add repository for provenance" -m "Noldor-FD: registry-distribution-for-the-noldor-package"
  ```

---

## Task 2: publish workflow → public npm (test-first, linchpin)

**Files:**
- Modify: `.github/workflows/publish.yml`
- Test: `src/release/__tests__/publish-workflow.test.ts`

- [ ] **Step 1: Rewrite the workflow assertion test.** Replace the entire contents of `src/release/__tests__/publish-workflow.test.ts` with:
  ```ts
  // @tests: registry-distribution-for-the-noldor-package
  import { describe, expect, it } from 'vitest';
  import { readFileSync } from 'node:fs';
  import { dirname, join } from 'node:path';
  import { fileURLToPath } from 'node:url';
  import { parse } from 'yaml';

  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

  interface WorkflowStep {
    name?: string;
    uses?: string;
    run?: string;
    with?: Record<string, unknown>;
    env?: Record<string, string>;
  }

  interface WorkflowShape {
    on: { push: { tags: string[] } };
    permissions: Record<string, string>;
    jobs: { publish: { steps: WorkflowStep[] } };
  }

  function loadWorkflow(): WorkflowShape {
    const raw = readFileSync(join(ROOT, '.github', 'workflows', 'publish.yml'), 'utf8');
    return parse(raw) as WorkflowShape;
  }

  describe('publish.yml — tag-triggered public npm publish', () => {
    it('fires on v* tag pushes only', () => {
      expect(loadWorkflow().on).toEqual({ push: { tags: ['v*'] } });
    });

    it('declares contents: read + id-token: write (provenance), and NOT packages: write', () => {
      expect(loadWorkflow().permissions).toEqual({ contents: 'read', 'id-token': 'write' });
    });

    it('points npm at the public npm registry via setup-node, unscoped (no scope)', () => {
      const setupNode = loadWorkflow().jobs.publish.steps.find((s) =>
        s.uses?.startsWith('actions/setup-node'),
      );
      expect(setupNode?.with?.['registry-url']).toBe('https://registry.npmjs.org');
      expect(setupNode?.with?.scope).toBeUndefined();
    });

    it('guards tag-vs-package.json before installing anything', () => {
      const runs = loadWorkflow().jobs.publish.steps.map((s) => s.run ?? '');
      const guardIdx = runs.findIndex((r) => r.includes('GITHUB_REF_NAME#v'));
      const installIdx = runs.findIndex((r) => r.includes('pnpm install --frozen-lockfile'));
      expect(guardIdx).toBeGreaterThan(-1);
      expect(installIdx).toBeGreaterThan(guardIdx);
    });

    it('contract-checks the exact bits, then publishes', () => {
      const runs = loadWorkflow().jobs.publish.steps.map((s) => s.run ?? '');
      const contractIdx = runs.findIndex((r) => r.includes('pnpm test:contract'));
      const publishIdx = runs.findIndex((r) => r.includes('npm publish'));
      expect(contractIdx).toBeGreaterThan(-1);
      expect(publishIdx).toBeGreaterThan(contractIdx);
    });

    it('publishes a public package with provenance via NPM_TOKEN — unscoped, no --access flag', () => {
      // Unscoped ⇒ public by default, so `--access public` is unnecessary.
      // Provenance is the OSS supply-chain attestation (needs id-token: write above).
      const publishStep = loadWorkflow().jobs.publish.steps.find((s) =>
        (s.run ?? '').includes('npm publish'),
      );
      const publishRun = publishStep?.run ?? '';
      expect(publishRun).toContain('npm publish');
      expect(publishRun).toContain('--provenance');
      expect(publishRun).not.toContain('--access public');
      expect(publishStep?.env?.NODE_AUTH_TOKEN).toBe('${{ secrets.NPM_TOKEN }}');
    });
  });
  ```

- [ ] **Step 2: Run the test — verify FAIL.**
  ```bash
  pnpm vitest run src/release/__tests__/publish-workflow.test.ts
  ```
  Expected: FAIL — the current `publish.yml` still declares `packages: write`, a `@davidzoufaly` scope, and `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` with no `--provenance`; the permissions, scope, registry, provenance, and token assertions all fail.

- [ ] **Step 3: Rewrite the workflow.** Replace the entire contents of `.github/workflows/publish.yml` with:
  ```yaml
  name: publish
  on:
    push:
      tags: ['v*']
  permissions:
    contents: read
    id-token: write
  jobs:
    publish:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: pnpm/action-setup@v4
        - uses: actions/setup-node@v4
          with:
            node-version: 22
            cache: pnpm
            registry-url: https://registry.npmjs.org
        - name: version guard — tag must equal package.json version
          run: |
            TAG_VERSION="${GITHUB_REF_NAME#v}"
            PKG_VERSION="$(node -p "require('./package.json').version")"
            if [ "$TAG_VERSION" != "$PKG_VERSION" ]; then
              echo "Tag v$TAG_VERSION != package.json $PKG_VERSION — refusing to publish." >&2
              exit 1
            fi
        - run: pnpm install --frozen-lockfile
        - run: pnpm test:contract
        - name: publish to public npm with provenance
          run: npm publish --provenance
          env:
            NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
  ```

- [ ] **Step 4: Run the test — verify PASS.**
  ```bash
  pnpm vitest run src/release/__tests__/publish-workflow.test.ts
  ```
  Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit.**
  ```bash
  git add .github/workflows/publish.yml src/release/__tests__/publish-workflow.test.ts
  git commit -m "ci(publish): publish noldor to public npm with provenance via NPM_TOKEN" -m "Noldor-FD: registry-distribution-for-the-noldor-package"
  ```

---

## Task 3: release poller → public-read semantics (test-first)

**Files:**
- Modify: `src/release/release-publish.ts`
- Test: `src/release/__tests__/release-publish.test.ts`

- [ ] **Step 1: Sweep the poller test for public semantics.** In `src/release/__tests__/release-publish.test.ts`, delete the three tests spanning the current lines 51-85 — `throws a clear read:packages error on a 401`, `throws on a 403 Forbidden`, and `does NOT treat a 404 whose spec carries 401-like digits as an auth error` (the last is vestigial once `isRegistryAuthError` is gone). Replace all three with this single test (paste it where the deleted block was, still inside `describe('isVersionOnRegistry', …)`):
  ```ts
    it('returns false (keeps polling) on a 401/403 — public reads need no token', async () => {
      // Public npm serves reads unauthenticated, so a 401/403 is not a
      // missing-token signal; treat it like any other transient failure —
      // return false and let awaitPublish keep polling until the timeout.
      const exec: ExecFn = async () => {
        throw new Error(
          'npm error code E403\nnpm error 403 Forbidden - GET https://registry.npmjs.org/noldor',
        );
      };
      await expect(
        isVersionOnRegistry({ pkgName: 'noldor', version: '0.5.0', exec }),
      ).resolves.toBe(false);
    });
  ```
  Leave every other test (`probes …`, `returns false when npm exits non-zero`, `honours a configured registry`, the `awaitPublish` block, the `readPkgIdentity` block) untouched — they already use the `DEFAULT_REGISTRY` constant and the `noldor` name, so they follow the new registry automatically.

- [ ] **Step 2: Run the test — verify FAIL.**
  ```bash
  pnpm vitest run src/release/__tests__/release-publish.test.ts
  ```
  Expected: FAIL — `isVersionOnRegistry` still throws on the 403 (via `isRegistryAuthError`), so the new "resolves toBe(false)" test rejects instead; `DEFAULT_REGISTRY` still equals `https://npm.pkg.github.com` so the `probes …` test's `--registry` arg mismatches the new value once Step 3 lands.

- [ ] **Step 3: Repoint DEFAULT_REGISTRY.** In `src/release/release-publish.ts`, change line 15:
  ```ts
  export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
  ```

- [ ] **Step 4: Delete the private-auth helper.** In `src/release/release-publish.ts`, delete the entire `isRegistryAuthError` JSDoc + function (current lines 40-58, from `/**` above `function isRegistryAuthError` through its closing `}`).

- [ ] **Step 5: Simplify `isVersionOnRegistry` and rewrite its comment.** Replace the `isVersionOnRegistry` doc comment + function (current lines 60-91) with:
  ```ts
  /**
   * One registry probe: does `<pkg>@<version>` resolve? A clean `npm view` = yes.
   * The public npm registry serves reads unauthenticated, so any `npm view`
   * failure — a 404 (not published yet) or even a transient 401/403 — is treated
   * as "not visible yet" and the caller keeps polling. There is no
   * missing-token special case: public reads need no token.
   */
  export async function isVersionOnRegistry(probe: RegistryProbe): Promise<boolean> {
    const exec = probe.exec ?? realExec;
    const registry = probe.registry ?? DEFAULT_REGISTRY;
    try {
      await exec(
        'npm',
        ['view', `${probe.pkgName}@${probe.version}`, 'version', '--json', '--registry', registry],
        probe.env,
      );
      return true;
    } catch {
      return false;
    }
  }
  ```

- [ ] **Step 6: Fix the `awaitPublish` comment.** In `src/release/release-publish.ts`, in the `awaitPublish` JSDoc, change the phrase describing the executor from `GitHub Packages, authed with the built-in \`GITHUB_TOKEN\`` to `the public npm registry, authed with an \`NPM_TOKEN\` secret`.

- [ ] **Step 7: Fix the `publishLocal` comment.** In the `publishLocal` JSDoc, replace the sentence `Needs a GH Packages token with \`write:packages\` in the local \`.npmrc\` / NODE_AUTH_TOKEN.` with `Needs an npm token with publish rights in the local \`.npmrc\` / \`NODE_AUTH_TOKEN\`.`

- [ ] **Step 8: Run the test — verify PASS.**
  ```bash
  pnpm vitest run src/release/__tests__/release-publish.test.ts
  ```
  Expected: PASS — all tests green (the new 401/403→false test passes; `probes …` matches `https://registry.npmjs.org`).

- [ ] **Step 9: Commit.**
  ```bash
  git add src/release/release-publish.ts src/release/__tests__/release-publish.test.ts
  git commit -m "refactor(release): poll public npm; drop private-registry auth-error path" -m "Noldor-FD: registry-distribution-for-the-noldor-package"
  ```

---

## Task 4: config default registry (test-first)

**Files:**
- Modify: `src/core/config.ts`
- Test: `src/core/__tests__/config.test.ts`

- [ ] **Step 1: Sweep the config test.** In `src/core/__tests__/config.test.ts`:
  - Line 227 — retitle: `it('defaults enabled=false, GitHub Packages registry, latest dist-tag', () => {` → `it('defaults enabled=false, public npm registry, latest dist-tag', () => {`.
  - Line 231 — value: `registry: 'https://npm.pkg.github.com',` → `registry: 'https://registry.npmjs.org',`.
  - Line 243 — value: `expect(parsed.release?.publish?.registry).toBe('https://npm.pkg.github.com');` → `expect(parsed.release?.publish?.registry).toBe('https://registry.npmjs.org');`.

- [ ] **Step 2: Run the test — verify FAIL.**
  ```bash
  pnpm vitest run src/core/__tests__/config.test.ts
  ```
  Expected: FAIL — the Zod default still returns `https://npm.pkg.github.com`, so the two value expectations fail.

- [ ] **Step 3: Repoint the Zod default + rewrite the comment.** In `src/core/config.ts`, change line 89 `registry: z.string().url().default('https://npm.pkg.github.com'),` to `registry: z.string().url().default('https://registry.npmjs.org'),`. Then replace the doc comment above `releasePublishConfigSchema` (current lines 78-86) with:
  ```ts
  /**
   * Registry-publish verification block. `enabled` defaults FALSE so every
   * consumer running the vendored release pipeline (Charuy, the contract
   * fixture) keeps byte-identical behaviour with no config change; only the
   * framework repo opts in. The tag-triggered publish.yml workflow is the
   * publish EXECUTOR (the public npm registry, authed with an `NPM_TOKEN`
   * secret); the values here drive the local pipeline's registry poll target
   * and log lines (`distTag` is echoed; the workflow hard-codes `latest`).
   */
  ```

- [ ] **Step 4: Run the test — verify PASS.**
  ```bash
  pnpm vitest run src/core/__tests__/config.test.ts
  ```
  Expected: PASS — all tests green.

- [ ] **Step 5: Commit.**
  ```bash
  git add src/core/config.ts src/core/__tests__/config.test.ts
  git commit -m "refactor(config): default release.publish.registry to public npm" -m "Noldor-FD: registry-distribution-for-the-noldor-package"
  ```

---

## Task 5: docs — drop private/closed-source framing

**Files:**
- Modify: `README.md`
- Modify: `docs/noldor/adoption-guide.md`, `templates/docs/noldor/adoption-guide.md`
- Modify: `docs/noldor/versioning.md`, `templates/docs/noldor/versioning.md`
- Modify: `docs/backlog.md`

- [ ] **Step 1: README intro (line 3).** Replace the intro paragraph with (drops "pre-1.0", "private GitHub Packages", and the "closed-source by design … public registry is not an option" sentence):
  > Discipline framework for agent-driven software development: a **single mandatory gate** for every code change, doc-anchored features, and an autonomous queue-drain that ships small work unattended. Noldor is self-hosting — it dogfoods its own gate, drain, and release pipeline (version lives in `package.json`, printed by `noldor --version`). It ships as a **public npm package**, `noldor`, published on tag by CI with build provenance.

- [ ] **Step 2: README Install section (lines 11-27).** Replace the whole `## Install` section body with:
  > Noldor is a public package on npm — install it as a dev dependency, no registry config or token required:
  >
  > ```bash
  > pnpm add -D noldor
  > ```
  >
  > - **Monorepo / workspace:** add `-w` (`pnpm add -Dw noldor`) — a bare `pnpm add -D` at a workspace root fails with `ERR_PNPM_ADDING_TO_ROOT`.
  > - **CI / deploy:** `npm ci` / `pnpm install` resolves `noldor` from public npm with no extra auth.

- [ ] **Step 3: README Contributing dep example.** In the Contributing `file:` JSON block, change the key `"@davidzoufaly/noldor": "file:../noldor"` to `"noldor": "file:../noldor"`.

- [ ] **Step 4: adoption-guide install step (line 29-47) — edit BOTH twins identically.** In `docs/noldor/adoption-guide.md` AND `templates/docs/noldor/adoption-guide.md`, replace step 1 ("Authenticate to GitHub Packages, then install.") and its `.npmrc` code block and the "CI / deploy auth (required)" callout with:
  > 1. **Install from npm.** Noldor is a public package (`noldor`) on the npm registry — no `.npmrc`, no token. Install as a dev dependency: `pnpm add -D noldor` (in a **pnpm workspace / monorepo**, add `-w`: `pnpm add -Dw noldor` — a bare `pnpm add -D` at a workspace root fails with `ERR_PNPM_ADDING_TO_ROOT`). Framework contributors point at a sibling clone instead: `"noldor": "file:../noldor"`.

  and replace the CI callout with:
  > > **CI / deploy.** Any pipeline that runs `npm ci` / `pnpm install` resolves `noldor` from public npm with no extra auth — no `.npmrc`, no secret.

- [ ] **Step 5: versioning publish narrative — edit BOTH twins identically.** In `docs/noldor/versioning.md` AND `templates/docs/noldor/versioning.md`:
  - The "local token usually lacks `read:packages`; the actual publish runs in CI." clause → "the actual publish runs in CI."
  - The paragraph "The framework package itself ships to **private GitHub Packages** as `@davidzoufaly/noldor`. Every release tag `vX.Y.Z` maps 1:1 to version `X.Y.Z`; `latest` is the only dist-tag pre-1.0." → "The framework package itself ships to **public npm** as `noldor`. Every release tag `vX.Y.Z` maps 1:1 to version `X.Y.Z`; `latest` is the only dist-tag."
  - The "publish executor" sentence (immediately after the ships-to paragraph): "The publish executor is the tag-triggered publish.yml workflow, authed with the built-in `GITHUB_TOKEN` (`packages: write`) — a scoped package defaults to restricted access, so the readable `src/` in the tarball never lands on a public registry." → "The publish executor is the tag-triggered publish.yml workflow, authed with an `NPM_TOKEN` secret — it publishes the unscoped `noldor` package to public npm with build provenance."
  - The "That poll needs a `read:packages` token in the release environment to see the private package; a 401 is surfaced as a missing-token error…" sentence → "That poll reads the public registry (no token needed)."
  - `pnpm up @davidzoufaly/noldor` → `pnpm up noldor`.

- [ ] **Step 6: backlog — remove the obsolete block.** In `docs/backlog.md`, delete the entire entry whose body begins "Deferred config follow-ups from the private-GH-Packages switch (PR #168 …" (line ~60) — including its heading line and any schema-C frontmatter fence for that block. Both follow-ups it lists (ps-offsite `.npmrc`; move to GoodData org) are moot under public unscoped `noldor`.

- [ ] **Step 7: Verify the two acceptance greps + template-sync.** Run:
  ```bash
  grep -riE "npm\.pkg\.github\.com|github packages|gh packages|(read|write):packages|GITHUB_TOKEN" src/ ; echo "src-exit:$?"
  grep -riE "@davidzoufaly/noldor|npm\.pkg\.github\.com|closed-source|github packages|read:packages|GITHUB_TOKEN" README.md docs/noldor/adoption-guide.md docs/noldor/versioning.md docs/backlog.md templates/docs/noldor/adoption-guide.md templates/docs/noldor/versioning.md ; echo "docs-exit:$?"
  pnpm noldor check-template-sync 2>&1 | tail -3
  ```
  Expected: `src-exit:1` and `docs-exit:1` (grep exit 1 = zero matches), and template-sync reports OK (twins mirrored).

- [ ] **Step 8: Commit.** Use the `docs(noldor):` scope — the `noldor-scope` gate rejects a scope-less `docs:` subject when `docs/noldor/` files are staged; the bare `noldor` scope accepts the full mixed page set (README/backlog/templates ride along), so no split is needed.
  ```bash
  git add README.md docs/noldor/adoption-guide.md templates/docs/noldor/adoption-guide.md docs/noldor/versioning.md templates/docs/noldor/versioning.md docs/backlog.md
  git commit -m "docs(noldor): retarget install + release docs from private GH Packages to public npm" -m "Noldor-FD: registry-distribution-for-the-noldor-package"
  ```
  If the `noldor-scope` hook still rejects the mixed set, split into two commits: `docs(noldor): …` for `docs/noldor/*` + their `templates/` twins, then `docs: …` for `README.md` + `docs/backlog.md`.

---

## Task 6: full verification gate

**Files:** none (verification only — no commit).

- [ ] **Step 1: Run the full verify suite.**
  ```bash
  pnpm verify
  ```
  Expected: PASS — `lint` (oxlint, no warnings), `fmt:check`, `typecheck` (tsc), and `test` (vitest, all suites) all green. If `fmt:check` flags a file, run `pnpm fmt` and fold the result into the relevant task's commit (`--amend` if it is the tip).

- [ ] **Step 2: Run the contract suite.**
  ```bash
  pnpm test:contract
  ```
  Expected: PASS — packs the `noldor` tarball, installs it into a scratch consumer fixture, and runs the contract checks green (registry-agnostic; the rename to `noldor` is the only observable change in the tarball name).

- [ ] **Step 3: Final literal sweep of the edited shipping surface (belt-and-suspenders).**
  ```bash
  grep -rInE "@davidzoufaly/noldor|npm\.pkg\.github\.com" package.json .github/ src/ README.md docs/noldor/ templates/docs/noldor/ docs/backlog.md ; echo "exit:$?"
  ```
  Expected: `exit:1` — zero matches in the files this change edits. The sweep deliberately **excludes** `docs/design/` (dated specs + this plan itself) and `docs/features/` (the parent FD is refreshed by the gate at Step 4, *after* this task; other-feature FDs are historical) — those keep the old name as accurate historical record and are out of scope for the cutover.

- [ ] **Step 4: Hand back to the gate.** Implementation is complete and verified. The `/noldor-gate` Step 4 end-of-flow owns the rest: `/noldor-draft-feature-md --refresh --usage-only` on the parent, `phase-flip-done`, code-stage CR, and `pr-flow` auto-merge. Do not open the PR from this plan. **Reminder:** the `NPM_TOKEN` repo secret (see Operator preconditions) must exist before the next `pnpm release` tags a version, or the publish job 401s — this PR merging does not itself trigger a publish.
