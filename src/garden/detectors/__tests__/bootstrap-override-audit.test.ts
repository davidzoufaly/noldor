import { describe, expect, it } from 'vitest';

import { detectBootstrapOverrideAudit } from '../bootstrap-override-audit.js';
import { BOOTSTRAP_REASON } from '../../../cr/gate-registry.js';

// @tests: bootstrap-immunity-for-self-gating-features

// A single-commit log block carrying a bootstrap codex override.
const LOG_WITH_BOOTSTRAP = [
  'sha1\x00',
  'feat: add codex gate\n\n',
  `Noldor-CR-Override-Codex: ${BOOTSTRAP_REASON}\n`,
  '\x1e',
].join('');

function runGit(_out: string): (args: string[]) => string {
  return (args) => {
    if (args[0] === 'log') return _out;
    return '';
  };
}

describe('detectBootstrapOverrideAudit', () => {
  it('flags a bootstrap override with no backing introduces-gate FD', () => {
    const findings = detectBootstrapOverrideAudit({
      cwd: '/tmp/repo',
      runGit: runGit(LOG_WITH_BOOTSTRAP),
      gateKeys: new Set(), // no FD declares introduces-gate
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      sha: 'sha1',
      gate: 'codex-cr',
      trailer: 'Noldor-CR-Override-Codex',
      severity: 'WARN',
    });
  });

  it('passes when a backing FD declares the gate', () => {
    const findings = detectBootstrapOverrideAudit({
      cwd: '/tmp/repo',
      runGit: runGit(LOG_WITH_BOOTSTRAP),
      gateKeys: new Set(['codex-cr']),
    });
    expect(findings).toEqual([]);
  });

  it('ignores a non-bootstrap override', () => {
    const log = [
      'sha2\x00',
      'feat: x\n\n',
      'Noldor-CR-Override-Codex: legit manual reason here\n',
      '\x1e',
    ].join('');
    expect(
      detectBootstrapOverrideAudit({ cwd: '/tmp/repo', runGit: runGit(log), gateKeys: new Set() }),
    ).toEqual([]);
  });
});
