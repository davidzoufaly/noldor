import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The framework's integration tests read real consumer files at the repo root
// (docs/roadmap.md, docs/features/*, .claude/skills/*, .noldor/config.json, etc.)
// via process.cwd(). This setup file lives at the repo root, so anchor cwd to
// its own directory — robust regardless of the dir `pnpm test` is invoked from.
const here = dirname(fileURLToPath(import.meta.url));
// Post-extract re-anchor: pre-extract the package sat at `packages/noldor/`, so
// the root was two levels up (`../..`). Now noldor IS the repo root, so `../..`
// overshot to the repo's parent (home dir) and every loadConsumerConfig() call
// in tests failed to find `.noldor/config.json`. Repo root is `here`.
process.chdir(here);
