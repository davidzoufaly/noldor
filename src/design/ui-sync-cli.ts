// @tests: pendev-ui-design-phase
// `noldor design ui-sync [--surface <name>]` — the report-and-validate half of
// baseline remediation (spec U6). This CLI cannot read .pen content (pencil MCP
// is the only reader); it reports U7 verdicts with edit instructions, plain-
// `git add`s the named baseline file so validation can see it staged, and never
// commits. Remediation completes only when the staged change is COMMITTED —
// U7 reads committed history.

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { runIfDirect } from '../core/cli-entry.js';
import { loadUiConfig } from '../core/consumer-config.js';
import {
  BASELINE_DIR,
  evaluateUiDesignFreshness,
  type UiSurfaceFreshness,
} from '../release/ui-design-freshness.js';

export function renderSurfaceReport(s: UiSurfaceFreshness): string {
  const file = `${BASELINE_DIR}/${s.surface}.pen`;
  const action =
    s.status === 'uninitialized'
      ? `create ${file} in a pencil-capable session (bootstrap)`
      : s.status === 'stale'
        ? `edit ${file} in a pencil-capable session to match the code at ${s.uiCommit?.slice(0, 8) ?? 'HEAD'}`
        : 'no action';
  return `${s.surface}: ${s.status}\n  ${s.detail}\n  → ${action}`;
}

export interface BaselineValidation {
  ok: boolean;
  reason?: 'missing' | 'empty' | 'not staged';
  notice?: string;
}

/** What a Node process can see: exists, non-empty, staged. Content rules (page
 * naming, one FINAL per surface) are validated in-session via pencil MCP. */
export function validateBaselineFile(
  absPath: string,
  git: { staged: boolean },
): BaselineValidation {
  if (!existsSync(absPath)) return { ok: false, reason: 'missing' };
  if (statSync(absPath).size === 0) return { ok: false, reason: 'empty' };
  if (!git.staged) return { ok: false, reason: 'not staged' };
  return {
    ok: true,
    notice: 'validation passed — remediation completes when the staged change is committed',
  };
}

export function isStaged(cwd: string, repoRelPath: string): boolean {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--', repoRelPath], {
    cwd,
    encoding: 'utf8',
  });
  return out.trim().length > 0;
}

export async function main(argv: string[], cwd: string = process.cwd()): Promise<number> {
  const flagIdx = argv.indexOf('--surface');
  if (flagIdx !== -1 && argv[flagIdx + 1] === undefined) {
    console.error('ui-sync: --surface requires a value');
    return 2;
  }
  const surfaceFlag = flagIdx === -1 ? undefined : argv[flagIdx + 1];
  const ui = loadUiConfig(cwd);
  if (ui === null) {
    console.log('ui-sync: nothing to do (no consumer config)');
    return 0;
  }
  const verdict = await evaluateUiDesignFreshness(cwd, ui);
  const rows = verdict.surfaces.filter(
    (s) => surfaceFlag === undefined || s.surface === surfaceFlag,
  );
  if (rows.length === 0) {
    console.log(
      surfaceFlag
        ? `no surface named '${surfaceFlag}'`
        : 'ui-sync: nothing to do (no uiPaths configured)',
    );
    return surfaceFlag ? 2 : 0;
  }
  let pending = 0;
  for (const s of rows) {
    console.log(renderSurfaceReport(s));
    if (s.status === 'stale' || s.status === 'uninitialized') {
      const rel = `${BASELINE_DIR}/${s.surface}.pen`;
      // Plain `git add` (never --intent-to-add: a no-op on tracked files and
      // invisible to `diff --cached`, which would make the ✓ path unreachable).
      // A missing file (uninitialized, not yet created this run) is the one
      // expected failure — anything else (index lock, permissions) is surfaced,
      // never swallowed into an ordinary "not staged" row.
      if (existsSync(join(cwd, rel))) {
        try {
          execFileSync('git', ['add', '--', rel], { cwd, stdio: 'pipe' });
        } catch (err) {
          const stderr = (err as { stderr?: Buffer | string }).stderr?.toString() ?? String(err);
          console.error(`  ✗ git add failed for ${rel}: ${stderr.trim()}`);
        }
      }
      const v = validateBaselineFile(join(cwd, rel), { staged: isStaged(cwd, rel) });
      if (v.ok) {
        console.log(`  ✓ ${v.notice}`);
      } else {
        pending += 1;
        console.log(`  ✗ not remediated yet: ${v.reason}`);
      }
    }
  }
  console.log(
    pending === 0
      ? 'nothing pending — commit any staged baseline changes to green the freshness check'
      : 'edit the files above via pencil MCP, re-run ui-sync to validate, then COMMIT the staged baseline — the freshness check greens only after the commit lands',
  );
  return pending === 0 ? 0 : 1;
}

runIfDirect('ui-sync-cli', 'design ui-sync', async () => main(process.argv.slice(2)));
