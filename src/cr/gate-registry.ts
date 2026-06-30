/**
 * Single source of truth mapping a gate-registry key (an FD's `introduces-gate`
 * frontmatter value) to the override trailer that the release gate already
 * honors. The bootstrap-immunity injector writes a trailer `checkCrGate`
 * (`src/release/release-cr-gate.ts`) and `validateTrailer`
 * (`src/hooks/noldor-validate-trailer.ts`) already read — it never invents a new
 * one. Sharing this constant between injector and the legitimacy detector keeps
 * the bootstrap reason string a single contract (a typo can't silently de-audit).
 */

export interface GateRegistryEntry {
  /** Commit trailer the gate reads to accept a commit (must match checkCrGate / validateTrailer). */
  readonly overrideTrailer: string;
  /** Audit ledger under `.noldor/` the injector appends a breadcrumb row to. */
  readonly log: string;
}

export const GATE_REGISTRY = {
  'codex-cr': { overrideTrailer: 'Noldor-CR-Override-Codex', log: 'cr-overrides.log' },
  'claude-cr': { overrideTrailer: 'Noldor-Path-Override', log: 'overrides.log' },
} as const satisfies Record<string, GateRegistryEntry>;

export type GateKey = keyof typeof GATE_REGISTRY;

/** The reason stamped on every bootstrap override; the detector matches its prefix. */
export const BOOTSTRAP_REASON =
  'bootstrap — feature added the gate that would block its own commits';

/** True when an override reason is a bootstrap reason (prefix match — the audit contract). */
export function isBootstrapReason(reason: string): boolean {
  return reason.trim().startsWith('bootstrap');
}

/** Resolve a registry key to its entry, or null when the key is unknown/unset. */
export function gateEntry(key: string | undefined): GateRegistryEntry | null {
  if (key === undefined) return null;
  return key in GATE_REGISTRY ? GATE_REGISTRY[key as GateKey] : null;
}
