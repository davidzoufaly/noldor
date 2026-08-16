---
id: error-result-types
applies-to: ["**/*.ts"]
stage: [code]
enforce: true
links: [docs/noldor/rules.md]
---

Expected failures return a result type (`{ success: true, data } | { success: false, errors }`
or an equivalent discriminated union) so callers confront both branches. `throw` is reserved
for programmer errors and invariant violations — a thrown error means "this should never
happen". Catch external throw sources (subprocess, network, file IO, `parse()`) once at the
boundary they enter and convert to the result type; interior code trusts typed results.
Never swallow errors: an empty `catch {}` is a bug — at minimum log and rethrow, ideally
surface as a result.
