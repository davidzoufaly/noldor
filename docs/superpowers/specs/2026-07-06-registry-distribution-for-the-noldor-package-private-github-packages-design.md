# Private GitHub Packages Distribution — Design

**Slug:** registry-distribution-for-the-noldor-package
**Enhancement:** private-github-packages
**FD:** docs/features/registry-distribution-for-the-noldor-package.md
**Date:** 2026-07-06
**Tier:** specs-only

## Problem

`registry-distribution-for-the-noldor-package` (shipped PR #139, spec `2026-07-03-registry-distribution-for-the-noldor-package-design.md`) chose **public npmjs** distribution: unscoped package name `noldor`, `publish.yml` running `npm publish --access public` against `https://registry.npmjs.org`, provenance config-gated behind a public repo. The decision rationale was a frictionless `pnpm add -D noldor` install and OIDC Trusted Publishing from a private repo.

That design does not achieve closed-source distribution, which is now the operator's requirement:

- **A private GitHub repo does not keep the code private.** `package.json` `files` ships `["dist","src","bin","templates"]`, and noldor runs tsx-on-source, so `src/` is the executed runtime — it must ship. `npm publish --access public` therefore uploads the **full readable source** to a world-downloadable tarball. Repo-private + package-public = source public.
- The frictionless-install rationale is now outranked by "the source must not be public."

The public-npm publish never went live (`npm view noldor` → E404; `release.publish.enabled` defaults false), so there is no published version to deprecate — this is a pre-launch redirection, not a migration off a live registry.

## Decision

Distribute noldor as a **private GitHub Packages** npm package under scope **`@davidzoufaly`** (must equal the repo owner `davidzoufaly/noldor`). Package visibility inherits the private repo. Fully replaces the public-npm path — no dual-publish (a public mirror would re-leak the source and defeat the purpose).

The bin command stays `noldor` (only the package *name* is scoped); consumers still run `pnpm noldor …`.

## Design

### 1. `package.json`
- `name`: `noldor` → `@davidzoufaly/noldor`.
- `publishConfig`: `{ "registry": "https://npm.pkg.github.com" }` — pins publish + scoped installs to GH Packages.
- `bin`: unchanged (`{ "noldor": "bin/noldor.mjs" }`) — CLI verb stays `noldor`.
- `files`: unchanged.

### 2. `.github/workflows/publish.yml`
- `registry-url`: `https://registry.npmjs.org` → `https://npm.pkg.github.com`; add `scope: '@davidzoufaly'` to the `setup-node` step.
- Auth: drop the npmjs OIDC path (`permissions.id-token: write`, Trusted Publisher). Use `permissions.packages: write` + `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` (the built-in token can publish packages to its own repo).
- Drop the `--provenance` gate entirely (npm provenance is a public-registry/sigstore feature; N/A on GH Packages). Publish is plain `npm publish` (scoped packages default to `--access restricted`; no `--access public`).

### 3. Release code (`src/release/release-publish.ts`, `src/release/index.ts`)
- `isVersionOnRegistry` / `awaitPublish` / `readPkgIdentity`: the post-tag publish verification (rung 7) must query the GH Packages registry for `@davidzoufaly/noldor@<version>`, not `registry.npmjs.org`.
- `release.publish.registry` config default → `https://npm.pkg.github.com`. The verify step needs an auth token in the release environment (`read:packages`) to see a private package — surface a clear error when the registry probe 401s vs genuinely-absent (404), so a missing token is not misread as "publish failed".
- Scoped-name identity: `readPkgIdentity` already reads `package.json` `name`, so it picks up `@davidzoufaly/noldor` automatically; verify the registry URL construction handles the `@scope%2Fname` encoding GH Packages expects.

### 4. Consumer-facing docs (`docs/noldor/adoption-guide.md` + template twin, `README.md`, any `registry.npmjs.org` / `pnpm add -D noldor` reference)
- Install step: `pnpm add -D @davidzoufaly/noldor`, preceded by a project `.npmrc`:
  ```
  @davidzoufaly:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
  ```
  where `NPM_TOKEN` is a GitHub PAT (classic or fine-grained) with **`read:packages`** and access to the noldor repo.
- CI note: the consumer's build/deploy pipeline (`npm ci` / `pnpm install`) needs the same `.npmrc` + a `NPM_TOKEN` repo secret. Call this out explicitly — it is the exact gap that blocked ps-offsite (friction #15: `file:../noldor` could not resolve on the Pages-deploy `npm ci`). GH Packages auth replaces the public-npm unblock.
- Twin parity: `templates/docs/noldor/adoption-guide.md` must match `docs/noldor/adoption-guide.md` (template-sync check).

## Consumer contract change

Every consumer and every consumer CI job now needs a `read:packages` token wired as `NPM_TOKEN`. This is the deliberate cost of closed distribution — auth everywhere in exchange for a non-public tarball. The previous "frictionless unscoped install" is gone by design.

## Trade-offs

- **Loses** frictionless `pnpm add -D noldor`; **gains** private source.
- **Provenance dropped** (public-repo/sigstore feature) — acceptable; provenance was already config-gated off.
- **Scope tied to repo owner.** `@davidzoufaly` is correct while the repo is `davidzoufaly/noldor`. Moving to a GoodData org later re-scopes the package and re-churns every consumer `.npmrc` — that is a separate migration, explicitly out of scope here.
- **GITHUB_TOKEN publish** works only for same-repo packages; fine for the single-repo case.

## Out of scope

- Moving the repo to a GoodData org (separate repo transfer + org GH Packages access).
- Wiring ps-offsite's consumer-side `.npmrc` + CI `NPM_TOKEN` secret (that lives in the consumer repo).
- Any public mirror / dual-publish.

## Acceptance

- `package.json` name is `@davidzoufaly/noldor` with `publishConfig.registry` = GH Packages; `pnpm noldor --version` still works locally.
- `publish.yml` publishes `@davidzoufaly/noldor` to `npm.pkg.github.com` via `GITHUB_TOKEN`, no OIDC/provenance path, on a `v*` tag.
- Release rung 7 verifies the version against the GH Packages registry and distinguishes 401 (missing token) from 404 (not published).
- `adoption-guide.md` (+ twin) and README document the scoped install + `.npmrc` + `read:packages` token; no surviving `registry.npmjs.org` / `--access public` / unscoped `pnpm add -D noldor` references.
- `pnpm verify` green (typecheck + lint + tests).

## Open questions

- **dist-tag strategy** — keep `latest`-only pre-1.0 (carried from the parent spec) or add a channel? Default: unchanged.
- **`files` slimming** — should `dist/` stay in the tarball now that the runtime is tsx-on-`src`? Out of scope here; noting for a later cleanup.
- **Token type for consumers** — classic PAT (`read:packages`) vs fine-grained (per-repo package read). Document both; recommend fine-grained.
