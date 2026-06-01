---
id: import-js-specifiers
applies-to: ["src/**/*.ts"]
stage: [code]
enforce: false
links: [.claude/engineering-rules.md]
---
The toolchain is ESM (ES2023, strict, run under tsx). Internal cross-module imports stay relative and carry an explicit `.js` specifier (e.g. `../utils/slugify.js`) — the on-disk file is `.ts`, but ESM resolution needs the emitted `.js` extension.
