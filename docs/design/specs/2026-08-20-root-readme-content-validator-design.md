# Root README Content Validator — Design

**Slug:** root-readme-content-validator
**FD:** docs/features/root-readme-content-validator.md
**Date:** 2026-08-20
**Tier:** full
**Deps:** none blocking. Q-0136 (typed advisory/blocking gap channels) is a follow-up, not a prerequisite — see Design § Channel. Q-0147 carries the residue named in Risks.

## Problem

Root `README.md` is the only doc surface the framework never inspects for content. Four mechanisms touch the file and none read what it says:

- `pnpm noldor docs check` walks `docs/` then appends `README.md` ([`src/docs/docs-check.ts:222`](../../../src/docs/docs-check.ts)), but `checkLinks` only resolves internal links — it never asks whether the prose is true.
- The `bootstrap commands` rule-pair asserts `/pnpm test\b/` appears in the README ([`src/invariants/rule-pairs.ts:62`](../../../src/invariants/rule-pairs.ts)) at `severity: 'warn'`, soft by design because the README is consumer-owned.
- SDD detector 12 `detectReadmePackageDrift` ([`src/garden/sdd-report.ts:490`](../../../src/garden/sdd-report.ts)) keys on a `### Packages` table and `packages/<prefix>-*` directories. This repository has neither, so the detector is dead here.
- Release-sweep step 4 is prose asking an LLM to eyeball the architecture, stack and command sections.

The measured miss: Q-0093 shipped a `docs architecture` subcommand plus a four-page `docs/architecture/` surface with its own validator, garden detector, SDD gap and release probe — and the README's `## CLI reference` and `## Docs` sections both stayed silent. The string "architecture" appears nowhere in `README.md`.

Two facts discovered while grounding reshape the original three-check proposal:

1. **`## CLI reference` declares itself non-exhaustive** — "this is the journey-critical subset, **not exhaustive**" ([`README.md:116`](../../../README.md)). It lists 9 groups against 35 in `MANIFEST`, and the `docs` group is absent entirely. A manifest→README completeness check would demand 35 rows and contradict the section's stated contract.
2. **Exhaustive CLI coverage is partly enforced elsewhere.** `validate script-catalog` ([`src/cli/validate-script-catalog.ts`](../../../src/cli/validate-script-catalog.ts)) diffs `flattenManifest()` leaf `src` paths against the source links in `docs/noldor/script-catalog.md` and blocks on `missingFromCatalog`. Its coverage has a documented hole — see Risks.

So the gap is not "the README is not exhaustive". It is that **nothing checks the README's claims resolve**, and **nothing notices a whole doc surface the reader cannot navigate to**.

## Goals

- Every command the README quotes that names a Noldor subcommand or a repo script resolves to a real `MANIFEST` entry or a real root `package.json` script.
- Every reader-facing doc surface is reachable from the README by following links.
- Findings surface author-side, at push time, and never withhold a release or block a push.
- No hand-maintained surface registry: a new doc surface enrols itself.

## Non-goals

- Manifest→README completeness (D1). See Risks for what this leaves uncovered.
- Flag validation: whether `--adopt` / `--dry-run` / `--detach` are accepted by the subcommand they are quoted with (D4). `MANIFEST` carries no flag registry.
- Validating commands **delegated to the package manager itself** — `add`, `install`, `dlx`, `exec`. Their arguments are package specifiers and external binaries, not repo-owned names, so there is nothing local to resolve them against. `pnpm run <name>` is explicitly **not** in this set: `<name>` is a repo-owned script and is validated (D13).
- Prose quality, tone, freshness-by-date, or screenshot currency.
- Reviving `detectReadmePackageDrift`. It is dead in this repo but harmless, and a single-package repo is not the case it was written for.
- Making any finding blocking — at release (D6) or at push (D14).

## Design

### Unit 1 — surface enumeration

```ts
/** Repo-relative POSIX dirs, sorted. */
export function enumerateDocSurfaces(cwd: string): Promise<readonly string[]>;
```

