// @tests: dashboard-broken-pages-audit
// logSink tee: child output is forwarded to the parent's stdio AND appended to
// the sink file, without ever accumulating into AgentResult.stdout — and the
// no-logSink stdio tuples stay byte-for-byte what they were before the tee.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnAgent } from '../registry';

function tmpConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-logsink-'));
  mkdirSync(join(dir, '.noldor'));
  writeFileSync(join(dir, '.noldor', 'config.json'), '{}', 'utf8');
  return dir;
}

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { on: vi.fn(), end: vi.fn() };
  pid = 12345;
  kill(): void {
    this.emit('close', null);
  }
}

function fakeSpawn() {
  const calls: Array<{ opts: Record<string, unknown> }> = [];
  let child: FakeChild | undefined;
  const impl = vi.fn((_bin: string, _argv: string[], opts: Record<string, unknown>) => {
    calls.push({ opts });
    child = new FakeChild();
    return child as never;
  });
  return { impl, calls, child: () => child! };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('spawnAgent logSink tee', () => {
  it('pipes both streams, forwards to parent stdio, appends to the sink, and never accumulates stdout', async () => {
    const dir = tmpConfig();
    const sinkPath = join(dir, '.noldor', 'watch.log');
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const f = fakeSpawn();
    const p = spawnAgent(
      'go',
      { role: 'implementer', cwd: dir, stdio: 'inherit', logSink: sinkPath },
      { spawnImpl: f.impl as never },
    );
    expect(f.calls[0]!.opts.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    f.child().stdout.emit('data', Buffer.from('out-line\n'));
    f.child().stderr.emit('data', Buffer.from('err-line\n'));
    f.child().emit('close', 0);
    const r = await p;
    expect(r.stdout).toBe(''); // the '' -under-inherit contract holds in tee mode
    expect(outSpy).toHaveBeenCalledWith(Buffer.from('out-line\n'));
    expect(errSpy).toHaveBeenCalledWith(Buffer.from('err-line\n'));
    // createWriteStream flushes asynchronously — give it a tick
    await new Promise((res) => setTimeout(res, 50));
    const logged = readFileSync(sinkPath, 'utf8');
    expect(logged).toContain('out-line');
    expect(logged).toContain('err-line');
  });

  it('appends across children (flags: a) instead of truncating', async () => {
    const dir = tmpConfig();
    const sinkPath = join(dir, '.noldor', 'watch.log');
    writeFileSync(sinkPath, 'prior-cycle\n', 'utf8');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const f = fakeSpawn();
    const p = spawnAgent(
      'go',
      { role: 'implementer', cwd: dir, stdio: 'inherit', logSink: sinkPath },
      { spawnImpl: f.impl as never },
    );
    f.child().stdout.emit('data', Buffer.from('new-line\n'));
    f.child().emit('close', 0);
    await p;
    await new Promise((res) => setTimeout(res, 50));
    const logged = readFileSync(sinkPath, 'utf8');
    expect(logged).toContain('prior-cycle');
    expect(logged).toContain('new-line');
  });

  it('without logSink the stdio tuples are unchanged: inherit stays fully inherited', async () => {
    const dir = tmpConfig();
    const f = fakeSpawn();
    const p = spawnAgent(
      'go',
      { role: 'implementer', cwd: dir, stdio: 'inherit' },
      { spawnImpl: f.impl as never },
    );
    expect(f.calls[0]!.opts.stdio).toEqual(['ignore', 'inherit', 'inherit']);
    f.child().emit('close', 0);
    const r = await p;
    expect(r.stdout).toBe('');
  });

  it('without logSink the pipe capture still accumulates stdout', async () => {
    const dir = tmpConfig();
    const f = fakeSpawn();
    const p = spawnAgent('go', { role: 'implementer', cwd: dir }, { spawnImpl: f.impl as never });
    expect(f.calls[0]!.opts.stdio).toEqual(['ignore', 'pipe', 'inherit']);
    f.child().stdout.emit('data', Buffer.from('captured'));
    f.child().emit('close', 0);
    const r = await p;
    expect(r.stdout).toBe('captured');
  });
});
