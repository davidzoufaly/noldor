# Registry Distribution for the Noldor Package — Design

**Slug:** registry-distribution-for-the-noldor-package
**FD:** docs/features/registry-distribution-for-the-noldor-package.md
**Date:** 2026-07-03
**Tier:** specs-only
**Deps:** none

## Problem

A consumer today installs Noldor as `"noldor": "file:../noldor"` (README Quick start, `docs/noldor/adoption-guide.md` Bootstrap §1) and must keep a clone of `noldor/` as a sibling directory. That is the single hardest adoption blocker for any repo not on this machine: versions are not pinnable, `pnpm install` breaks without the clone, and consumer-#2 dogfood on another machine is impossible.

Package hygiene already shipped (PR #119: `files` whitelist `["dist","src","bin","templates"]` in `package.json`, tolerant `postinstall` for missing lefthook, scaffold-only config template). Tarball mechanics are proven end-to-end by contract CI (`scripts/test-contract.mjs` → `installFrameworkTarball` in `src/testing/contract-harness.ts`, which runs `pnpm pack --pack-destination` and installs the tarball into a fixture repo). What is missing is the actual registry: nothing publishes, and the release pipeline (`src/release/index.ts`) ends at `gh release create` (lines 511–525) — commit, tag, push, GitHub Release, then `clearReleaseState`.

## Goals

- `pnpm add -D noldor` works from any machine — package resolvable on the public npm registry.
- Publishing is a tag-driven, provenance-attested step that fires only after the existing commit→tag→push→GitHub-Release chain succeeds, respects every existing release gate, and never touches a dirty tree.
- `pnpm release` (and `pnpm release --resume`) treats "version visible on the registry" as the new final rung, so an interrupted release cannot silently end unpublished.
- Consumer repos that vendor the same release pipeline (Charuy) can never publish by accident — publish is opt-in via config.
- README Quick start and adoption-guide Bootstrap §1 lead with the registry path; `file:` stays documented as the contributor/dev path.

## Non-goals

- No scoped-name migration (`@noldor/…`), no rename ripple into `consumer-config` docs or `init` output — unscoped `noldor` is claimed as-is (see D2).
- No private-registry / GitHub Packages support.
- No new dist-tag channels (`next`, `beta`) pre-1.0 — `latest` only (D4).
- No changesets/semantic-release adoption — the existing `deriveBumpLevel` commit-classification bump (`src/release/release-commits.ts`) stays the version authority.
- No 1.0 semver-stability commitment; this entry ships 0.x to the registry.

## Design

### Unit 1 — Registry + name decision (config-free)

Public npm, unscoped name `noldor` (verified unclaimed in the 2026-07-01 audit). `package.json` already has `"private": false`, `bin`, `files`, and `"prepare": "tsc"` (so `dist/` is built at pack time). No package.json rename needed; `packageManager: pnpm@9.7.1` (PR #135) pins the toolchain for CI. First publish requires `--access public` (npm default for unscoped is public, but pass it explicitly in the workflow for determinism).

### Unit 2 — `publish.yml` tag-triggered workflow (the publish executor)

New `.github/workflows/publish.yml` beside `contract-e2e.yml`, triggered on `push: tags: ['v*']`:

1. checkout the tag (`fetch-depth: 1` is fine — no changelog walk here),
2. `pnpm/action-setup` (resolves from `packageManager`) + `actions/setup-node` with `registry-url: https://registry.npmjs.org`,
3. version guard: fail if `package.json` `version` ≠ tag minus `v` (protects against a hand-made tag on the wrong commit),
4. `pnpm install --frozen-lockfile` (runs `prepare` → `tsc` → `dist/`),
5. `pnpm test:contract` — the tarball-shape check (`installFrameworkTarball` + `runContractChecks`) is the "final pack + scratch-dir install verification" from the entry body, run against the exact bits about to publish,
6. `npm publish --provenance --access public`.

Provenance requires CI OIDC — `npm publish --provenance` errors outside CI, which is why the executor is a workflow, not local code (D3). Workflow declares `permissions: { id-token: write, contents: read }`. Auth via npm **Trusted Publishing** (one-time manual setup on npmjs.com linking repo + workflow filename) — no `NPM_TOKEN` secret to rotate or leak.

### Unit 3 — publish-verification rung in `src/release/index.ts`

The local pipeline gains a final rung that *waits for* the workflow's outcome rather than publishing itself:

- New module `src/release/release-publish.ts` exporting `awaitPublish({ version, timeoutMs, pollMs })`: polls `npm view noldor@<version> version --json` (via the existing `run()` execFile helper pattern) until it resolves, with a default ~5 min timeout for registry/workflow lag. Returns `{ ok, elapsedMs }`; timeout → throws with a message pointing at `gh run list --workflow publish.yml` and `pnpm release --resume`.
- `main()`: after `gh release create` (line 524) and **before** `clearReleaseState(process.cwd())` (line 525), call `awaitPublish` — but only when the `release.publish` config block enables it (Unit 4). Moving `clearReleaseState` after the rung means a publish failure leaves `.noldor/release-state.json` behind, so `assertNoInProgressRelease` (line 134) forces the operator into `--resume` instead of a half-released limbo.
- `resumeRelease()`: append **rung 7 — publish** after the gh-release rung (line 296), same skip-if-done shape as rungs 3–6: `npm view` resolves → `→ publish: noldor@<v> already on registry (skipped)`; otherwise re-enter `awaitPublish` (the tag push from rung 5 already triggered the workflow; resume only waits/verifies). `clearReleaseState` stays last.

### Unit 4 — `release.publish` config block (consumer safety)

Extend `releaseConfigSchema` (`src/cr/config.ts:78`, currently only `crGateExemptCommits`):

```ts
publish: z
  .object({
    enabled: z.boolean().default(false),
    registry: z.string().url().default('https://registry.npmjs.org'),
    distTag: z.string().default('latest'),
  })
  .optional(),
```

Default-off: Charuy and every other consumer running the vendored pipeline gets byte-identical behavior with no config change. Only Noldor's own `.noldor/config.json` sets `"release": { "publish": { "enabled": true } }`. `registry`/`distTag` are read by `awaitPublish` (poll target) and echoed in logs; the workflow hard-codes npmjs + `latest` pre-1.0 (D4).

### Unit 5 — `noldor release publish` manual subcommand (fallback + local dry-run)

Add to the `release` group in `src/cli/manifest.ts:201` (today only `run`):

- `publish` → `src/release/release-publish.ts` CLI entry. Modes:
  - `--verify-tarball` (default when no other flag): reuse `buildConsumerFixture` + `installFrameworkTarball` + `runContractChecks` from `src/testing/` to pack the working tree and prove the installed shape locally — the pre-flight an operator runs before tagging.
  - `--local`: emergency executor for CI-down. Guards first (branch = main, clean `git status --porcelain`, HEAD tag `v<pkg.version>` exists — same checks as `ensureCleanTreeOnMain`, which gets exported from `src/release/index.ts` for reuse), then `npm publish --access public` **without** provenance, printing a loud warning and writing an `appendOverrideLog(cwd, 'release publish --local', 'release')` breadcrumb (`src/core/overrides-log.ts`) so the garden override-audit sees it.
  - `--wait <version>`: bare `awaitPublish` invocation, for finishing a release whose state file was already cleared.

### Unit 6 — docs rewrite

- `README.md` Quick start: lead with `pnpm add -D noldor && pnpm noldor init && pnpm noldor doctor`; move the `file:../noldor` sibling-clone block under Development as the contributor path; drop the "npm publication is tracked on the roadmap" sentence from Status.
- `docs/noldor/adoption-guide.md` Bootstrap §1: "Install" step becomes `pnpm add -D noldor` (registry), with a one-line note that framework contributors use `file:` instead.
- `docs/noldor/versioning.md`: short section — tag `vX.Y.Z` ↔ npm version, `latest` is the only dist-tag pre-1.0, upgrade flow stays `pnpm up noldor && pnpm noldor doctor && pnpm noldor upgrade` (migration chain from PR #104 unchanged).
- Both doc edits carry `noldor`/`noldor:page` commit scopes and template-twin updates where the page has one (`templates/` copies, per the template-sync check in `src/checks/check-template-sync.ts`).

## Acceptance criteria

- Fresh temp dir on a machine (or scratch dir) with no sibling clone: `pnpm init && pnpm add -D noldor && pnpm noldor init && pnpm noldor doctor` → doctor green.
- `npm view noldor version` resolves to the released version; npm package page shows a provenance attestation.
- `pnpm release` on Noldor main runs every existing gate unchanged, and only reaches `awaitPublish` after commit+tag+push+GitHub-Release succeed; `.noldor/release-state.json` is cleared only after the version is visible on the registry.
- With `release.publish` absent or `enabled: false` (contract fixture / Charuy), `pnpm release` output is byte-identical to today — no `npm` invocation, state cleared right after `gh release create`.
- Killing the pipeline between tag-push and registry visibility, then `pnpm release --resume`, skips rungs 3–6 and completes rung 7 (verified in a test alongside `src/release/__tests__/` release-state tests, with `npm view` stubbed).
- `noldor release publish --verify-tarball` passes on a clean main (reuses contract harness); `--local` refuses on a dirty tree or missing HEAD tag.
- Unit tests: `releaseConfigSchema` parses/defaults the `publish` block; `awaitPublish` resolves on first poll, retries on 404, throws on timeout (mocked exec); manifest lists `release publish` in `--help`.
- README Quick start and adoption-guide Bootstrap §1 show the registry path; `file:` remains documented as the contributor path.

## Risks / trade-offs

- **Name race:** `noldor` unclaimed as of 2026-07-01 — claim can be lost any day. Mitigation: first workflow-driven publish (even 0.4.x) claims it; treat as the first deliverable.
- **Trusted-publisher setup is manual and untestable until the first tag fires.** Mitigation: `--local` fallback publishes the claim if the workflow misconfigures; workflow dry-runs are impossible for provenance, accept one iteration loop.
- **Registry propagation lag** can flake `awaitPublish`. Mitigation: 5-min timeout + poll interval, and timeout leaves the resume token so nothing is lost — re-run `--resume` or `release publish --wait`.
- **Split executor (CI publishes, local verifies)** adds a moving part vs. pure-local publish; accepted because local `npm publish --provenance` is impossible (D3) and token-less auth is strictly safer.
- **`files` whitelist drift** could ship a broken tarball; contract CI on PRs plus the workflow's `pnpm test:contract` step (Unit 2, step 5) gate both edges.
- **tsx-at-runtime packaging** (`bin/noldor.mjs` registers tsx and imports `src/cli/index.ts`) means `src/` must stay in `files` forever or the published bin breaks — already true today, now load-bearing for strangers; noted in versioning.md.

## User Story

As a maintainer of any repository on any machine, I want to install Noldor with `pnpm add -D noldor` from the public npm registry, so that I can adopt the framework with pinned, resolvable versions and no sibling clone of the framework repo.

## Usage

**Adopter (any repo, any machine):**

```bash
pnpm init                     # or an existing repo
pnpm add -D noldor            # registry install — no sibling clone
pnpm noldor init              # scaffold docs/noldor, hooks, .noldor/config.json
pnpm noldor doctor            # health check → green
```

**Releasing operator (Noldor repo):**

```bash
pnpm release                  # existing gates → commit → tag → push → GH release
                              # → tag triggers publish.yml (npm publish --provenance)
                              # → pipeline polls registry until noldor@<v> visible
pnpm release --resume         # after any interruption; rung 7 verifies/waits on publish
```

**Fallback / pre-flight:**

```bash
pnpm noldor release publish --verify-tarball   # local pack + scratch install check
pnpm noldor release publish --wait 0.5.0       # re-attach to an in-flight publish
pnpm noldor release publish --local            # CI-down emergency, no provenance, logged
```

**Agent API:** none beyond the CLI — the gate/drain machinery is unaffected; publish is release-pipeline-only.

## Open questions (resolved)

1. *Public npm or GitHub Packages (private-first)?*
   -> (D1) Public npm. GitHub Packages requires an authenticated `.npmrc` even for public reads, which re-creates the adoption friction this entry exists to remove; the stated goal is "any repo anywhere adopts without cloning."

2. *Unscoped `noldor` or a scope (`@zoufaly/noldor` etc.)?*
   -> (D2) Claim unscoped `noldor` — verified unclaimed 2026-07-01. Zero ripple: `package.json` name, README, adoption-guide, `init` output, and every `pnpm noldor …` invocation already assume the bare name; a scope would touch all of them for no benefit while the name is free.

3. *Where does the publish actually execute — local pipeline or CI?*
   -> (D3) Tag-triggered GitHub Actions workflow with npm Trusted Publishing; the local pipeline's new last rung only *verifies* registry visibility (`awaitPublish`). `npm publish --provenance` is impossible outside CI OIDC, and trusted publishing removes the long-lived-token risk; `release publish --local` remains as a logged, provenance-less emergency hatch.

4. *Semver tag → npm dist-tag mapping — `latest` only pre-1.0?*
   -> (D4) Yes, `latest` only. Pre-1.0 there is one consumer channel and the migration chain (`noldor upgrade`, PR #104) handles skew; introduce `next` only when a 1.0 stabilization branch exists. `distTag` already sits in the config schema so the flip is a one-liner later.

5. *Should consumer repos running the vendored pipeline ever publish?*
   -> (D5) No — `release.publish.enabled` defaults `false` in `releaseConfigSchema`, so Charuy and the contract fixture keep byte-identical release behavior; only Noldor's own config opts in.
