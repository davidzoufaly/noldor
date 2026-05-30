import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The framework's integration tests read real consumer files at the repo root
// (docs/roadmap.md, docs/features/*, .claude/skills/*, etc.) via process.cwd().
// Pre-migration these tests lived under scripts/ and ran with cwd = repo root.
// Post-lift, `pnpm --filter noldor test` / `turbo run test` set cwd = the package
// dir, so process.cwd()/docs/... no longer resolves. Restore the pre-migration
// contract by chdir-ing to the repo root (two levels up from packages/noldor).
const here = dirname(fileURLToPath(import.meta.url));
// Chdir to Charuy monorepo root. Phase C survey (2026-05-29) measured 73
// new test failures when this was changed to `resolve(here, '..')` (package
// root). Tests still read Charuy product paths via process.cwd(). Defer the
// re-anchor to a post-extract cleanup pass in the noldor repo, where the
// surface area is smaller and the fix can be tested in isolation.
process.chdir(resolve(here, '..', '..'));
