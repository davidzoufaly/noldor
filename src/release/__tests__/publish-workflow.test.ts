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

  it('declares OIDC permissions (id-token: write) for provenance', () => {
    expect(loadWorkflow().permissions).toEqual({ 'id-token': 'write', contents: 'read' });
  });

  it('points npm at the public registry via setup-node', () => {
    const setupNode = loadWorkflow().jobs.publish.steps.find((s) =>
      s.uses?.startsWith('actions/setup-node'),
    );
    expect(setupNode?.with?.['registry-url']).toBe('https://registry.npmjs.org');
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

  it('never hard-codes --provenance — the flag is gated on release.publish.provenance', () => {
    // Provenance requires a PUBLIC repo; this repo is private for now. The
    // publish step must read the knob from the checked-in .noldor/config.json
    // so open-sourcing flips attestation on with a one-line config change.
    const runs = loadWorkflow().jobs.publish.steps.map((s) => s.run ?? '');
    const publishRun = runs.find((r) => r.includes('npm publish')) ?? '';
    expect(publishRun).toContain('--access public');
    expect(publishRun).toContain('release?.publish?.provenance');
    expect(publishRun).not.toContain('npm publish --provenance');
  });
});
