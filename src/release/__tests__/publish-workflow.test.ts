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

function loadWorkflow(): WorkflowShape {
  const raw = readFileSync(join(ROOT, '.github', 'workflows', 'publish.yml'), 'utf8');
  return parse(raw) as WorkflowShape;
}

describe('publish.yml — tag-triggered trusted publishing', () => {
  it('fires on v* tag pushes only', () => {
    expect(loadWorkflow().on).toEqual({ push: { tags: ['v*'] } });
  });

  it('declares packages: write for GitHub Packages publish (no OIDC id-token)', () => {
    expect(loadWorkflow().permissions).toEqual({ contents: 'read', packages: 'write' });
  });

  it('points npm at GitHub Packages under the @davidzoufaly scope via setup-node', () => {
    const setupNode = loadWorkflow().jobs.publish.steps.find((s) =>
      s.uses?.startsWith('actions/setup-node'),
    );
    expect(setupNode?.with?.['registry-url']).toBe('https://npm.pkg.github.com');
    expect(setupNode?.with?.scope).toBe('@davidzoufaly');
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

  it('publishes a private package via GITHUB_TOKEN — no --access public, no provenance', () => {
    // Private GH Packages: a scoped name defaults to restricted access, so
    // `--access public` (which would re-leak the source) must be absent, and
    // provenance is a public-registry/sigstore feature that no longer applies.
    const publishStep = loadWorkflow().jobs.publish.steps.find((s) =>
      (s.run ?? '').includes('npm publish'),
    );
    const publishRun = publishStep?.run ?? '';
    expect(publishRun).toContain('npm publish');
    expect(publishRun).not.toContain('--access public');
    expect(publishRun).not.toContain('--provenance');
    expect(publishStep?.env?.NODE_AUTH_TOKEN).toBe('${{ secrets.GITHUB_TOKEN }}');
  });
});
