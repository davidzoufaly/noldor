import { unparkSlug } from './escalations.js';

function main(): void {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const slug = args[0];
  const si = process.argv.indexOf('--source');
  const source = si === -1 ? undefined : process.argv[si + 1];
  if (slug === undefined) {
    process.stderr.write('usage: noldor autonomous unpark <slug> [--source <id>]\n');
    process.exit(1);
  }
  const r = unparkSlug(process.cwd(), slug, source);
  if (r.status === 'resolved') {
    process.stdout.write(`unparked ${r.key} — re-eligible next cycle\n`);
    return;
  }
  if (r.status === 'not-parked') {
    process.stdout.write(`${slug}: not parked — nothing to do\n`);
    return;
  }
  process.stderr.write(
    `${slug} is parked under multiple sources — pass --source. Candidates: ${r.candidates.join(', ')}\n`,
  );
  process.exit(1);
}

const invokedDirect = /[\\/]unpark-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) main();
