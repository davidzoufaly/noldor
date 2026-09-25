# One Graph Builder for the Sweep and CI — Design

**Slug:** self-refreshing-compact-knowledge-graph (enhancement: one-graph-builder)
**FD:** docs/features/self-refreshing-compact-knowledge-graph.md
**Date:** 2026-09-25
**Tier:** specs-only
**Entry:** Q-0293

UI verdict: skip — noldor declares no `consumer.uiPaths`; this work changes how the committed graph is built, not a UI.

Architecture verdict: skip — the builder stays inside `src/graphify/`: no new directory, package or cross-module import. The CLI now starts Python locally, which the graph's CI producer already does.

## Problem

Two producers write the committed graph, and they cluster it differently. The `update-knowledge-graph` workflow rebuilds `graphify-out/` after every merged `feat`, `fix` or `refactor` PR: a clean AST pass with `PYTHONHASHSEED=0`, sorted input, `parallel=False` and `Community N` labels. `/noldor-release-sweep` steps 1 and 5 instead call the external `/graphify --ast-only` skill, which runs unseeded, extracts in parallel over an unsorted list, names communities with an LLM, installs `graphifyy` unpinned when it is missing, and also writes `graphify-out/manifest.json`. Both extract the same nodes and edges, so every release commits a graph whose community ids and labels the next CI run throws away — the first graph PR after each release reshuffles the whole file.

A shared recipe is not enough on its own. The v1.13.0 sweep ran the workflow's exact recipe on the operator's Mac and found 222 communities where CI found 215 on the same extraction. The cause is now measured (2026-09-25, tree `2b8e85d`): the recipe under the Mac's installed packages (networkx 3.6.1, tree-sitter 0.25.2, datasketch 1.10.0, older grammars) gave CI's 4150 nodes, 11042 edges and 244 communities, but a different partition. The same recipe on the same Mac, in a fresh venv holding what `pip install graphifyy==0.7.8` resolves today (networkx 3.7, tree-sitter 0.26.0, …), reproduced CI's `graph.json` exactly — same partition, same ids, and the same content apart from the `built_at_commit` stamp, which a copy without `.git` cannot carry — and a byte-identical `GRAPH_REPORT.md`, across Python 3.13.3 on arm64 macOS and 3.13.15 on x64 Linux. So the dependency set decides the clustering; the platform and the Python patch version did not. That also means CI drifts against itself: the workflow pins `graphifyy` only, so a new networkx release can reshuffle the graph between two CI runs.

## Goals

- One command builds the committed graph, and both producers call it: `pnpm noldor graphify build`.
- What it builds is a function of the commit and a committed lock of every Python package — not of the machine or the run.
- Run right after a graph PR merges, the sweep's graph step leaves `graphify-out/` byte-identical.
- The sweep's default path no longer depends on an external `/graphify` skill.

## Non-goals

- `--full-semantic`. LLM extraction cannot be made deterministic; that opt-in keeps calling `/graphify`, and the next CI run replaces what it wrote.
- `graph.json`'s schema and the `.toon` format — unchanged.
- Hash-pinned installs (`pip --require-hashes`). Version pins reproduced CI; hashes are later hardening.
- The user-global `/graphify` skill itself.
- Any check or migration for a consumer's old workflow copy. charuy, the only consumer, is updated by hand (D6).

## Design

### Structural context

Every file in `src/graphify/` sits in a small community of its own plus its test: `graph-to-toon.ts` in c29, `refactor-precondition.ts` in c162. Each one's only cross-community edges go to `src/core/cli-entry.ts` (c69, `runIfDirect()`, `readValueFlags()`) and `isEntrypoint()` (c67). None defines a god node. The builder will be the same shape: interior, joined to the rest only through the CLI helpers.

Three touched files sit on busier ground:

- **`src/garden/garden-detect.ts`** (c10) defines a god node, `detectAll()`, ranked #8 with 32 edges. The edit there is one remedy string and does not go near it.
- **`src/cli/manifest.ts`** (c131) is where the new subcommand registers. Its edges to `command-registry.ts`, `capability-index.ts` and `skill-code-drift.ts` mean a new entry also owes `docs/noldor/script-catalog.md` an entry and the `AGENTS.md` capability index a regeneration.
- **`bin/build-manifest.mjs`** (c26) lists the runtime assets. Its edge to `checkPackagedRuntime()` in `src/testing/contract-harness.ts` is the check that a packed tarball carries them.

