---
noldor-page: engineering-principles
introduced: 0.4.0
---

# Engineering Principles

Non-negotiable principles for all code written in a Noldor repo. Aligned with `tsconfig.json` (ES2023, strict, ESM) and `.oxlintrc.json` (correctness/suspicious/perf as error). When in doubt, lean toward _less_ code.

## Commands (executable enforcement)

| Command               | Enforces                                                                              |
| --------------------- | ------------------------------------------------------------------------------------- |
| `pnpm lint`           | `oxlint` — correctness/suspicious/perf rules + `jsx-a11y` structural a11y rules       |
| `pnpm fmt:check`      | `oxfmt` formatting (CI-safe; `pnpm fmt` to write)                                     |
| `pnpm typecheck`      | `tsc --noEmit` across packages + `scripts/`                                           |
| `pnpm test`           | Vitest unit + component + script tests                                                |
| `pnpm verify`         | Composite: `lint && fmt:check && typecheck && build:samples && test` — pre-push smoke |
| Pre-commit (lefthook) | Runs `validate:features`, `check:invariants`, `check:shared-files`, `sync:*`          |

Principles below are reviewed at code-write time; the commands above are the automated gate.

## Principles

- **YAGNI.** Don't build for hypothetical future requirements. Add capability when a real caller needs it, not before.
- **Smallest viable diff.** Surgical change > sweeping refactor. Refactor commits are separate from feature commits.
- **DRY threshold = 3.** Two similar lines is fine. Three near-identical instances is the trigger to extract — not before.
- **Prefer deletion.** Removing code is the highest-leverage edit. If a flag, branch, or helper has no caller, delete it.
- **Trust the boundary, not the interior.** Validate at system edges (user input, file IO, external APIs). Don't add defensive checks against impossible internal states.
- **Fix root cause.** Don't suppress warnings, skip hooks, or add fallbacks for "can't happen" cases. If it can't happen, don't handle it; if it can, fix it.
- **Composition > configuration.** A function that takes a 6-key options bag is two functions in disguise.
- **One responsibility per function.** If you struggle to name it, it does too much.
- **Avoid regex.** Hard to read, easy to get subtly wrong. Prefer string methods (`includes`, `startsWith`, `split`), parsers, or named helpers. Reach for regex only when the pattern is genuinely irregular and no built-in fits — and then add a comment explaining what it matches.

## TypeScript

(Project overlays may extend these rules — read both.)

- **Narrow, don't assert.** Use type guards, `in`, `typeof`, discriminants. `as` is reserved for branded types and library-shaped unknowns from external sources.
- **Exhaustive unions.** Discriminated unions get `switch` + `default: x satisfies never`. No silent fall-through.
- **Readonly by default.** Stored data, props, and slice state are `readonly` / `Readonly<>`. Mutate locally, return new.
- **Prefer built-in utility types.** `Pick`, `Omit`, `Partial`, `Required`, `Readonly`, `ReadonlyArray`, `Record`, `Parameters`, `ReturnType`, `Awaited`, `NonNullable`, `Extract`, `Exclude` keep type definitions DRY and intent-explicit. Re-declaring a shape that already exists as `Pick<Foo, 'a' | 'b'>` or `Partial<T>` is duplication. For Zod-derived types use `z.infer<typeof fooSchema>` (when the project layers Zod on top); same DRY principle. Cap depth at the "Type aliases, not generic gymnastics" threshold — past 2 levels (e.g. `Readonly<Partial<Pick<Foo, 'a' | 'b'>>>`), extract a named alias.
- **No optional chaining as a null check.** Narrow first; `?.` is for traversal, not for "I don't know if this exists."
- **Type aliases, not generic gymnastics.** If a generic has >2 parameters or nested conditional types, extract to a named alias.
- **No type-only re-exports for compatibility shims.** Delete the old name and update callers.
- **No `@ts-ignore` / `@ts-expect-error` without an inline reason.** Suppression is comment debt — explain why and what would let it be removed.

## Zod

(Project overlays may extend these rules; opt-in — applies only when the project depends on `zod`.)

