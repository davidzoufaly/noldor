// @tests: specs-cr-gate-multi-reviewer
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AUTOFIX_ROUND_CAP,
  LedgerParseError,
  appendRound,
  fingerprintBlockers,
  isSameSeries,
  ledgerDir,
  ledgerPath,
  quarantineLedger,
  quarantinePath,
  readLedger,
} from '../autofix-ledger.js';
import type { AutofixLedger } from '../autofix-ledger.js';
import { aggregate } from '../aggregate.js';
import type { Finding } from '../findings-schema.js';

const SESSION = '2026-08-07T18:00:00.000Z';
const OTHER_SESSION = '2026-08-06T09:00:00.000Z';

let cwd: string;

function writeRaw(contents: string, slug = 'slug'): void {
  mkdirSync(ledgerDir(cwd), { recursive: true });
  writeFileSync(ledgerPath(cwd, slug, 'spec'), contents, 'utf8');
}

const ROUND = {
  headSha: 'aaaaaaa',
  fingerprint: 'fp-1',
  applied: 2,
  deferred: 0,
  diffStat: '1 file changed',
} as const;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'autofix-ledger-'));
  mkdirSync(join(cwd, '.noldor', 'cr'), { recursive: true });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('AUTOFIX_ROUND_CAP', () => {
  it('is a constant 2, not a config knob', () => {
    expect(AUTOFIX_ROUND_CAP).toBe(2);
  });
});

describe('fingerprintBlockers', () => {
  const mk = (over: Partial<Finding> = {}): Finding => ({
    file: 'a.md',
    severity: 'high',
    message: 'missing section',
    ...over,
  });

  it('is order-independent', () => {
    const a = mk();
    const b = mk({ message: 'other' });
    expect(fingerprintBlockers([a, b])).toBe(fingerprintBlockers([b, a]));
  });

  it('changes with severity', () => {
    expect(fingerprintBlockers([mk()])).not.toBe(fingerprintBlockers([mk({ severity: 'med' })]));
  });

  it('changes with file', () => {
    expect(fingerprintBlockers([mk()])).not.toBe(fingerprintBlockers([mk({ file: 'b.md' })]));
  });

  it('changes with message', () => {
    expect(fingerprintBlockers([mk()])).not.toBe(fingerprintBlockers([mk({ message: 'other' })]));
  });

  it('IGNORES line — a shifted line must not read as progress', () => {
    expect(fingerprintBlockers([mk({ line: 10 })])).toBe(fingerprintBlockers([mk({ line: 940 })]));
    expect(fingerprintBlockers([mk({ line: 10 })])).toBe(fingerprintBlockers([mk()]));
  });

  it('is stable for an empty set', () => {
    expect(fingerprintBlockers([])).toBe(fingerprintBlockers([]));
  });
});

describe('isSameSeries', () => {
  const ledger = (sessionStartedAt: string): AutofixLedger => ({
    slug: 'slug',
    kind: 'spec',
    sessionStartedAt,
    rounds: [],
  });

  it('matches an identical session key', () => {
    expect(isSameSeries(ledger(SESSION), SESSION)).toBe(true);
  });

  it('rejects a different session key', () => {
    expect(isSameSeries(ledger(OTHER_SESSION), SESSION)).toBe(false);
  });
});

describe('readLedger', () => {
  it('returns null when the file is absent', async () => {
    expect(await readLedger(cwd, 'slug', 'spec', SESSION)).toBeNull();
  });

  it('returns the ledger for the current session', async () => {
    await appendRound(cwd, 'slug', 'spec', SESSION, ROUND);
    const r = await readLedger(cwd, 'slug', 'spec', SESSION);
    expect(r?.rounds).toHaveLength(1);
    expect(r?.sessionStartedAt).toBe(SESSION);
  });

  it('returns null for a ledger owned by a DIFFERENT session', async () => {
    await appendRound(cwd, 'slug', 'spec', OTHER_SESSION, ROUND);
    expect(await readLedger(cwd, 'slug', 'spec', SESSION)).toBeNull();
  });

  it('throws LedgerParseError on unparseable JSON', async () => {
    writeRaw('{ not json');
    await expect(readLedger(cwd, 'slug', 'spec', SESSION)).rejects.toBeInstanceOf(LedgerParseError);
  });

  it('throws LedgerParseError on schema-invalid content', async () => {
    writeRaw(JSON.stringify({ slug: 'slug', kind: 'nope', rounds: 'x' }));
    await expect(readLedger(cwd, 'slug', 'spec', SESSION)).rejects.toBeInstanceOf(LedgerParseError);
  });

  it('does NOT treat a directory at the ledger path as a parse failure', async () => {
    // Stands in for any non-ENOENT read error (EACCES/EIO): it must propagate as
    // itself so the caller never quarantines a ledger it merely could not read.
    mkdirSync(ledgerPath(cwd, 'dir', 'spec'), { recursive: true });
    await expect(readLedger(cwd, 'dir', 'spec', SESSION)).rejects.not.toBeInstanceOf(
      LedgerParseError,
    );
  });
});

