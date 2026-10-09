// @fd: ui-proof-screenshots-on-the-pr
// `noldor checks ui-proof-spec` — does the branch carry its own proof test for
// every feature-proof surface it touches? Exit 1 names each missing path, so
// the gate can ask for the test before review instead of `pr-flow` posting a
// `no feature proof` note at ship time. Never runs the test.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runIfDirect } from '../core/cli-entry.js';
import { loadConsumerConfig } from '../core/consumer-config.js';
import { readFrontmatter } from '../core/fd-load.js';
import { readSession } from '../core/session.js';
import { missingFeatureSpecs, UI_PROOF_TRAILER, uiProofSkipReason } from '../core/ui-proof.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

/** The session FD's `design:` value, the other way besides the trailer to declare no visual change. */
function sessionFdDesign(cwd: string): unknown {
  const session = readSession(cwd);
  const slug = session?.parent ?? session?.slug;
  const path = join(cwd, 'docs', 'features', `${slug}.md`);
  if (slug === undefined || !existsSync(path)) return undefined;
  const parsed = readFrontmatter(readFileSync(path, 'utf8'));
  return parsed.ok ? parsed.data.design : undefined;
}

export async function main(argv: readonly string[] = [], cwd = process.cwd()): Promise<number> {
  const baseAt = argv.indexOf('--base');
  const base = baseAt === -1 ? 'origin/main' : argv[baseAt + 1];
  if (base === undefined || base.startsWith('--')) {
    process.stderr.write('usage: noldor checks ui-proof-spec [--base <ref>]\n');
    return 2;
  }
  if (!existsSync(join(cwd, '.noldor', 'config.json'))) {
    console.log('ui-proof-spec: skipped (no .noldor/config.json)');
    return 0;
  }
  const range = `${base}..HEAD`;
  const skip = uiProofSkipReason(
    sessionFdDesign(cwd),
    git(cwd, ['log', `--format=%(trailers:key=${UI_PROOF_TRAILER},valueonly)`, range])
      .split('\n')
      .filter((v) => v.trim() !== ''),
  );
  if (skip !== null) {
    console.log(`ui-proof-spec: skipped (${skip})`);
    return 0;
  }
  const missing = await missingFeatureSpecs({
    cwd,
    branch: git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    branchFiles: [
      ...new Set(
        git(cwd, ['log', '--format=', '--name-only', range])
          .split('\n')
          .filter((f) => f !== ''),
      ),
    ],
    config: loadConsumerConfig(cwd),
  });
  for (const m of missing) {
    console.log(`  ${m.surface}: write ${m.spec} — it should drive the new UI and shoot it`);
  }
  console.log(
    missing.length === 0
      ? 'ui-proof-spec: ok'
      : `ui-proof-spec: ${missing.length} surface(s) without a feature proof`,
  );
  return missing.length === 0 ? 0 : 1;
}

runIfDirect('check-ui-proof-spec', 'checks ui-proof-spec', async (argv) => main(argv));
