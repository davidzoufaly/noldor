# Public npm Cutover — Design

**Slug:** registry-distribution-for-the-noldor-package
**FD:** docs/features/registry-distribution-for-the-noldor-package.md
**Date:** 2026-07-15
**Tier:** full
**Enhancement:** public-npm-cutover
**Deps:** none

## Problem

The `registry-distribution` feature (PR #139, then #168) settled Noldor as a **private GitHub Packages** scoped package `@davidzoufaly/noldor`. The stated rationale — "the tarball ships readable `src/` (a tsx-on-source runtime), so a public registry is not an option" ([`README.md:3`](../../README.md)) — is a deliberate closed-source stance. That stance is now reversed: the project is going open source (GitHub repo already flipped public). The private-registry machinery actively blocks that goal:

- Consumers must author an `.npmrc` with `@davidzoufaly:registry=https://npm.pkg.github.com` + a `read:packages` `NPM_TOKEN` before `pnpm add` resolves ([`README.md:13-27`](../../README.md)). Public OSS should install with zero auth.
- `.github/workflows/publish.yml` publishes to `npm.pkg.github.com` via the built-in `GITHUB_TOKEN`, scoped to `@davidzoufaly`, deliberately **without** `--access public` so the scoped package stays restricted ([`publish-workflow.test.ts:62-74`](../../src/release/__tests__/publish-workflow.test.ts)).
- `src/release/release-publish.ts` bakes GitHub-Packages-private semantics into the release poller: `DEFAULT_REGISTRY = 'https://npm.pkg.github.com'` and `isRegistryAuthError` throws a `read:packages` error on any 401/403, because a private read needs a token.
- The Zod config default (`config.ts:89`) and three test suites assert the private design.

## Goals

- Publish `noldor` to **public npm** (`registry.npmjs.org`), installable with `pnpm add -D noldor` — no `.npmrc`, no token, for consumers.
- Rename the package `@davidzoufaly/noldor` → unscoped **`noldor`** (verified unclaimed on npm, 2026-07-15).
- CI publishes on tag, authed by an `NPM_TOKEN` repo secret (npm **automation token**), with build **provenance** on.
- Purge the "closed-source / private / token-gated" framing from the live docs.

## Non-goals

- **OIDC trusted publishing** — evaluated and declined (D1); token auth chosen.
- **Consumer dep migration** (`charuy` still pins `@davidzoufaly/noldor`) — a separate follow-up in that repo, its own gate (D5).
- **The version bump.** The rename is breaking → MAJOR at release; the tag/version is a release-time concern, not a code change in this PR (D6).
- **Archived dated specs** under `docs/design/specs/archive/` — historical record, left verbatim.
- **Contract harness** (`src/testing/consumer-fixture.ts`, `pnpm test:contract`) — installs from a local `pnpm pack` tarball, registry-agnostic; no change (verified in plan).
- **Repo-wide `pre-1.0` wording audit** — only the two blocks this change already rewrites (README line 3, `config.ts:83-88`) get their stale `pre-1.0` clause dropped. Hunting every other `pre-1.0` occurrence is a separate chore.

## Design

Six named units.

### 1. Package identity — `package.json`

- `name`: `@davidzoufaly/noldor` → `noldor`.
- `publishConfig`: `{ "registry": "https://npm.pkg.github.com" }` → `{ "registry": "https://registry.npmjs.org" }`. Unscoped ⇒ public by default, so **no** `access` key needed. Provenance is a workflow-only concern (CI OIDC) and lives as the `--provenance` flag in `publish.yml`, **not** in `publishConfig` — otherwise a local `--local` publish (no CI OIDC) would try and fail to attest.
- `private: false` unchanged.
- **Add `repository`, `homepage`, `bugs`** (all currently absent). `npm publish --provenance` **requires** `repository.url` — npm aborts with `EUSAGE: package.json must have a "repository" field for provenance generation` when it is missing, so this is a provenance prerequisite, not merely OSS hygiene:
  - `"repository": { "type": "git", "url": "git+https://github.com/davidzoufaly/noldor.git" }`
  - `"homepage": "https://github.com/davidzoufaly/noldor#readme"`
  - `"bugs": "https://github.com/davidzoufaly/noldor/issues"`

### 2. Publish workflow — `.github/workflows/publish.yml`

- `permissions`: drop `packages: write`; keep `contents: read`; add `id-token: write` (provenance).
- `actions/setup-node` `with`: `registry-url: https://registry.npmjs.org`; **remove** `scope: '@davidzoufaly'` (unscoped).
- publish step: `npm publish --provenance` (no `--access public` — unscoped is public); `env.NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`.
- Unchanged: `on: push tags v*`, the tag-vs-`package.json` version guard before install, `pnpm test:contract` before publish.

### 3. Release poller — `src/release/release-publish.ts`

- `DEFAULT_REGISTRY` (line 15) → `'https://registry.npmjs.org'`.
- `isVersionOnRegistry` (line 69): **remove** the `isRegistryAuthError` fatal-throw branch. Public `npm view` reads are unauthenticated, so a 401/403 is no longer "missing `read:packages`" — treat every `npm view` failure as "not visible yet" → return `false`, keep polling. Delete the now-dead `isRegistryAuthError` helper (lines 40-58). **Rewrite this fn's own doc comment (lines 60-68)** — it currently narrates the private-GH-Packages throw ("A 401 or 403 is different… throw a clear error instead of polling"); after the branch is gone that comment lies, so it must describe the public-read semantics.
- `awaitPublish` doc comment (line 112): `GITHUB_TOKEN` → `NPM_TOKEN`.
- `publishLocal` (line 189): comment/warning update — `--local` write auth is now an npm publish token in `.npmrc`/`NODE_AUTH_TOKEN`, not GH-Packages `write:packages`.
- **Sweep every remaining GH-Packages narrative** in this file's comments (not just the three named above) — the acceptance `src/` grep below is the backstop.

### 4. Tests

- [`publish-workflow.test.ts`](../../src/release/__tests__/publish-workflow.test.ts) — **linchpin rewrite.** New assertions: `registry-url` = `https://registry.npmjs.org`; **no** `scope`; `permissions` = `{ contents: read, id-token: write }`; publish `run` contains `npm publish` **and** `--provenance`, and (unscoped) still **not** `--access public`; `env.NODE_AUTH_TOKEN` = `${{ secrets.NPM_TOKEN }}`. Keep the tag-guard-before-install and contract-before-publish ordering tests.
- [`release-publish.test.ts`](../../src/release/__tests__/release-publish.test.ts) — **sweep the whole file** (7 forbidden-literal hits), not line-scoped: (a) replace the two "401/403 → throws `read:packages`" tests (lines 51-71) with one "a 401/403 during `npm view` resolves `false` (keeps polling)" test locking public semantics; (b) **delete the "404 whose spec carries 401-like digits → false" test (lines ~73-85)** — it existed only to guard the bare-`\b401\b` false-positive inside the now-deleted `isRegistryAuthError`; post-change it asserts a vanished concern; (c) purge every hard-coded `https://npm.pkg.github.com` and `@davidzoufaly/noldor` literal; the `DEFAULT_REGISTRY` assertion (line 39) follows the new value.
- [`config.test.ts`](../../src/core/__tests__/config.test.ts) — **sweep the whole file** (3 hits): the `release.publish.registry` default value (lines 231, 243) → `https://registry.npmjs.org`, **and** the test title at line 227 (`'defaults enabled=false, GitHub Packages registry, …'`, which carries the forbidden "GitHub Packages" literal) → retitle for npmjs.

### 5. Config default — `src/core/config.ts`

- Line 89: `registry: z.string().url().default('https://npm.pkg.github.com')` → `.default('https://registry.npmjs.org')`.
- **Update the comment block above it (lines ~83-88)** — it describes the "publish EXECUTOR (GitHub Packages, authed with `GITHUB_TOKEN`)"; after the default flips this misdescribes the executor + registry, so rewrite it for npmjs + `NPM_TOKEN`. It also carries a stale "the workflow hard-codes `latest` **pre-1.0**" clause — drop the `pre-1.0` qualifier (package is v1.0.0; this cutover → v2.0.0).

### 6. Docs (live + template twins)

Drop closed-source/private/token framing; install becomes `pnpm add -D noldor`.

- [`README.md`](../../README.md) — intro (line 3), Install § (13-27), CI/deploy note, Contributing `file:` example name. The line-3 sentence also carries a stale "Noldor is pre-1.0" clause (package is already v1.0.0) — drop it while rewriting that sentence.
- [`docs/noldor/adoption-guide.md`](../../docs/noldor/adoption-guide.md) **+** [`templates/docs/noldor/adoption-guide.md`](../../templates/docs/noldor/adoption-guide.md) — install + CI-auth-trap sections.
- [`docs/noldor/versioning.md`](../../docs/noldor/versioning.md) **+** [`templates/docs/noldor/versioning.md`](../../templates/docs/noldor/versioning.md) — private-package references.
- [`docs/backlog.md`](../../docs/backlog.md) — name/registry references.
- Parent FD `User Story` + `Usage` — refreshed by `/noldor-draft-feature-md --refresh --usage-only` at gate end-of-flow (not hand-edited here).

`docs/noldor/*.md` are template twins of `templates/docs/noldor/*.md`; both sides must move together or `check-template-sync` fails.

## Acceptance criteria

- `pnpm verify` (lint + fmt:check + typecheck + test) green in the worktree.
- `pnpm test:contract` green (tarball install unaffected by registry change).
- `package.json`: `name === "noldor"`; `publishConfig.registry === "https://registry.npmjs.org"`; no `publishConfig.access` key (unscoped); `repository.url` present (provenance prerequisite).
- `publish.yml`: registry npmjs, no `scope`, `permissions` has `id-token: write` and no `packages: write`, publish step has `--provenance`, no `--access public`, `NODE_AUTH_TOKEN` = `secrets.NPM_TOKEN` — all asserted by the rewritten `publish-workflow.test.ts`.
- `isVersionOnRegistry` returns `false` (does not throw) on a 401/403 — asserted by the rewritten `release-publish.test.ts`.
- `release.publish.registry` Zod default is `https://registry.npmjs.org` — asserted by `config.test.ts`.
- `grep -riE "@davidzoufaly/noldor|npm\.pkg\.github\.com|closed-source|github packages|read:packages"` over live README + `docs/noldor/{adoption-guide,versioning}.md` + `docs/backlog.md` (and their `templates/` twins): **zero** — the `github packages` term catches the "private GitHub Packages" prose (symmetric with the `src/` grep); bare `private` is deliberately excluded (legitimate uses like `"private": false`).
- `grep -riE "npm\.pkg\.github\.com|github packages|read:packages|GITHUB_TOKEN" src/`: **zero** — no stale private-registry narrative survives in source comments or tests.
- `check-template-sync` passes (twins mirrored).

## Risks / trade-offs

- **Breaking rename.** `@davidzoufaly/noldor` → `noldor` breaks every consumer's dep string → MAJOR bump (v2.0.0) at release; `charuy` update is a tracked follow-up (D5).
- **Release-blocking operator step.** First `npm publish` creates `noldor` on npm — but only if the `NPM_TOKEN` secret exists in the repo *before* the release tag, else `publish.yml` 401s. Out of code scope; called out in Usage so it is not forgotten.
- **Provenance prerequisites.** Needs a public repo (✅ flipped), `id-token: write` (workflow), and a `package.json` `repository` field (added in §1 — `npm publish --provenance` errors `EUSAGE` without it); all satisfied.
- **Relaxed poller auth handling.** Dropping the fatal 401/403 throw trades a crisp "missing token" message for polling-to-timeout should a public read ever 401/403 (misconfig). Acceptable: public reads need no auth, so this is near-unreachable, and the timeout message already names `publish.yml` + `--resume` for recovery.
- **Template-twin drift.** Editing `docs/noldor/*` without the `templates/` twin fails `check-template-sync`; the plan pairs every doc edit with its twin.

## User Story

As a maintainer of any repository, I want to install Noldor with `pnpm add -D noldor` from public npm — no `.npmrc`, no token — so that adoption has zero auth friction and the framework is openly available.

## Usage

**Adopter (any repo):**

```bash
pnpm add -D noldor      # public npm — no .npmrc, no token
pnpm noldor init        # scaffold docs/noldor, hooks, .noldor/config.json
pnpm noldor doctor      # health check → green
```

**Releasing operator (Noldor repo) — one-time setup:**

```bash
# 1. npmjs.com → create an automation token (publish rights)
# 2. GitHub repo → Settings → Secrets → Actions → add NPM_TOKEN
```

**Releasing operator — per release:**

```bash
pnpm release            # existing gates → commit → tag → push → GH release
                        # → tag triggers publish.yml (npm publish --provenance via NPM_TOKEN)
                        # → pipeline polls registry.npmjs.org until noldor@<v> visible
pnpm release --resume   # after any interruption
```

**Agent API:** none beyond the CLI — the gate/drain machinery is unaffected; publish is release-pipeline-only.

## Open questions (resolved)

1. *Auth: OIDC trusted publishing vs an `NPM_TOKEN` secret?* -> **`NPM_TOKEN` automation token** (D1). Operator chose token; OIDC adds a one-time npmjs web config + a first-publish bootstrap-token dance for no consumer-side benefit.
2. *Name: keep scoped `@davidzoufaly/noldor` or go unscoped `noldor`?* -> **unscoped `noldor`** (D2). Verified free on npm; consumer churn is identical to any rename; no scope/org/corporate-account coupling; unscoped is public by default (no `--access public`).
3. *Keep the private-read auth-error throw in `isVersionOnRegistry`?* -> **drop it** (D3). Public reads are unauthenticated, so the `read:packages` message is obsolete and misleading; any `npm view` failure → keep polling.
4. *Provenance on?* -> **yes** (D4). Free supply-chain-trust signal for an OSS package; repo is public so attestation works. `id-token: write` + `--provenance`.
5. *Migrate the `charuy` consumer dep in this PR?* -> **no** (D5). Different repo, its own gate; keeps this change focused on the framework.
6. *Set the version bump here?* -> **no, note only** (D6). Breaking rename → MAJOR (v2.0.0), applied at release time, not in this PR.
