import { draftMilestone } from './lib.js';
import { writeOrExit } from './write-cli.js';

function usage(): never {
  console.error(`Usage: noldor milestones draft <slug> [description]

Scaffold docs/milestones/<slug>.md with status: draft.`);
  process.exit(2);
}

const [slug, ...words] = process.argv.slice(2);
if (!slug || slug.startsWith('-')) usage();

writeOrExit(() => draftMilestone(slug, words.join(' ') || undefined));
console.log(`Drafted docs/milestones/${slug}.md`);
