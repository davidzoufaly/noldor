/**
 * One invariant violation. Plugins emit zero or more per run.
 */
export interface InvariantViolation {
  readonly file?: string;
  readonly line?: number;
  readonly message: string;
}

/**
 * Result of running one invariant plugin.
 */
export interface InvariantResult {
  readonly invariant: string;
  readonly violations: readonly InvariantViolation[];
  readonly durationMs: number;
}

/**
 * Plugin contract for one architecture invariant.
 *
 * @remarks
 * Plugins are pure: no `process.exit`, no `console.log`. The runner owns
 * exit code and output formatting. Empty `violations` array = pass.
 */
export interface Invariant {
  readonly name: string;
  readonly description: string;
  run(): Promise<InvariantResult>;
}
