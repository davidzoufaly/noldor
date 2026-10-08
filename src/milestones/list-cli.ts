import { listMilestones, type Milestone } from './lib.js';

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

const result = listMilestones();
console.log(fmtGroup('Active', result.active));
console.log(fmtGroup('Draft', result.draft));
console.log(fmtGroup('Shipped', result.shipped));
