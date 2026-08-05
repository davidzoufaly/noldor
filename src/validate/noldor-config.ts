import { loadConfig } from '../core/config.js';
import { missingMandatoryReviewer } from '../core/lanes.js';

async function main() {
  try {
    const cfg = await loadConfig();
    if (cfg === null) {
      console.log('.noldor/config.json absent (OK — interactive mode only)');
      process.exit(0);
    }
    // Schema-valid but policy-invalid: a spec/plan lane set without `reviewer`.
    // Lane resolution self-heals it at run time (see withMandatoryReviewer), but
    // a config that reads as "no reviewer" while a reviewer always runs is a lie
    // about the review posture — refuse it here so it gets fixed on disk.
    const missing = missingMandatoryReviewer(cfg.crLanes);
    if (missing.length > 0) {
      console.error('.noldor/config.json INVALID:');
      console.error(
        `crLanes.${missing.join(' / crLanes.')} must include the "reviewer" lane — ` +
          'it is mandatory for spec and plan artifacts (no spec or plan ships unreviewed). ' +
          'Add "reviewer" to the array, or drop the key to inherit the reviewer-only default.',
      );
      process.exit(1);
    }
    console.log('.noldor/config.json valid');
    console.log(JSON.stringify(cfg, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('.noldor/config.json INVALID:');
    console.error((err as Error).message);
    process.exit(1);
  }
}

main();
