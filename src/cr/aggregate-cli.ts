import { artifactKindSchema } from './findings-schema.js';
import { parseSlug, type Slug } from '../core/slug.js';
import { aggregate } from './aggregate.js';

interface Args {
  /** Branded: it names the sink paths this command reads. */
  slug: Slug;
  kind?: 'spec' | 'plan' | 'code';
  waitMs?: number;
}

function parseArgs(argv: string[]): Args {
  const a: Partial<Args> = {};
  // Collected raw and branded below — `Args.slug` is a parsed Slug.
  let rawSlug: string | undefined;
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--slug') rawSlug = argv[++i];
    else if (t === '--kind') a.kind = artifactKindSchema.parse(argv[++i]);
    else if (t === '--wait-ms') a.waitMs = Number(argv[++i]);
  }
  if (!rawSlug) throw new Error('--slug required');
  // The value reaches `.noldor/cr/<slug>-<kind>-<lane>.json` sink paths.
  const parsed = parseSlug(rawSlug);
  if (!parsed.ok) throw new Error(parsed.error.message);
  a.slug = parsed.slug;
  return a as Args;
}

async function main() {
  const args = parseArgs(process.argv);
  const start = Date.now();
  const budget = args.waitMs ?? 0;

  while (true) {
    const r = await aggregate(args.slug, args.kind);
    const stillWaiting = r.unresolved.length > 0 && Date.now() - start < budget;
    if (!stillWaiting) {
      console.log(`slug=${args.slug} kind=${args.kind ?? '<any>'} ok=${r.ok}`);
      for (const [lane, summary] of Object.entries(r.summaries)) {
        console.log(`  ${lane}: ${summary}`);
      }
      if (r.unresolved.length) console.log(`  unresolved: ${r.unresolved.join(', ')}`);
      for (const b of r.blockers) {
        console.log(`  [${b.severity}] ${b.lane} ${b.file}: ${b.message}`);
      }
      process.exit(r.ok ? 0 : 1);
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