`src/design/graph-context.ts` (c13, beside `src/release/graph-freshness.ts`) changes only its remedy string. The workflow files are YAML, which the graph does not extract.

### U1 — The recipe and the lock move into the package

The workflow's heredoc becomes `src/graphify/build-graph.py`, unchanged in substance: `detect`, a sorted code list, `extract(..., parallel=False)`, `cluster`, `Community N` labels, `generate`, `to_json(force=True)`. Four things change, each because a working machine is not a fresh CI checkout:

- **Only HEAD's files.** The recipe runs in a temporary copy of HEAD's tree, so an uncommitted edit, a scratch file, an ignored build output or a `.worktrees/` checkout never enters the graph, nor the file and word totals `detect` hands the report. CI's checkout holds nothing else, so this changes nothing there.
- **A cache of its own.** graphify caches each file's parse under `graphify-out/cache/ast/`, keyed by the file's contents and path but not by the graphify or tree-sitter version. So a cache written by a `/graphify` run under older packages would be read back as if current. The script passes `extract(..., cache_root=<the environment's directory>)`, which ties the cache to the lock.
- **Explicit stamps.** The TypeScript side passes `built_at_commit` (HEAD) to `to_json`, rather than letting graphify ask git from whatever directory it runs in.
- **The report's date is HEAD's committer date, not the run day.** `generate` writes today's date into the report's first line, so without this a rebuild of the same commit on another day differs by that line.

Next to it, `src/graphify/graphify-requirements.txt` pins every package `==`: the 30-line `pip freeze` of a clean venv holding `graphifyy==0.7.8`, including numpy, scipy, networkx and each tree-sitter grammar, under a header naming the Python minor it was frozen with. Both files join `RUNTIME_ASSETS` in `bin/build-manifest.mjs`, which is what copies non-TypeScript files into `dist/`. They are package files, not consumer templates, so no consumer owns or edits them. Bumping the lock means re-freezing a clean venv and landing the result in its own PR.

### U2 — `pnpm noldor graphify build`

A new `src/graphify/build.ts`, registered as `graphify.subs.build` in `src/cli/manifest.ts`. In order:

1. **Up-to-date check.** Read `built_at_commit` from `graphify-out/graph.json`. When it names a commit and no file outside `graphify-out/` differs between that commit and HEAD (`git diff --quiet <built_at_commit> HEAD -- . ':(exclude)graphify-out'`), print that the graph is already built from this tree and exit 0 without writing. Uncommitted and untracked changes do not count, because the build never reads them (U1). `--force` skips the check. This is what makes the deletion test hold: a graph PR changes only `graphify-out/`. CI never meets it, because every merge that triggers CI changes something else.
2. **Environment.** The interpreter is `NOLDOR_GRAPHIFY_PYTHON`, else `python3` on `PATH`. The lock's header records the Python minor it was frozen under (`3.13` today, the version CI's `setup-python` installs); an interpreter of any other minor is refused with exit 2 and a line naming `NOLDOR_GRAPHIFY_PYTHON`, because only patch-level agreement is measured. The venv lives under the user cache (`$XDG_CACHE_HOME/noldor/graphify/<key>`, else `~/.cache/noldor/graphify/<key>`), where the key hashes the lock's bytes and the interpreter's full version. The builder installs the lock into it with that interpreter's `pip`, using `--no-deps` so no package the lock does not name can enter, then runs `pip check`, so a lock missing a dependency fails there rather than mid-build. It writes a ready marker last. A directory without the marker is incomplete and is rebuilt; one with it is reused as is. The operator's own Python is never touched.
3. **Build.** Run `build-graph.py` with the environment's interpreter and `PYTHONHASHSEED=0`, from the root of the HEAD copy (U1), writing its two outputs into a temporary directory. Render both `.toon` files from that `graph.json` with `graph-to-toon`'s pure functions, then move all four files into `graphify-out/`. A failed build leaves the committed graph untouched. A move that fails partway exits 1 and names `git checkout -- graphify-out/`, which restores the tracked files. The builder writes nothing else in `graphify-out/`.

Exit codes: 0 built or already up to date; 1 the build failed, or the directory is not a git work tree; 2 no usable Python environment (no interpreter, one of the wrong minor, or a lock pip could not install or `pip check` rejects), with the fix on stderr.

### U3 — The workflow calls the builder

Both twins of `update-knowledge-graph.yml` lose the `Install graphify` step, the heredoc and the separate `graph-to-toon` line, and gain one `pnpm noldor graphify build` step after `pnpm install`. `actions/setup-python` stays, because the builder needs an interpreter, and its `python-version: '3.13'` must keep naming the lock's minor or the builder refuses it. The `graphifyy` pin moves out of the YAML into the lock.

