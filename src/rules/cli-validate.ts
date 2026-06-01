import { runValidate } from './cli-cores.js';

function main(): void {
  const res = runValidate(process.cwd());
  for (const e of res.errors) console.error(`error [rules] ${e}`);
  if (!res.ok) {
    console.error(`validate:rules failed with ${res.errors.length} error(s).`);
    process.exitCode = 1;
    return;
  }
  console.log(`validate:rules OK (${res.count} rule(s)).`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