Each directory **one level under `docs/`** that contains at least one `.md` **recursively**, minus an explicit exclusion set:

```ts
/** Directories holding per-change workflow artifacts, not reader documentation. */
const ARTIFACT_DIRS: ReadonlySet<string> = new Set(['features', 'design']);
```

The set is an explicit two-member constant, **not** a derivation from `loadDocRoots()`. That derivation was wrong: `loadDocRoots()` ([`src/core/doc-roots.ts:56-70`](../../../src/core/doc-roots.ts)) also names `adr`, `architecture` and `milestones`, so deriving exclusions from it would exclude the two surfaces this feature exists to catch. It is also unusable by path: its design entries are keyed at `docs/design/{plans,specs,ui}`, two levels deep, so nothing there equals `docs/design`.

Membership rule for future additions, stated so the constant is not arbitrary: a directory is excluded when it holds **one file per change** (a feature doc, a spec, a plan) rather than pages a reader navigates. `docs/assets` needs no entry — it holds 5 non-markdown files and zero `.md`, so the recursive-`.md` predicate drops it.

`docs/milestones` is **in scope** — a milestone page is reader-facing (`docs/vision.md` points at the active one and the dashboard renders it), so it must be reachable. It does not exist in this repo, so it contributes no finding here.

Measured survivors on this repo: `adr` (1 md), `architecture` (4), `noldor` (26), `user` (1).

### Unit 2 — reachability walk

```ts
export interface ReachSet {
  /** Repo-relative POSIX paths of every reached file. */
  readonly files: ReadonlySet<string>;
  /** Repo-relative POSIX dirs reached directly by a directory-target link. */
  readonly dirs: ReadonlySet<string>;
}
export function reachableTargets(cwd: string): Promise<ReachSet>;
```

Seeded from `README.md`, then transitively through each reached `.md`, to a fixpoint over a visited set (so link cycles terminate).

**Eligible links are whatever `extractLinks` returns** ([`src/docs/docs-check.ts:53`](../../../src/docs/docs-check.ts)) — it already calls `stripCodeRegions` internally, and already drops `https?:` / `mailto:` / `#`-only hrefs via `EXTERNAL_RE` and root-absolute hrefs via `ROOT_ABSOLUTE_RE`. Reusing it is what keeps this check's notion of "a link" identical to the one `docs check` enforces.

`stripCodeRegions` is load-bearing rather than incidental: `docs/architecture/` and `docs/adr/` are mentioned in `docs/noldor/{script-catalog,versioning,garden-and-drift}.md` **only inside prose backticks, never as markdown links**. Counting a backticked path as a link would make the check green while the reader still has no route.

**Canonicalization**, in order: strip the `#fragment` and any `?query`; percent-decode; resolve against the containing file's directory; normalize. Comparisons are byte-exact on the resulting POSIX path — no case folding, so a case-mismatched link is unreachable on a case-sensitive filesystem and the finding says so.

**Traversal root is the repository, not `docs/`.** A route through a root-level markdown file (`CHANGELOG.md`, `CONTRIBUTING.md`) is a legitimate reader path. A canonicalized target that escapes the repository root is dropped, and symlinks are not followed — both silently, as neither is this check's concern.

**Only `.md` targets are traversed.** A non-`.md` file target is recorded in `files` (it was reached) but not read.

**Link-target error paths.** `checkLinks` ([`src/docs/docs-check.ts:133-146`](../../../src/docs/docs-check.ts)) shows the cases a `readFile` on a link target hits. The last one currently `throw`s, which would crash `checks readme` rather than report:

- `ENOENT` — broken link. **Skip and continue, silently.** A missing target is `docs check`'s finding; duplicating it here would couple two independent gates.
- `EISDIR` — the href names a directory. Add it to `ReachSet.dirs`; do not descend.
- Any other code — **skip and continue**, appending one operational note (Unit 6). Never a finding, never a throw.

