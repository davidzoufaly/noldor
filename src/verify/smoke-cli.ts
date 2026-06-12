// @tests: acceptance-verify-lane
// `noldor verify smoke [--json]` — the smoke floor, standalone. Exit 0 when
// doctor + every configured surface is green; exit 1 otherwise.
import { resolvePort } from './port.js';
import { runSmoke } from './smoke.js';

const json = process.argv.includes('--json');
const cwd = process.cwd();
const port = await resolvePort(cwd);
const report = await runSmoke(cwd, port);

if (json) {
  process.stdout.write(`${JSON.stringify(report)}\n`);
} else {
  for (const s of report.surfaces) {
    process.stdout.write(`${s.ok ? '✓' : '✗'} ${s.name}: ${s.evidence.observed}\n`);
  }
  for (const n of report.notes) process.stdout.write(`note: ${n}\n`);
  process.stdout.write(report.ok ? 'smoke OK\n' : 'smoke FAILED\n');
}
process.exit(report.ok ? 0 : 1);
