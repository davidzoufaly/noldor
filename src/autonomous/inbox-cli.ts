import { readInboxRows } from './escalations.js';

function main(): void {
  const rows = readInboxRows(process.cwd());
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(rows)}\n`);
    return;
  }
  if (rows.length === 0) {
    process.stdout.write('inbox: no open escalations\n');
    return;
  }
  for (const r of rows) {
    process.stdout.write(
      `${r.source}:${r.slug} | ${r.reason} | ${r.ts}\n  evidence: ${r.evidence || '(none)'}\n  action:   ${r.suggestedAction}\n`,
    );
  }
}

const invokedDirect = /[\\/]inbox-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) main();