**Directory-link semantics.** Unit 3's rule is "reached when at least one `.md` beneath it is in the reached set", and a directory link resolves to no `.md` at all. Left there, the three links this PR adds under `## Docs` (D10) would satisfy nobody and the check would ship red. So a directory target marks that surface **reached directly** via `ReachSet.dirs`. Both shapes work: `[ADRs](docs/adr/)` and `[ADR 0001](docs/adr/0001-absent-doc-surfaces-skip-release-gates.md)`.

### Unit 3 — surface verdict

```ts
export function unreachableSurfaces(
  surfaces: readonly string[],
  reached: ReachSet,
): readonly string[];
```

Pure. A surface is **reached** when it is in `reached.dirs`, or when any path in `reached.files` is equal to or beneath it (D12). No per-surface `index.md` is required — `docs/adr/` holds numbered records and `docs/user/` holds only `how-to/index.md`, and demanding index pages would turn a validator into a doc-authoring feature.

### Unit 4 — command extraction (lexical only)

```ts
export interface QuotedCommand {
  /** The command as written, for diagnostics. */
  readonly raw: string;
  /** Whitespace-split tokens, prompt prefix and comments removed. */
  readonly argv: readonly string[];
  /** 1-based line in README.md. */
  readonly line: number;
}
export function parseReadmeCommands(content: string): readonly QuotedCommand[];
```

Pure and **MANIFEST-unaware** — it cannot decide whether `argv[1]` is a subcommand or a positional, so it does not try (D1). It only lexes, from fenced blocks and inline code alike:

- Join `\`-continuations into one logical line, then split logical lines.
- Strip a leading shell prompt (`$ `, `> `).
- Drop everything from an unquoted `#` to end of line.
- Split on unquoted `&&`, `||`, `;` and `|` into separate commands.
- Keep only commands whose first token is `pnpm`; every other leading binary (`node`, `npm`, `git`, `codex`) is out of scope.
- Drop any command containing a `<placeholder>` token — the README documents shapes as well as invocations.

### Unit 5 — command resolution

```ts
export interface Finding {
  readonly message: string;
}
export function resolveCommands(
  cmds: readonly QuotedCommand[],
  manifestCommands: ReadonlySet<string>,
  /** Root package.json script names; null when unreadable — see Unit 6. */
  scriptNames: ReadonlySet<string> | null,
): readonly Finding[];
```

Pure. `manifestCommands` is `new Set(flattenManifest().map((l) => l.command))` ([`src/cli/manifest.ts:515`](../../../src/cli/manifest.ts) — `command` is the bare group for a `''`-subcommand leaf, else `<group> <sub>`). Resolution per command, in order:

1. Drop leading global flags. A command that is only `pnpm noldor` plus flags (`pnpm noldor --help`) resolves trivially.
2. `pnpm add|install|dlx|exec …` → out of scope (Non-goals), no finding.
3. `pnpm run <name>` → resolve `<name>` against `scriptNames`. This closes the contradiction in the earlier draft, where `pnpm run missing-script` was silently accepted (D13).
4. `pnpm noldor <a> <b> …` → **longest match first**: if `"<a> <b>"` is in `manifestCommands`, resolved; else if `"<a>"` is, resolved (and `<b>` is a positional); else unresolved.
5. `pnpm <name> …` → resolve `<name>` against `scriptNames`.

Direction is README→registry only (D1): a manifest entry with no README mention is not a finding. Findings are **deduplicated by normalized command**, each citing the first line it appeared on, so a command quoted five times yields one finding.

### Unit 6 — report and the operational-error contract

```ts
export type ReadmeStatus = 'absent' | 'ok' | 'findings';
export interface ReadmeReport {
  readonly status: ReadmeStatus;
  readonly findings: readonly Finding[];
  /** Degradations: what could not be checked, and why. Never a finding. */
  readonly notes: readonly string[];
}
export function checkReadme(cwd?: string): Promise<ReadmeReport>;
```

`{ status, findings }` is deliberately the shape `docSurfaceRow` already consumes; `notes` is additive.

**`checkReadme` never rejects** (D4). Every operational failure degrades to a note and the check continues on what it can still evaluate:

