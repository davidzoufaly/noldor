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
happen". Catch external throw sources (subprocess, network, file IO, schema-parse of
untrusted input) once at the boundary they enter and convert to the result type; interior
code trusts typed results — a `parse()` that fails on already-validated internal data is a
programmer error and may throw.
Never swallow errors: an empty `catch {}` is a bug — at minimum log and rethrow, ideally
surface as a result. (`eslint/no-empty` covers the machine half; this rule is the semantic half.)
A rethrow chains its origin: `throw new Error(msg, { cause: err })`. Dropping `cause` discards the
only stack that pointed at the real failure, which turns a one-line diagnosis into a bisect — so a
converted external throw carries the original as `cause`, and a result-type `errors` payload keeps
whatever the boundary actually reported rather than a re-worded summary of it.
