// `noldor init` — scaffold/sync framework files into the consumer repo, OR
// (with --adopt) snapshot the consumer's current files INTO the pkg's
// templates dir (first-party-dev bootstrap, monorepo only).
//
// Flags:
//   --update   re-copy templates and overwrite any drifted consumer files
//   --adopt    reverse direction: copy consumer files INTO packages/noldor/templates/
//              (writes the pkg's own templates from the live consumer state)
import { TEMPLATES_ROOT, templateFiles } from '../../templates/manifest.js';
import { copyTemplate, adoptTemplate } from '../../templates/copy.js';

const args = new Set(process.argv.slice(2));
const update = args.has('--update');
const adopt = args.has('--adopt');
const consumer = process.cwd();
const files = templateFiles();

if (adopt) {
  adoptTemplate(TEMPLATES_ROOT, consumer, files);
  console.log(`adopt: snapshotted ${files.length} consumer files into ${TEMPLATES_ROOT}`);
  process.exit(0);
}

try {
  const results = copyTemplate(TEMPLATES_ROOT, consumer, files, { update });
  const counts = { added: 0, updated: 0, unchanged: 0 } as const as {
    added: number;
    updated: number;
    unchanged: number;
  };
  for (const r of results) {
    counts[r.status]++;
    if (r.status !== 'unchanged') console.log(`${r.status.padEnd(10)} ${r.path}`);
  }
  console.log(`\n${counts.added} added, ${counts.updated} updated, ${counts.unchanged} unchanged`);
  process.exit(0);
} catch (err) {
  console.error(`init failed: ${(err as Error).message}`);
  process.exit(1);
}
