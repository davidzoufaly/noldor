import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migration_0_6_0 } from '../0.6.0.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'noldor-mig-'));
  // Simulate a consumer at 0.5.0 with old vendored skill dirs.
  mkdirSync(join(dir, '.claude/skills/gate'), { recursive: true });
  writeFileSync(join(dir, '.claude/skills/gate/SKILL.md'), 'name: gate\n# /gate\n');
  mkdirSync(join(dir, '.claude/skills/refactor'), { recursive: true });
  writeFileSync(join(dir, '.claude/skills/refactor/SKILL.md'), 'name: refactor\n');
  // Opencode command shim for gate (B2).
  mkdirSync(join(dir, '.opencode/command'), { recursive: true });
  writeFileSync(join(dir, '.opencode/command/gate.md'), '---\ndescription: gate\n---\n');
  // Consumer-AUTHORED homonym at a renamed path — frontmatter name is NOT the bare
  // slug, so the guard must leave it untouched (B3).
  mkdirSync(join(dir, '.claude/skills/promote'), { recursive: true });
  writeFileSync(join(dir, '.claude/skills/promote/SKILL.md'), 'name: my-custom-promote\n');
  mkdirSync(join(dir, 'docs/features'), { recursive: true });
  writeFileSync(join(dir, 'docs/features/mine.md'), 'consumer-owned\n'); // must survive
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('migration_0_6_0', () => {
  it('renames only the skills the consumer vendored (true-rename)', () => {
    migration_0_6_0.migrate(dir, {} as never);
    expect(existsSync(join(dir, '.claude/skills/gate'))).toBe(false);
    expect(existsSync(join(dir, '.claude/skills/refactor'))).toBe(false);
    expect(existsSync(join(dir, '.claude/skills/noldor-gate/SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude/skills/noldor-refactor/SKILL.md'))).toBe(true);
    // `garden` was never vendored => no noldor-garden installed (agent/subset scoping).
    expect(existsSync(join(dir, '.claude/skills/noldor-garden'))).toBe(false);
  });
  it('renames the opencode command shim (B2)', () => {
    migration_0_6_0.migrate(dir, {} as never);
    expect(existsSync(join(dir, '.opencode/command/gate.md'))).toBe(false);
    expect(existsSync(join(dir, '.opencode/command/noldor-gate.md'))).toBe(true);
  });
  it('leaves a consumer-authored homonym skill untouched (B3 data-loss guard)', () => {
    migration_0_6_0.migrate(dir, {} as never);
    expect(existsSync(join(dir, '.claude/skills/promote/SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude/skills/noldor-promote'))).toBe(false);
  });
  it('leaves consumer-owned docs untouched', () => {
    migration_0_6_0.migrate(dir, {} as never);
    expect(existsSync(join(dir, 'docs/features/mine.md'))).toBe(true);
  });
  it('dryRun reports steps without writing', () => {
    const steps = migration_0_6_0.dryRun(dir, {} as never);
    expect(steps.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, '.claude/skills/gate'))).toBe(true); // not removed
    expect(existsSync(join(dir, '.claude/skills/noldor-gate'))).toBe(false); // not added
  });
  it('is idempotent on a second apply', () => {
    migration_0_6_0.migrate(dir, {} as never);
    const second = migration_0_6_0.migrate(dir, {} as never);
    expect(second.filter((s) => s.after === '').length).toBe(0); // nothing left to remove
  });
});
