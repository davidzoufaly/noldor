import { renderMilestoneShow } from './lib.js';

function usage(): never {
  console.error(`Usage: noldor milestones show <slug>

Print one milestone's feature MDs and the roadmap/backlog entries that still
name it. Membership comes from the same grouping the dashboard's /milestones
page uses, so the two can never disagree.`);
  process.exit(2);
}

const slug = process.argv[2];
if (!slug || slug.startsWith('-')) usage();

const shown = await renderMilestoneShow(slug);
if (!shown.ok) {
  console.error(shown.message);
  process.exit(1);
}
process.stdout.write(shown.text);
