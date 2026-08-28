# Unvalidated Slug Path Traversal Across CLI Entry Points — Design

**Slug:** unvalidated-slug-path-traversal-across-cli-entry-points
**FD:** docs/features/unvalidated-slug-path-traversal-across-cli-entry-points.md
**Date:** 2026-08-28
**Tier:** specs-only
**Deps:** none

UI verdict: skip — no `consumer.uiPaths` is configured in `.noldor/config.json` and the FD's `links.code` is empty, so the verdict has no candidate surface. This change is CLI-only.

## Problem

`src/core/slug.ts` declares the canonical slug shape and says in its own docstring that "every entry point that accepts one from outside needs the SAME check — a per-call-site copy is how one of them ends up looser than the rest". The check is a convention, and conventions are unevenly applied: three command families that automated gate flows invoke routinely build filesystem paths from an unchecked positional argument, which is a local path-traversal read/write primitive.

- **`worktrees up` / `worktrees down`** — `upWorktree()` computes `join(opts.cwd, '.worktrees', opts.slug)` at `src/worktrees/up-worktree.ts:60` *before* validation, and only reaches the validating `createWorktree()` when that path does not already exist. An existing outside directory, or `--no-create`, bypasses the sole guard; Noldor then opens an editor there, launches an agent there, and boots configured dev commands there. `downWorktree()` builds `join(opts.cwd, '.noldor', 'dev-<slug>.pids')` the same way and, with `--remove`, hands `join('.worktrees', slug)` to `git worktree remove --force`. The pid path escapes `.noldor` on a deep enough value even without `--remove`, so the command reads a foreign `.pids` file and treats column two as process-group IDs to SIGKILL.
- **`features phase-flip-done` / `features phase-revert`** — both take the first non-flag token straight into `join(process.cwd(), 'docs', 'features', slug + '.md')` (`phase-flip-done-cli.ts:16`, `phase-revert-cli.ts:16`) with no validator import. From a consumer root, `../../../escape` resolves outside the repo and the command rewrites that file when it exists and carries the expected phase text.
- **Milestone draft / load / activate** — `src/milestones/lib.ts:59,68,101` interpolate the slug into `docs/milestones/<slug>.md` and the CLI forwards `rest[0]` verbatim, so `draft` can create a file outside the repo when its parent exists, and `activate` can read and rewrite one carrying milestone-shaped frontmatter.

The convention is also unevenly *shaped*, not merely unevenly applied. Three validators exist today: `isSlug` (`src/core/slug.ts:13`), used by `createWorktree` and by `src/cr/autofix-cli.ts:92`; `validateSlug` / `validateSlugs` (`src/design/ledger.ts:125,142`), a slugify-based variant guarding `log-cli.ts:275` and `context-cli.ts:122` with a different diagnostic; and nothing at all everywhere else. A fourth would make the problem worse.

