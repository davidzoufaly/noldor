// CLI for `noldor cr autofix <plan|record>` — the decide + record halves of the
// gate's auto-fix seam. The framework never APPLIES a blocker: applying is an
// LLM act performed by the gate controller between these two calls.
import { execFile } from 'node:child_process';

import { loadConfig } from '../core/config.js';
import { readSession } from '../core/session.js';
import { aggregate } from './aggregate.js';
import { decide } from './autofix.js';
import type { LaneBlocker } from './autofix.js';
import {
  AUTOFIX_ROUND_CAP,
  LedgerParseError,
  fingerprintBlockers,
  ledgerPath,
  appendRound,
  quarantineLedger,
  readLedger,
} from './autofix-ledger.js';
import { artifactKindSchema } from './findings-schema.js';
import type { ArtifactKind } from './findings-schema.js';

/** Exit 0 = auto-fix / recorded, 10 = decline, 2 = usage or infra error. */
const EXIT = { ok: 0, decline: 10, error: 2 } as const;

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd }, (err, stdout) => resolve(err ? '' : String(stdout).trim()));
  });
}

interface Args {
  verb: string;
  slug?: string;
  kind?: ArtifactKind;
  applied?: string;
  deferred?: string;
  stopped?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { verb: argv[2] ?? '' };
  for (let i = 3; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--slug') a.slug = argv[++i];
    else if (t === '--kind') a.kind = argv[++i] as ArtifactKind;
    else if (t === '--applied') a.applied = argv[++i];
    else if (t === '--deferred') a.deferred = argv[++i];
    else if (t === '--stopped') a.stopped = argv[++i];
  }
  return a;
}

function usage(msg: string): never {
  console.error(`cr autofix: ${msg}
usage:
  noldor cr autofix plan   --slug <slug> --kind <spec|plan|code>
  noldor cr autofix record --slug <slug> --kind <spec|plan|code> --applied <n> --deferred <n> [--stopped <reason>]`);
  process.exit(EXIT.error);
}

/** Validate the two flags both verbs need. */
function requireTarget(a: Args): { slug: string; kind: ArtifactKind } {
  if (!a.slug) usage('--slug is required');
  const kind = artifactKindSchema.safeParse(a.kind);
  if (!kind.success) usage(`--kind must be one of spec|plan|code (got ${a.kind ?? '<unset>'})`);
  return { slug: a.slug, kind: kind.data };
}

/**
 * `startedAt` of the owning gate session, or `''` when no marker exists. The
 * empty key still resets once a real session starts; rounds do accumulate across
 * unrelated no-session runs, which over-counts (caps early, never late) and is
 * therefore safe.
 */
function sessionKey(cwd: string): string {
  return readSession(cwd)?.startedAt ?? '';
}

async function runPlan(cwd: string, a: Args): Promise<never> {
  const { slug, kind } = requireTarget(a);
  const cfg = await loadConfig().catch(() => null);
  const onBlockers = cfg?.autonomous?.onBlockers ?? 'prompt';

  let ledger;
  try {
    ledger = await readLedger(cwd, slug, kind, sessionKey(cwd));
  } catch (err) {
    if (err instanceof LedgerParseError) {
      // Parse failure ONLY: quarantine so the next session starts clean. Any
      // other read error falls through below WITHOUT a rename, so transient
      // infra can never restart the round series.
      const moved = await quarantineLedger(cwd, slug, kind);
      console.error(
        moved
          ? `${err.message}\nquarantined to ${moved} — the next session starts a fresh round series`
          : `${err.message}\ncould not quarantine it; remove it by hand: rm -f ${ledgerPath(cwd, slug, kind)}`,
      );
    } else {
      console.error(
        `cr autofix: could not read the ledger at ${ledgerPath(cwd, slug, kind)}: ${(err as Error).message}\n` +
          'left in place (not a parse failure, so the round series is preserved)',
      );
    }
    process.exit(EXIT.error);
  }

  const agg = await aggregate(slug, kind, { cwd });
  const headSha = await git(['rev-parse', 'HEAD'], cwd);
  const r = decide({
    blockers: agg.blockers as LaneBlocker[],
    onBlockers,
    ledger,
    headSha,
  });

  console.log(`verdict: ${r.verdict}`);
  console.log(`reason: ${r.reason ?? '-'}`);
  console.log(`base-sha: ${r.baseSha || '-'}`);
  console.log(`round: ${r.round}/${AUTOFIX_ROUND_CAP}`);
  console.log(`mechanical: ${r.mechanical.length}`);
  r.mechanical.forEach((b, i) => console.log(`  M${i + 1} ${b.file} — ${b.message}`));
  console.log(`design: ${r.design.length}`);
  r.design.forEach((b, i) => console.log(`  D${i + 1} ${b.file} — ${b.message}`));

  process.exit(r.verdict === 'auto-fix' ? EXIT.ok : EXIT.decline);
}

/** Parse a required non-negative integer flag. */
function count(name: string, raw: string | undefined): number {
  if (raw === undefined) usage(`--${name} is required`);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) usage(`--${name} must be a non-negative integer (got ${raw})`);
  return n;
}

async function runRecord(cwd: string, a: Args): Promise<never> {
  const { slug, kind } = requireTarget(a);
  const applied = count('applied', a.applied);
  const deferred = count('deferred', a.deferred);
  const key = sessionKey(cwd);

  // The sinks are unchanged between `plan` and `record` — nothing re-runs
  // orchestrate in between — so recomputing here yields exactly what `plan`
  // computed, and no state has to survive the LLM edit.
  const agg = await aggregate(slug, kind, { cwd });
  const fingerprint = fingerprintBlockers(agg.blockers);

  const prior = await readLedger(cwd, slug, kind, key);
  const baseSha = prior?.rounds.at(-1)?.headSha ?? '';
  const headSha = await git(['rev-parse', 'HEAD'], cwd);
  const range = baseSha !== '' ? `${baseSha}..HEAD` : 'HEAD~1..HEAD';
  const diffStat = (await git(['diff', '--shortstat', range], cwd)) || '(unavailable)';

  const ledger = await appendRound(cwd, slug, kind, key, {
    headSha,
    fingerprint,
    applied,
    deferred,
    diffStat,
    ...(a.stopped ? { stopped: a.stopped } : {}),
  });
  const round = ledger.rounds.at(-1)!;
  console.log(
    `round ${round.round}/${AUTOFIX_ROUND_CAP} recorded (fingerprint ${fingerprint.slice(0, 8)}, applied ${applied}, deferred ${deferred})`,
  );
  console.log(`diff: ${diffStat}`);
  process.exit(EXIT.ok);
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const a = parseArgs(process.argv);
  if (a.verb === 'plan') return runPlan(cwd, a);
  if (a.verb === 'record') return runRecord(cwd, a);
  usage(`unknown verb '${a.verb || '<none>'}' — expected plan or record`);
}

// Every non-success path collapses to exit 2 as best-effort DIAGNOSTICS. The
// gate's stop rule is "any non-zero", not "exactly 2", so an uncaught crash or a
// signal kill is still handled — see the spec's residual-rule paragraph.
main().catch((err) => {
  console.error(`cr autofix: ${(err as Error).message}`);
  process.exit(EXIT.error);
});