- **Validate at the boundary, never `as` cast.** All external data (API responses, file IO, user input) parsed through a Zod schema. Internal code trusts the parsed type.
- **`safeParse` for expected failures, `parse` only when invalid = bug.** A failing `parse()` is a programmer error; reach for `safeParse` whenever the input might legitimately not match.
- **Co-locate schema + type.** `export const fooSchema = z.object({...}); export type Foo = z.infer<typeof fooSchema>;` — single source of truth, schema name uses lowercase `fooSchema` suffix (not PascalCase).
- **`.strict()` on object schemas.** Unknown keys are silent data corruption; reject them at the boundary.

## React

- **Function components only.** No class components.
- **No `useEffect` for derived values.** Compute during render. Memoize only when profiling proves the need.
- **No `useEffect` to sync props → state.** Lift state up or pass derived values directly.
- **Prop drilling beats Context until 3+ levels.** Context has re-render cost; reach for it deliberately.
- **Stable keys.** Use the domain ID. Array index is a key only when the list is static, never reordered, and never insert/remove.
- **Trust the React Compiler.** If your build wires the React Compiler, the compiler auto-memoizes function components + hooks. Don't add `useMemo` / `useCallback` by hand — only when a profiler proves a hot path the compiler can't reason about (rare). The compiler enforces rules-of-hooks and reactivity invariants at build time; a build error here is a real bug, never a "compiler is too strict" excuse to opt out.
- **Every subscription has a cleanup.** `useEffect` returns a teardown for every event listener, observer, timer, network call.
- **No async function passed to `useEffect`.** Define an inner async fn and call it.
- **No `dangerouslySetInnerHTML`** without sanitization at the boundary it enters the system.

## Accessibility

Target: **WCAG 2.1 Level AA** across every user-facing surface. Aligned with the `jsx-a11y` plugin in `.oxlintrc.json`; lint catches structural mistakes, but contrast / live regions / shortcut conflicts need test-time + design-time discipline. Canvas / WebGL surfaces are exempt from DOM-level rules — but they need an alternative DOM surface (sidebar tree, command palette, keyboard shortcuts) that **must** stay AA-compliant.

### Semantic structure

- **Semantic HTML first.** `<button>` for actions, `<a>` for navigation, `<input>` paired with `<label htmlFor>`. Add `role` only when no native element fits.
- **Landmarks present.** Each top-level surface (toolbar, sidebar, properties, main view, status bar) sits inside a landmark (`<nav>`, `<aside>`, `<main>`, or labeled `role="region"`). One `<main>` per page.
- **Headings convey structure.** Panel titles are headings (`<h2>` / `<h3>`), not styled `<div>`s. Heading levels skip nothing.
- **Every form control has an accessible name.** `htmlFor` + `id`, wrapping `<label>`, or `aria-label`. No bare inputs.
- **Label in name (WCAG 2.5.3).** When a control has visible text, the accessible name must contain that text verbatim. A `<button>Save</button>` must have `aria-label="Save"` (or no `aria-label` at all) — never `aria-label="S"`; the keyboard chip in the tooltip is supplementary.

### Keyboard & focus

- **Every interactive element is keyboard-reachable.** If it has `onClick`, it has `tabIndex={0}` (or is a native control), `onKeyDown` for Enter/Space, and a `role`.
- **Focus visible (WCAG 2.4.7).** Every focusable element shows a focus indicator with **≥ 3:1 contrast** against adjacent colors. Never `outline: none` without a replacement. Test under every theme variant the project ships (light, dark, high-contrast, etc.).
- **Manage focus on dynamic UI.** When a menu / modal / edit-mode opens, move focus into it; on close, restore to the trigger. Use `ref` + `useEffect`, never `autoFocus`.
- **No keyboard traps.** Escape closes overlays, Tab cycles within modals, focus is recoverable everywhere.
- **Single-character shortcuts are dismissible (WCAG 2.1.4).** Single-character shortcuts (e.g. `n`, `t`, ...) are _active only when a specific surface has focus_, OR a user setting disables them globally. Never trap globally — colliding with browser screen-reader shortcuts breaks AT users.
- **Pointer activation on pointer-up (WCAG 2.5.2).** Native `<button>` already does this. For custom canvas controls (drag handles, gizmos): commit on `pointerup` with abort-on-leave-target, never on `pointerdown`.
- **Focus order matches visual order (WCAG 2.4.3).** Tab moves through panels in left-to-right, top-to-bottom DOM order. Don't reorder visually with `flex-direction: row-reverse` or `order:` without matching DOM.

