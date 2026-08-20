import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NOLDOR_BLOCK } from '../checks/check-lefthook-wiring.js';

export interface ConsumerFixture {
  dir: string;
  seedSlug: string;
  git: (args: string[]) => string;
  dumpState: () => string;
  cleanup: () => void;
}

export interface BuildFixtureOpts {
  dir?: string;
  seedSlug?: string;
}

const CONSUMER_CONFIG = (name: string) => ({
  consumer: {
    name,
    repoUrl: 'https://example.test/fixture',
    // ConsumerConfigSchema requires lockstepPackages.min(1).
    lockstepPackages: ['package.json'],
    scanPaths: ['src'],
    e2ePrefix: 'e2e/',
    samplesPath: 'samples',
    packagePrefix: '@fixture/',
    appPathPrefix: 'src/',
    categories: ['Tooling'],
  },
  agents: { default: 'stub', targets: ['stub'] },
  autonomous: {
    skipLanePicker: true,
    onFailure: 'abort',
    requireHumanPrApproval: false,
    verifyMode: 'advisory',
  },
});

const ROADMAP = (slug: string) => `# Roadmap

## ${slug}

\`\`\`yaml
slug: ${slug}
name: Add greeting helper
target: consumer
area: tooling
size: XS
impact: low
since: 2026-06-13
\`\`\`

Add a tiny greeting helper to src/.
`;

/** Generate a minimal, real-git consumer repo into a temp dir. */
export function buildConsumerFixture(opts: BuildFixtureOpts = {}): ConsumerFixture {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), 'noldor-fixture-'));
  const seedSlug = opts.seedSlug ?? 'add-greeting-helper';
  const git = (args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

  mkdirSync(join(dir, '.noldor'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });

  writeFileSync(
    join(dir, '.noldor', 'config.json'),
    JSON.stringify(CONSUMER_CONFIG('fixture-consumer'), null, 2),
  );
  writeFileSync(join(dir, 'src', 'index.ts'), 'export const ok = true;\n');
  writeFileSync(join(dir, 'docs', 'vision.md'), '# Vision\n\nFixture consumer.\n');
  writeFileSync(join(dir, 'docs', 'ideas.md'), '# Ideas\n');
  writeFileSync(join(dir, 'docs', 'roadmap.md'), ROADMAP(seedSlug));
  // Root lefthook.yml is consumer-owned and scaffold-only, so `init` never
  // rewrites it — the fixture therefore has to model an ADOPTED consumer
  // itself, extends line included. Without it `doctor` reports `unwired`
  // (checkLefthookWiring) and the contract job reds on a fixture that was
  // never wired, not on a framework regression. The project-specific job
  // below the extends is the point: a real consumer keeps its own hooks.
  // The block path comes from the check's own constant so the fixture cannot
  // drift from the path the check and the shipped template agree on.
  writeFileSync(
    join(dir, 'lefthook.yml'),
    `extends:\n  - ${NOLDOR_BLOCK}\npre-commit:\n  jobs:\n    - run: pnpm noldor validate features\n`,
  );
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-consumer',
        private: true,
        version: '0.0.0',
        // Doctor's prerequisite probe (checkConsumerScripts) requires every
        // script the scaffolded lefthook config invokes; a real consumer
        // declares these, so the fixture models that with no-op stubs.
        scripts: { lint: 'true', fmt: 'true', 'fmt:check': 'true', test: 'true' },
      },
      null,
      2,
    ),
  );

  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'fixture@test.test']);
  git(['config', 'user.name', 'fixture']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'chore: initial fixture commit']);

  const dumpState = (): string => {
    const log = git(['log', '--oneline', '-20']);
    const noldorDir = join(dir, '.noldor');
    const listing = existsSync(noldorDir) ? readdirSync(noldorDir).join('\n') : '(no .noldor)';
    return `=== git log ===\n${log}\n=== .noldor/ ===\n${listing}\n`;
  };

  return {
    dir,
    seedSlug,
    git,
    dumpState,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
