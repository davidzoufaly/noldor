// @tests: registry-distribution-for-the-noldor-package
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}

interface WorkflowShape {
  on: { push: { tags: string[] } };
  permissions: Record<string, string>;
  jobs: { publish: { steps: WorkflowStep[] } };
}

interface PackageIdentity {
  name: string;
  publishConfig?: { access?: string };
}

function loadWorkflow(): WorkflowShape {
  const raw = readFileSync(join(ROOT, '.github', 'workflows', 'publish.yml'), 'utf8');
  return parse(raw) as WorkflowShape;
}

function readPackageJson(): PackageIdentity {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as PackageIdentity;
}

function publishStep(): WorkflowStep | undefined {
  return loadWorkflow().jobs.publish.steps.find((s) => (s.run ?? '').includes('npm publish'));
}

function publishCommand(): string {
  return publishStep()?.run ?? '';
}

describe('publish.yml — tag-triggered public npm publish', () => {
  it('fires on v* tag pushes only', () => {
    expect(loadWorkflow().on).toEqual({ push: { tags: ['v*'] } });
  });

  it('declares contents: read + id-token: write (provenance), and NOT packages: write', () => {
    expect(loadWorkflow().permissions).toEqual({ contents: 'read', 'id-token': 'write' });
  });

  it('points npm at the public npm registry via setup-node, with no scope key', () => {
    const setupNode = loadWorkflow().jobs.publish.steps.find((s) =>
      s.uses?.startsWith('actions/setup-node'),
    );
    expect(setupNode?.with?.['registry-url']).toBe('https://registry.npmjs.org');
    expect(setupNode?.with?.scope).toBeUndefined();
  });

  it('guards tag-vs-package.json before installing anything', () => {
    const runs = loadWorkflow().jobs.publish.steps.map((s) => s.run ?? '');
    const guardIdx = runs.findIndex((r) => r.includes('GITHUB_REF_NAME#v'));
    const installIdx = runs.findIndex((r) => r.includes('pnpm install --frozen-lockfile'));
    expect(guardIdx).toBeGreaterThan(-1);
    expect(installIdx).toBeGreaterThan(guardIdx);
  });

  it('contract-checks the exact bits, then publishes', () => {
    const runs = loadWorkflow().jobs.publish.steps.map((s) => s.run ?? '');
    const contractIdx = runs.findIndex((r) => r.includes('pnpm test:contract'));
    const publishIdx = runs.findIndex((r) => r.includes('npm publish'));
    expect(contractIdx).toBeGreaterThan(-1);
    expect(publishIdx).toBeGreaterThan(contractIdx);
  });

  it('publishes a public package with provenance + --access public via NPM_TOKEN', () => {
    // `npm publish --provenance` on a NEW package REQUIRES an explicit
    // `--access public` — npm otherwise errors EUSAGE: "Can't generate
    // provenance for new or private package, you must set access to public".
    // (Unscoped defaults to public WITHOUT provenance, but the provenance path
    // on a first publish demands the flag — caught by live CI on v1.0.1.)
    const publishRun = publishCommand();
    expect(publishRun).toContain('npm publish');
    expect(publishRun).toContain('--provenance');
    expect(publishRun).toContain('--access public');
    expect(publishStep()?.env?.NODE_AUTH_TOKEN).toBe('${{ secrets.NPM_TOKEN }}');
  });

  it('derives the --access public requirement from the package it actually publishes', () => {
    // The test above locks the literal; this one locks the reason, so a rename
    // or a provenance flip cannot revive the "unscoped is public anyway, drop
    // the flag" reasoning that shipped in the cutover spec and failed the v1.0.1
    // tag. Two independent grounds make the flag mandatory: a scoped name
    // defaults to `restricted`, and `--provenance` accepts no access level but
    // `public`. Both hold today; either one alone is sufficient.
    const pkg = readPackageJson();
    const publishRun = publishCommand();
    const scoped = pkg.name.startsWith('@');
    const attested = publishRun.includes('--provenance');
    expect(scoped || attested).toBe(true);
    expect(publishRun).toContain('--access public');
    // `publishConfig.access` is the other lever that can force `restricted`;
    // absent is fine, present must agree with the flag.
    expect(pkg.publishConfig?.access ?? 'public').toBe('public');
  });
});
