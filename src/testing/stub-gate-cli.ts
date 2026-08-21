// @tests: noldor
// Direct-invocation entry for the stub gate, so `bin/noldor-stub-gate.mjs` can
// select a runtime and import one module rather than reaching in for `main`.

import { main } from './stub-gate.js';

process.exit(main(process.argv));
