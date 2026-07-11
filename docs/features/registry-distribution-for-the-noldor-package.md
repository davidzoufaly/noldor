---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/release/release-publish.ts
    - src/release/index.ts
    - src/cr/config.ts
    - src/cli/manifest.ts
    - .github/workflows/publish.yml
  docs:
    - docs/noldor/versioning.md
    - docs/noldor/adoption-guide.md
  tests:
    - src/release/__tests__/publish-workflow.test.ts
    - src/release/__tests__/release-publish-cli.test.ts
    - src/release/__tests__/release-publish.test.ts
  spec: >-
    docs/superpowers/specs/archive/2026-07-03-registry-distribution-for-the-noldor-package-design.md
name: Registry Distribution for the Noldor Package
packages:
  - scripts
phase: done
noldor-tier: specs-only
introduced: 0.5.0
---

## Summary

Today a consumer installs Noldor as a `file:` dependency and must keep a clone of `noldor/` as a sibling directory of their repo. That is the single hardest blocker for any project that is not on this machine. Publish the package to a registry so adoption starts with `pnpm add -D noldor`.

Package hygiene largely shipped in PR #119 (tarball `files` filter drops the self-host `docs/` tree, tolerant postinstall for missing lefthook, config scaffold in `templates/.noldor/config.json`, `pnpmStderrPrefix` optional). Backlog entry `cli-standalone-tool` merged here 2026-07-02 — same problem, registry install IS the standalone path. Remaining:

- Decide registry: public npm vs GitHub Packages. `noldor` on npm verified unclaimed (2026-07-01 audit); claim it or pick a scope — scoped name ripples into `consumer-config` docs and `init` output, so decide before publishing anything.
- Extend `src/release/` so `pnpm release` gains a publish step (or a separate `release publish` subcommand): build → pack → publish with provenance, tag-driven, after the existing commit-tag-push succeeds (`src/release/index.ts:294-300` currently ends at git push). Must respect the existing release gates; publishing is the new last step, never runs on a dirty tree.
- Final `pnpm pack` + scratch-dir install verification (tarball mechanics already proven by contract CI, verify the published shape end-to-end).
- Docs: rewrite README Quick start and adoption-guide Bootstrap §1 for the registry path; keep `file:` documented as the contributor/dev path.

**What it enables:** any repo anywhere adopts without cloning the framework; precondition for a credible consumer-#2 dogfood on a machine that isn't this one (versions pinnable + resolvable; migration chain already shipped, PR #104).

**Open questions:** npm public vs GitHub Packages (private-first?); semver tag → npm dist-tag mapping (`latest` only pre-1.0?).

**Acceptance sketch:** fresh temp dir, `pnpm init && pnpm add -D noldor && pnpm noldor init && pnpm noldor doctor` → green, no sibling clone present.

## User Story

As a maintainer of any repository on any machine, I want to install Noldor from a private registry with `pnpm add -D @davidzoufaly/noldor` (GitHub Packages, authed with a `read:packages` token), so that I can adopt the framework with pinned, resolvable versions and no sibling clone — without the framework's source going public.

## Usage

**Adopter (any repo, any machine):**

```bash
pnpm init                              # or an existing repo
# project .npmrc:
#   @davidzoufaly:registry=https://npm.pkg.github.com
#   //npm.pkg.github.com/:_authToken=${NPM_TOKEN}   # read:packages token
pnpm add -D @davidzoufaly/noldor       # private GitHub Packages — no sibling clone
pnpm noldor init                       # scaffold docs/noldor, hooks, .noldor/config.json
pnpm noldor doctor                     # health check → green
```

**Releasing operator (Noldor repo):**

```bash
pnpm release                  # existing gates → commit → tag → push → GH release
                              # → tag triggers publish.yml (npm publish via GITHUB_TOKEN)
                              # → pipeline polls GH Packages until @davidzoufaly/noldor@<v> visible
pnpm release --resume         # after any interruption; rung 7 verifies/waits on publish
```

**Fallback / pre-flight:**

```bash
pnpm noldor release publish --verify-tarball   # local pack + scratch install check
pnpm noldor release publish --wait 0.5.0       # re-attach to an in-flight publish
pnpm noldor release publish --local            # CI-down emergency (bypasses workflow), logged
```

**Agent API:** none beyond the CLI — the gate/drain machinery is unaffected; publish is release-pipeline-only.

## PRs

<!-- @prs-since-last-release: registry-distribution-for-the-noldor-package -->

## Changelog

### Initial Release (v0.5.0)

#### Summary

Added a `release.publish` config block that ships default-off for consumer safety (#139).

#### PRs

- #139: add release.publish config block (default-off consumer safety) ([link](https://github.com/davidzoufaly/noldor/pull/139))

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-07-03-registry-distribution-for-the-noldor-package-design.md`](../../docs/superpowers/specs/archive/2026-07-03-registry-distribution-for-the-noldor-package-design.md)
- **Code:**
  - [`src/release/release-publish.ts`](../../src/release/release-publish.ts)
  - [`src/release/index.ts`](../../src/release/index.ts)
  - [`src/cr/config.ts`](../../src/cr/config.ts)
  - [`src/cli/manifest.ts`](../../src/cli/manifest.ts)
  - [`.github/workflows/publish.yml`](../../.github/workflows/publish.yml)
- **Tests:**
  - [`src/release/__tests__/publish-workflow.test.ts`](../../src/release/__tests__/publish-workflow.test.ts)
  - [`src/release/__tests__/release-publish-cli.test.ts`](../../src/release/__tests__/release-publish-cli.test.ts)
  - [`src/release/__tests__/release-publish.test.ts`](../../src/release/__tests__/release-publish.test.ts)
- **Docs:**
  - [`docs/noldor/versioning.md`](../../docs/noldor/versioning.md)
  - [`docs/noldor/adoption-guide.md`](../../docs/noldor/adoption-guide.md)

<!-- /generated: resources -->
