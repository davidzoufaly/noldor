// @tests: noldor
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateTrailer } from '../noldor-validate-trailer';

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qfvt-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t.t', { cwd: dir });
  execSync('git config user.name t', { cwd: dir });
  mkdirSync(join(dir, '.noldor'));
  // Scaffold a minimal consumer config so loadConsumerConfig() in
  // isReleaseAutomationFile resolves. Test-only fixture — real shape
  // lives in the consumer repo's `.noldor/config.json`.
  writeFileSync(
    join(dir, '.noldor', 'config.json'),
    JSON.stringify({
      consumer: {
        name: 'test',
        repoUrl: 'https://github.com/test/test',
        lockstepPackages: [
          'package.json',
          'apps/web/package.json',
          'packages/format/package.json',
          'packages/engine/package.json',
          'packages/viewport/package.json',
          'packages/test-fixtures/package.json',
          'packages/examples/package.json',
        ],
        scanPaths: [],
        boundaries: [],
        deprecatedPackages: [],
        e2ePrefix: 'apps/web/e2e/',
        samplesPath: 'apps/web/public/samples',
        packagePrefix: '@test/',
        pnpmStderrPrefix: 'test@',
        appPathPrefix: 'apps/web/',
      },
    }),
  );
  return dir;
}

describe('validateTrailer', () => {
  it('soft mode: passes everything when no rollout marker', () => {
    const dir = setupRepo();
    // No .noldor/rollout-marker written — soft mode should pass regardless
    const r = validateTrailer({ message: 'fix: x\n', cwd: dir });
    expect(r.ok).toBe(true);
  });

  it('accepts Noldor-Path-Override regardless of other state', () => {
    const dir = setupRepo();
    // Write a rollout marker so enforcement is active
    writeFileSync(join(dir, 'a'), 'init');
    execSync('git add a && git commit -q -m init', { cwd: dir });
    const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), sha + '\n');
    writeFileSync(join(dir, 'b'), 'x');
    execSync('git add b && git commit -q -m "post-rollout"', { cwd: dir });
    const r = validateTrailer({
      message: 'fix: x\n\nNoldor-Path-Override: hook broken — see issue 42\n',
      cwd: dir,
    });
    expect(r.ok).toBe(true);
  });

  it('accepts release-automation without other trailers', () => {
    const dir = setupRepo();
    writeFileSync(join(dir, 'a'), 'init');
    execSync('git add a && git commit -q -m init', { cwd: dir });
    const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), sha + '\n');
    writeFileSync(join(dir, 'b'), 'x');
    execSync('git add b && git commit -q -m "post-rollout"', { cwd: dir });
    writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n');
    execSync('git add CHANGELOG.md', { cwd: dir });
    const r = validateTrailer({
      message: 'chore(release): v1.2.3\n\nNoldor-Path: release-automation\n',
      cwd: dir,
    });
    expect(r.ok).toBe(true);
  });

  it('rejects release-automation when the subject is not a release commit', () => {
    const dir = setupRepo();
    writeFileSync(join(dir, 'a'), 'init');
    execSync('git add a && git commit -q -m init', { cwd: dir });
    const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), sha + '\n');
    writeFileSync(join(dir, 'b'), 'x');
    execSync('git add b && git commit -q -m "post-rollout"', { cwd: dir });
    writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n');
    execSync('git add CHANGELOG.md', { cwd: dir });
    const r = validateTrailer({
      message: 'fix: bypass gate\n\nNoldor-Path: release-automation\n',
      cwd: dir,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/release subject/);
  });

  it('rejects release-automation when staged files are not release outputs', () => {
    const dir = setupRepo();
    writeFileSync(join(dir, 'a'), 'init');
    execSync('git add a && git commit -q -m init', { cwd: dir });
    const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), sha + '\n');
    writeFileSync(join(dir, 'b'), 'x');
    execSync('git add b && git commit -q -m "post-rollout"', { cwd: dir });
    mkdirSync(join(dir, 'packages', 'web', 'src'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'web', 'src', 'foo.ts'), 'x');
    execSync('git add packages/web/src/foo.ts', { cwd: dir });
    const r = validateTrailer({
      message: 'chore(release): v1.2.3\n\nNoldor-Path: release-automation\n',
      cwd: dir,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/release-automation files/);
  });

  it('rejects missing Noldor-Path', () => {
    const dir = setupRepo();
    writeFileSync(join(dir, 'a'), 'init');
    execSync('git add a && git commit -q -m init', { cwd: dir });
    const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), sha + '\n');
    writeFileSync(join(dir, 'b'), 'x');
    execSync('git add b && git commit -q -m "post-rollout"', { cwd: dir });
    const r = validateTrailer({ message: 'fix: x\n', cwd: dir });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Noldor-Path/);
  });

  it('rejects unknown path enum value', () => {
    const dir = setupRepo();
    writeFileSync(join(dir, 'a'), 'init');
    execSync('git add a && git commit -q -m init', { cwd: dir });
    const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), sha + '\n');
    writeFileSync(join(dir, 'b'), 'x');
    execSync('git add b && git commit -q -m "post-rollout"', { cwd: dir });
    const r = validateTrailer({
      message: 'fix: x\n\nNoldor-Path: bogus\n',
      cwd: dir,
    });
    expect(r.ok).toBe(false);
  });

  it('fast-track without Noldor-Reviewed is accepted at commit-msg (interim commit)', () => {
    const dir = setupRepo();
    writeFileSync(join(dir, 'a'), 'init');
    execSync('git add a && git commit -q -m init', { cwd: dir });
    const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), sha + '\n');
    writeFileSync(join(dir, 'b'), 'x');
    execSync('git add b && git commit -q -m "post-rollout"', { cwd: dir });
    const r = validateTrailer({
      message: 'fix: x\n\nNoldor-Path: fast-track\n',
      cwd: dir,
    });
    expect(r.ok).toBe(true);
  });

  it('micro-chore re-validates the staged diff at commit-msg (defense-in-depth vs hand-typed trailer)', () => {
    const dir = setupRepo();
    writeFileSync(join(dir, 'a'), 'init');
    execSync('git add a && git commit -q -m init', { cwd: dir });
    const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), sha + '\n');
    writeFileSync(join(dir, 'b'), 'x');
    execSync('git add b && git commit -q -m "post-rollout"', { cwd: dir });
    mkdirSync(join(dir, 'packages', 'web', 'src'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'web', 'src', 'foo.ts'), 'x');
    execSync('git add packages/web/src/foo.ts', { cwd: dir });
    const r = validateTrailer({
      message: 'fix: x\n\nNoldor-Path: micro-chore\n',
      cwd: dir,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/allowlist/);
  });

  it('specs-only-new requires existing FD with matching tier + spec file', () => {
    const dir = setupRepo();
    writeFileSync(join(dir, 'a'), 'init');
    execSync('git add a && git commit -q -m init', { cwd: dir });
    const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), sha + '\n');
    writeFileSync(join(dir, 'b'), 'x');
    execSync('git add b && git commit -q -m "post-rollout"', { cwd: dir });
    mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
    writeFileSync(
      join(dir, 'docs', 'features', 'foo.md'),
      `---\nname: Foo\nphase: in-progress\ncategory: Editor\narea: x\npackages: [web]\nnoldor-tier: specs-only\nlinks: { code: [], docs: [], tests: [] }\n---\n`,
    );
    mkdirSync(join(dir, 'docs', 'superpowers', 'specs'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'superpowers', 'specs', '2026-05-25-foo-design.md'), '# spec');
    const r = validateTrailer({
      message:
        'feat(web:foo): x\n\nNoldor-Path: specs-only-new\nNoldor-FD: foo\nNoldor-Reviewed: deadbeef\n',
      cwd: dir,
    });
    expect(r.ok).toBe(true);
  });

  it('full-new rejects when FD has no links.spec', () => {
    const dir = setupRepo();
    writeFileSync(join(dir, 'a'), 'init');
    execSync('git add a && git commit -q -m init', { cwd: dir });
    const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), sha + '\n');
    writeFileSync(join(dir, 'b'), 'x');
    execSync('git add b && git commit -q -m "post-rollout"', { cwd: dir });
    mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
    writeFileSync(
      join(dir, 'docs', 'features', 'foo.md'),
      `---\nname: Foo\nphase: in-progress\ncategory: Editor\narea: x\npackages: [web]\nnoldor-tier: full\nlinks: { code: [], docs: [], tests: [] }\n---\n`,
    );
    const r = validateTrailer({
      message:
        'feat(web:foo): x\n\nNoldor-Path: full-new\nNoldor-FD: foo\nNoldor-Reviewed: deadbeef\n',
      cwd: dir,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/links\.spec/);
  });

  it('full-attach requires Noldor-Enhancement + spec file matching enhancement suffix', () => {
    const dir = setupRepo();
    writeFileSync(join(dir, 'a'), 'init');
    execSync('git add a && git commit -q -m init', { cwd: dir });
    const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), sha + '\n');
    writeFileSync(join(dir, 'b'), 'x');
    execSync('git add b && git commit -q -m "post-rollout"', { cwd: dir });
    mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
    writeFileSync(
      join(dir, 'docs', 'features', 'parent.md'),
      `---\nname: Parent\nphase: done\ncategory: Editor\narea: x\npackages: [web]\nnoldor-tier: specs-only\nlinks: { code: [], docs: [], tests: [] }\n---\n`,
    );
    // Without Noldor-Enhancement trailer — should fail
    const r0 = validateTrailer({
      message:
        'feat(web:parent): enhance\n\nNoldor-Path: full-attach\nNoldor-FD: parent\nNoldor-Reviewed: deadbeef\n',
      cwd: dir,
    });
    expect(r0.ok).toBe(false);
    expect(r0.reason).toMatch(/Noldor-Enhancement/);

    // With trailer but no spec file — should fail
    const r1 = validateTrailer({
      message:
        'feat(web:parent): enhance\n\nNoldor-Path: full-attach\nNoldor-FD: parent\nNoldor-Enhancement: enhance\nNoldor-Reviewed: deadbeef\n',
      cwd: dir,
    });
    expect(r1.ok).toBe(false);
    expect(r1.reason).toMatch(/spec/);

    // With spec file matching enhancement suffix — should pass
    mkdirSync(join(dir, 'docs', 'superpowers', 'specs'), { recursive: true });
    writeFileSync(
      join(dir, 'docs', 'superpowers', 'specs', '2026-05-10-parent-enhance-design.md'),
      '# spec',
    );
    const r2 = validateTrailer({
      message:
        'feat(web:parent): enhance\n\nNoldor-Path: full-attach\nNoldor-FD: parent\nNoldor-Enhancement: enhance\nNoldor-Reviewed: deadbeef\n',
      cwd: dir,
    });
    expect(r2.ok).toBe(true);
  });

  it('missing FD for specs-only-new rejects', () => {
    const dir = setupRepo();
    writeFileSync(join(dir, 'a'), 'init');
    execSync('git add a && git commit -q -m init', { cwd: dir });
    const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), sha + '\n');
    writeFileSync(join(dir, 'b'), 'x');
    execSync('git add b && git commit -q -m "post-rollout"', { cwd: dir });
    const r = validateTrailer({
      message: 'feat(web:nosuchfd): x\n\nNoldor-Path: specs-only-new\nNoldor-FD: nosuchfd\n',
      cwd: dir,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/FD does not exist/);
  });

  describe('Noldor-CR-Override-Codex', () => {
    it('appends to .noldor/cr-overrides.log when reason is present', () => {
      const dir = setupRepo();
      writeFileSync(join(dir, 'a'), 'init');
      execSync('git add a && git commit -q -m init', { cwd: dir });
      const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
      writeFileSync(join(dir, '.noldor', 'rollout-marker'), sha + '\n');
      writeFileSync(join(dir, 'b'), 'x');
      execSync('git add b && git commit -q -m "post-rollout"', { cwd: dir });
      const r = validateTrailer({
        cwd: dir,
        message: 'fix: x\n\nNoldor-CR-Override-Codex: codex offline\n',
      });
      expect(r.ok).toBe(true);
      const { readFileSync } = require('node:fs');
      const log = readFileSync(join(dir, '.noldor', 'cr-overrides.log'), 'utf8');
      expect(log).toMatch(/\tcodex offline\n$/);
    });

    it('rejects empty reason', () => {
      const dir = setupRepo();
      writeFileSync(join(dir, 'a'), 'init');
      execSync('git add a && git commit -q -m init', { cwd: dir });
      const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
      writeFileSync(join(dir, '.noldor', 'rollout-marker'), sha + '\n');
      writeFileSync(join(dir, 'b'), 'x');
      execSync('git add b && git commit -q -m "post-rollout"', { cwd: dir });
      const r = validateTrailer({
        cwd: dir,
        message: 'fix\n\nNoldor-CR-Override-Codex:  \n',
      });
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/empty reason/i);
    });
  });

  describe('release-sweep path', () => {
    function setupPostRollout(dir: string): void {
      writeFileSync(join(dir, 'a'), 'init');
      execSync('git add a && git commit -q -m init', { cwd: dir });
      const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
      writeFileSync(join(dir, '.noldor', 'rollout-marker'), sha + '\n');
      writeFileSync(join(dir, 'b'), 'x');
      execSync('git add b && git commit -q -m "post-rollout"', { cwd: dir });
    }

    it('passes when staged files match RELEASE_SWEEP_GLOBS', () => {
      const dir = setupRepo();
      setupPostRollout(dir);
      mkdirSync(join(dir, 'graphify-out'), { recursive: true });
      writeFileSync(join(dir, 'graphify-out', 'graph.json'), '{}');
      execSync('git add graphify-out/graph.json', { cwd: dir });
      const r = validateTrailer({
        cwd: dir,
        message: 'chore(release-sweep): graphify output\n\nNoldor-Path: release-sweep\n',
      });
      expect(r.ok).toBe(true);
    });

    it('fails when staged files escape RELEASE_SWEEP_GLOBS', () => {
      const dir = setupRepo();
      setupPostRollout(dir);
      mkdirSync(join(dir, 'packages', 'engine', 'src'), { recursive: true });
      writeFileSync(join(dir, 'packages', 'engine', 'src', 'foo.ts'), 'x');
      execSync('git add packages/engine/src/foo.ts', { cwd: dir });
      const r = validateTrailer({
        cwd: dir,
        message: 'feat(engine): sneak in\n\nNoldor-Path: release-sweep\n',
      });
      expect(r.ok).toBe(false);
      expect(r.reason).toContain('release-sweep diff escapes allowlist');
    });
  });

  describe('Noldor-Phase-Revert: 1 trailer bypasses spec-file existence check', () => {
    function setupPostRollout(dir: string): void {
      writeFileSync(join(dir, 'a'), 'init');
      execSync('git add a && git commit -q -m init', { cwd: dir });
      const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
      writeFileSync(join(dir, '.noldor', 'rollout-marker'), sha + '\n');
      writeFileSync(join(dir, 'b'), 'x');
      execSync('git add b && git commit -q -m "post-rollout"', { cwd: dir });
    }

    it('lets full-attach commit through with the trailer (no spec file present)', () => {
      const dir = setupRepo();
      setupPostRollout(dir);
      mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
      writeFileSync(
        join(dir, 'docs', 'features', 'parent.md'),
        `---\nname: Parent\nphase: in-progress\ncategory: Editor\narea: x\npackages: [web]\nnoldor-tier: full\nlinks: { code: [], docs: [], tests: [] }\n---\n`,
      );
      const r = validateTrailer({
        cwd: dir,
        message:
          'docs(features:parent): revert phase done -> in-progress\n\nNoldor-Path: full-attach\nNoldor-FD: parent\nNoldor-Phase-Revert: 1\n',
      });
      expect(r.ok).toBe(true);
    });

    it('lets specs-only-attach commit through with the trailer', () => {
      const dir = setupRepo();
      setupPostRollout(dir);
      mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
      writeFileSync(
        join(dir, 'docs', 'features', 'parent.md'),
        `---\nname: Parent\nphase: in-progress\ncategory: Editor\narea: x\npackages: [web]\nnoldor-tier: full\nlinks: { code: [], docs: [], tests: [] }\n---\n`,
      );
      const r = validateTrailer({
        cwd: dir,
        message:
          'docs(features:parent): revert phase done -> in-progress\n\nNoldor-Path: specs-only-attach\nNoldor-FD: parent\nNoldor-Phase-Revert: 1\n',
      });
      expect(r.ok).toBe(true);
    });

    it('lets specs-only-new commit through with the trailer (scaffold without spec yet)', () => {
      const dir = setupRepo();
      setupPostRollout(dir);
      mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
      writeFileSync(
        join(dir, 'docs', 'features', 'foo.md'),
        `---\nname: Foo\nphase: in-progress\ncategory: Editor\narea: x\npackages: [web]\nnoldor-tier: specs-only\nlinks: { code: [], docs: [], tests: [] }\n---\n`,
      );
      const r = validateTrailer({
        cwd: dir,
        message:
          'docs(features:foo): scaffold\n\nNoldor-Path: specs-only-new\nNoldor-FD: foo\nNoldor-Phase-Revert: 1\n',
      });
      expect(r.ok).toBe(true);
    });

    it('does NOT bypass without the trailer (regular attach commit must have spec)', () => {
      const dir = setupRepo();
      setupPostRollout(dir);
      mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
      writeFileSync(
        join(dir, 'docs', 'features', 'parent.md'),
        `---\nname: Parent\nphase: in-progress\ncategory: Editor\narea: x\npackages: [web]\nnoldor-tier: full\nlinks: { code: [], docs: [], tests: [] }\n---\n`,
      );
      const r = validateTrailer({
        cwd: dir,
        message:
          'feat(parent): enhance\n\nNoldor-Path: full-attach\nNoldor-FD: parent\nNoldor-Enhancement: foo\n',
      });
      expect(r.ok).toBe(false);
    });
  });

  describe('specs-only-attach requires Noldor-Enhancement + spec file matching enhancement', () => {
    function setupPostRollout(dir: string): void {
      writeFileSync(join(dir, 'a'), 'init');
      execSync('git add a && git commit -q -m init', { cwd: dir });
      const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
      writeFileSync(join(dir, '.noldor', 'rollout-marker'), sha + '\n');
      writeFileSync(join(dir, 'b'), 'x');
      execSync('git add b && git commit -q -m "post-rollout"', { cwd: dir });
    }

    it('rejects when no spec file matches the enhancement suffix', () => {
      const dir = setupRepo();
      setupPostRollout(dir);
      mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
      writeFileSync(
        join(dir, 'docs', 'features', 'parent.md'),
        `---\nname: Parent\nphase: in-progress\ncategory: Editor\narea: x\npackages: [web]\nnoldor-tier: full\nlinks: { code: [], docs: [], tests: [] }\n---\n`,
      );
      mkdirSync(join(dir, 'docs', 'superpowers', 'specs'), { recursive: true });
      writeFileSync(
        join(dir, 'docs', 'superpowers', 'specs', '2026-05-25-parent-other-design.md'),
        '# spec',
      );
      const r = validateTrailer({
        cwd: dir,
        message:
          'feat(parent): enhance\n\nNoldor-Path: specs-only-attach\nNoldor-FD: parent\nNoldor-Enhancement: wanted\n',
      });
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/wanted-design\.md/);
    });

    it('passes when spec file matches enhancement suffix', () => {
      const dir = setupRepo();
      setupPostRollout(dir);
      mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
      writeFileSync(
        join(dir, 'docs', 'features', 'parent.md'),
        `---\nname: Parent\nphase: in-progress\ncategory: Editor\narea: x\npackages: [web]\nnoldor-tier: full\nlinks: { code: [], docs: [], tests: [] }\n---\n`,
      );
      mkdirSync(join(dir, 'docs', 'superpowers', 'specs'), { recursive: true });
      writeFileSync(
        join(dir, 'docs', 'superpowers', 'specs', '2026-05-25-parent-my-enh-design.md'),
        '# spec',
      );
      const r = validateTrailer({
        cwd: dir,
        message:
          'feat(parent): enhance\n\nNoldor-Path: specs-only-attach\nNoldor-FD: parent\nNoldor-Enhancement: my-enh\n',
      });
      expect(r.ok).toBe(true);
    });
  });
});
