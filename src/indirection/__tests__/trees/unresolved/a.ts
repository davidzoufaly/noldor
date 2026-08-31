// Relative and unresolvable — ours, therefore reported.
import { missing } from './does-not-exist.js';
// Bare and unresolvable — dependency-cruiser reports couldNotResolve here for
// healthy reasons (an uninstalled optional peer, an unresolvable types entry),
// so this one must NOT be reported.
import { alsoMissing } from 'no-such-package-anywhere';

export const a = (): unknown => [missing, alsoMissing];