A consumer owns its copy — the file is scaffold-only, so `init --update` never rewrites it — and a copy left on the old recipe keeps floating packages. No compatibility machinery covers that. charuy is the only consumer and the operator's own repo, so its copy is switched to the builder by hand, in charuy, once charuy upgrades to a noldor release that ships `graphify build` — the step cannot land earlier, because the command does not exist in charuy's installed noldor until then.

### U4 — The sweep and the remedy prose switch

`/noldor-release-sweep` steps 1 and 5 call `pnpm noldor graphify build`, and step 2 folds into them; step 6's commit of refactor leftovers moves ahead of step 5, because the build reads HEAD; `--full-semantic` keeps invoking `/graphify`. The same switch lands wherever noldor tells someone to regenerate: `noldor-spec` step 1.7's stale branch, the stale remedy in `src/design/graph-context.ts` and `src/garden/garden-detect.ts`, and `docs/noldor/graph-integration.md`, `versioning.md`, `skill-catalog.md` and `worktree-discipline.md`. Every one of those has a `templates/` twin that changes with it. Two other features' FDs show the old line in their Usage — `sdd-co-tag-detector` and `graphify-plan-of-edges-nodes-for-plans-specs` — and get the same one-line swap. The `graph-integration.md` paragraph about 222 against 215 is replaced by the lock. The new subcommand gets its `script-catalog.md` entry (and twin), and the `AGENTS.md` capability index is regenerated with `pnpm noldor docs capability-index --write`.

### U5 — `manifest.json` leaves the repo

`graphify-out/manifest.json` is `/graphify`'s incremental-update record: absolute paths and mtimes from the machine that last ran it (today's copy lists `/Users/davidzoufaly/code/noldor/…`). Nothing in `src/` reads it. The workflow's recipe never writes it, the builder will not either, and only the `/graphify` skill's last step does. Once the sweep stops calling that skill, it is a tracked file nothing keeps current. Untrack it with `git rm --cached` and add `graphify-out/manifest.json` to `.gitignore`, beside the directory's other machine-local entries.

### Error handling

A missing interpreter, one of the wrong minor, a failed venv creation, a failed pip install or a failed `pip check` exits 2 before anything under `graphify-out/` is touched. Run outside a git work tree, the builder exits 1 at once: it cannot copy HEAD's tree or stamp a commit. A recipe crash exits 1, and the temporary directory is discarded. An unreadable `graph.json` or a `built_at_commit` that does not resolve (a squash-merged sweep branch, a shallow clone) never short-circuits: it reads as "not up to date" and the builder builds.

### Testing

The TypeScript side takes its process runner and its git calls as injected seams, so unit tests drive it with fakes and never start Python. They cover the up-to-date decision (a graph-only commit, a code commit, an uncommitted edit, a missing or unknown `built_at_commit`, `--force`), the environment key, the ready marker, the minor-version refusal, the exit codes, and that nothing under `graphify-out/` changes on any failure. A file-level test asserts every lock line pins an exact version. The Python half runs for real in one end-to-end test, gated on an environment variable because it needs the network and a 240 MB environment. It builds a small fixture repo twice with `--force` and asserts identical bytes. It stays out of `pnpm test`, and the implementer runs it once before shipping. After merge, CI's first graph PR is the live check: it should carry no reshuffle, because the lock pins what CI resolves today.

## Acceptance criteria

1. `pnpm noldor graphify build` writes `graph.json`, `GRAPH_REPORT.md` and both `.toon` files, and uses `Community N` labels.
2. Building the same commit twice with `--force` leaves `graphify-out/` byte-identical.
3. When HEAD differs from `built_at_commit` only under `graphify-out/`, the command exits 0 and writes nothing; `--force` rebuilds.
4. A commit that changes a file outside `graphify-out/` since `built_at_commit` makes it rebuild.
5. An uncommitted edit or a file git does not track never appears in the graph or in the report's totals, and a parse cache under the repo's `graphify-out/cache/` is never read.
6. Every package in the build environment is installed from the lock, and every lock line pins an exact version.
7. With no usable interpreter, an interpreter of a Python minor other than the lock's, or a lock pip cannot install, it exits 2 and leaves `graphify-out/` unchanged.
8. A recipe failure exits 1 and leaves `graphify-out/` unchanged.
9. Both workflow twins build through `pnpm noldor graphify build` and contain no inline Python and no `pip install`.
10. Both release-sweep twins call `pnpm noldor graphify build` in steps 1 and 5, and invoke `/graphify` only under `--full-semantic`.
11. The stale remedies in `graph-context` and `garden detect` name `pnpm noldor graphify build`.
12. `graphify-out/manifest.json` is not tracked and is ignored.

