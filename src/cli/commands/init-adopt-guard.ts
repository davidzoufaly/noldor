import { isBinaryChannel } from '../../binary/asset-root.js';

/**
 * `init --adopt` writes consumer snapshots INTO the package templates root.
 * On the binary channel that root is the shared version-keyed cache — a
 * write there would leak one repo's snapshot into every repo on the machine
 * (spec Unit 2 write-refusal guard).
 */
export function assertAdoptAllowed(): void {
  if (isBinaryChannel()) {
    throw new Error(
      "adopt requires the npm channel — the binary's template root is a shared read-only cache",
    );
  }
}
