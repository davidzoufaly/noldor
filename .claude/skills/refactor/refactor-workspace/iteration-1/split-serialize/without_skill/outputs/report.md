# Refactor Report: Split serialize.ts into serialize.ts + deserialize.ts

**Task**: Split `packages/format/src/serialize.ts` (which contained both serialize and deserialize logic) into two separate modules, and update the barrel export.

## Changes Made

**New file: `packages/format/src/deserialize.ts`**
Contains `PRIMITIVE_SET`, `deserializeNode()`, and the exported `deserialize()` function. Added TSDoc comments per project rules.

**Modified: `packages/format/src/serialize.ts`**
Removed `deserializeNode()`, `deserialize()`, and the `PRIMITIVE_SET` constant (only used by deserialize). Removed the now-unused `primitiveTypes` import. Added TSDoc comments to private helpers and the exported function.

**Modified: `packages/format/src/index.ts`**
Split the single re-export line into two separate imports:

- `export { serialize } from './serialize.js';`
- `export { deserialize } from './deserialize.js';`

**Modified: `packages/format/src/__tests__/serialize.test.ts`**
Updated import to pull `serialize` from `../serialize.js` and `deserialize` from `../deserialize.js`.

## Verification

**Typecheck (`pnpm typecheck`)**: All 4 packages pass (7/7 tasks successful).

**Tests (`pnpm test`)**: 98 tests passed, 0 failures across all packages. All 10 serialize/deserialize tests pass.

## Import Impact

No external consumers broke. The barrel export still exposes both `serialize` and `deserialize` at the same public API surface. Only the test file imported directly from the module path and was updated.

## Breaking Changes

None. The public API of `@tvar/format` is unchanged.

## Rationale

Single Responsibility Principle — serialize (defaults elision for storage) and deserialize (defaults restoration for runtime) are independent operations with different internal dependencies. Separating them makes each module smaller and more focused.
