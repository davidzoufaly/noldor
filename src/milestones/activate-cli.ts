import { activateMilestone } from './lib.js';
import { writeOrExit } from './write-cli.js';

function usage(): never {
  console.error(`Usage: noldor milestones activate <slug>

Promote a draft milestone to active; the previous active one flips to shipped
and docs/vision.md's current-milestone follows.`);
  process.exit(2);
}

const slug = process.argv[2];
if (!slug || slug.startsWith('-')) usage();

writeOrExit(() => activateMilestone(slug));
console.log(`Activated ${slug}; vision.md updated`);
