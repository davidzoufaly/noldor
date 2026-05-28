import { draftMilestone, activateMilestone, listMilestones, type Milestone } from './lib.js';

function fmtGroup(label: string, ms: Milestone[]): string {
  if (ms.length === 0) return `${label}:\n  (none)\n`;
  return (
    `${label}:\n` +
    ms
      .map(
        (m) => `  - ${m.slug}${m.frontmatter.description ? ` — ${m.frontmatter.description}` : ''}`,
      )
      .join('\n') +
    '\n'
  );
}

function usage(): never {
  console.error(`Usage: tsx scripts/milestones/cli.ts <command> [args]

Commands:
  draft <slug> [description]    Scaffold docs/milestones/<slug>.md with status: draft.
  activate <slug>               Promote draft → active; flip previous active → shipped.
  list                          Print all milestones grouped by status.`);
  process.exit(2);
}

const [, , cmd, ...rest] = process.argv;
if (!cmd) usage();

try {
  switch (cmd) {
    case 'draft': {
      const slug = rest[0];
      if (!slug) usage();
      const description = rest.slice(1).join(' ') || undefined;
      draftMilestone(slug, description);
      console.log(`Drafted docs/milestones/${slug}.md`);
      break;
    }
    case 'activate': {
      const slug = rest[0];
      if (!slug) usage();
      activateMilestone(slug);
      console.log(`Activated ${slug}; vision.md updated`);
      break;
    }
    case 'list': {
      const result = listMilestones();
      console.log(fmtGroup('Active', result.active));
      console.log(fmtGroup('Draft', result.draft));
      console.log(fmtGroup('Shipped', result.shipped));
      break;
    }
    default:
      usage();
  }
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
