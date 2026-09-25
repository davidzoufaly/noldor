# UI Baseline Validity, Not Just Recency — Design

**Slug:** pendev-ui-design-phase (enhancement: baseline-validity)
**FD:** docs/features/pendev-ui-design-phase.md
**Date:** 2026-09-25
**Tier:** specs-only
**Entry:** Q-0247 (the feature-`.pen` half split out as Q-0296)

## Problem

`checks ui-design-freshness` asks one question per surface: did a successful capture land after the last UI commit? `evaluateUiDesignFreshness` in `src/release/ui-design-freshness.ts` answers it from commit ancestry and the receipt's `baselineBlob`. It never opens the `.pen`. So a baseline that is recent, broken and half-covered reads `fresh`.

charuy's `docs/design/ui/baseline/app.pen` read `fresh` for a month while all of this was true:

- its `variables` block was empty, so every `$…` fill resolved to nothing and the canvas drew `pen-render`'s magenta miss marker;
- it declared `version: "2.13"` while the installed schema was 2.17;
- it carried a page for a state deleted two PRs earlier;
- it covered only the dark theme, though light is a shipped mode.

The capture's own fidelity gate re-renders the emitted file in the same browser that measured it, so it agrees with itself and cannot catch these. The consumer's schema pass skipped silently for weeks. Nothing in noldor looks inside the committed file.

## Goals

- `checks ui-design-freshness` reports a committed baseline that is not a usable document: not JSON, missing a required top-level key, or binding a `$variable` its `variables` block does not declare.
- A surface can declare the states and modes its baseline must hold, and the check reports a missing or an undeclared page.
- A baseline whose `version` differs from the installed pen schema is reported as an advisory, so the check's verdict never depends on which machine runs it.
- `design capture` stops writing a receipt for a baseline that fails the same checks, so a broken capture can no longer vouch for itself.
- A valid, covered, fresh baseline reads exactly as it does today.

## Non-goals

- Holding a *feature's* `.pen` to its spec's acceptance criteria. That is Q-0296.
- Layout rows, twin order and element-id grammar for baselines. That is Q-0292. This spec fixes only the page-id shape the coverage check needs, and Q-0292 builds on it.
- Deep validation of every node against the full JSON schema. The consumer's capture harness already does that at write time (charuy's `scripts/design/validate.ts`), and noldor would need a JSON-schema engine to repeat it.
- Pixel fidelity or render comparison.
- The pen.dev desktop app's schema. noldor dropped that editor (`PENCIL_EXTENSION_ID` in `src/core/design-artifact-names.ts`).

## Design

### Structural context

The change lands in community c41: `src/release/ui-design-freshness.ts`, `src/checks/check-ui-design-freshness.ts` and `src/design/ui-sync-cli.ts`, owned by `pendev-ui-design-phase`. c41's outward edges go to `src/release/preflight-probes.ts` (c40), `src/cli/commands/doctor.ts` (c66), `src/core/design-artifact-names.ts` (c115) and `src/design/ui-capture.ts` (c49). The capture side sits in c49 with `src/design/ui-capture-cli.ts`, `src/core/receipt-store.ts` and `src/core/ui-predicate.ts`. The config key lands in `src/core/consumer-config.ts` (c81), which defines the god node `loadConsumerConfig()` (rank #4, 41 edges), so the schema change there stays additive: one new optional key. None of the touched files defines a god node itself. The new `.pen` reader is a leaf both c41 and `src/design/design-approval-cli.ts` (c28) import.

UI verdict: skip — noldor configures no `consumer.uiPaths`, and this session changes framework code, not a UI surface.

### Unit 1 — `.pen` document reader (`src/design/pen-doc.ts`, new)

Pure functions over a `.pen`'s bytes. The file is plain JSON (the gotcha `docs/noldor/gotchas.md` records).

- `parsePenDocument(bytes)` returns the parsed document or an error naming why it is not one: not JSON, or no top-level `children` array.
- `topLevelPages(doc)` returns each top-level frame's `id` and `name` in file order. `readPenPages` in `src/design/design-approval-cli.ts` moves onto it, so the approval record and this check read pages one way.
- `variableReferences(doc)` returns every variable binding in the tree. A binding is any string value starting with `$`: the schema's `variable` def is `pattern: "^\\$"`, reached through `numberOrVariable`, `colorOrVariable`, `booleanOrVariable` and `stringOrVariable`. The walk skips the top-level `variables`, `themes`, `imports` and `fonts` blocks, and the keys `id`, `name`, `type`, `url` and `ref`, none of which can hold a binding.

