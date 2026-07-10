import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

interface CannedPlan {
  slug: string;
  files: { path: string; content: string }[];
  commitSubject: string;
}

export interface StubGateOpts {
  cwd: string;
  slug: string;
}

function cannedPath(slug: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, 'fixtures', 'canned', `${slug}.json`);
}

/** Strip the seeded roadmap entry's schema-C block for `slug`. */
function retireRoadmapEntry(roadmap: string, slug: string): string {
  const lines = roadmap.split('\n');
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line.startsWith('## ') && line.includes(slug)) {
      skipping = true;
      continue;
    }
    if (skipping && line.startsWith('## ')) skipping = false;
    if (!skipping) out.push(line);
  }
  return out.join('\n');
}

/** Perform the deterministic fast-track gate work a real /noldor-gate run would, sans LLM. */
export function applyStubGate(opts: StubGateOpts): void {
  const { cwd, slug } = opts;
  const plan = JSON.parse(readFileSync(cannedPath(slug), 'utf8')) as CannedPlan;
  for (const f of plan.files) {
    const abs = join(cwd, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content);
  }
  const roadmapPath = join(cwd, 'docs', 'roadmap.md');
  writeFileSync(roadmapPath, retireRoadmapEntry(readFileSync(roadmapPath, 'utf8'), slug));

  const git = (args: string[]): void => {
    execFileSync('git', args, { cwd, stdio: 'pipe' });
  };
  git(['add', '-A']);
  const msg = [
    plan.commitSubject,
    '',
    `Noldor-FD: ${slug}`,
    'Noldor-Path: fast-track',
    'Noldor-Reviewed-Claude: stub',
    'Noldor-Reviewed-Codex: stub',
  ].join('\n');
  git(['commit', '-q', '--no-verify', '-m', msg]);
}

/** Parse the slug from the gate prompt (`/noldor-gate --resume <slug>`) or env. */
function slugFromPrompt(prompt: string): string | null {
  const m = prompt.match(/--resume\s+(\S+)/);
  if (m) return m[1];
  return process.env.NOLDOR_STUB_SLUG ?? null;
}

/** CLI entrypoint (invoked via bin/noldor-stub-gate.mjs). */
export function main(argv: string[]): number {
  const prompt = argv[2] ?? '/noldor-gate';
  const slug = slugFromPrompt(prompt);
  if (!slug) {
    process.stderr.write('stub-gate: no slug (set NOLDOR_STUB_SLUG or pass --resume <slug>)\n');
    return 2;
  }
  try {
    applyStubGate({ cwd: process.cwd(), slug });
    return 0;
  } catch (err) {
    process.stderr.write(`stub-gate: ${(err as Error).message}\n`);
    return 1;
  }
}
