// @tests: consumer-contract-ci-and-headless-gate-e2e-harness
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { RUNNER_NAMES } from '../../core/agent-runner/types';
import { CAPABILITIES } from '../../core/agent-runner/capabilities';
import { STUB_BIN, buildStubArgv } from '../../core/agent-runner/runners/stub';
import { buildConsumerFixture, type ConsumerFixture } from '../consumer-fixture';
import { applyStubGate } from '../stub-gate';

describe('stub runner', () => {
  it('is a registered runner name', () => {
    expect(RUNNER_NAMES).toContain('stub');
  });
  it('has a capabilities entry', () => {
    expect(CAPABILITIES.stub).toBeDefined();
    expect(CAPABILITIES.stub.structuredOutput).toBe('prose');
  });
  it('builds argv pointing at the stub-gate entrypoint with the prompt', () => {
    const argv = buildStubArgv('/gate', {});
    expect(STUB_BIN).toBe(process.execPath);
    expect(argv.some((a) => a.endsWith('noldor-stub-gate.mjs'))).toBe(true);
    expect(argv).toContain('/gate');
  });
});

let sgFx: ConsumerFixture | null = null;
afterEach(() => sgFx?.cleanup());

describe('stub gate', () => {
  it('applies the canned plan: writes file, retires entry, commits with trailers', () => {
    sgFx = buildConsumerFixture({ seedSlug: 'add-greeting-helper' });
    applyStubGate({ cwd: sgFx.dir, slug: 'add-greeting-helper' });
    expect(existsSync(join(sgFx.dir, 'src', 'greeting.ts'))).toBe(true);
    const body = sgFx.git(['log', '-1', '--format=%B']);
    expect(body).toContain('Noldor-Path: fast-track');
    expect(body).toMatch(/Noldor-Reviewed/);
    const roadmap = sgFx.git(['show', 'HEAD:docs/roadmap.md']);
    expect(roadmap).not.toContain('add-greeting-helper');
  });
});
