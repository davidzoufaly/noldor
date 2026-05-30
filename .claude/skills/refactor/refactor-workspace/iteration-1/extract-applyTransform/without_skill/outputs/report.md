# Refactoring: Extract applyTransform into composable pieces

## What was done

Decomposed the monolithic `applyTransform` function in `packages/engine/src/transform.ts` into three composable functions:

1. **`applyRotation(manifold, rotation: Vec3)`** — Applies Euler rotation. Returns same reference if rotation is zero.
2. **`applyTranslation(manifold, position: Vec3)`** — Applies translation offset. Returns same reference if position is zero.
3. **`applyTransform(manifold, transform: Transform)`** — Convenience composer that calls the above two, handling intermediate manifold cleanup. Preserves the original API contract exactly.

A private `isZeroVec3` helper deduplicates the zero-check pattern.

All exported functions have TSDoc comments. The `applyTransform` signature and behavior are unchanged, so `engine.ts` required no modifications.

## Tests

Added 4 new tests in `packages/engine/src/__tests__/transform.test.ts`:

- `applyRotation`: zero rotation returns same reference; 90-degree Z rotation produces correct bounding box
- `applyTranslation`: zero translation returns same reference; non-zero translation shifts centroid correctly

All 4 original `applyTransform` tests preserved unchanged.

## Verification

- **`pnpm typecheck`**: All 7 tasks pass (format, engine, viewport, web)
- **`pnpm test`**: All 102 tests pass across all packages. Engine transform tests went from 4 to 8.
