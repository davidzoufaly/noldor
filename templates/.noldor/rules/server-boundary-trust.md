---
id: server-boundary-trust
applies-to: ["**/actions/**/*.ts", "**/actions/**/*.tsx", "**/*.action.ts", "**/route.ts", "**/api/**/*.ts"]
stage: [code, review]
enforce: true
links: [.claude/engineering-rules.md]
---

A server action reads as a function call and *is* a public HTTP endpoint. Anyone can invoke it with
any payload, in any order, regardless of which component appears to call it and regardless of what
the client-side form allowed. So every server action and route handler authenticates and authorizes
first, then parses its input through a schema — never trusting an argument's declared TypeScript
type, which is erased and was never checked at the wire. The client-side check is a UX affordance;
this is the security boundary. Omitting it is the single most common real vulnerability in this
architecture.

The server/client split is also a serialization boundary: functions, classes, and class instances do
not cross it, and everything that does is paid for in payload on every request. A boundary drawn in
the wrong place is how a server-rendered app ends up shipping more bytes than the client-rendered
one it replaced — so what crosses is a deliberate decision, not whatever the props happened to
contain.

Caching defaults at this boundary have changed between framework major versions and will change
again. Do not reason from memory about whether a given fetch or route is cached — read the version's
own documentation, then verify against observed behaviour. An assumed cache is either a stale-data
bug or a thundering-herd bug, and which one you get is not predictable from the code.