### Unit 2 — Installed schema locator (`src/design/pen-schema.ts`, new)

`findInstalledPenSchema()` returns the schema's path, its `version` (`properties.version.const`), its `required` top-level keys and its known top-level keys, or `null`.

It looks in this order and takes the first hit:

1. `NOLDOR_PEN_SCHEMA`, when set, is a path to a `pen.schema.json`. This covers CI and editors noldor does not search.
2. The pen.dev install VS Code's own registry names: the `highagency.pencildev` entry of `~/.vscode/extensions/extensions.json`, whose location holds `node_modules/@ha/schema/pen.schema.json`. The registry rather than a scan of `highagency.pencildev-<version>` directories, because an update leaves the old version on disk, listed only in `.obsolete` (0.6.71 beside 0.6.73 on the operator's machine today), and its schema is stale.

A missing, unreadable or unparseable file counts as "no schema". It never throws.

### Unit 3 — Validity check (`validateBaseline` in `src/design/pen-doc.ts`)

`validateBaseline(bytes, schema | null)` returns a list of findings. Each finding is either **red** or **advisory**.

Red findings do not depend on the machine running the check:

- `unparseable`: Unit 1 could not read the file as a `.pen`.
- `missing-required`: `version` or `children` is absent. Those two are fixed in code rather than read from the installed schema, so this finding cannot change with the machine; they have been the schema's `required` pair in every version seen.
- `unresolved-variable`: a binding names a variable the document does not declare. A plain `$name` must be a key of `variables`. A qualified `$alias:name` must use an alias declared in `imports`; the imported file itself is not opened. This is the finding charuy's empty `variables` block would have raised.

Advisory findings depend on the installed schema, so they exist only when Unit 2 found one:

- `version-drift`: the document's `version` differs from the schema's `version.const`.
- `unknown-top-level-key`: a top-level key the schema does not know.
- `schema-required`: a top-level key the installed schema requires beyond `version` and `children` is absent.

The split is deliberate. A schema finding reds on the operator's laptop and passes in CI, where no extension is installed. A release gate that flips with the machine is worse than no gate, so schema findings inform and never block.

### Unit 4 — Declared coverage (`consumer.uiCoverage` + `checkCoverage` in `src/design/pen-doc.ts`)

A new optional config key in `src/core/consumer-config.ts`:

```json
"uiCoverage": {
  "app": { "states": ["rest", "model-open", "chat-open"], "modes": ["light", "dark"] }
}
```

Keys follow the same rule `uiCapture` keys do: a declared `uiSurfaces` surface, or the implicit `app` when `uiSurfaces` is absent. An orphan key is a config error. `modes` is optional; without it each state stands alone.

The declared set expands to page ids: `<state>-<mode>` for every pair, or `<state>` when there are no modes. That is the page-id grammar charuy already emits (`pageId` in its `scripts/design/states.ts`) and that Q-0292 proposes for every baseline. `checkCoverage(pages, declared, surface)` reports three red findings:

- `missing-page`: a declared id with no top-level frame carrying it.
- `duplicate-page`: a declared id carried by more than one top-level frame.
- `undeclared-page`: a top-level `FINAL:<surface>:` frame whose id is not declared. This is the page for a deleted state that charuy carried.

A surface without a `uiCoverage` entry gets no coverage findings at all. Adoption is opt-in, so no existing consumer gains a new block from this unit.

### Unit 5 — Evaluator integration (`src/release/ui-design-freshness.ts`)

For every surface whose baseline exists at HEAD, `evaluateUiDesignFreshness` reads the committed bytes. `showAtHead` is already there, and HEAD rather than the working tree is the module's rule. It then runs Units 3 and 4 on them. A surface the loop already leaves before that point keeps its verdict: a shallow clone and a surface with no UI history stay `skipped`, and a surface with no baseline at HEAD stays `uninitialized` or `stale`, because there is no file to read.

- Two new statuses, `invalid` (any red validity finding) and `incomplete` (any red coverage finding), join the red-capable tier of `RANK`: `invalid` 7, `incomplete` 6, above `stale` 5. A row takes the worst of its freshness, validity and coverage statuses, and its `detail` names every failing leg, not just the winner.
- Advisory findings ride a new optional `advisories: string[]` on the row. They never change `status`.
- A git failure reading the bytes adds `indeterminate` to the row, never `invalid`, in line with the module's rule that a failed probe may not mint a red. The freshness verdict is computed first, so a known `stale` still outranks the unknown.
- `remediation` for the new statuses is `capture` when the surface declares `uiCapture`, and `ui-sync` otherwise.