- `README.md` absent → `status: 'absent'`, no findings.
- `README.md` unreadable → `status: 'absent'` plus a note. Nothing to check, not a failure of the README.
- Root `package.json` missing, unparseable, or carrying no `scripts` → `scriptNames = null`. Unit 5 **skips steps 3 and 5** and adds one note; the `pnpm noldor` half and the whole surface half still run.
- Any other filesystem error → note, continue.

This is what makes the never-blocks guarantee real rather than asserted: a rejected promise inside a preflight probe would surface as a crashed release.

### Unit 7 — CLI shell

`src/checks/check-readme.ts`, on the [`src/checks/check-ui-design-freshness.ts`](../../../src/checks/check-ui-design-freshness.ts) pattern:

```ts
export function main(cwd?: string): Promise<number>;
runIfDirect('check-readme', 'checks readme', async () => main());
```

Prints one line per finding, then each note prefixed `note:`. Exit 1 when `findings` is non-empty; notes never affect the exit code. Registered as `checks readme` in `src/cli/manifest.ts`. Callers choose whether exit 1 blocks — per D14, none do.

### Unit 8 — release preflight row

`docSurfaceRow` ([`src/release/preflight-probes.ts:156`](../../../src/release/preflight-probes.ts)) gains a trailing optional options bag, so the existing `architecture` and `adr` call sites are untouched:

```ts
async function docSurfaceRow(
  id: PreflightRowId,
  envVar: string,
  check: () => Promise<{ status: string; findings: readonly { message: string }[] }>,
  details: { absent: string; ok: string; blocking: string; fix: string },
  opts?: { severity?: 'blocking' | 'warn' },
): Promise<PreflightRow>;
```

A new `readme` row calls `checkReadme` with `{ severity: 'warn' }` and an audited `RELEASE_SKIP_README` override. `warn` never aborts a release ([`src/release/preflight-types.ts:8`](../../../src/release/preflight-types.ts)), so `blockingIds()` excludes it by construction.

### Channel

`checks readme` plus the warn preflight row, and **no `GardenFindings` key** (D5). Routing to `sddGaps` would gate the garden receipt and therefore block a release through the four-hop chain Q-0136 exists to make structural. A hand-rolled advisory key on the `architectureAdvisories` precedent ([`src/garden/garden-detect.ts:596`](../../../src/garden/garden-detect.ts)) would avoid blocking but has no consumer beyond the JSON dump. Declining both is what lets this ship without waiting on Q-0136.

### Wiring

A `readme` job on `pre-push`, beside `template-sync` and `clones check` — but **advisory: it reports and exits 0** (D14, superseding the blocking form of D7).

The reason is adoption. There is no `templates/README.md`, and `templates/lefthook/noldor.yml` is byte-identical to `lefthook/noldor.yml`, so this job ships to every consumer and would run against a README the framework itself calls consumer-owned — the stated reason the `bootstrap commands` rule-pair sits at `severity: 'warn'`. A blocking job would red a fresh consumer's first push over an unlinked `docs/` directory, or over a `pnpm <script>` that lives in a workspace package rather than root `package.json` (Unit 5 reads root only). Advisory keeps the signal at exactly the moment it is actionable without gating anyone's adoption.

Visibility, not blocking, is what the founding failure needed: PR #333 shipped because nothing *said* anything, not because nothing stopped it.

`README.md` sits outside `RELEASE_SWEEP_GLOBS` ([`src/core/allowlist.ts:20`](../../../src/core/allowlist.ts)) and stays there — the sweep must not rewrite it. It is in `MICRO_CHORE_GLOBS` via root-level `*.md`, and feature paths carry no allowlist branch, so a finding is fixable in the same PR that caused it.

### Twins and registries this touches

