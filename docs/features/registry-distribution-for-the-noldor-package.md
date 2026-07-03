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
    - src/release/__tests__/release-resume.test.ts
    - src/cr/__tests__/config.test.ts
  spec: >-
    docs/superpowers/specs/2026-07-03-registry-distribution-for-the-noldor-package-design.md
name: Registry Distribution for the Noldor Package
packages:
  - scripts
phase: done
noldor-tier: specs-only
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

## PRs

<!-- @prs-since-last-release: registry-distribution-for-the-noldor-package -->

## Changelog
