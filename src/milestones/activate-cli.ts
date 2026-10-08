import { activateMilestone, milestoneRefusalMessage } from './lib.js';

function usage(): never {
  console.error(`Usage: noldor milestones activate <slug>

Promote a draft milestone to active; the previous active one flips to shipped
and docs/vision.md's current-milestone follows.`);
  process.exit(2);
}

const slug = process.argv[2];
if (!slug || slug.startsWith('-')) usage();

// The repository-state refusals (already exists, shipped is terminal, …) still throw;
// print their message alone, without the router's stack trace.
function attempt() {
  try {
    return activateMilestone(slug);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

const activated = attempt();
if (!activated.ok) {
  console.error(milestoneRefusalMessage(activated.error));
  process.exit(1);
}
console.log(`Activated ${slug}; vision.md updated`);