- `lefthook/noldor.yml` + `templates/lefthook/noldor.yml` — the new advisory pre-push job, mirrored.
- `docs/noldor/script-catalog.md` + `templates/docs/noldor/script-catalog.md` — a source link for `src/checks/check-readme.ts`, or `validate script-catalog` blocks on `missingFromCatalog`.
- `ALL_ROW_IDS` ([`src/release/preflight-probes.ts:42`](../../../src/release/preflight-probes.ts)) — a plain `readonly PreflightRowId[]`, not derived and not exhaustive-checked, and it is what `preflight.ts:72` iterates to build the report. Adding `'readme'` to the union alone leaves the row **silently unrendered with a green typecheck**, so the array needs the same edit.
- `src/release/__tests__/preflight-probes.test.ts:226` — asserts `ALL_ROW_IDS` equals a hand-written id list, so it needs `'readme'` too.
- `docs/noldor/script-catalog.md:356` + its twin — the release-preflight entry enumerates every row id in prose. (Pre-existing drift, not introduced here: that prose already omits `ui-design-freshness` and `adr`, listing 14 of the 16 live ids. This spec adds `readme`; repairing the two stale omissions is separate residue.)
- `README.md` — links added under `## Docs` so `docs/adr/`, `docs/architecture/` and `docs/user/` become reachable (D10). The check ships green and the feature dogfoods itself.

## Acceptance criteria

1. `pnpm noldor checks readme` exits 0 on this repository once the `## Docs` links are added.
2. Deleting the `## Docs` link that reaches `docs/architecture/` makes the command exit 1 with a finding naming `docs/architecture`.
3. Renaming a `MANIFEST` group the README quotes (e.g. `upgrade`) makes the command exit 1 with a finding naming the unresolved command and its README line.
4. Adding a new subcommand to an existing `MANIFEST` group without touching the README leaves the command at exit 0.
5. A new `docs/<newdir>/page.md` with no link reaching it makes the command exit 1 naming `docs/<newdir>`; `docs/milestones` behaves identically when present.
6. `docs/assets` (zero `.md`), `docs/features` and `docs/design` are never reported as unreachable.
7. A surface path appearing only inside prose backticks does not reach it; the same path as a markdown link does.
8. `pnpm run <name>` with `<name>` absent from root `package.json` `scripts` is reported; `pnpm add|install|dlx|exec` and `pnpm noldor --help` never are.
9. Both `[ADRs](docs/adr/)` and a link to a specific `.md` beneath it satisfy the `docs/adr` surface.
10. A surface is satisfied by a reached `.md` at any depth beneath it, with no `index.md` present.
11. A multi-hop route terminates on a link cycle, and a route passing through a root-level markdown file outside `docs/` counts as reaching its target.
12. A command quoted on five lines yields exactly one finding, citing the first line.
13. A broken link (`ENOENT`) produces no finding from this check; an unreadable linked file produces a note and does not change the exit code.
14. A missing or malformed root `package.json` skips script resolution with a note while surface and `pnpm noldor` checks still run; `checkReadme` resolves rather than rejects for every simulated failure mode.
15. Release preflight renders a `readme` row; with findings its status is `warn` and `blockingIds()` omits it. `RELEASE_SKIP_README=1` renders it `skipped` with the override recorded; a repo with no `README.md` renders it `skipped` and the CLI exits 0.
16. The advisory `pre-push` `readme` job exits 0 on a repo with findings, is byte-identical in `templates/lefthook/noldor.yml`, and `pnpm noldor validate script-catalog` passes with the new entrypoint documented.

## Risks / trade-offs

- **The D8 compensating control is narrower than the FD's deletion test.** `validate script-catalog` joins on `src`, and `manifestSrcSet`'s docstring ([`src/cli/validate-script-catalog.ts:26-31`](../../../src/cli/validate-script-catalog.ts)) states that aliases sharing an entrypoint collapse, so "documenting that source once satisfies every alias". A subcommand added to an existing group and pointed at an **already-catalogued** entrypoint therefore reds nothing anywhere — not `script-catalog`, and not this check under the README→registry direction. This is recorded as **Q-0147**, not claimed as covered.
- **Walk cost on every push.** Unit 2 reads the reachable set (≈260 `.md` here, bounded by reachability rather than the tree). Comparable to `docs check`, which already reads every one. If it proves slow the remedy is caching by tree sha, not narrowing the check.
- **Advisory everywhere means a determined author can ignore it.** Accepted (D14): the alternative reds a fresh consumer's first push against a README the framework does not own.
- **A consumer with a private docs directory gets a standing note.** Accepted rather than configured (D9): an unlinked `docs/<dir>/` is a genuine discoverability gap and the fix is one link. Advisory wiring keeps the cost at noise rather than breakage.
- **Reachability is link-shaped, not comprehension-shaped.** A README can link every surface and still describe them wrongly. This raises the floor from "unnavigable" to "navigable"; it does not verify the prose is accurate.
- **Unit 5 reads root `package.json` only.** A monorepo consumer quoting a workspace-package script gets a false finding. Advisory wiring bounds the damage; per-workspace resolution is deferred.
- **`docs/user/` is a projection target.** `docProjectionRoots()` treats it as generated. Including it means a generated surface must be linked by hand — judged correct: generated or not, a reader needs a route.

