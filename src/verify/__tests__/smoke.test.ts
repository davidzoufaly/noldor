// @tests: acceptance-verify-lane
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePort } from '../port.js';
import { runSmoke } from '../smoke.js';

const OK_DOCTOR = 'node -e "process.exit(0)"';
const BAD_DOCTOR = 'node -e "console.error(\'drift: AGENTS.md\'); process.exit(1)"';

function consumerDir(verifyCommands: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-smoke-'));
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  writeFileSync(
    join(dir, '.noldor', 'config.json'),
    JSON.stringify({
      consumer: {
        name: 'x',
        repoUrl: 'https://example.com/x',
        lockstepPackages: ['package.json'],
        e2ePrefix: 'e2e/',
        samplesPath: 'samples',
        packagePrefix: '@x/',
        pnpmStderrPrefix: 'x',
        appPathPrefix: 'src',
        verifyCommands,
      },
    }),
  );
  return dir;
}

describe('runSmoke', () => {
  it('fails fast with doctor evidence when doctor is red', async () => {
    const dir = consumerDir({});
    const report = await runSmoke(dir, 4000, { doctorCommand: BAD_DOCTOR });
    expect(report.ok).toBe(false);
    expect(report.surfaces[0].name).toBe('doctor');
    expect(report.surfaces[0].evidence.observed).toContain('drift: AGENTS.md');
  });

  it('is green with a note when zero surfaces are configured', async () => {
    const dir = consumerDir({});
    const report = await runSmoke(dir, 4000, { doctorCommand: OK_DOCTOR });
    expect(report.ok).toBe(true);
    expect(report.notes).toContain('no surfaces configured');
  });

  it('cli surface: exit 0 passes, non-zero fails with output quoted', async () => {
    const dir = consumerDir({
      good: { command: 'node -e "process.exit(0)"', kind: 'cli' },
      bad: { command: 'node -e "console.error(\'boom\'); process.exit(3)"', kind: 'cli' },
    });
    const report = await runSmoke(dir, 4000, { doctorCommand: OK_DOCTOR });
    expect(report.ok).toBe(false);
    const byName = Object.fromEntries(report.surfaces.map((s) => [s.name, s]));
    expect(byName.good.ok).toBe(true);
    expect(byName.bad.ok).toBe(false);
    expect(byName.bad.evidence.observed).toContain('boom');
  });

  it('server surface: boots on {port}, probes 200, kills the process', async () => {
    const server =
      "node -e \"require('node:http').createServer((q,s)=>s.end('ok')).listen({port},'127.0.0.1')\"";
    const dir = consumerDir({ web: { command: server, kind: 'server', readyTimeoutMs: 10_000 } });
    const port = await resolvePort(dir);
    const report = await runSmoke(dir, port, { doctorCommand: OK_DOCTOR });
    expect(report.ok).toBe(true);
    const web = report.surfaces.find((s) => s.name === 'web');
    expect(web?.evidence.observed).toContain('200');
    // the boot was killed: the port frees up (poll — SIGKILL teardown is async)
    const freed = async (): Promise<boolean> => {
      for (let i = 0; i < 20; i++) {
        const up = await fetch(`http://127.0.0.1:${port}/`).then(
          () => true,
          () => false,
        );
        if (!up) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    };
    await expect(freed()).resolves.toBe(true);
  });

  it('server surface: port already occupied → honest fail, no boot', async () => {
    const { createServer } = await import('node:http');
    const squatter = createServer((q, s) => s.end('squatter'));
    const port = await resolvePort(mkdtempSync(join(tmpdir(), 'noldor-squat-')));
    await new Promise<void>((r) => squatter.listen(port, '127.0.0.1', r));
    try {
      const dir = consumerDir({ web: { command: 'node -e "process.exit(0)"', kind: 'server' } });
      const report = await runSmoke(dir, port, { doctorCommand: OK_DOCTOR });
      expect(report.ok).toBe(false);
      expect(report.surfaces.find((s) => s.name === 'web')?.evidence.observed).toContain(
        'already in use',
      );
    } finally {
      squatter.close();
    }
  });

  it('server surface: no 200 within readyTimeoutMs fails with evidence', async () => {
    const dir = consumerDir({
      dead: {
        command: 'node -e "setTimeout(()=>{}, 60000)"',
        kind: 'server',
        readyTimeoutMs: 1500,
      },
    });
    const report = await runSmoke(dir, 4000, { doctorCommand: OK_DOCTOR });
    expect(report.ok).toBe(false);
    expect(report.surfaces.find((s) => s.name === 'dead')?.evidence.observed).toContain(
      'no HTTP 200',
    );
  });
});
