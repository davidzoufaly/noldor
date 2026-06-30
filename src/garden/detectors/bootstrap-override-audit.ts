import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

import matter from 'gray-matter';

import { loadDocRoots } from '../../core/doc-roots.js';
import { readRolloutMarker } from '../../core/rollout-marker.js';
import { parseTrailers } from '../../core/trailers.js';
import { GATE_REGISTRY, isBootstrapReason, type GateKey } from '../../cr/gate-registry.js';

export interface BootstrapOverrideFinding {
  readonly sha: string;
  readonly gate: string;
  readonly trailer: string;
  readonly reason: 'orphan-bootstrap-override';
  readonly severity: 'WARN';
}

export interface BootstrapAuditInput {
  cwd: string;
  /** Git seam — defaults to execFileSync in `cwd`. */
  runGit?: (args: string[]) => string;
  /** Gate keys declared by FDs (test seam). Production scans docs/features. */
  gateKeys?: Set<string>;
}

/** Map an override trailer back to its gate-registry key (reverse of GATE_REGISTRY). */
function gateForTrailer(trailer: string): GateKey | null {
  for (const key of Object.keys(GATE_REGISTRY) as GateKey[]) {
    if (GATE_REGISTRY[key].overrideTrailer === trailer) return key;
  }
  return null;
}

/** Collect every `introduces-gate` value declared by an FD in docs/features. */
function declaredGateKeys(cwd: string): Set<string> {
  const dir = loadDocRoots(cwd).features;
  const keys = new Set<string>();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return keys;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    try {
      const k = (
        matter(readFileSync(`${dir}/${entry}`, 'utf8')).data as {
          'introduces-gate'?: unknown;
        }
      )['introduces-gate'];
      if (typeof k === 'string') keys.add(k);
    } catch {
      /* skip unparseable FD */
    }
  }
  return keys;
}

/**
 * Legitimacy audit for bootstrap overrides. A bootstrap override is legitimate
 * only when some FD declares `introduces-gate` for the gate whose override
 * trailer was stamped. A `bootstrap`-reason override with NO backing
 * gate-introducing FD is abuse (a non-bootstrap commit laundered through the
 * bootstrap reason) → a `WARN` finding (advisory, not blocking — matches the
 * framework's "floor, not ceiling" posture). Scans the release range
 * (`<rollout-marker>..HEAD`, or `HEAD` when no marker exists).
 */
export function detectBootstrapOverrideAudit(
  input: BootstrapAuditInput,
): BootstrapOverrideFinding[] {
  const cwd = input.cwd;
  const git =
    input.runGit ??
    ((args) =>
      execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const declared = input.gateKeys ?? declaredGateKeys(cwd);

  const marker = readRolloutMarker(cwd);
  const range = marker ? `${marker}..HEAD` : 'HEAD';

  let raw: string;
  try {
    raw = git(['log', '--pretty=%H%x00%B%x1e', range]);
  } catch {
    return [];
  }

  const findings: BootstrapOverrideFinding[] = [];
  for (const block of raw.split('\x1e')) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const nul = trimmed.indexOf('\x00');
    if (nul === -1) continue;
    const sha = trimmed.slice(0, nul).trim();
    const body = trimmed.slice(nul + 1);

    let trailers: Record<string, string>;
    try {
      trailers = parseTrailers(body);
    } catch {
      continue;
    }

    for (const key of Object.keys(GATE_REGISTRY) as GateKey[]) {
      const trailer = GATE_REGISTRY[key].overrideTrailer;
      const value = trailers[trailer];
      if (value === undefined || !isBootstrapReason(value)) continue;
      const gate = gateForTrailer(trailer);
      if (gate !== null && !declared.has(gate)) {
        findings.push({
          sha,
          gate,
          trailer,
          reason: 'orphan-bootstrap-override',
          severity: 'WARN',
        });
      }
    }
  }
  return findings;
}