### Color & contrast

- **Text contrast ≥ 4.5:1 (WCAG 1.4.3).** Body text against its background. Large text (≥ 18pt or ≥ 14pt bold) ≥ 3:1.
- **Non-text contrast ≥ 3:1 (WCAG 1.4.11).** UI components (button borders, input borders, toggles, focus rings), graphical info (status icons, color-coded overlays, sidebar icons). Decorative chrome is exempt.
- **Don't rely on color alone (WCAG 1.4.1).** Color-coded overlays must carry a label or icon, not just a color. Selection highlights use both color and outline. Validation errors pair red with an icon and text.
- **Theme variants pass the same bars across the board.** Translucent / glassy backgrounds compress contrast — design tokens enforce minimum effective contrast on every surface; a token failing under any theme is a token bug, not a designer's call.

### Dynamic content

- **Status messages use `aria-live` (WCAG 4.1.3).** Background-task progress, autosave state, validation errors all surface to AT without focus shift. `polite` for routine updates, `assertive` only for things that block work (fatal errors). Toast-style notifications are `role="status"` or `role="alert"` accordingly.
- **Tooltips are dismissible, hoverable, persistent (WCAG 1.4.13).** Esc dismisses. The tooltip itself is hoverable so users magnifying their screen can read it. Stays open until pointer leaves the trigger or the tooltip itself.
- **Expose state via ARIA.** `aria-expanded`, `aria-selected`, `aria-busy`, `aria-pressed`, `aria-current` mirror visible state. Tree nodes expose `aria-expanded` / `aria-selected`; long-running operations expose `aria-busy`.
- **Errors identified, located, suggested (WCAG 3.3.1, 3.3.3).** Validation errors say _what_ failed, _where_ (which field / which entity), and _how to fix_. If the project exposes both a programmatic API and a UI, the API error shape and the UI error message should share the same content.
- **No context change on focus or input (WCAG 3.2.1, 3.2.2).** Tabbing into a field never auto-submits; selecting a value never auto-navigates. Submit requires explicit user action.

### User preferences

- **Honor `prefers-reduced-motion`.** Auto-pans, activity highlights, panel transitions, onboarding flows — all gate their animation on the media query. Static fallbacks must still convey the same information.
- **Reflow at 320 CSS px (WCAG 1.4.10).** No horizontal scroll on a 320px viewport at 100% zoom. Floating panels collapse / stack rather than overflow. Even when mobile is out of scope, reflow on a narrowed desktop window is not.
- **Survive 200% text resize (WCAG 1.4.4) and text-spacing overrides (WCAG 1.4.12).** Test under browser zoom 200% + the standard text-spacing bookmarklet (`line-height: 1.5`, `letter-spacing: 0.12em`, `word-spacing: 0.16em`, `paragraph-spacing: 2em`). Layout must not clip or overlap.

### Verification

- **`pnpm lint` enforces structural rules.** `jsx-a11y` plugin runs on every commit.
- **Component tests assert ARIA contracts.** Use `@testing-library/jest-dom` matchers (`toHaveAccessibleName`, `toHaveRole`) — these test the contract, not the implementation.
- **`axe-core` runs in critical-path component + e2e tests.** Top-level surfaces (navigation, primary panels, modals). Failing axe rule = failing test. (Adopt incrementally; not every shipped feature has it yet — flag the gap in your audit script if missing on a new feature.)
- **Manual keyboard pass before committing UI.** Tab through every new surface with the mouse hidden; reach every control; verify focus ring visible; verify Esc / Tab / Enter / Space behave as expected.

## Tests