## Risks / trade-offs

- **The first build downloads the lock into a user cache**, about 240 MB once installed (numpy, scipy and 23 tree-sitter grammars). An offline machine exits 2 until it has network once.
- **A lock bump reshuffles the graph once.** That is the change doing its job; it should land in its own PR so the reshuffle is the whole diff.
- **A machine without Python 3.13 cannot build** until it installs one and points `NOLDOR_GRAPHIFY_PYTHON` at it (D8). That is the price of the same-bytes promise; moving the whole setup to a newer minor is a lock bump.
- **`Community N` is less readable than the LLM's names** in `GRAPH_REPORT.md`. CI has committed `Community N` between releases all along; `graph-to-toon` derives its own labels either way.
- **charuy keeps the old recipe until its copy is edited** (D6). Until then its CI and its sweep can still disagree. The edit is a follow-up in charuy after it upgrades, not part of this change.
- **Old environments accumulate** — one per lock hash and interpreter, 240 MB each. Nothing prunes them; `rm -rf ~/.cache/noldor/graphify` resets the lot, and the next build recreates what it needs.

## User Story

As an operator releasing a repo that commits its knowledge graph, I want the release sweep and CI to build the graph with one command and one pinned set of packages, so that a release no longer reshuffles every community id in the next graph PR.

## Usage

```bash
pnpm noldor graphify build          # build graphify-out/; a no-op when nothing but the graph changed since it was built
pnpm noldor graphify build --force  # rebuild anyway
NOLDOR_GRAPHIFY_PYTHON=/path/to/python3.13 pnpm noldor graphify build
```

The release sweep and the `update-knowledge-graph` workflow both run it. The first run creates the pinned environment under `~/.cache/noldor/graphify/`; later runs reuse it.

## Open questions (resolved)

**D1.** *Pin every package, or keep CI's committed graph whenever the extraction matches?*
-> Pin. A fresh venv on the operator's Mac reproduced CI's graph byte for byte, so pinning removes the cause; keeping CI's graph would only hide it, and would not cover a sweep whose refactor changed code.

**D2.** *Who installs the pinned packages — the builder, in its own venv, or the operator?*
-> The builder, in a venv under the user cache. The operator's own Python stays untouched, and the sweep works on a machine that has never installed graphify.

**D3.** *Where do the recipe and the lock live?*
-> `src/graphify/`, shipped through `RUNTIME_ASSETS`. Under `templates/` a consumer would own them, and a consumer-edited lock is the drift this removes.

**D4.** *Does the up-to-date check live in the builder or in the sweep's prose?*
-> The builder, with `--force` to override: every caller then gets an idempotent build, not only the sweep.

**D5.** *Should the report's date be the built commit's date instead of the run day?*
-> Yes. Otherwise a rebuild of the same commit on another day differs by one line, and "same tree, same bytes" stops being true.

**D6.** *What about consumers whose workflow copy still carries the old heredoc?*
-> Nothing in noldor detects it. charuy is the only consumer and is the operator's own repo; its copy is edited by hand after it upgrades. A check or a migration would guard consumers that do not exist.

**D7.** *Does untracking `manifest.json` belong in this change?*
-> Yes. It is a tracked `graphify-out/` file that no producer keeps current after this change, and leaving it would keep a sweep-only artifact in the directory this change makes deterministic.

**D8.** *Refuse, or warn, when the interpreter's minor version differs from the lock's?*
-> Refuse, with exit 2 and a pointer to `NOLDOR_GRAPHIFY_PYTHON`. Only patch-level agreement is measured, and a warning would let a different minor split the graph differently with nothing but a log line to show for it.

**D9.** *What if one of the four moves into `graphify-out/` fails after another succeeded?*
-> Exit 1 and name `git checkout -- graphify-out/`. The four files are tracked, so git already holds the old set; a backup-and-rollback step would be code guarding a failed same-disk rename.

**D10.** *Build from the working tree or from HEAD?*
-> HEAD. `built_at_commit` then always names the tree the graph came from, so the up-to-date check cannot call a graph of since-discarded edits fresh. An operator's uncommitted edits are left out of the graph, which is the point: the committed graph describes a commit.
