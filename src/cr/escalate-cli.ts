// scripts/cr/escalate-cli.ts
import { readFile } from 'node:fs/promises';
import { parseSlug } from '../core/slug.js';
import { loadConfig } from '../core/config.js';
import { escalate } from './escalate.js';
import type { EscalateInput } from './escalate.js';

async function main() {
  const args: Partial<EscalateInput> = { cwd: process.cwd() };
  // Collected raw and branded below — `EscalateInput.slug` is a parsed Slug,
  // so argv text cannot be assigned to it directly.
  let rawSlug: string | undefined;
  for (let i = 2; i < process.argv.length; i++) {
    const t = process.argv[i];
    if (t === '--slug') rawSlug = process.argv[++i];
    else if (t === '--reason') args.reason = process.argv[++i] as 'test-red' | 'cr-red';
    else if (t === '--context-file') args.context = await readFile(process.argv[++i], 'utf8');
    else if (t === '--failing') args.failingArtifact = process.argv[++i];
    else if (t === '--autonomous') args.autonomous = true;
  }
  const cfg = await loadConfig().catch(() => null);
  args.onFailure = cfg?.autonomous?.onFailure ?? 'prompt';
  if (!rawSlug || !args.reason || !args.context) {
    console.error('escalate-cli requires --slug --reason --context-file');
    process.exit(2);
  }
  // The value reaches `.noldor/cr/<slug>-escalation-context.md`.
  const parsedSlug = parseSlug(rawSlug);
  if (!parsedSlug.ok) {
    console.error(parsedSlug.error.message);
    process.exit(1);
  }
  args.slug = parsedSlug.slug;
  const r = await escalate({
    slug: parsedSlug.slug,
    reason: args.reason,
    context: args.context,
    cwd: args.cwd!,
    autonomous: args.autonomous ?? false,
    onFailure: args.onFailure,
    ...(args.failingArtifact ? { failingArtifact: args.failingArtifact } : {}),
  });
  console.log(`escalate outcome: ${r.outcome}`);
  // exit codes: retry-implementation=10 (gate skill checks for this), spawned=0, override=0, abort=1
  const codeMap = {
    'retry-implementation': 10,
    spawned: 0,
    override: 0,
    abort: 1,
  } as const;
  process.exit(codeMap[r.outcome]);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
