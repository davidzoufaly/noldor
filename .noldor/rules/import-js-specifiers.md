---
id: import-js-specifiers
applies-to: ["src/**/*.ts"]
stage: [code]
enforce: false
links: [tsconfig.json, docs/superpowers/plans/2026-05-26-noldor-package-lift.md]
---
The toolchain is ESM (ES2023, strict, run under tsx per tsconfig.json). Internal cross-module imports stay relative and carry an explicit `.js` specifier (e.g. `../utils/slugify.js`) — the on-disk file is `.ts`, but ESM resolution needs the emitted `.js` extension.
