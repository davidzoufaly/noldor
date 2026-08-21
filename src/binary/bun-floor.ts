/**
 * Minimum Bun version for `pnpm build:binary` and the release matrix — the
 * exact version the Unit-0 spike verified (compile, embed, spawn, PTY).
 * Build script and CI both pin to this single constant (spec Unit 0/4/5).
 */
export const BUN_FLOOR = '1.1.34';
