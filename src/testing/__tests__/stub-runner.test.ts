// @tests: consumer-contract-ci-and-headless-gate-e2e-harness
import { describe, expect, it } from 'vitest';
import { RUNNER_NAMES } from '../../core/agent-runner/types';
import { CAPABILITIES } from '../../core/agent-runner/capabilities';
import { STUB_BIN, buildStubArgv } from '../../core/agent-runner/runners/stub';

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
