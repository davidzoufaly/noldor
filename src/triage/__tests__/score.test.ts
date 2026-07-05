// @tests: triage-scoring-rubric-effort-impact-confidence-dependency
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveIsShipped, scoreEntry, type ScoringInputs } from '../score.js';

describe(scoreEntry, () => {
  const baseEntry: ScoringInputs = {
    size: 'M',
    impact: 'high',
    confidence: 'med',
    deps: [],
    isShipped: () => false,
  };

  it('computes a base score for M / high / med / no-deps', () => {
    expect(scoreEntry(baseEntry)).toBe(150);
    // (4 * 0.75 * 1) / 2 * 100 = 150
  });

  it('penalizes XL effort vs S effort', () => {
    const sScore = scoreEntry({ ...baseEntry, size: 'S' });
    const xlScore = scoreEntry({ ...baseEntry, size: 'XL' });
    expect(sScore).toBeGreaterThan(xlScore);
  });

  it('rewards critical impact over low impact', () => {
    const critical = scoreEntry({ ...baseEntry, impact: 'critical' });
    const low = scoreEntry({ ...baseEntry, impact: 'low' });
    expect(critical).toBeGreaterThan(low);
  });

  it('defaults missing confidence to med', () => {
    const explicit = scoreEntry({ ...baseEntry, confidence: 'med' });
    const missing = scoreEntry({ ...baseEntry, confidence: undefined });
    expect(missing).toBe(explicit);
  });

  it('discounts items with unshipped deps', () => {
    const clean = scoreEntry({ ...baseEntry, deps: [] });
    const blocked = scoreEntry({
      ...baseEntry,
      deps: ['foo', 'bar'],
      isShipped: () => false,
    });
    expect(blocked).toBeLessThan(clean);
  });

  it('ignores shipped deps', () => {
    const clean = scoreEntry({ ...baseEntry, deps: [] });
    const allShipped = scoreEntry({
      ...baseEntry,
      deps: ['foo', 'bar'],
      isShipped: () => true,
    });
    expect(allShipped).toBe(clean);
  });

  it('hits the maximum documented score for XS / critical / high / no deps', () => {
    expect(scoreEntry({ ...baseEntry, size: 'XS', impact: 'critical', confidence: 'high' })).toBe(
      1600,
    );
  });

  it('throws on unknown size value', () => {
    expect(() => scoreEntry({ ...baseEntry, size: 'huge' as never })).toThrow(/unknown size/i);
  });

  it('throws on unknown impact value', () => {
    expect(() => scoreEntry({ ...baseEntry, impact: 'mega' as never })).toThrow(/unknown impact/i);
  });

  it('throws on unknown confidence value', () => {
    expect(() => scoreEntry({ ...baseEntry, confidence: 'epic' as never })).toThrow(
      /unknown confidence/i,
    );
  });
});

describe(resolveIsShipped, () => {
  const fixtures = join(__dirname, 'fixtures/score-resolver');
  const isShipped = resolveIsShipped({
    featuresDir: join(fixtures, 'features'),
    roadmapPath: join(fixtures, 'roadmap.md'),
    backlogPath: join(fixtures, 'backlog.md'),
  });

  it('returns true for a feature MD with phase: done', () => {
    expect(isShipped('ship-done')).toBe(true);
  });

  it('returns false for a feature MD with phase: in-progress', () => {
    expect(isShipped('ship-progress')).toBe(false);
  });

  it('returns false for a slug that exists only in roadmap', () => {
    expect(isShipped('roadmap-only-slug')).toBe(false);
  });

  it('returns false for a slug that exists only in backlog', () => {
    expect(isShipped('backlog-only-slug')).toBe(false);
  });

  it('returns false for an unknown slug', () => {
    expect(isShipped('does-not-exist-anywhere')).toBe(false);
  });

  it('resolves a Q-id pointing at a phase: done FD (via entry-id) as shipped', () => {
    expect(isShipped('Q-0500')).toBe(true);
  });

  it('returns false for a Q-id that resolves only to a roadmap entry', () => {
    expect(isShipped('Q-0100')).toBe(false);
  });

  it('returns false for an unknown Q-id', () => {
    expect(isShipped('Q-9999')).toBe(false);
  });
});

describe('score.ts CLI', () => {
  // src/triage/__tests__/score.test.ts → repo root (four levels up)
  const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

  it('prints 150 for M / high / med / no deps', () => {
    const out = execSync('pnpm tsx src/triage/score.ts --size=M --impact=high --confidence=med', {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(out.trim()).toBe('150');
  });

  it('honors deps against the real docs/features tree', () => {
    // `noldor` FD exists with phase: done — so a dep on it is shipped (factor 1).
    // A non-existent slug stays unshipped — penalizes the score.
    const shipped = execSync(
      'pnpm tsx src/triage/score.ts --size=M --impact=high --confidence=med --deps=noldor',
      { cwd: repoRoot, encoding: 'utf8' },
    ).trim();
    const unshipped = execSync(
      'pnpm tsx src/triage/score.ts --size=M --impact=high --confidence=med --deps=does-not-exist-anywhere',
      { cwd: repoRoot, encoding: 'utf8' },
    ).trim();
    expect(Number(shipped)).toBe(150);
    expect(Number(unshipped)).toBe(75);
  });

  it('honors --blocked-by as an alias of --deps', () => {
    const unshipped = execSync(
      'pnpm tsx src/triage/score.ts --size=M --impact=high --confidence=med --blocked-by=does-not-exist-anywhere',
      { cwd: repoRoot, encoding: 'utf8' },
    ).trim();
    expect(Number(unshipped)).toBe(75);
  });

  it('unions --deps and --blocked-by (dedup) for the dep factor', () => {
    // Two distinct unshipped refs → factor 1/3 → round(100*4*0.75/2 * 1/3) = 50.
    const out = execSync(
      'pnpm tsx src/triage/score.ts --size=M --impact=high --confidence=med --deps=nope-one --blocked-by=nope-one,nope-two',
      { cwd: repoRoot, encoding: 'utf8' },
    ).trim();
    expect(Number(out)).toBe(50);
  });

  it('exits with code 2 and prints usage when --size is invalid', () => {
    let exitCode = 0;
    let stderr = '';
    try {
      execSync('pnpm tsx src/triage/score.ts --size=HUGE --impact=high', {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      const err = e as { status: number; stderr: string };
      exitCode = err.status;
      stderr = err.stderr;
    }
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/usage/i);
    expect(stderr).not.toMatch(/at [\w./]+:\d+:\d+/); // no JS stack frame leaked
  });

  it('exits with code 2 when --impact is missing', () => {
    let exitCode = 0;
    try {
      execSync('pnpm tsx src/triage/score.ts --size=M', {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      exitCode = (e as { status: number }).status;
    }
    expect(exitCode).toBe(2);
  });
});