describe('appendRound', () => {
  it('numbers rounds from 1 and increments within a session', async () => {
    const first = await appendRound(cwd, 'slug', 'spec', SESSION, ROUND);
    expect(first.rounds.map((r) => r.round)).toEqual([1]);
    const second = await appendRound(cwd, 'slug', 'spec', SESSION, {
      ...ROUND,
      fingerprint: 'fp-2',
    });
    expect(second.rounds.map((r) => r.round)).toEqual([1, 2]);
  });

  it('REPLACES a series owned by another session rather than appending', async () => {
    await appendRound(cwd, 'slug', 'spec', OTHER_SESSION, ROUND);
    const next = await appendRound(cwd, 'slug', 'spec', SESSION, { ...ROUND, applied: 1 });
    expect(next.sessionStartedAt).toBe(SESSION);
    expect(next.rounds).toHaveLength(1);
    expect(next.rounds[0]!.round).toBe(1);
  });

  it('makes the round it wrote visible to the next readLedger in the same session', async () => {
    // Regression for the bound going dead: a writer that kept a stale session key
    // would leave readLedger returning null forever, so rounds.length stayed 0.
    await appendRound(cwd, 'slug', 'spec', OTHER_SESSION, ROUND);
    await appendRound(cwd, 'slug', 'spec', SESSION, ROUND);
    const read = await readLedger(cwd, 'slug', 'spec', SESSION);
    expect(read?.rounds).toHaveLength(1);
  });

  it('persists every round field', async () => {
    await appendRound(cwd, 'slug', 'spec', SESSION, { ...ROUND, stopped: 'no-progress' });
    const raw = JSON.parse(readFileSync(ledgerPath(cwd, 'slug', 'spec'), 'utf8'));
    expect(raw.rounds[0]).toMatchObject({
      round: 1,
      headSha: 'aaaaaaa',
      fingerprint: 'fp-1',
      applied: 2,
      deferred: 0,
      diffStat: '1 file changed',
      stopped: 'no-progress',
    });
  });

  it('throws on a malformed existing file instead of replacing it', async () => {
    writeRaw('{ not json');
    await expect(appendRound(cwd, 'slug', 'spec', SESSION, ROUND)).rejects.toBeInstanceOf(
      LedgerParseError,
    );
    expect(readFileSync(ledgerPath(cwd, 'slug', 'spec'), 'utf8')).toBe('{ not json');
  });
});

describe('ledger placement', () => {
  it('nests under .noldor/cr/autofix so it is never globbed as a lane sink', () => {
    expect(ledgerDir(cwd)).toBe(join(cwd, '.noldor', 'cr', 'autofix'));
    expect(ledgerPath(cwd, 'slug', 'spec')).toBe(join(ledgerDir(cwd), 'slug-spec.json'));
  });

  it('does not add a blocker to aggregate() for the same slug+kind', async () => {
    // Regression: a sibling `<slug>-<kind>-autofix.json` matched aggregate()'s
    // sink glob, so inferLaneFromFilename returned null and a bogus
    // `non-conforming filename` HIGH blocker turned green runs red.
    writeFileSync(
      join(cwd, '.noldor', 'cr', 'slug-spec-reviewer.json'),
      JSON.stringify({
        lane: 'reviewer',
        artifact: 'a.md',
        kind: 'spec',
        slug: 'slug',
        blockers: [],
        suggestions: [],
        summary: 'approve',
        startedAt: SESSION,
        finishedAt: SESSION,
      }),
      'utf8',
    );
    await appendRound(cwd, 'slug', 'spec', SESSION, ROUND);
    const agg = await aggregate('slug', 'spec', { cwd });
    expect(agg.blockers).toEqual([]);
    expect(agg.ok).toBe(true);
  });
});

describe('quarantineLedger', () => {
  it('renames the ledger aside and reports the destination', async () => {
    await appendRound(cwd, 'slug', 'spec', SESSION, ROUND);
    const dest = await quarantineLedger(cwd, 'slug', 'spec');
    expect(dest).toBe(quarantinePath(cwd, 'slug', 'spec'));
    expect(await readLedger(cwd, 'slug', 'spec', SESSION)).toBeNull();
  });

  it('returns null when there is nothing to rename', async () => {
    expect(await quarantineLedger(cwd, 'absent', 'spec')).toBeNull();
  });
});
