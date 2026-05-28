// `noldor doctor` — diff every template-managed file (under the pkg's
// `templates/` asset dir) against the consumer copy at the same relative path
// under `process.cwd()`. Exit 1 on any drift; exit 0 with a count on clean.
// Wired into `pnpm verify` at the consumer side (per spec).
import { TEMPLATES_ROOT, templateFiles } from '../../templates/manifest.js';
import { computeDrift } from '../../templates/diff.js';

const files = templateFiles();
const drift = computeDrift(TEMPLATES_ROOT, process.cwd(), files);

let bad = 0;
for (const entry of drift) {
  if (entry.status === 'unchanged') continue;
  bad++;
  console.log(`${entry.status.padEnd(10)} ${entry.path}`);
}

if (bad === 0) {
  console.log(`OK — ${files.length} template files in sync`);
  process.exit(0);
}

console.error(
  `\n${bad} drift entries. Run 'noldor init --update' to sync consumer paths, or 'noldor init --adopt' if the pkg should adopt consumer state.`,
);
process.exit(1);
