import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A fresh directory under the OS temp dir, removed with everything in it when
 * the owning `using` scope ends — on every path out, the throwing one included.
 *
 * @param prefix - The `mkdtemp` prefix, so a directory left by a killed process
 *   names the command that made it.
 */
export function scratchDir(prefix: string): { path: string } & Disposable {
  const path = mkdtempSync(join(tmpdir(), prefix));
  return { path, [Symbol.dispose]: () => rmSync(path, { recursive: true, force: true }) };
}
