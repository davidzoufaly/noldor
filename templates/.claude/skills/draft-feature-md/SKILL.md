---
name: draft-feature-md
description: Auto-draft a feature MD's User Story and Usage sections from the spec (--from-spec) or from spec + code + tests (--refresh). Presents drafts inline as fenced markdown blocks; user confirms or edits inline. Non-destructive — never overwrites non-TODO content without explicit confirmation. Skips Summary and frontmatter. Does not stage or commit. Use after a spec is approved (--from-spec) and again before flipping phase: in-progress → done (--refresh).
user_invocable: true
---

# Auto-Draft Feature MD

Draft `User Story` and `Usage` sections of a feature MD from the spec (and at refresh-time, the shipped code + tests). Replace the previous "TODO stub filled in by hand" pattern with proactive drafts that the user confirms or edits.

## Inputs

- **slug** (required) — kebab-case feature slug. The feature MD lives at `docs/features/<slug>.md`.
- **mode** (optional flag) — `--from-spec` (default) or `--refresh`.

## Steps — `--from-spec` mode

1. Read `docs/features/<slug>.md`. If missing, abort:
   > No feature MD at `docs/features/<slug>.md` — run `/promote` or `/new-feature` first.
2. Locate the latest spec at `docs/superpowers/specs/*-<slug>-design.md` (sort by date prefix, take latest). If none, abort:
   > No spec found for slug `<slug>`. Author one via `superpowers:brainstorming`, or run `/draft-feature-md <slug> --refresh` after code lands.
3. Read the spec. Extract its `## User Story` and `## Usage` sections (everything between those headings and the next `##`).
4. For each of `User Story`, `Usage` in the feature MD:
   - If the section's body contains the substring `<!-- TODO`, mark it for drafting.
   - Else, mark `skip` and tell the user: `Skipping <section>: already populated.`
5. For each marked-for-drafting section, draft according to **Drafting prompts** below. Present each draft inline as a fenced markdown block.
6. Ask the user:
   > Approve? Reply with `y` to accept, inline edits to revise, or `regen with: <hint>` to redraft.
7. On `y`: apply draft to feature MD via Edit tool (replace the TODO-stub section body with the drafted content). On inline edits: parse, apply, re-show, re-ask. On `regen with: <hint>`: redraft using the hint, re-show, re-ask.
8. After all sections settled, save the feature MD. Tell the user:
   > Updated `docs/features/<slug>.md`: <list of sections written>. Not staged, not committed.
9. Do NOT run `git add` or `git commit`.

## Steps — `--refresh` mode

1. Read `docs/features/<slug>.md`. If missing, abort (same message as `--from-spec` step 1).
2. Read the latest spec at `docs/superpowers/specs/*-<slug>-design.md` if present (optional but preferred). If absent, log: `No spec found — drafting from code + tests only.`
3. Read every file path listed in the feature MD's `links.code` frontmatter array. For directory entries, recurse one level. Filter to extensions `*.ts`, `*.tsx`, `*.md`, `*.html`. Ignore `node_modules`, `dist`, `.turbo`.
4. Read every file in `links.tests`.
5. If both `links.code` and `links.tests` are empty AND no spec was loaded, abort:
   > Refresh needs at least a spec or shipped code/tests. Nothing to draw from.
6. Draft fresh `User Story` + `Usage` according to **Drafting prompts**, weighting code/tests over spec where they conflict (reality wins).
7. For each of `User Story`, `Usage`:
   - Compute a normalized form of the current section body (strip leading/trailing whitespace, collapse runs of blank lines to one).
   - Compute a normalized form of the draft.
   - If `normalized current == normalized draft`, leave the section alone, tell the user: `<section>: unchanged`.
   - Else, present a unified diff (current vs proposed). Ask the user:
     > Reply: `keep` (current text), `replace` (use proposal), or `edit: <new text>`.
8. Apply user choices. If a section was edited heavily by the user (current text shares <30% of tokens with what we'd draft), prefer `keep` as the default if the user replies with empty input — don't surprise-replace.
9. Save the file. Tell the user what changed. Do NOT stage or commit.

## Drafting prompts

When the agent invoking this skill produces the draft itself (no separate API call), use these prompts:

- **User Story prompt:** Write **one sentence** in the form: `As a <role> (human or agent), I want <action>, so that <outcome>.` Role should be specific (`new user`, `experienced user`, `agent driving the editor`). Avoid generic `user`. Source: spec's User Story section. At `--refresh` time, also weigh test files — e2e specs reveal who actually uses the feature.
- **Usage prompt:** Write the feature MD `## Usage` section with these subsections in order, each only included if applicable to this feature:
  - `**UI**` — numbered steps for the human flow (open menu, click button, etc.). Imperative, present-tense.
  - `**Keyboard shortcut**` — single bullet: chord + 1-line rationale, OR `_none for v1_` with the conflict that blocked binding (e.g., macOS Option+G types ©).
  - `**Agent/Programmatic API**` — one bullet per public method or endpoint the feature exposes for agents/scripts (if any).
    Match what the spec promised at `--from-spec` time; match what shipped at `--refresh` time. No rationale or non-goals — those belong in the spec.

## Rules

- **Never modify Summary.** The Summary section is user-curated; `/promote` already copies the spec block's first paragraph.
- **Never touch frontmatter.** `phase`, `introduced`, `links.*`, `category`, `area`, `packages`, `deps` are owned by other tooling.
- **Never set `introduced`.** `pnpm release` owns that field.
- **Never `git add` or `git commit`.** Caller stages and commits per existing conventions.
- **Never overwrite non-TODO content silently in `--from-spec` mode.** Skip + tell user.
- **Never run `--refresh` without surfacing diffs to the user** when proposed text differs from current.
- **Output drafts as fenced markdown blocks.** Easy copy/paste-edit.
- **One slug per invocation.** Multi-slug batch is out of scope (backlog).

## Failure modes

| Failure                                                    | Mode          | Behavior                                                      |
| ---------------------------------------------------------- | ------------- | ------------------------------------------------------------- |
| Feature MD missing                                         | both          | Abort with: "Run `/promote` or `/new-feature` first."         |
| Spec missing                                               | `--from-spec` | Abort with: "No spec — author one or use `--refresh` later."  |
| Spec missing AND `links.code` + `links.tests` empty        | `--refresh`   | Abort with: "Nothing to draw from."                           |
| Section already non-TODO                                   | `--from-spec` | Skip + tell user.                                             |
| Drafted text ≈ current text                                | `--refresh`   | Skip + tell user "unchanged".                                 |
| User types unparseable edit syntax                         | both          | Re-prompt with format hint.                                   |
| Multiple specs match `*-<slug>-design.md`                  | both          | Pick the latest by date prefix; tell user which one was used. |
| `links.code` references a file no longer present (deleted) | `--refresh`   | Skip that file silently; warn if all entries are missing.     |

## When to use

- **After a spec is approved** in `superpowers:brainstorming`, before invoking `writing-plans`. Mode: `--from-spec`. Pre-fills the feature MD so it's not a TODO black hole during implementation.
- **Before flipping `phase: in-progress → done`** in the shipping commit. Mode: `--refresh`. Surfaces drift between spec claims and what shipped.

## When NOT to use

- During `/promote` or `/new-feature` — those scaffold TODO stubs intentionally; the spec/code that would feed the drafter doesn't exist yet.
- On a feature with no spec AND no code yet (newly scaffolded via `/new-feature` with no body work done). The skill aborts in that case.
- Bulk operations across many features — out of scope at v1.
