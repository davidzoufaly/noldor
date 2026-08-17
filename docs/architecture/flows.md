# Flows

Two flows carry the weight. The gate flow is how a change reaches `main`; the
release flow is how `main` reaches a version. Everything else in the framework
exists to serve one of them.

## The gate flow

An operator or agent picks work, the gate scaffolds artifacts, review runs at
each artifact stage, and the pull request merges only once the review receipt on
the commit tree is valid. The receipt is bound to `HEAD^{tree}`, so any later
edit invalidates it — that is what stops a reviewed change from being quietly
amended before it lands.

```mermaid
sequenceDiagram
  actor Operator
  participant Gate as noldor gate
  participant CR as cr orchestrate
  participant Hooks as git hooks
  participant GH as gh

  Operator->>Gate: pick a roadmap entry
  Gate->>Gate: create worktree, write session marker
  Gate->>Gate: promote entry to a feature doc
  Operator->>Gate: spec dialogue
  Gate->>Hooks: commit the spec
  Hooks-->>Gate: scope + trailer checks pass
  Gate->>CR: review the spec
  CR-->>Gate: findings
  Operator->>Gate: address, or accept at the round cap
  Gate->>Gate: implement against the spec
  Gate->>CR: review the code diff
  CR-->>Gate: green, receipt stamped on the tip commit
  Gate->>Hooks: push
  Hooks-->>Gate: receipt, commit body, templates, clones pass
  Gate->>GH: open pull request, merge
  GH-->>Operator: merged
```

## The release flow

A release runs a preflight of independent probes before anything is published.
Each probe reports its own row rather than throwing, so one run names every
problem instead of stopping at the first.

```mermaid
sequenceDiagram
  actor Operator
  participant Release as noldor release
  participant Probes as preflight probes
  participant Repo as repository state
  participant NPM as npm registry

  Operator->>Release: release
  Release->>Probes: run every row
  Probes->>Repo: session marker, tree, origin sync
  Probes->>Repo: graph freshness, garden receipt, sdd report
  Probes->>Repo: features, gate compliance, architecture
  Probes->>Repo: review receipts since the last tag
  Probes-->>Release: ok · skipped · blocking, per row
  alt any blocking row
    Release-->>Operator: abort, naming every failure and its fix
  else all rows pass
    Release->>Repo: version bump, changelog, release notes
    Release->>NPM: publish
    Release-->>Operator: released
  end
```
