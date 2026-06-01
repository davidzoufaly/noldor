---
id: ts-named-exports-only
applies-to: ["src/**/*.ts"]
stage: [code]
enforce: false
links: [.claude/engineering-rules.md]
---
Use named exports; `src/index.ts` is public API only and re-exports nothing internal that isn't part of the contract. A module's exported surface is its contract — named symbols keep that surface explicit and greppable, so prefer them over default exports.
