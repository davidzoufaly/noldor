# Refactoring: Rename `formatZodErrors` to `formatValidationErrors`

**File changed:** `packages/format/src/validate.ts` — 3 occurrences replaced (definition on line 13, call sites on lines 33 and 41) using `replace_all`.

**Scope:** The function is private (non-exported), so only 1 file needed modification. No other packages import or reference it. No breaking changes.

**Verification:**

- `pnpm typecheck` — all 4 packages pass (format, engine, viewport, web)
- `pnpm test` — all 98 tests pass across 14 test files
