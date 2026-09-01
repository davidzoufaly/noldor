import { artifactKindSchema } from './findings-schema.js';
import { parseSlug, type Slug } from '../core/slug.js';
import { aggregate } from './aggregate.js';

interface Args {
  /** Branded: it names the sink paths this command reads. */
  slug: Slug;
  kind?: 'spec' | 'plan' | 'code';
  waitMs?: number;
  /**
   * Report on lane RESOLUTION only: review findings still print, but they no
   * longer set the exit code. For the gate's "drain any artifact-stage lanes
   * that are still running" step, whose question is whether a lane is still
   * writing — not whether its verdict was green.
   *
   * That step calls kind-lessly (it cannot know which artifact kinds this
   * session produced), so it also reads the spec/plan sinks. A round that
   * fix-and-proceeded at the re-round cap leaves such a sink red BY DESIGN — the
   * findings were fixed in commits and deliberately not re-dispatched — so the
   * default exit code re-red on already-addressed findings and the operator had
   * to recognise the staleness by hand and override (Q-0154; hit on Q-0131 and
   * again on Q-0092).
   *
   * Integrity blockers keep gating regardless: a sink that cannot be read,
   * parsed or trusted is not a stale verdict, and muting it would re-open the
   * Q-0100 fail-open hole this command exists to close.
   *
   * The mute is every blocker a lane FILED, which is wider than "findings about
   * the artifact" — a sink reporting that its own review never happened
   * (`verdict: cannot-verify` with `reason: dispatch-failed` / `timeout`) is muted
   * too. Deliberate: that sink was already surfaced by the artifact stage's own
   * aggregate at the Step 2.5 continue-dialog, which is where the artifact's
   * verdict is settled. A lane still WRITING is `unresolved`, so it keeps gating.
   */
  unresolvedOnly?: boolean;
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
    else if (t === '--unresolved-only') a.unresolvedOnly = true;
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
      // Which blockers gate is a property of this invocation, not of the sinks,
      // so it is derived here rather than tracked alongside `AggregateResult.ok`.
      // Derived BEFORE the header line on purpose: the header reports the verdict
      // this run will exit on, because printing `ok=false` above an exit 0 is
      // exactly the contradiction that makes a controller stop and adjudicate by
      // hand — the cost `--unresolved-only` exists to remove.
      const integrity = r.blockers.filter((b) => b.integrity === true);
      const ok = args.unresolvedOnly ? r.unresolved.length === 0 && integrity.length === 0 : r.ok;
      console.log(`slug=${args.slug} kind=${args.kind ?? '<any>'} ok=${ok}`);
      for (const [lane, summary] of Object.entries(r.summaries)) {
        console.log(`  ${lane}: ${summary}`);
      }
      if (r.unresolved.length) console.log(`  unresolved: ${r.unresolved.join(', ')}`);
      for (const b of r.blockers) {
        console.log(`  [${b.severity}] ${b.lane} ${b.file}: ${b.message}`);
      }
      if (args.unresolvedOnly) {
        console.log(
          `  --unresolved-only: ${r.blockers.length - integrity.length} lane finding(s) above ` +
            `do NOT gate; ${r.unresolved.length} unresolved lane(s) and ` +
            `${integrity.length} integrity blocker(s) do`,
        );
      }
      process.exit(ok ? 0 : 1);
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