Downstream:

- `exitCodeFor` in `src/checks/check-ui-design-freshness.ts` exits 1 on `invalid` and `incomplete`. `renderRows` prints advisories under their row.
- The `ui-design-freshness` probe in `src/release/preflight-probes.ts` blocks on `invalid` and `incomplete`, as it does on `stale`. A run whose overall is `fresh` but carries advisories warns instead of reporting ok. The exhaustive `never` checks there and in `exitCodeFor` make every new status a typecheck error until it is handled.
- `src/cli/commands/doctor.ts` warns on `invalid` and `incomplete` beside `stale`, `uninitialized` and `unverified`. Its filter was an allowlist with no exhaustive check, so it becomes an exhaustive switch; without it doctor would have stayed silent on both.
- `src/design/ui-sync-cli.ts`, the command a `ui-sync` remediation names, treats `invalid` and `incomplete` the way it treats `stale`: the operator fixes the file in a pencil session, and ui-sync stages it and stays pending until then. Without this it would print "no action" and exit 0 over a broken baseline.

### Unit 6 — Capture-side gate (`src/design/ui-capture-cli.ts`)

After a surface's capture command exits 0 and the baseline exists, `design capture` runs Units 3 and 4 on the file it just wrote. A red finding fails that surface: no receipt is written, the findings are printed, and the run exits non-zero. `--vouch-only` checks the same way, because a hand edit that breaks the file must not be vouched for either. This closes the loop the charuy month opened: the receipt is what makes a surface read fresh, so a receipt must not exist for a broken baseline.

### Error handling

Every probe keeps the module's existing posture: report, never throw, and never turn "could not check" into a red.

- No schema installed: no advisory findings. The red findings still run, because they need no schema.
- A git failure reading the baseline at HEAD: `indeterminate`.
- An unparseable baseline is a real red (`invalid` / `unparseable`), not an `indeterminate`: the bytes were read, and they are not a `.pen`.
- A `uiCoverage` key naming no surface: `validate noldor-config` refuses it, as it refuses an orphan `uiCapture` key.

### Testing

- `pen-doc.ts`: fixture documents for each finding. The charuy shape (empty `variables`, pages binding `$dark-viewport-bg`) must yield `unresolved-variable`. A qualified `$alias:name` with a declared alias must not. A text node whose `content` is `$price` counts as a binding, which is what the schema says it is.
- `pen-schema.ts`: a temp `HOME` with two extension directories must pick the one the registry names, not the leftover. `NOLDOR_PEN_SCHEMA` must win. A corrupt schema file must read as none.
- Evaluator: extend the temp-git-repo harness in `src/release/__tests__/ui-design-freshness.test.ts` with an invalid baseline, an incomplete one, a schema advisory, and a failed `git show` that must stay `indeterminate`. Every existing freshness test must pass unchanged.
- CLI and preflight: exit codes and row statuses for the new statuses.
- Capture: a stub capture command that writes an invalid baseline must leave no receipt and exit non-zero.

## Acceptance criteria

1. A committed baseline whose pages bind a `$variable` the `variables` block does not declare makes `checks ui-design-freshness` report that surface `invalid`, naming the variable, and exit 1.
2. A committed baseline that is not JSON, or has no top-level `children` array, reports `invalid` and exits 1.
3. With `uiCoverage` declaring states × modes for a surface, a baseline missing one of the expanded page ids reports `incomplete`, naming the id, and exits 1.
4. A top-level `FINAL:<surface>:` page whose id the surface does not declare, or a declared id carried by two top-level frames, reports `incomplete`, naming the id.
5. A surface with no `uiCoverage` entry never reports `incomplete`.
6. With a pen schema found, a baseline whose `version` differs from it is reported as an advisory and the check still exits 0 when nothing else is wrong. With no schema found, the check reports no schema finding at all.
7. Release preflight blocks on `invalid` and `incomplete`, and warns rather than reporting ok when the only findings are advisories.
8. A git failure reading the committed baseline yields `indeterminate`, never `invalid` or `incomplete`.
9. `design capture` writes no receipt and exits non-zero when the baseline it produced is `invalid` or `incomplete`. `--vouch-only` refuses the same way.
10. A valid, fully covered baseline keeps the verdict it has today. Every existing freshness, capture, ui-sync and approval test keeps its assertions; only its `.pen` fixtures become valid documents, since placeholder text is now correctly `invalid`.
11. `validate noldor-config` rejects a `uiCoverage` key that names no declared surface.