Repository-authored references feed non-slugs into the same readers, through two schemas that accept any non-empty string: `src/core/feature-schema.ts:115` (`milestone: z.string().min(1).optional()`) and `src/dashboard/data.ts:770` (`visionFrontmatterSchema`'s `current-milestone`). `milestoneFrontmatterSchema` at `src/milestones/lib.ts:9` is *not* one of them — it carries only `name` / `status` / `description`, and a milestone's slug comes from `basename(absPath, '.md')` at `:44`.

## Goals

- Every path built from an externally-supplied or repository-authored slug is validated and containment-checked before any slug-derived protected operation — any `exists`, read, write, process launch, kill, or git call keyed on that slug.
- Slug-rooted path construction has exactly one implementation, and the compiler refuses a raw `string` reaching it. **This does not make omission impossible** — a new call site can still `join` a raw argv value and compile. What the type system buys is that using the sanctioned builder is the path of least resistance and misusing it is a build error; what it cannot buy is detecting a call site that ignores the builder entirely. That residue is reported, not prevented (Unit 3), and this spec claims nothing stronger.
- One accept/reject rule for slugs across the whole repo, replacing the three that exist today.
- The slug shape is encoded in the schemas that carry repository-authored references, so invalid state fails to load rather than flowing into readers.

## Non-goals

- Hardening CLIs whose paths come from a directory listing rather than a slug (`fd-load.ts`, `release-markers.ts`, `repo-paths.ts`): those names are produced by the filesystem, not by an argument.
- A general capability sandbox, a chroot, or dropping privileges. This is input validation.
- Reworking `throw`-based error surfaces beyond the functions this change touches.
- Changing `SLUG_RE`. The shape is correct; only its reach is wrong.
- Restoring the `boundaries` invariant's TypeScript parsing (see Unit 3) — a real gap, but a separate one.

## Design

### Unit 1 — One rejection rule and one guarded join

`src/core/slug.ts` becomes the single owner of the accept/reject decision:

```ts
export type Slug = string & { readonly __slug: unique symbol };
export type SlugError = { kind: 'invalid-slug'; value: string; message: string };

export function parseSlug(value: string): { ok: true; slug: Slug } | { ok: false; error: SlugError };
export function isSlug(value: string): value is Slug;   // narrowing predicate
export const slugSchema: z.ZodType<Slug>;               // regex + transform, so it infers Slug
```

`slugSchema` is `z.string().regex(SLUG_RE, …).transform((v) => v as Slug)` rather than a bare regex schema: a plain `z.string().regex(...)` infers `string`, which would not satisfy a builder demanding a `Slug`, so the brand has to be produced at the parse boundary.

**Where `string` becomes `Slug`.** Exactly one class of place: an entry point that receives untrusted text — a CLI argv parser, or an exported library function that a consumer may call with a plain string (`createWorktree`, `upWorktree`, `downWorktree`, `draftMilestone`, `loadMilestoneBySlug`, `activateMilestone`). Each takes `string` in its public signature, calls `parseSlug` as its first statement, and passes `Slug` inward. Everything below that line — `preflightActivate`, the builders, the path owners — takes `Slug` and cannot fail slug validation. That is why the acceptance criteria can call `createWorktree` and `loadMilestoneBySlug` with invalid strings: those are the parse boundaries.

`Slug` is a branded string. Branding is what makes the goal enforceable: `parseSlug` is the only function that produces one, so a raw `string` from argv cannot reach a path builder without passing through it, and the failure is a compile error rather than a review finding. This reverses the earlier decision to defer branding — deferral assumed a static check could carry the enforcement instead, and Unit 3 shows it cannot.

`validateSlug` / `validateSlugs` in `src/design/ledger.ts` are reimplemented on `parseSlug` and keep their corrected-value suggestion. Two *messages* therefore survive — a bare rejection and a rejection carrying `(expected '<corrected>')` — but only one accept/reject rule does, which is the property that matters. `src/cr/autofix-cli.ts:92` keeps calling `isSlug`, now the narrowing predicate.

A new `src/core/slug-paths.ts` holds exactly one function, the guarded join:

```ts
export type PathError =
  | { kind: 'escapes-root'; path: string; anchor: string }
  | { kind: 'unsafe-symlink'; path: string };

export function slugPath(
  anchor: string,                       // repo root; containment is judged against this
  relRoot: readonly string[],           // root segments beneath the anchor, e.g. ['docs','features']
  slug: Slug,
  seg?: { prefix?: string; suffix?: string },
): { ok: true; path: string } | { ok: false; error: PathError };
```

Three things follow from this shape, each fixing a defect the earlier draft had:

**`SlugError` is not an arm.** `slugPath` takes an already-branded `Slug`, so slug validation cannot fail here; the only failures are containment ones. An unreachable error arm is a contract that lies.

**The guarded segment carries a prefix as well as a suffix.** The path is `join(anchor, ...relRoot, prefix + slug + suffix)`. This is what `dev-<slug>.pids` needs: `src/worktrees/down-worktree.ts:37` builds `join(opts.cwd, '.noldor', \`dev-${opts.slug}.pids\`)` — one segment with the slug in the middle, and that prefixed segment is exactly the escape the Problem section names. A suffix-only signature could not express it. Because `SLUG_RE` admits no separator and `prefix`/`suffix` are literals owned by the builder, the composed segment is always a single path component.

**Containment is judged against the anchor, not against `relRoot`.** The root is composed *from* the anchor rather than passed in ready-made, so a relocated or symlinked root cannot define its own legality. Resolving a passed-in root and comparing the candidate to it — the earlier draft's rule — accepts a symlinked root pointing outside the repository, because both sides resolve under the same outside location and the comparison succeeds. Anchoring on the repo root closes that: `resolveExisting(join(anchor, ...relRoot, seg))` must be contained in `resolveExisting(anchor)`.

Both sides are resolved with `resolveExisting` (`src/core/branch-added.ts:197`) and compared with `contained()` — currently private at `src/design/artifact-locate.ts:80` and lifted here. `contained()` does no realpath of its own; it is a pure `candidate === root || candidate.startsWith(root + sep)`, and `vet()` applies `resolveExisting` to each side separately at `:96` and `:207`. Resolving both sides is required, not defensive: the `branch-added.ts` docstring notes that same-form-on-both-sides is mandatory, else a `/var` versus `/private/var` cwd rejects every legal path.

`resolveExisting` settles the prospective-path case — a worktree directory or milestone draft that does not exist yet. It resolves the deepest existing ancestor and re-appends the unresolved tail, so a not-yet-created target normalizes without an ENOENT.

**A dangling symlink at the final segment is refused explicitly, because resolution does not cover it.** `realpathSync` throws on a link whose target does not exist, so `resolveExisting` falls back to resolving the *parent* and re-appending `basename` — returning the link's own path, not the target's. Verified directly: a symlink at `<root>/dangling` pointing at a nonexistent path resolves to `<root>/dangling`, which is inside the root and passes `contained()`; the next `mkdirSync` or `writeFileSync` then follows the link and lands outside. Containment alone therefore cannot cover this case, whatever it resolves.

The rule is a separate check: `slugPath` `lstat`s the composed final segment and returns `unsafe-symlink` when it is a symbolic link, regardless of where the link points. No legitimate Noldor path has a symlink at its slug segment — a worktree directory, a feature MD, a milestone MD, a lane sink and a pid file are all created by the framework itself — so refusing the whole category is correct rather than merely conservative, and it needs no target resolution. Write sites additionally open with `O_NOFOLLOW` where the platform supports it, closing the window between the check and the open.

### Unit 2 — Existing owners validate; no root is re-homed

Path roots already have single owners, and this change does not move them. `src/core/doc-roots.ts:54` `loadDocRoots` is the one source for `features` and `milestones`; `src/cr/filename.ts:13` `laneSinkPath` is documented as "the one place a CR sink path is built" after five inline copies were collapsed into it; `src/design/ledger.ts:180` `ledgerPath` owns the design ledger. Re-homing any of them into a new module would recreate exactly the duplication those functions exist to remove, and `laneSinkPath(root, slug, kind, lane)` does not fit a `(cwd, slug)` signature anyway.

So each existing owner calls `slugPath` and returns a result:

| Owner | `relRoot` | `prefix` | `suffix` |
|---|---|---|---|
| `laneSinkPath` (`src/cr/filename.ts:13`) | `['.noldor','cr']` | — | `-<kind>-<lane>.json` |
| `ledgerPath` (`src/design/ledger.ts:180`) | `['.noldor','design']` | — | `.md` |
| escalation path (`src/cr/escalate.ts:38`) | `['.noldor','cr']` | — | `-escalation-context.md` |
| new `featurePath` | `['docs','features']` | — | `.md` |
| new `milestonePath` | `['docs','milestones']` | — | `.md` |
| new `worktreePath` | `['.worktrees']` | — | — |
| new `worktreePidsPath` | `['.noldor']` | `dev-` | `.pids` |

Each owner keeps its own arity and passes its `anchor` through — `laneSinkPath(root, slug, kind, lane)` forwards `root`, `ledgerPath(cwd, slug)` forwards `cwd`. `featurePath` and `milestonePath` live beside `loadDocRoots` in `src/core/doc-roots.ts` and take their `relRoot` from the same constants `loadDocRoots` uses, so there is still one definition of where features and milestones live. The two worktree builders live in `src/worktrees/`.

**Signatures.** Every builder is `(anchor, slug: Slug, …) => { ok: true; path: string } | { ok: false; error: PathError }`. The result is not ceremony: with a `Slug` in hand `escapes-root` is reachable only through a relocated or symlinked root, but `unsafe-symlink` is reachable on *every* call, since anyone can drop a symlink at the target. Two distinct functions are named `ledgerPath` — `src/design/ledger.ts:180` `(cwd, slug)` and `src/cr/autofix-ledger.ts:93` `(cwd, slug, kind)` — with three and four non-test call sites respectively, not the thirty-one a combined grep suggests. The mechanical cost is therefore small. An owner with no result channel of its own (`openLane`, `readLedger`, `writeLedger`) throws on the one arm still reachable once the slug is branded; `sinkCandidatePaths` instead drops refused entries, since a path the guard will not build is one no prior run can have written.

**Call-site conversion.** `upWorktree()`, `downWorktree()`, `createWorktree()`, the two phase CLIs, and the milestone exports each build their path through the matching builder and handle the failure branch before any side effect. The milestone exports are `draftMilestone` (`src/milestones/lib.ts:65`), `loadMilestoneBySlug` (`:58`) and `activateMilestone` (`:154`) — the last is what `src/milestones/cli.ts:42` calls; `preflightActivate` (`:90`) is private and is reached only through it, so it takes an already-parsed `Slug` and needs no result of its own.

Blast radius is small and measured: `upWorktree` and `downWorktree` have no non-test callers outside their own `main()`; the milestone functions have four (`src/milestones/cli.ts` ×2, `src/dashboard/data.ts` ×2). `activateMilestone` returns a result; `loadMilestoneBySlug` already returns `Milestone | null` and widens to a result so an invalid slug is distinguishable from an absent file.

**`createWorktree` converts, and so do its other refusals.** It validates today but throws, which would leave two contracts for one condition. Converting only the slug throw would not fix that: `src/worktrees/create-worktree.ts` throws at `:82` (invalid slug), `:91` (not the main workspace), `:96` (worktree exists) and `:107` (branch exists), and all four are *expected* failures of external input or repository state, not programmer errors. All four become arms of one result union; `:124` (pnpm install failed) stays a throw, being a subprocess failure the boundary converts with `cause` per `error-result-types`. `upWorktree` propagates, and the self-call at `:167` is updated with it.

**Repository-authored slugs that already reach a path.** Three cases exist today:

- `src/dashboard/data.ts:804` passes vision's `current-milestone` into `loadMilestoneBySlug`.
- `src/core/next-priority.ts:256` — `loadMilestoneGate` joins `loadDocRoots(cwd).milestones` with the same vision field and reads the result.
- `src/features/validate-features.ts:297` — joins the milestones root with an FD's `fm.milestone` and `existsSync`es it.

All three adopt `milestonePath`. Unit 4 closes the first and third at the schema; the second is *not* covered by Unit 4, because `next-priority.ts:252` reads vision through a hand-rolled `as { 'current-milestone'?: string }` cast rather than `visionFrontmatterSchema`, so no schema tightening binds there. It is covered by the builder alone — which is the argument for having a guarded builder rather than relying on schemas.

**Flag parsers.** The remaining `--slug` consumers parse and hand off. Each calls `parseSlug` at parse time and reports through its existing usage-error surface, which is also what makes their downstream calls type-check once the builders demand a `Slug`. Two are shared, so the edit count is below the file count: `src/cr/cli-args.ts:73` serves `review-with-codex.ts`, `orchestrate.ts` and `codex.ts`, and `src/cr/orchestrate-args.ts:21` serves orchestrate. The rest are `src/design/{log-cli,context-cli,archive-cli,archive-resolve}.ts`, `src/prep/{prep-fanout,discover,prep-promote}.ts`, `src/cr/{bootstrap-cli,escalate-cli,autofix-cli,aggregate-cli}.ts`, `src/features/propose-pointers.ts` and `src/autonomous/gate-prompt.ts`.

**Argv forms.** A slug value beginning with `-` is consumed as a flag by every parser here, so it never reaches `parseSlug`; the hostile case is passed after `--`, and the tests use that form. A missing flag value is a usage error (exit 2), not an invalid slug (exit 1) — these are different conditions and keep different diagnostics. `--slug=VALUE` and `--slug VALUE` both route to the same validation; parsers that accept only one form are left as they are, since form support is not this change's subject.

### Unit 3 — What enforces the policy, and what only reports it

The compiler enforces *correct use of the builders*, and nothing more. Once every builder demands a `Slug`, passing a raw argv string to one is a type error. What the compiler cannot see is a call site that never calls a builder at all: `join(cwd, 'docs', 'features', argvSlug + '.md')` type-checks perfectly, because `join` takes strings. Any claim that omission "does not build" would be false, and the Goals section states the weaker property that is actually true.

This is the honest ceiling, and it is worth naming why it is not raised further. Raising it would need a static pass over every path-forming expression — and that pass is unavailable here.

A static check cannot carry this load in this repo, and the reason is concrete: **TypeScript 7 dropped the in-process JS compiler API**, as `src/invariants/public-api-tsdoc.ts:6-12` records, so `ts.createSourceFile` is unavailable to an invariant plugin. The one existing AST-capable invariant, `boundaries`, runs on dependency-cruiser, which accepts `typescript >=2 <6` or `@swc/core` — and `boundaries.ts:119` reports that it currently goes **unchecked** for exactly this reason. An AST-based slug invariant would have to first solve a parser problem that already defeats a shipped invariant.

A text scan is therefore a **belt, not the buckle**, and it registers at `severity: 'warn'`. Its stated detection shape is narrow and honest: a `join(...)` call whose argument list contains one of the slug-rooted directory literals `.worktrees`, `docs/features`, `docs/milestones`, `.noldor/cr`, `.noldor/design`, `.noldor/dev-`, outside the sanctioned owner set. It will not see `join(cwd, MILESTONES_DIR, …)` where the literal hides in a const, `join(process.cwd(), 'docs', 'features', …)` where the literal is split across arguments, or `join(loadDocRoots(cwd).milestones, …)` where there is no literal at all. Those are precisely the shapes the type system does catch, which is why the weak check is acceptable as a supplement and would not have been acceptable as the primary control.

The invariant therefore makes no "zero violations means the policy holds" claim, and no acceptance criterion rests on it.

### Unit 4 — Schema encoding

`src/core/slug.ts` exports `slugSchema = z.string().regex(SLUG_RE, …)`, co-located with its inferred type per the `ts-colocate-schema-type` rule. Two schemas adopt it: `src/core/feature-schema.ts:115` (`milestone`, staying `.optional()` — absent remains legal, empty and malformed do not) and `src/dashboard/data.ts:770` (`visionFrontmatterSchema`'s `current-milestone`, same optionality). A milestone document's own slug is out of scope: it is a filename stem produced by `basename()`, not an authored field, so it is guarded by `milestonePath` rather than by a schema.

Migration cost here is nil — `docs/milestones/` holds no files, no FD carries a `milestone:` line, and vision has no `current-milestone`. A consumer carrying a non-slug value is the case that should start failing `validate`, so no grandfather clause.

### Unit 5 — Tests

Two layers, split by what each can observe. A subprocess cannot see a read; an in-process call never runs `main()`.

**Subprocess layer** — against a real `mkdtemp` root, following `src/cr/__tests__/autofix-cli.test.ts:27` (which also covers the router's argv reshaping).

Two invocation forms are needed, because the milestone commands are not `noldor` routes. `src/cli/manifest.ts:237` registers `milestones validate` and nothing else — `node bin/noldor.mjs milestones` prints `validate` alone — while `.claude/skills/noldor-milestone/SKILL.md:20,26` invokes `tsx src/milestones/cli.ts draft|activate`. The tests drive each entry point the way it is actually reached: `node bin/noldor.mjs …` for the worktree and phase commands, `tsx src/milestones/cli.ts …` for the milestone ones. Registering the milestone subcommands in the manifest would be an improvement but is a different change, and this spec does not assume it.

One process accepts one slug, so the count is enumerated rather than asserted:

| Case | Spawns |
|---|---|
| `features phase-flip-done` × full hostile matrix (slash, `..`, leading/trailing/doubled hyphen, uppercase, Unicode) | 7 |
| `features phase-revert`, `tsx milestones/cli.ts draft`, `tsx milestones/cli.ts activate` × canonical traversal value | 3 |
| `worktrees up` × canonical value, in three modes: default, `--no-create`, and with a directory already at the traversed path (AC3) | 3 |
| `worktrees down` × canonical value, with and without `--remove` (AC4) | 2 |
| **Total** | **15** |

AC8's fifteen `--slug` CLIs are **not** in this layer. Their guard is a `parseSlug` call inside two shared parsers plus thirteen thin ones, and spawning fifteen processes to prove fifteen copies of one line is cost without signal; they are covered in-process by calling each parser with an invalid value and asserting the usage-error result. The layer split is stated here so the criterion is not read as promising subprocess coverage it does not have.

Payloads are command-specific, not generic: each is constructed so that, with the guard removed, it resolves onto a purpose-built sentinel whose content the unguarded code would actually rewrite — a phase-shaped sentinel for the phase commands, a milestone-frontmatter sentinel for `activate`, a pid-shaped one for `down`. A generic `../../../escape` does not reach a sentinel once the builder appends `.md` or a `dev-` prefix. A slug value beginning with `-` is passed after `--`.

**In-process layer** — exported functions called directly with hand-rolled fakes passed through the existing `UpDeps` / `DownDeps` seams, never `vi.mock`. This layer proves the ordering the goal states, and it proves it through observable output rather than through a spy on the filesystem. The pid read is the case that matters: every well-formed line in a pid file increments `reaped`, so planting a two-line file exactly where a traversing slug resolves means an unguarded run reports `reaped: 2`. A refusal with no count, and an untouched kill seam, is evidence the read never happened — and unlike a call-count assertion it survives the Deletion Test, which was confirmed by reverting the guard.

Where the payload lands is **computed in the test, not assumed**: `dev-<slug>.pids` puts the slug mid-segment, so the escape depth is not the obvious one, and the test asserts the path is outside the repo before using it. A companion case drives a valid slug through the same code and expects `reaped: 2`, so the guard cannot pass by refusing everything.

The containment metadata reads that `resolveExisting` performs on the *root* are not "protected operations"; they are the guard.

The pid fixture deliberately contains no live PID, so a reintroduced regression cannot issue a real kill from the test suite; the kill seam is a fake and its invocation count is the assertion.

Both layers use the real filesystem per `test-mocking-boundaries`. The Deletion Test holds in each: revert any builder to a bare `join` and the sentinel cases, the exit-code cases and the no-read cases all go red.

## Acceptance criteria

1. `parseSlug` returns `{ ok: false, error }` for any value failing `SLUG_RE` and a branded `Slug` otherwise; `validateSlug` accepts and rejects exactly the same values.
2. `slugPath` returns `escapes-root` for a path resolving outside the anchor — including when `relRoot` itself is a symlink pointing outside — and `unsafe-symlink` when the composed final segment is a symbolic link, whether its target exists or dangles. A final segment that simply does not exist yet succeeds.
3. `worktrees up <bad-slug>` exits non-zero, creates no directory, opens no editor and launches no agent — with `--no-create`, and with a directory already present at the traversed path.
4. `worktrees down <bad-slug>` exits non-zero and invokes neither the kill seam nor the git seam — both with and without `--remove`.
5. `features phase-flip-done <bad-slug>` and `features phase-revert <bad-slug>` exit non-zero and write no file.
6. `milestones draft|activate <bad-slug>` and a direct `loadMilestoneBySlug(<bad-slug>)` each fail without creating, reading or rewriting a file, and an invalid slug is distinguishable from an absent milestone.
7. A direct `createWorktree({ slug: <bad-slug> })` returns a failure result rather than throwing, and runs no git command; its not-main-workspace, worktree-exists and branch-exists refusals return arms of the same union.
8. Every CLI accepting a `--slug` flag exits non-zero on an invalid value before any slug-derived protected operation; a missing flag value remains a usage error with its own exit code.
9. A traversing slug whose pid path resolves outside the repo yields no reaped pids and no kill-seam call, which is observable evidence the foreign file was never read; a valid slug through the same path still reaps its pids.
10. Nothing outside the repo root differs after any case in criteria 3–8 — asserted over the whole outside tree rather than one predicted path, since traversal depth differs per command — and every refusal is identified by the guard's own diagnostic, not merely by a non-zero exit.
11. `pnpm noldor validate features` reports an error for an FD whose `milestone` value is not a slug, and `visionFrontmatterSchema` rejects a non-slug `current-milestone` at dashboard load; an absent value stays legal in both. `src/core/next-priority.ts:252` is knowingly outside this criterion — it casts rather than parses — and is covered by `milestonePath` instead.
12. Valid slugs continue to work end-to-end: the existing worktree, phase, milestone, cr and design suites pass unchanged.

## Risks / trade-offs

- **The guarantee has a real ceiling.** The brand makes builder *misuse* a build error; it does not make builder *omission* one. A future call site that joins a raw slug compiles, and only the advisory scan may notice — and only if the literal is visible to it. This is the strongest property available in this repo today, and stating it plainly is preferable to a stronger claim the code cannot honour. Raising the ceiling means restoring an AST-capable parser (installing `@swc/core` would do it, and would also revive `boundaries`), which is a separate entry.
- **Brand plumbing.** Threading `Slug` through call chains touches signatures a text-scan approach would have left alone — in practice it reached `LaneInput.slug`, `EscalateInput.slug` and `GuardCtx.slug`, so the whole CR lane surface carries proof rather than a string. Every place the compiler objected was a place a raw string previously reached a path, which is the plumbing paying for itself rather than a cost to regret.
- **A warn-level invariant may be ignored.** That is the honest cost of a check that cannot see split literals. It is mitigated by not resting any claim or criterion on it; the type system carries the guarantee, and the scan only shortens the feedback loop for the shapes it can see.
- **Size.** The source entry is labelled `M`; the sweep across ~21 files plus brand plumbing reads closer to `L`. The file count overstates it — two shared `--slug` parsers cover four CLIs, and most remaining edits are a single validate-at-parse line — but the brand threading is genuinely new work relative to the original estimate.
- **Containment cost.** `resolveExisting` walks ancestors on each build. Negligible at CLI cadence, named so it is a decision rather than an accident.
- **Residual surface.** A slug reaching a path from a session marker or a lane sink is covered by the builder it eventually calls, not by an entry-point check. That is the intended depth: the builder is the last line, and Unit 4 hardens the authored schemas that feed it.
- **`boundaries` stays dark.** This change documents why an AST invariant is unavailable but does not fix it. Installing `@swc/core` would restore `boundaries` and open the AST rung for a future stronger slug check; that is a separate entry.

## User Story

As an operator or an autonomous agent running Noldor commands, I want every command that builds a path from a slug to reject a traversing value before it touches the filesystem, so that a malformed or hostile slug cannot read, rewrite, or delete files outside the repository.

## Usage

No new command. Existing commands gain a refusal:

```
$ noldor features phase-flip-done -- ../../../escape
invalid slug '../../../escape': expected kebab-case ([a-z0-9-])
$ echo $?
1
```

`pnpm noldor checks invariants` gains an advisory `slug-path-choke-point` row reporting slug-rooted joins outside the sanctioned builders. It warns; it does not block.

## Open questions (resolved)

1. *Result type or throw for the library-level slug failure?*
   -> Result type, uniformly, including `createWorktree`. (D1) `error-result-types` reserves `throw` for programmer errors, and a slug from argv is untrusted external input; two contracts for one condition is worse than either contract.

2. *Does the sweep cover `--slug`-flag consumers?*
   -> Yes — builder adoption for those that build paths, `parseSlug` at parse time for the rest. (D2) They are the same primitive reached through a flag, and once builders demand a `Slug` their calls do not type-check otherwise.

3. *What enforces the policy — a static check or the type system?*
   -> The type system, with the static check demoted to advisory. (D3) TypeScript 7 removed the in-process compiler API (`public-api-tsdoc.ts:6-12`), the one AST-capable invariant is already dark for that reason (`boundaries.ts:119`), and a text scan provably misses split literals, const-hidden roots and `loadDocRoots`-derived roots.

4. *Should a branded `Slug` type be introduced, having been deferred earlier?*
   -> Yes. (D4) The deferral assumed a static check could carry the enforcement; question 3 shows it cannot, so the type-level rung is now the cheapest thing that actually holds.

5. *Do the three existing validators collapse into one?*
   -> One rejection rule, two messages. (D5) `validateSlug` keeps its corrected-value suggestion because it is better UX for a typo, but is reimplemented on `parseSlug`, so the accept/reject set is single-sourced even though one message carries a suggestion.

6. *Do the new builders replace `laneSinkPath` / `ledgerPath` / `loadDocRoots`?*
   -> No — those owners call `slugPath`. (D6) `laneSinkPath` exists precisely to collapse five inline copies; replacing it would recreate the duplication, and its `(root, slug, kind, lane)` shape does not fit a `(cwd, slug)` builder.

7. *Is a milestone document's own filename slug in scope for schema validation?*
   -> No. (D7) It is a `basename()` stem, not an authored field, so `milestonePath` guards it and no schema can.
