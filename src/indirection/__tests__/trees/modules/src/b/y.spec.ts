// @tests: architecture-design-phase
// Fixture, not a real test: a spec file the cruise must exclude, so its import
// never becomes a `src/b -> src/c` pair. The tag is required because the
// test-tag gate matches on the filename pattern, which this file must keep.
import { w } from '../c/w.js';

export const probe = w;
