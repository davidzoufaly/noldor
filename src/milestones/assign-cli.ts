// @fd: milestone-membership-has-no-tagger-and-no-counter
// `noldor milestones assign <milestone> <target>... [--replace]` — tag roadmap
// entries, backlog entries and feature MDs with a milestone.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWriteFileSync } from '../core/atomic-write.js';
import { runIfDirect } from '../core/cli-entry.js';
import { planAssign, type TargetLine } from './assign.js';
import { loadMilestoneBySlug, milestoneRefusalMessage } from './lib.js';

const USAGE = `usage: noldor milestones assign <milestone> <slug|Q-NNNN>... [--replace]

Tag each target — a roadmap block, a backlog block or a feature MD — with the
milestone. A target already naming another milestone is refused unless
--replace is given. Every target is checked before any file is written.
Exit 0: every target tagged. 1: something refused, nothing written. 2: usage.
`;

interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
}

const stdio: Io = {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
};

function describe(line: TargetLine): string {
  const where = line.matches.length > 0 ? ` ${line.matches.join(', ')}` : '';
  const was =
    line.previous !== undefined && line.outcome !== 'noop' ? ` (was ${line.previous})` : '';
  return `${line.outcome.padEnd(9)} ${line.ref}${where}${was}\n`;
}

/**
 * Run `milestones assign` against the repo at `cwd` and return the exit code.
 *
 * @param argv - Arguments after the verb.
 * @param cwd - Repo root.
 * @param io - Output sinks, injectable for tests.
 */
export async function assignMain(
  argv: string[],
  cwd = process.cwd(),
  io: Io = stdio,
): Promise<number> {
  const replace = argv.includes('--replace');
  const positional = argv.filter((a) => a !== '--replace');
  const [slug, ...refs] = positional;
  if (slug === undefined || refs.length === 0 || positional.some((a) => a.startsWith('-'))) {
    io.err(USAGE);
    return 2;
  }

  const loaded = loadMilestoneBySlug(slug, cwd);
  if (!loaded.ok) {
    io.err(`assign: ${milestoneRefusalMessage(loaded.error)}\n`);
    return 1;
  }
  if (loaded.milestone === null) {
    io.err(`assign: milestone "${slug}" not found under docs/milestones/\n`);
    return 1;
  }

  const read = (rel: string): string => {
    const p = join(cwd, rel);
    return existsSync(p) ? readFileSync(p, 'utf8') : '';
  };
  const featuresDir = join(cwd, 'docs/features');
  const features = existsSync(featuresDir)
    ? readdirSync(featuresDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => ({ slug: f.slice(0, -3), raw: readFileSync(join(featuresDir, f), 'utf8') }))
    : [];

  const plan = planAssign({
    milestone: loaded.milestone,
    refs,
    replace,
    roadmapRaw: read('docs/roadmap.md'),
    backlogRaw: read('docs/backlog.md'),
    features,
  });
  for (const line of plan.lines) io.out(describe(line));
  if (!plan.ok) {
    io.err(`assign: ${plan.error ?? 'refused — nothing written'}\n`);
    return 1;
  }
  for (const w of plan.writes) atomicWriteFileSync(join(cwd, w.path), w.text);
  return 0;
}

runIfDirect('assign-cli', 'milestones assign', (argv) => assignMain(argv));