## Risks / trade-offs

- **New reds on upgrade.** A consumer whose committed baseline binds an undeclared variable goes red the day it upgrades. That is the point: the entry exists because such a baseline passed. The coverage red is opt-in, so it cannot surprise anyone.
- **Page-id grammar ahead of Q-0292.** The coverage check fixes `<state>-<mode>` as the baseline page id before Q-0292 writes the full contract. Q-0292 then extends this grammar rather than choosing one, and its layout and element-id rules stay its own.
- **Binding detection is a string rule, not a schema walk.** Any `$`-prefixed string outside the skipped keys counts as a binding. The schema says exactly that for every `*OrVariable` property, including text `content`, so a literal `$5` in a label is already a variable miss in the editor. The risk is a string property the skip list misses; the fixture tests pin the skip list.
- **Envelope validation, not full validation.** A structurally wrong node deep in the tree still passes noldor's check. Full validation needs a JSON-schema engine: either a new dependency (`ajv`) or the extension's private `@ha/schema/validator` module, whose shape can change with any extension update. The consumer's capture harness already runs the full pass, and the capture-side gate in Unit 6 makes the envelope check run at the same moment.
- **Imported variables are trusted by alias.** A qualified binding with a declared alias passes without opening the imported file.

## User Story

As an operator whose release gate trusts the UI baseline, I want `checks ui-design-freshness` to prove the committed baseline is a usable document that covers every state and mode its surface declares, not just that it was captured after the last UI commit, so that a fresh-but-broken or dark-only baseline fails loudly instead of passing for a month.

## Usage

- Any time: `pnpm noldor checks ui-design-freshness`. A row now reads `invalid` (the file is not a usable `.pen`: not JSON, a missing required key, or a `$variable` nothing declares) or `incomplete` (a declared page is missing, or a `FINAL:` page is undeclared), and both exit 1. Schema advisories, such as a `version` that differs from the installed pen schema, print under the row and do not change the exit code. Gate Step 4 and release preflight run the same check, and preflight blocks on both new statuses.
- Declare coverage (optional) in `consumer` of `.noldor/config.json`: `"uiCoverage": {"app": {"states": ["rest", "chat-open"], "modes": ["light", "dark"]}}`. The baseline must then hold exactly one top-level page per `<state>-<mode>` id (`rest-light`, `rest-dark`, …).
- `pnpm noldor design capture [--surface <name>] [--vouch-only]` now refuses to write a receipt for a baseline that is `invalid` or `incomplete`, and prints why.
- Schema: found automatically in the pen.dev extension VS Code has active. Point `NOLDOR_PEN_SCHEMA` at a `pen.schema.json` to use another, for example in CI.

## Open questions (resolved)

1. *Should `invalid` and `incomplete` block the release, or only warn?* → Block, like `stale` (D1). Both are defects in the committed artifact, not adoption debt; `incomplete` is opt-in, and `invalid` rests only on machine-independent findings.
2. *How deep should "validates against the installed schema" go?* → Envelope plus bindings: parse, required keys, variable resolution, plus version and top-level-key advisories (D2). It needs no new dependency and catches every failure charuy hit. Full node validation stays with the capture harness.
3. *How does a page match a declared state and mode?* → By the top-level frame's `id`, shaped `<state>-<mode>` (D3). An id is stable where a display name is not, and charuy already emits this shape.
4. *Presence only, or an exact match?* → Exact: a declared id must be carried by exactly one top-level frame, and an undeclared `FINAL:<surface>:` page is reported (D4). A leftover page is what misled charuy's capture.
5. *Should `design capture` run the same checks?* → Yes, and refuse the receipt (D5). The receipt is what makes a surface read fresh, so it is the one place a broken baseline must be stopped.
6. *Where is the installed schema found?* → `NOLDOR_PEN_SCHEMA`, then the pen.dev install VS Code's extension registry names (D6). The registry knows which install is active; a directory scan can land on an obsolete one. The desktop app is no longer a noldor editor.
7. *What happens when no schema is installed, as in CI?* → The schema advisories are skipped and nothing reds on schema grounds (D7). The red findings run everywhere because they need no schema.