## User Story

As a framework maintainer, I want the README's commands and doc-surface links checked against the real manifest and the real `docs/` tree when I push, so that a capability I add cannot drift out of the front door unnoticed.

## Usage

```bash
pnpm noldor checks readme        # exit 0 clean, 1 with findings; notes printed as note:
```

Runs automatically as an advisory `pre-push` job — it reports and never blocks the push. Findings are fixable in the same PR: edit `README.md` and push again.

At release, `pnpm release --preflight` renders a `readme` row. It is advisory: findings show as `warn` and never abort. `RELEASE_SKIP_README=1` skips the row and records the override.

## Open questions (resolved)

1. *Should the CLI-reference check demand that every `MANIFEST` group appear in the README?*
   → **No — reverse direction only (D1).** `README.md:116` declares the section a non-exhaustive journey-critical subset. The residue this leaves is Q-0147, recorded in Risks rather than papered over.

2. *Is the doc-surface set a registry or derived?*
   → **Auto-enrolled directories minus an explicit two-member artifact set (D2, D9, revised).** Deriving the exclusions from `loadDocRoots()` was wrong — it names `adr`, `architecture` and `milestones` too, so it would exclude the surfaces the feature targets.

3. *Direct link from `## Docs`, or a transitive walk?*
   → **Transitive, seeded from the whole README, traversal root the repository (D2).** It respects the `docs/noldor/README.md` hub, admits legitimate routes through root-level markdown, and still has teeth: three surfaces are unreachable today.

4. *Do checks #1 and #3 stay separate?*
   → **They merge (D3).** 12 of the 16 quoted commands are `pnpm noldor` forms resolving through `MANIFEST`, so the two were the same check.

5. *Which channel carries findings?*
   → **`checks` CLI + warn preflight row, no garden key (D5).** Non-blocking at release by construction, and it removes the Q-0136 dependency instead of working around it.

6. *Does the pre-push job block?*
   → **No — advisory (D14).** The job ships to every consumer via the byte-identical lefthook twin, and there is no `templates/README.md`, so blocking would red a fresh consumer's first push against a file the framework calls consumer-owned.

7. *Does the first run ship red?*
   → **No — this PR adds the missing links (D10).**

8. *Where do the units live?*
   → **Pure evaluator in `src/docs/readme-content.ts`, thin shell in `src/checks/check-readme.ts` (D11).** Mirrors `docs-architecture.ts` / `docs-adr.ts`, which the preflight probe already imports from.

9. *What counts as reaching a surface?*
   → **Any `.md` beneath it, or a directory-target link to it (D12, extended).** Requiring a per-surface index would mean authoring two new index pages inside a validator feature.

10. *Does extraction resolve commands?*
    → **No — extraction is lexical, resolution consults `MANIFEST` with longest-match (D1 blocker).** Extraction cannot know whether token 2 is a subcommand or a positional.

11. *Is `pnpm run <name>` validated?*
    → **Yes (D13).** Only `add`, `install`, `dlx` and `exec` are out of scope, because their arguments are not repo-owned names.

12. *What happens on an operational error?*
    → **A note, never a finding, never a rejection (D4 blocker).** `checkReadme` degrades per-source and keeps checking what it can.