(Project overlays may extend these rules.)

- **One behavior per `it` block.** Multiple assertions are fine if they describe one behavior.
- **Matcher discipline.** `toBe` for primitives, `toEqual` for object shape (ignores `undefined` keys), `toStrictEqual` only when key set must be exact. `toBeTruthy()` for non-boolean values, never `toBe(true)`.
- **No `toHaveBeenCalledWith()` with empty args.** That asserts "called with no arguments" — use `toHaveBeenCalled()` instead.
- **Don't test implementation.** Test the observable behavior. Private methods, internal state shapes, render counts are off-limits.
- **Real dependencies, no mocks.** Tests hit the real domain WASM module (or other heavy local dependency), real Zod schemas, real localStorage in jsdom. Mock only at true external boundaries (network, time).

## Error Handling

- **Result types for expected failures.** Return `{ success: true, data } | { success: false, errors }` (or equivalent discriminated union). Forces callers to confront both branches.
- **Throw only for programmer errors / invariant violations.** A thrown error means "this should never happen" — `parse()` failures, missing required env, broken assumptions. Recoverable failures use the result type.
- **Catch external errors at the boundary, convert to result type.** WASM modules, network calls, file IO can throw — wrap once at the entry point, propagate the typed result inward.
- **Never swallow errors silently.** Empty `catch {}` blocks are bugs; at minimum log and rethrow, ideally surface as a result.

## Comments

- **Default: no comment.** A well-named identifier replaces most comments.
- **Allowed: the _why_.** Hidden constraint, subtle invariant, workaround for a specific bug, behavior that would surprise a reader.
- **Forbidden: the _what_.** `// increment counter` above `i++` is noise.
- **Forbidden: the conversational.** No "added for the X feature", "fixes issue #123". Those belong in commit messages, not code.
- **TSDoc on every exported symbol.** Project overlays may carry the format rules; otherwise apply the standard TSDoc tags (`@param`, `@returns`, `@example`, `@deprecated`).

## File Structure

Per-package convention (project overlays may extend):

- `src/index.ts` — public API only. Re-exports nothing internal that isn't part of the contract.
- `src/types.ts` — schemas + derived types (single source of truth).
- `src/<module>.ts` — implementation, one responsibility per file.
- `src/__tests__/<module>.test.ts` — tests co-located in a `__tests__/` directory.

## When auto-tooling rewrites code

- **Always verify after `oxlint --fix`, formatter runs, or codemods.** Run `pnpm verify` before staging.
- **Auto-fixes can introduce bugs.** Real examples: `toBeTruthy()` → `toBe(true)` on string values, `toHaveBeenCalled()` → `toHaveBeenCalledWith()` with empty args, `describe('Name')` → `describe(NameConstant)` where `NameConstant` is not a function. Read the diff.
- **Format-only commits stay separate from logic commits.** Mixed diffs are unreviewable.

## Subagent guidance

When delegating to a subagent (Agent tool), include this line in the prompt:

> Follow engineering principles in `docs/noldor/engineering-principles.md` and project overlays in `.claude/engineering-rules.md`.

Subagents don't auto-load CLAUDE.md, so the parent must reference the files explicitly.

### Implementer scope-guard

When dispatching an implementer subagent to execute a plan task (e.g. `superpowers:subagent-driven-development`), append this template to the implementer prompt verbatim:

> ONLY edit the files listed in the task's Files: section (no Files: section ⇒ only the files the task names). Hooks may auto-stage fixes for files you never touched — lefthook `stage_fixed` formatter/sync jobs run during `git commit`, so you cannot prevent the bundling up front. After committing, run `git show --stat HEAD`: if it lists files outside your task scope, report `DONE_WITH_CONCERNS` naming those files instead of reporting the commit as clean. Do not amend or re-commit — the controller moves the forced edits into a separate, explicitly-labeled cleanup commit (e.g. `chore(hooks): stage_fixed auto-fixes from task N`).

The guard exists because lefthook `stage_fixed` jobs silently stage auto-fixes for files the task never touched, blurring per-task commit scope in `git log`.
