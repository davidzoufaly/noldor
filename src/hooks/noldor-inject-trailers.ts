// scripts/hooks/noldor-inject-trailers.ts
// prepare-commit-msg stage: auto-injects Noldor-* trailers from the active session marker.
// NOTE: This hook intentionally has NO soft-mode gate — injecting trailers pre-rollout is
// harmless (nobody validates them yet) and useful post-rollout.
import { spawnSync } from 'node:child_process';
import { readSession } from '../core/session';

export function injectTrailers(opts: { messageFile: string; cwd: string }): void {
  const session = readSession(opts.cwd);
  if (!session) return;

  const args: string[] = ['interpret-trailers', '--in-place', '--if-exists', 'doNothing'];
  args.push('--trailer', `Noldor-Path: ${session.path}`);
  if (session.slug) args.push('--trailer', `Noldor-FD: ${session.slug}`);
  if (session.parent) args.push('--trailer', `Noldor-FD: ${session.parent}`);
  if (session.enhancement) args.push('--trailer', `Noldor-Enhancement: ${session.enhancement}`);
  args.push(opts.messageFile);

  const r = spawnSync('git', args, { cwd: opts.cwd });
  if (r.status !== 0) {
    throw new Error(`git interpret-trailers failed: ${r.stderr?.toString()}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  injectTrailers({ messageFile: process.argv[2], cwd: process.cwd() });
}
