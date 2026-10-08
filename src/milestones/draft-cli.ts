import { draftMilestone, milestoneRefusalMessage } from './lib.js';

function usage(): never {
  console.error(`Usage: noldor milestones draft <slug> [description]

Scaffold docs/milestones/<slug>.md with status: draft.`);
  process.exit(2);
}

const [slug, ...words] = process.argv.slice(2);
if (!slug || slug.startsWith('-')) usage();

// The repository-state refusals (already exists, shipped is terminal, …) still throw;
// print their message alone, without the router's stack trace.
function attempt() {
  try {
    return draftMilestone(slug, words.join(' ') || undefined);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

const drafted = attempt();
if (!drafted.ok) {
  console.error(milestoneRefusalMessage(drafted.error));
  process.exit(1);
}
console.log(`Drafted docs/milestones/${slug}.md`);
