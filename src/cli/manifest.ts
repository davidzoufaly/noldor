// Subcommand manifest for the `noldor` CLI. Each entry maps `<group> <subcmd>`
// → an `src/`-relative file path of the entrypoint script. The router (index.ts)
// loads the file via dynamic import after mutating process.argv to look like a
// direct invocation, so existing top-level entrypoint code runs unchanged. No
// per-entrypoint `main()` refactor is required.
//
// Groups with a single `''` subcommand are LEAF commands (init, doctor): they
// take flags directly after the group name (`noldor init --update`).

export interface SubCmd {
  readonly src: string;
  readonly desc: string;
}

export interface Group {
  readonly desc: string;
  readonly subs: Record<string, SubCmd>;
}

export const MANIFEST: Record<string, Group> = {
  autonomous: {
    desc: 'Autonomous runners (queue-drain / plan-runner)',
    subs: {
      run: {
        src: 'autonomous/queue-drain.ts',
        desc: 'Drain a source autonomously (--source roadmap|plans)',
      },
      'queue-drain': {
        src: 'autonomous/queue-drain.ts',
        desc: 'Fast-track roadmap drain (same entrypoint as `run`; defaults --source roadmap)',
      },
      watch: {
        src: 'autonomous/watch.ts',
        desc: 'Continuous drain daemon (--interval <min>, --once for cron, --detach for unattended, --max-features per cycle)',
      },
      inbox: {
        src: 'autonomous/inbox-cli.ts',
        desc: 'List open escalations (parked slugs) with evidence + suggested action',
      },
      unpark: {
        src: 'autonomous/unpark-cli.ts',
        desc: 'Resolve an escalation: unpark <slug> [--source <id>]',
      },
      status: {
        src: 'autonomous/status-cli.ts',
        desc: 'Runner liveness (lock pid + kill -0) plus shipped/skip/in-flight from drain-state (--json)',
      },
    },
  },
  prep: {
    desc: 'Parallel prep: fan out spec/plan drafts, then promote approved ones to FDs',
    subs: {
      fanout: {
        src: 'prep/prep-fanout.ts',
        desc: 'Draft spec [+plan] + self-answered open questions for every M+ roadmap entry, in parallel',
      },
      promote: {
        src: 'prep/prep-promote.ts',
        desc: 'Promote approved drafts to in-progress FDs (serial; --ship opens an auto-merged PR)',
      },
      format: {
        src: 'prep/print-format.ts',
        desc: 'Print the canonical spec|plan format contract',
      },
    },
  },
  research: {
    desc: 'Parallel read-only research agents (fanout + opt-in synthesis)',
    subs: {
      fanout: {
        src: 'research/fanout.ts',
        desc: 'Spawn one researcher per task (--tasks file / --task sugar); findings + INDEX.md (+ --synthesize)',
      },
    },
  },
  garden: {
    desc: 'Garden drift detection + SDD report + receipts',
    subs: {
      detect: { src: 'garden/garden-detect.ts', desc: 'Detect framework drift sentinels' },
      receipt: { src: 'garden/garden-receipt.ts', desc: 'Write a garden receipt' },
      'sdd-report': { src: 'garden/sdd-report.ts', desc: 'Produce the SDD report' },
      'demote-stale': {
        src: 'garden/backlog-demote.ts',
        desc: 'Auto-demote stale backlog entries to phase: later (--days N / --dry-run / --json)',
      },
    },
  },
  metrics: {
    desc: 'Effectiveness metrics derived from repo history',
    subs: {
      compute: {
        src: 'metrics/compute-cli.ts',
        desc: 'Derive all metrics → stdout table + metrics.json (--json <path>, --metric <id>)',
      },
    },
  },
  cr: {
    desc: 'Code-review orchestration (subagent / codex / standalone lanes)',
    subs: {
      orchestrate: { src: 'cr/orchestrate.ts', desc: 'Run CR lanes for an artifact' },
      aggregate: { src: 'cr/aggregate-cli.ts', desc: 'Aggregate lane sinks into a single verdict' },
      codex: { src: 'cr/codex.ts', desc: 'Codex CR pass' },
      escalate: { src: 'cr/escalate-cli.ts', desc: 'Escalate on cr-red / test-red' },
      bootstrap: {
        src: 'cr/bootstrap-cli.ts',
        desc: 'Stamp bootstrap override on a gate-introducing feature branch',
      },
    },
  },
  triage: {
    desc: 'Triage + score backlog entries',
    subs: {
      score: { src: 'triage/score.ts', desc: 'Score a backlog entry' },
      'list-untriaged': { src: 'triage/triage-list-untriaged.ts', desc: 'List untriaged ideas' },
      validate: { src: 'triage/validate-triage.ts', desc: 'Validate triage docs' },
    },
  },
  rules: {
    desc: 'Engineering rule store: resolve / list / validate',
    subs: {
      resolve: { src: 'rules/cli-resolve.ts', desc: 'Resolve rules for --file / --stage (JSON)' },
      list: { src: 'rules/cli-list.ts', desc: 'List all rules in the store' },
      validate: { src: 'rules/cli-validate.ts', desc: 'Validate the rule store' },
    },
  },
  features: {
    desc: 'Feature MD validators + migrations',
    subs: {
      validate: { src: 'features/validate-features.ts', desc: 'Validate all feature MDs' },
      'fill-links-code-gaps': {
        src: 'features/fill-links-code-gaps.ts',
        desc: 'Fill links.code gaps',
      },
      'migrate-features': {
        src: 'features/migrate-features.ts',
        desc: 'One-off features migration',
      },
      'migrate-code-tags': {
        src: 'features/migrate-code-tags.ts',
        desc: 'One-off: seed // @fd: tags from links.code',
      },
      'propose-pointers': {
        src: 'features/propose-pointers.ts',
        desc: 'Propose initial // @fd: pointers for a new FD',
      },
      'migrate-fd-commits-to-prs': {
        src: 'features/migrate-fd-commits-to-prs.ts',
        desc: 'Migrate FD commit refs to PR refs',
      },
      'migrate-link-rot': {
        src: 'features/migrate-link-rot.ts',
        desc: 'One-off: rewrite dead scripts/→src/ FD links, archive repoints, lost sentinels (--dry-run)',
      },
      'phase-flip-done': {
        src: 'features/phase-flip-done-cli.ts',
        desc: 'Flip an FD phase in-progress → done (gate Step 4)',
      },
      'phase-revert': {
        src: 'features/phase-revert-cli.ts',
        desc: 'Revert an FD phase done → in-progress (attach scaffold)',
      },
    },
  },
  roadmap: {
    desc: 'Roadmap/backlog block operations',
    subs: {
      'remove-block': {
        src: 'triage/remove-block-cli.ts',
        desc: 'Remove a schema-C block by slug (--backlog for docs/backlog.md; absent slug = no-op)',
      },
    },
  },
  milestones: {
    desc: 'Milestone validators',
    subs: {
      validate: { src: 'milestones/validate-milestones.ts', desc: 'Validate milestones' },
    },
  },
  sync: {
    desc: 'Sync links across docs/tests/FDs',
    subs: {
      'test-links': { src: 'sync/sync-test-links.ts', desc: 'Sync test links into FDs' },
      'doc-links': { src: 'sync/sync-doc-links.ts', desc: 'Sync doc links into FDs' },
      'code-links': { src: 'sync/sync-code-links.ts', desc: 'Sync code links into FDs' },
      'spec-links': { src: 'sync/sync-spec-links.ts', desc: 'Sync spec links into FDs' },
      'fd-resources': { src: 'sync/sync-fd-resources.ts', desc: 'Sync FD resource links' },
    },
  },
  validate: {
    desc: 'Validators (noldor config + skill catalog + scope)',
    subs: {
      noldor: { src: 'core/validate-noldor.ts', desc: 'Validate Noldor invariants' },
      'noldor-config': { src: 'validate/noldor-config.ts', desc: 'Validate .noldor/config.json' },
      'noldor-scope': { src: 'core/validate-noldor-scope.ts', desc: 'Validate commit scope' },
      'skill-catalog': { src: 'core/validate-skill-catalog.ts', desc: 'Validate skill catalog' },
      features: { src: 'features/validate-features.ts', desc: 'Validate feature MDs' },
      milestones: { src: 'milestones/validate-milestones.ts', desc: 'Validate milestones' },
      triage: { src: 'triage/validate-triage.ts', desc: 'Validate triage docs' },
      'feature-slug-scope': {
        src: 'checks/check-feature-slug-scope.ts',
        desc: 'Validate commit scope vs feature slugs',
      },
    },
  },
  release: {
    desc: 'Release pipeline',
    subs: {
      run: {
        src: 'release/index.ts',
        desc: 'Run pnpm release (--resume finishes an interrupted release)',
      },
      publish: {
        src: 'release/release-publish.ts',
        desc: 'Tarball pre-flight + registry wait: --verify-tarball (default) / --wait <version> / --local (emergency, no provenance, logged)',
      },
    },
  },
  hooks: {
    desc: 'Lefthook entrypoints (pre-commit / commit-msg / pre-push)',
    subs: {
      'pre-commit': { src: 'hooks/noldor-pre-commit.ts', desc: 'Pre-commit gate' },
      'inject-trailers': {
        src: 'hooks/noldor-inject-trailers.ts',
        desc: 'Inject FD/path trailers',
      },
      'validate-trailer': {
        src: 'hooks/noldor-validate-trailer.ts',
        desc: 'Validate commit trailers',
      },
      'enforce-review-receipt': {
        src: 'hooks/noldor-enforce-review-receipt.ts',
        desc: 'Enforce review receipt on pre-push',
      },
      'pre-push': { src: 'hooks/noldor-pre-push.ts', desc: 'Pre-push gate' },
      'pre-edit-guard': { src: 'hooks/noldor-pre-edit-guard.ts', desc: 'PreToolUse guard' },
    },
  },
  checks: {
    desc: 'Invariant + shared-file checks',
    subs: {
      invariants: { src: 'checks/check-invariants.ts', desc: 'Run all invariants' },
      'shared-files': {
        src: 'checks/check-shared-files.ts',
        desc: 'Block shared-file edits from worktrees',
      },
      'feature-slug-scope': {
        src: 'checks/check-feature-slug-scope.ts',
        desc: 'Validate commit scope vs feature slugs',
      },
      'template-sync': {
        src: 'checks/check-template-sync.ts',
        desc: 'Block templated files drifting from their templates/ copy',
      },
    },
  },
  graphify: {
    desc: 'Graphify runner + helpers',
    subs: {
      'graph-to-toon': { src: 'graphify/graph-to-toon.ts', desc: 'Render graph.json to TOON' },
      'enrich-docs': {
        src: 'graphify/enrich-doc-nodes.ts',
        desc: 'Add FD/plan/spec doc nodes + plan-of/spec-of edges to graph.json',
      },
    },
  },
  dashboard: {
    desc: 'Dev dashboard',
    subs: {
      server: { src: 'dashboard/server.ts', desc: 'Run dashboard dev server' },
      ensure: {
        src: 'dashboard/ensure.ts',
        desc: 'Start dashboard server if not already running (idempotent)',
      },
    },
  },
  docs: {
    desc: 'Docs builders + checks',
    subs: {
      api: { src: 'docs/docs-api.ts', desc: 'Generate API docs' },
      howto: { src: 'docs/docs-howto.ts', desc: 'Generate how-to docs' },
      check: { src: 'docs/docs-check.ts', desc: 'Validate doc links/tags' },
      transclude: { src: 'docs/docs-transclude.ts', desc: 'Transclude docs blocks' },
    },
  },
  worktrees: {
    desc: 'Worktree create + status + launch',
    subs: {
      create: {
        src: 'worktrees/create-worktree.ts',
        desc: 'Create .worktrees/<slug> on feat/<slug> (--branch overrides), install deps, stamp port',
      },
      status: { src: 'worktrees/worktree-status.ts', desc: 'Per-tree status table' },
      conflicts: {
        src: 'worktrees/worktree-conflicts.ts',
        desc: 'Pre-flight conflict scan across worktrees (direct + graphify-community)',
      },
      launch: { src: 'worktrees/launch-worktrees.ts', desc: 'Spawn iTerm2 worktree windows' },
      up: {
        src: 'worktrees/up-worktree.ts',
        desc: 'Bootstrap full dev surface: create + IDE + terminal + dev servers',
      },
      down: {
        src: 'worktrees/down-worktree.ts',
        desc: 'Reap dev servers for a tree (--remove also deletes the worktree)',
      },
    },
  },
  verify: {
    desc: 'Acceptance verification (smoke floor)',
    subs: {
      smoke: {
        src: 'verify/smoke-cli.ts',
        desc: 'Doctor + boot every consumer.verifyCommands surface + HTTP-200/exit-0 probe',
      },
    },
  },
  invariants: {
    desc: 'Same as `checks invariants`; alias kept for the spec cheatsheet.',
    subs: {
      run: { src: 'checks/check-invariants.ts', desc: 'Run all invariants' },
    },
  },
  noldor: {
    desc: 'Noldor utilities (changelog, session marker, etc.)',
    subs: {
      changelog: { src: 'core/changelog.ts', desc: 'Generate changelog' },
      'bump-session-marker': {
        src: 'core/bump-session-marker.ts',
        desc: 'Bump session markerVersion',
      },
      'set-autonomous': { src: 'core/set-autonomous.ts', desc: 'Mark session autonomous' },
      'lint-plan-snippets': {
        src: 'core/lint-plan-snippets.ts',
        desc: 'Lint code snippets in plans',
      },
      'split-check': {
        src: 'core/split-check-cli.ts',
        desc: 'Suggest a split when an entry/FD/plan exceeds size thresholds',
      },
      'rename-plan-only-tier': {
        src: 'core/rename-plan-only-tier.ts',
        desc: 'Rename plan-only tier docs',
      },
    },
  },
  'next-priority': {
    desc: 'Next-priority pickup',
    subs: {
      '': { src: 'core/next-priority.ts', desc: 'Print top priority' },
    },
  },
  'pr-flow': {
    desc: 'PR flow (push + create + auto-merge + poll)',
    subs: {
      '': { src: 'core/pr-flow-cli.ts', desc: 'Run pr-flow' },
    },
  },
  changelog: {
    desc: 'Generate changelog (hoisted)',
    subs: {
      '': { src: 'core/changelog.ts', desc: 'Generate changelog' },
    },
  },
  init: {
    desc: 'Scaffold framework files into the consumer repo',
    subs: {
      '': { src: 'cli/commands/init.ts', desc: 'Run init (--update / --adopt / --agents flags)' },
    },
  },
  doctor: {
    desc: 'Diff consumer files against pkg templates (non-zero exit on drift)',
    subs: {
      '': {
        src: 'cli/commands/doctor.ts',
        desc: 'Run drift check + configured-runner presence/version check',
      },
    },
  },
  upgrade: {
    desc: 'Run version-aware migration chain (anchored → installed framework version)',
    subs: {
      '': {
        src: 'cli/commands/upgrade.ts',
        desc: 'Run upgrade (--dry-run / --from <version> / --force)',
      },
    },
  },
};
