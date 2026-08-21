#!/usr/bin/env node
// Measures the runtime-selection verdict path in isolation: median of five warm
// runs. Deliberately a script rather than a test — inside the parallel suite the
// number reflects worker contention, not the code (measured 15ms standalone
// against 116ms under 17 workers).

import { selectRuntime } from './runtime-select.mjs';

const root = process.cwd();
selectRuntime(root, {}); // warm the fs cache
const runs = [];
for (let i = 0; i < 5; i += 1) {
  const start = performance.now();
  selectRuntime(root, {});
  runs.push(performance.now() - start);
}
runs.sort((a, b) => a - b);
const median = runs[2];
console.log(
  `runtime-select: median ${median.toFixed(1)}ms over 5 warm runs (${runs.map((r) => r.toFixed(1)).join(', ')})`,
);
process.exit(median <= 25 ? 0 : 1);
