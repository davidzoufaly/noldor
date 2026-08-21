// @tests: single-static-binary-distribution
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function mapped(unameS: string, unameM: string): string {
  return execFileSync('sh', ['install.sh', '--map-only'], {
    encoding: 'utf8',
    env: { ...process.env, NOLDOR_UNAME_S: unameS, NOLDOR_UNAME_M: unameM },
  }).trim();
}

describe('install.sh platform mapping', () => {
  it('maps all four supported targets', () => {
    expect(mapped('Linux', 'x86_64')).toBe('noldor-linux-amd64');
    expect(mapped('Linux', 'aarch64')).toBe('noldor-linux-arm64');
    expect(mapped('Darwin', 'x86_64')).toBe('noldor-darwin-amd64');
    expect(mapped('Darwin', 'arm64')).toBe('noldor-darwin-arm64');
  });
  it('rejects unsupported platforms', () => {
    expect(() => mapped('Windows_NT', 'x86_64')).toThrow();
    expect(() => mapped('Linux', 'riscv64')).toThrow();
  });
});

describe('install.sh behavior (local HTTP server via NOLDOR_BASE_URL)', () => {
  async function serve(files: Record<string, Buffer | string>): Promise<{
    base: string;
    close: () => Promise<void>;
  }> {
    const { createServer } = await import('node:http');
    const server = createServer((req, res) => {
      const body = files[(req.url ?? '').replace(/^\//, '')];
      if (body === undefined) {
        res.statusCode = 404;
        res.end('nope');
        return;
      }
      res.end(body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    return {
      base: `http://127.0.0.1:${port}`,
      close: () => new Promise((r) => server.close(() => r())),
    };
  }

  // Async spawn, never execFileSync: the HTTP server above lives on THIS
  // event loop — a sync child blocks it, curl waits forever, deadlock.
  async function runInstall(base: string, destDir: string): Promise<void> {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    await promisify(execFile)('sh', ['install.sh'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        NOLDOR_BASE_URL: base,
        NOLDOR_INSTALL_DIR: destDir,
        NOLDOR_VERSION: 'v9.9.9',
      },
    });
  }

  it('installs a checksum-verified binary with mode 0755, atomically', async () => {
    const { createHash } = await import('node:crypto');
    const { mkdtempSync, readFileSync, statSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const asset = execFileSync('sh', ['install.sh', '--map-only'], { encoding: 'utf8' }).trim();
    const payload = Buffer.from('#!/bin/sh\necho fake-noldor\n');
    const sum = createHash('sha256').update(payload).digest('hex');
    const srv = await serve({ [asset]: payload, SHA256SUMS: `${sum}  ${asset}\n` });
    const dest = mkdtempSync(join(tmpdir(), 'noldor-install-'));
    try {
      await runInstall(srv.base, dest);
      expect(readFileSync(join(dest, 'noldor'), 'utf8')).toContain('fake-noldor');
      expect(statSync(join(dest, 'noldor')).mode & 0o755).toBe(0o755);
    } finally {
      await srv.close();
    }
  });

  it('aborts on checksum mismatch and preserves an existing installation', async () => {
    const { mkdtempSync, readFileSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const asset = execFileSync('sh', ['install.sh', '--map-only'], { encoding: 'utf8' }).trim();
    const srv = await serve({
      [asset]: Buffer.from('tampered'),
      SHA256SUMS: `${'0'.repeat(64)}  ${asset}\n`,
    });
    const dest = mkdtempSync(join(tmpdir(), 'noldor-install-'));
    writeFileSync(join(dest, 'noldor'), 'prior-install');
    try {
      await expect(runInstall(srv.base, dest)).rejects.toThrow();
      expect(readFileSync(join(dest, 'noldor'), 'utf8')).toBe('prior-install');
    } finally {
      await srv.close();
    }
  });

  it('aborts on a missing SHA256SUMS sentinel (incomplete release)', async () => {
    const { mkdtempSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const asset = execFileSync('sh', ['install.sh', '--map-only'], { encoding: 'utf8' }).trim();
    const srv = await serve({ [asset]: Buffer.from('x') });
    const dest = mkdtempSync(join(tmpdir(), 'noldor-install-'));
    try {
      await expect(runInstall(srv.base, dest)).rejects.toThrow();
      expect(existsSync(join(dest, 'noldor'))).toBe(false);
    } finally {
      await srv.close();
    }
  });
});
