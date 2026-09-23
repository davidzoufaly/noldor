# Self-Refreshing, Compact Knowledge Graph Implementation Plan — Part 3: the refresh workflow

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Regenerating the committed graph stops being a human's job and stops appearing in a feature PR's diff. A merged `feat`/`fix`/`refactor` PR rebuilds `graphify-out/` on CI and lands it through a graph PR of its own.

**Architecture:** A new scaffold-only template, `templates/.github/workflows/update-knowledge-graph.yml`, picked up by `templateFiles()`'s directory walk with no registry edit. It opens a PR rather than pushing to the default branch, because noldor's pre-push hook refuses a direct push to the default ref and honours no CI escape ([ADR 0002](../../adr/0002-shipped-ci-templates-route-through-pr.md)). The workflow is **two jobs**: `build` runs the merged tree's own code with read-only permissions and no credentials on disk, and `publish` holds the write token but installs no dependencies — so lefthook is never installed there rather than installed and bypassed. noldor installs the same file into its own `.github/workflows/`, kept byte-identical by a test, so the shipped template is the one actually exercised.

**Tech Stack:** GitHub Actions, `graphifyy==0.7.8`, TypeScript (ESM, Node >= 24), vitest, `yaml`.

---

## File Structure

- `templates/.github/workflows/update-knowledge-graph.yml` — **Create.** The consumer-facing workflow: qualifying-merge trigger, job-level concurrency, pinned graphify, regenerate, verify, artifact hand-off, create-or-reuse PR, auto-merge.
- `.github/workflows/update-knowledge-graph.yml` — **Create.** noldor's own byte-identical copy.
- `src/templates/manifest.ts` — **Modify.** Adds the workflow to `SCAFFOLD_ONLY_TEMPLATES`.
- `src/templates/__tests__/templates.test.ts` — **Modify.** A `describe` block for the workflow: manifest membership, scaffold-only, driver-neutral, the trigger, per-job permissions, the absence of every bypass, the CLI call, token isolation, the pin, the fixed branch, the staging rule, and byte-identity with the self-host copy.
- `docs/features/self-refreshing-compact-knowledge-graph.md` — **Modify.** `links.code` / `links.tests`, Summary, Diagram.

**Counts in this plan are measured, not computed.** `src/templates/__tests__/templates.test.ts` holds 21 tests before this part; Task 1 adds 12 and Task 2 adds 1.

---

## Task 1: The workflow template

**Files:**

- Create: `templates/.github/workflows/update-knowledge-graph.yml`
- Modify: `src/templates/manifest.ts`
- Test: `src/templates/__tests__/templates.test.ts`

This is the first `.github` file noldor has ever shipped — a deliberate posture change, and the reason the acceptance criteria spend four entries on what the workflow must not do.

- [ ] **Step 1: Write the failing tests.**

  Add `import { parse as parseYaml } from 'yaml';` to `src/templates/__tests__/templates.test.ts` — as the **last** import, after the relative ones, which is where oxfmt wants it — then append:

  ```ts
  interface WfStep {
    readonly uses?: string;
    readonly run?: string;
    readonly env?: Record<string, string>;
    readonly with?: Record<string, unknown>;
  }
  interface WfJob {
    readonly if: string;
    readonly concurrency: unknown;
    readonly permissions: Record<string, string>;
    readonly steps: WfStep[];
  }

  describe('.github/workflows/update-knowledge-graph.yml template (graph refresh)', () => {
    const rel = '.github/workflows/update-knowledge-graph.yml';
    const raw = (): string => readFileSync(join(TEMPLATES_ROOT, rel), 'utf8');

    /**
     * The workflow with comment lines stripped. Every `not.toContain` below is an
     * assertion about what the file *does*, and the file explains each of those
     * absences in a comment — grepping the raw text makes the explanation fail the
     * test it explains. Both YAML `#` comments and shell `#` comments inside `run:`
     * blocks start their line, so one filter covers both.
     */
    const runnable = (): string =>
      raw()
        .split('\n')
        .filter((l) => !/^\s*#/.test(l))
        .join('\n');

    const workflow = (): { permissions: unknown; jobs: Record<string, WfJob>; on?: unknown } =>
      parseYaml(raw()) as { permissions: unknown; jobs: Record<string, WfJob>; on?: unknown };

    it('ships in the template manifest', () => {
      expect(templateFiles()).toContain(rel);
    });

    it('is scaffold-only (runner labels and the pin are the consumer own)', () => {
      expect(SCAFFOLD_ONLY_TEMPLATES.has(rel)).toBe(true);
    });

    it('is driver-neutral — every agent target gets it', () => {
      expect(filterTemplatesByAgents([rel], ['claude'])).toEqual([rel]);
      expect(filterTemplatesByAgents([rel], ['codex'])).toEqual([rel]);
    });

    it('parses, and triggers only on a merged PR with a code-change title', () => {
      const wf = workflow() as Record<string, unknown>;
      // `on` is the YAML 1.1 boolean `true`, which is why this reads both keys.
      const on = (wf.on ?? wf[true as unknown as string]) as {
        pull_request: { types: string[]; branches?: string[] };
      };
      expect(on.pull_request.types).toEqual(['closed']);
      // No hardcoded branch name: `branches:` takes no expression, so the
      // default-branch check lives in the job's `if` instead.
      expect(on.pull_request.branches).toBeUndefined();

      const build = (wf.jobs as Record<string, WfJob>).build;
      expect(build.if).toContain('github.event.pull_request.merged == true');
      expect(build.if).toContain('github.event.repository.default_branch');
      for (const prefix of ['feat', 'fix', 'refactor']) {
        expect(build.if).toContain(`'${prefix}'`);
      }
      // Job level, not workflow level — see the comment in the file.
      expect(build.concurrency).toEqual({ group: 'knowledge-graph', 'cancel-in-progress': true });
      expect(wf.concurrency).toBeUndefined();
    });

    it('grants each job only the permissions it needs', () => {
      const wf = workflow();
      expect(wf.permissions).toEqual({});
      expect(wf.jobs.build.permissions).toEqual({ contents: 'read' });
      expect(wf.jobs.publish.permissions).toEqual({
        contents: 'write',
        'pull-requests': 'write',
      });
    });

    it('never reaches the default branch except through a PR', () => {
      const text = runnable();
      expect(text).not.toContain('--no-verify');
      expect(text).not.toContain('LEFTHOOK=0');
      expect(text).not.toContain('refs/heads/main');
      expect(text).not.toMatch(/HEAD:main\b/);
      expect(text).toContain('gh pr create');
    });

    it('calls the framework CLI, not noldor-only package scripts', () => {
      // Those scripts exist only in noldor's own package.json — a consumer would
      // fail on a missing script.
      const text = runnable();
      expect(text).not.toMatch(/pnpm\s+toon\b/);
      expect(text).not.toMatch(/pnpm\s+graphify:/);
      expect(text).toContain('pnpm noldor graphify graph-to-toon');
    });

    it('runs no repository code while the write token is in scope', () => {
      const { jobs } = workflow();
      const holdsToken = (j: WfJob): WfStep[] =>
        j.steps.filter((s) => JSON.stringify(s.env ?? {}).includes('GITHUB_TOKEN'));

      // The token exists in exactly one job.
      expect(holdsToken(jobs.build)).toHaveLength(0);
      expect(holdsToken(jobs.publish).length).toBeGreaterThan(0);

      // That job installs nothing, so lefthook is never installed in it — the
      // hooks are absent rather than bypassed, which is why no step needs
      // --no-verify or LEFTHOOK=0.
      for (const s of jobs.publish.steps) {
        expect(s.run ?? '').not.toMatch(/pnpm install|npm ci|yarn install/);
        expect(s.uses ?? '').not.toContain('pnpm/action-setup');
      }

      // The job that DOES run merged-tree code keeps no credentials on disk.
      const checkout = jobs.build.steps.find((s) => (s.uses ?? '').startsWith('actions/checkout'));
      expect(checkout?.with?.['persist-credentials']).toBe(false);
    });

    it('pins graphify and titles its own PR with a prefix the filter skips', () => {
      const text = runnable();
      expect(text).toContain('graphifyy==0.7.8');
      expect(text).toContain('chore(graph):');
      expect(text).not.toMatch(/--title "(feat|fix|refactor)/);
    });

    it('checks out an explicit sha and force-updates one fixed bot branch', () => {
      const text = runnable();
      expect(text).toContain('github.event.pull_request.merge_commit_sha');
      expect(text).toContain('GRAPH_BRANCH: noldor/graph-refresh');
      expect(text).toContain('git checkout -B "$GRAPH_BRANCH"');
      expect(text).toContain('git push --force origin "HEAD:$GRAPH_BRANCH"');
    });

    it('stages the directory so each repo own ignore rules decide', () => {
      // Naming files breaks any consumer tracking a different subset: charuy
      // ignores everything under graphify-out/ but graph.json and GRAPH_REPORT.md.
      const text = runnable();
      expect(text).toContain('git add graphify-out/');
      expect(text).not.toContain('git add --force');
    });

    it('is excluded from the template-sync drift set', () => {
      // `check-template-sync` and `doctor` both filter on this set — membership is
      // what makes a consumer's edited runner labels not read as drift.
      expect(templateFiles().filter((f) => !SCAFFOLD_ONLY_TEMPLATES.has(f))).not.toContain(rel);
    });
  });
  ```

- [ ] **Step 2: Run the tests and verify they FAIL.**

  ```bash
  pnpm vitest run src/templates/__tests__/templates.test.ts
  ```

  Expected output: `Tests  10 failed | 23 passed (33)`. Ten, not twelve: `is driver-neutral` passes because `filterTemplatesByAgents` returns any non-`.claude/`/`.opencode/` path unchanged, and `is excluded from the template-sync drift set` passes because it is a `not.toContain` against a list that does not hold the file yet. Of the ten, `is scaffold-only` fails on an assertion and the rest on `ENOENT` reading the template.

- [ ] **Step 3: Write the workflow.**

  Create `templates/.github/workflows/update-knowledge-graph.yml`:

  ```yaml
  # Regenerates the committed knowledge graph after a code-change merge and lands
  # it through a pull request.
  #
  # It never pushes to the default branch. noldor's pre-push hook refuses a direct
  # push to the default ref and honours no CI escape hatch, so pushing straight
  # would mean shipping a hook-bypass flag to every consumer — teaching them to
  # skip the gate the framework exists to enforce. See
  # docs/adr/0002-shipped-ci-templates-route-through-pr.md.
  #
  # Two jobs, and the split is the point. `build` runs code from the merged tree
  # and holds no credentials. `publish` holds the write token and installs no
  # dependencies — so lefthook is never installed there, rather than installed and
  # then bypassed, and nothing the merged PR controls runs while the token is in
  # scope. Handing both halves to one job is what `persist-credentials: false`
  # alone does not fix: `git commit` and `git push` run hooks, and hooks are
  # merged-tree code.
  #
  # Yours to edit after `noldor init` writes it: runner labels, the Python and
  # Node versions, and the graphifyy pin. Two repository settings this file cannot
  # set for you — enable auto-merge in repository settings, and note that a PR
  # opened with the default GITHUB_TOKEN does not trigger other workflows, so
  # required checks on the graph PR need a PAT or an app token.
  name: update-knowledge-graph

  # No `branches:` filter — it takes no expression, so hardcoding a branch name
  # would silently never fire in a consumer whose default branch is named
  # something else. The base-ref check lives in the job's `if`, where an
  # expression is legal.
  on:
    pull_request:
      types: [closed]

  permissions: {}

  env:
    GRAPH_BRANCH: noldor/graph-refresh

  jobs:
    build:
      # Runs the merged tree's own code. Read-only, and no token on disk.
      permissions:
        contents: read
      # Concurrency is declared on the JOB, not the workflow. At workflow level
      # every merged PR joins the group, so a docs merge — whose job the title
      # filter skips — would cancel a qualifying run that is still working and
      # then do nothing itself. A skipped job never enters the group.
      concurrency:
        group: knowledge-graph
        cancel-in-progress: true
      if: >-
        github.event.pull_request.merged == true &&
        github.event.pull_request.base.ref == github.event.repository.default_branch &&
        (startsWith(github.event.pull_request.title, 'feat') ||
        startsWith(github.event.pull_request.title, 'fix') ||
        startsWith(github.event.pull_request.title, 'refactor'))
      runs-on: ubuntu-latest
      steps:
        - name: Check out the merged tree by explicit sha
          uses: actions/checkout@v4
          with:
            # By sha, not by branch name: the run's output then always matches the
            # tree the run read. The default branch may still move before the
            # graph PR merges — the next qualifying merge corrects that, the same
            # way the title filter is self-healing.
            ref: ${{ github.event.pull_request.merge_commit_sha }}
            fetch-depth: 0
            persist-credentials: false

        - uses: actions/setup-python@v5
          with:
            python-version: '3.13'

        - name: Install graphify
          # Pinned: an unpinned install makes the extraction a function of the run
          # date. The pin binds the top-level package only — tree-sitter grammars
          # and the Python version above can still move.
          run: pip install graphifyy==0.7.8 -q

        - uses: pnpm/action-setup@v4
        - uses: actions/setup-node@v4
          with:
            node-version: 24
            cache: pnpm
        - run: pnpm install --frozen-lockfile

        - name: Regenerate the graph
          run: |
            set -euo pipefail
            # --force: a `refactor` merge legitimately deletes code, and without it
            # the rebuild refuses to shrink the graph — which would leave exactly
            # the staleness this workflow exists to remove. The verify step below
            # is what catches a genuinely broken extraction.
            graphify update . --force
            # `pnpm noldor` resolves the framework's own bin in a consumer and its
            # package script in noldor itself. A repo-local alias would not: `toon`
            # and `graphify:enrich-docs` exist only in noldor's package.json.
            pnpm noldor graphify enrich-docs graphify-out/graph.json
            pnpm noldor graphify graph-to-toon graphify-out/graph.json

        - name: Verify the outputs
          run: |
            set -euo pipefail
            for f in graph.json graph.brainstorm.toon graph.brainstorm-summary.toon; do
              test -s "graphify-out/$f" || {
                echo "::error::missing or empty graphify-out/$f"
                exit 1
              }
            done
            node -e "JSON.parse(require('node:fs').readFileSync('graphify-out/graph.json','utf8'))"
            head -2 graphify-out/graph.brainstorm.toon
            wc -c graphify-out/graph.brainstorm.toon

        - uses: actions/upload-artifact@v4
          with:
            name: graphify-out
            path: |
              graphify-out/
              !graphify-out/cache/
            retention-days: 1

    publish:
      needs: build
      # The only job that holds the write token — and it installs nothing, so no
      # code from the merged tree runs here and no git hook is ever installed.
      permissions:
        contents: write
        pull-requests: write
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
          with:
            ref: ${{ github.event.pull_request.merge_commit_sha }}
            fetch-depth: 0

        - uses: actions/download-artifact@v4
          with:
            name: graphify-out
            path: graphify-out/

        - name: Open or update the graph pull request
          env:
            GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
            PR_NUMBER: ${{ github.event.pull_request.number }}
            DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}
          run: |
            set -euo pipefail
            git config user.name "noldor-graph-bot"
            git config user.email "noldor-graph-bot@users.noreply.github.com"

            # One fixed branch, force-updated in place, so an unmerged queue is
            # bounded at one PR rather than growing per merge.
            git checkout -B "$GRAPH_BRANCH"

            # The directory, and no --force: each repo's own ignore rules then
            # decide what is staged. Naming files instead would break any consumer
            # that tracks a different subset — charuy ignores everything under
            # graphify-out/ except graph.json and GRAPH_REPORT.md, so a named
            # manifest.json would abort the step.
            git add graphify-out/
            if git diff --cached --quiet; then
              echo "graph unchanged — nothing to open"
              exit 0
            fi

            # The title prefix must be one the trigger filter SKIPS. Under a PAT or
            # app token, merging this PR does trigger workflows — a feat-titled
            # graph PR would re-trigger this one, which would open another, forever.
            # The override trailer is the established escape for a machine-written
            # commit that carries no FD and no review receipt; override-audit.ts
            # counts it into the SDD report, so it stays visible rather than silent.
            {
              echo "chore(graph): refresh the committed knowledge graph"
              echo
              echo "Regenerated by the update-knowledge-graph workflow after PR #${PR_NUMBER}."
              echo
              echo "Noldor-Path-Override: ci-graph-refresh machine-written graph regeneration"
            } > ../graph-commit-msg.txt
            git commit -F ../graph-commit-msg.txt

            git push --force origin "HEAD:$GRAPH_BRANCH"

            # Create-or-reuse, not create: `gh pr create` fails outright when one is
            # already open, and a previously auto-merged PR leaves none. Both happen.
            OPEN=$(gh pr list --head "$GRAPH_BRANCH" --state open --json number --jq '.[0].number // empty')
            if [ -z "$OPEN" ]; then
              gh pr create \
                --head "$GRAPH_BRANCH" \
                --base "$DEFAULT_BRANCH" \
                --title "chore(graph): refresh the committed knowledge graph" \
                --body "Regenerated after #${PR_NUMBER}. Merges itself where auto-merge is enabled; where it is not, this PR is waiting for you — it is not review work."
            fi

            # Where auto-merge is off (charuy today) this is the documented stop:
            # the PR stays open for a human. It must never fall back to a push.
            gh pr merge --auto --squash "$GRAPH_BRANCH" ||
              echo "::warning::auto-merge unavailable — the graph PR is open and waiting for a human"
  ```

- [ ] **Step 4: Register it as scaffold-only.**

  In `src/templates/manifest.ts`, add to `SCAFFOLD_ONLY_TEMPLATES`, immediately before the `docs/architecture/context.md` entry:

  ```ts
    // Graph-refresh workflow starter: runner labels, the Python and Node versions
    // and the graphifyy pin are all properties of the CONSUMER's CI, so noldor
    // writes it once and the consumer owns it afterwards. Also keeps `init
    // --adopt` from snapshotting a consumer's own .github/workflows/ back into the
    // template directory.
    '.github/workflows/update-knowledge-graph.yml',
  ```

- [ ] **Step 5: Run the tests and verify they PASS.**

  ```bash
  pnpm vitest run src/templates/__tests__/templates.test.ts
  ```

  Expected output: `Tests  33 passed (33)`.

- [ ] **Step 6: Commit.**

  ```bash
  cat > /tmp/msg-part3-task1.txt <<'EOF'
  feat(templates): ship a knowledge-graph refresh workflow

  Why — The committed graph is stale because refreshing it is expensive in the one
  place nobody wants the cost: a feature PR's diff. Regenerating rewrites graph.json
  and both toon files, all tracked, so the rational move for any individual PR is to
  skip it — and every PR making that rational choice is why the graph drifts.

  How — A scaffold-only workflow template, picked up by templateFiles()'s directory
  walk with no registry edit, that regenerates on a merged feat/fix/refactor PR and
  lands the result through a PR of its own on one fixed branch. Two jobs: build runs
  the merged tree's code read-only with no credentials on disk, publish holds the
  write token and installs nothing, so lefthook is never installed there rather than
  installed and bypassed. It opens a PR rather than pushing to the default branch
  because the pre-push hook refuses that and honours no CI escape.

  What — One new template file, one SCAFFOLD_ONLY_TEMPLATES entry, and twelve tests
  covering the trigger, the per-job permissions, token isolation, the staging rule,
  the absence of every bypass, and the pin.

  Noldor-FD: self-refreshing-compact-knowledge-graph
  EOF
  git add templates/.github/workflows/update-knowledge-graph.yml src/templates/manifest.ts src/templates/__tests__/templates.test.ts
  git commit -F /tmp/msg-part3-task1.txt
  ```

---

## Task 2: noldor adopts its own workflow

**Files:**

- Create: `.github/workflows/update-knowledge-graph.yml`
- Test: `src/templates/__tests__/templates.test.ts`

noldor's own graph is the stale one the spec's Problem section is about. Shipping only the template would leave the motivating defect in place and the workflow would ship having never run once. The byte-identity test is the same guard `.oxlintrc.json` already uses for its self-host copy.

- [ ] **Step 1: Write the failing test.**

  Append inside the workflow `describe` added in Task 1, immediately before `is excluded from the template-sync drift set`:

  ```ts
    it('is byte-identical to the self-host copy noldor own CI runs', () => {
      expect(readFileSync(join(TEMPLATES_ROOT, '..', rel), 'utf8')).toBe(raw());
    });
  ```

- [ ] **Step 2: Run the test and verify it FAILS.**

  ```bash
  pnpm vitest run src/templates/__tests__/templates.test.ts
  ```

  Expected output: `Tests  1 failed | 33 passed (34)`, the failure an `ENOENT` on `.github/workflows/update-knowledge-graph.yml`.

- [ ] **Step 3: Install the workflow into noldor.**

  ```bash
  mkdir -p .github/workflows
  cp templates/.github/workflows/update-knowledge-graph.yml .github/workflows/update-knowledge-graph.yml
  ```

- [ ] **Step 4: Run the test and verify it PASSES.**

  ```bash
  pnpm vitest run src/templates/__tests__/templates.test.ts
  ```

  Expected output: `Tests  34 passed (34)`.

- [ ] **Step 5: Dry-run the regeneration chain locally.**

  The `build` job's three regeneration commands are the only part CI cannot be asked about in advance. Run exactly what the workflow runs — not the `pnpm toon` alias, which is what the workflow deliberately does not call:

  ```bash
  graphify update . --force
  pnpm noldor graphify enrich-docs graphify-out/graph.json
  pnpm noldor graphify graph-to-toon graphify-out/graph.json
  test -s graphify-out/graph.json && head -2 graphify-out/graph.brainstorm.toon
  ```

  Expected output: each command exits 0 and the toon header reads `# Domain Knowledge Graph (v3 — compact)` then `# version: 3`. If any command errors, fix it in **both** copies of the workflow — the byte-identity test catches a one-sided edit.

- [ ] **Step 6: Discard the regenerated graph.**

  ```bash
  git checkout -- graphify-out/
  git status --short graphify-out/
  ```

  Expected output: no lines. The first regeneration that lands is the workflow's own, which is the feature proving itself.

- [ ] **Step 7: Run the whole suite.**

  ```bash
  pnpm verify
  ```

  Expected output: lint, typecheck and the full vitest run green — **except** on a machine whose locale is not English, where `sortEntries > defaults to name-asc when sort mode is empty` and `sortEntries > falls back to name-asc for unknown sort key` fail. That pair is red on `main` already (`ideas.md` records it: a bare `localeCompare` reads the machine locale, and Czech collates `ch` after `h`). Confirm they are the known pair rather than yours with `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pnpm vitest run src/dashboard/__tests__/dashboard-views.test.ts`, which passes 129/129. Any other failure is yours.

- [ ] **Step 8: Commit.**

  ```bash
  cat > /tmp/msg-part3-task2.txt <<'EOF'
  feat(repo): run the graph-refresh workflow on noldor itself

  noldor's own graph is the stale one the spec's Problem section is about, and a
  workflow that ships having never run is a workflow nobody has evidence for. The
  copy is byte-identical to the template and a test keeps it that way, the same
  guard .oxlintrc.json already uses — so the file consumers receive is the file
  noldor's own CI exercises on every qualifying merge.

  graphify-out/ is deliberately not regenerated by hand here. The first refresh is
  the workflow's, after this merges.

  Noldor-FD: self-refreshing-compact-knowledge-graph
  EOF
  git add .github/workflows/update-knowledge-graph.yml src/templates/__tests__/templates.test.ts
  git commit -F /tmp/msg-part3-task2.txt
  ```

---

## Task 3: Close the feature doc

**Files:**

- Modify: `docs/features/self-refreshing-compact-knowledge-graph.md`

- [ ] **Step 1: Sync the code and test links.**

  ```bash
  pnpm noldor sync code-links --fd self-refreshing-compact-knowledge-graph
  pnpm noldor sync test-links --fd self-refreshing-compact-knowledge-graph
  git diff --name-only
  ```

  Expected output: `links.code` holds `src/graphify/graph-to-toon.ts`, `src/templates/manifest.ts` and both workflow copies; `links.tests` holds `src/graphify/__tests__/graph-to-toon.test.ts` and `src/templates/__tests__/templates.test.ts`. Both syncs rewrite unrelated feature docs — revert every file in the diff except this feature's own.

- [ ] **Step 2: Write the Summary section.**

  Replace the `<!-- TODO 1-3 sentences. -->` stub under `## Summary` with:

  ```markdown
  The committed knowledge graph refreshes itself: a merged `feat`, `fix` or
  `refactor` PR rebuilds `graphify-out/` on CI and lands it through a graph PR of
  its own, so no feature PR carries the diff. The emitted `.toon` is v3 — roughly
  60% smaller, addressed by community-local index, and fronted by a table of
  contents an agent can `Read offset/limit` against.
  ```

- [ ] **Step 3: Write the Diagram section.**

  Replace the `## Diagram` TODO comment with a `mermaid` fence holding:

  ```
  flowchart LR
    M[merged PR<br/>feat / fix / refactor] --> B[build job<br/>read-only, no token]
    B --> G[graphify update --force<br/>enrich-docs · graph-to-toon]
    G --> A[(artifact<br/>graphify-out)]
    A --> P[publish job<br/>token, no deps installed]
    P --> R[(branch<br/>noldor/graph-refresh)]
    R --> Q[chore graph PR<br/>auto-merged where enabled]
    Q --> D[(default branch<br/>graphify-out/)]
    D -.read offset/limit via toc.-> Z[agent]
  ```

  followed by a sentence for readers who do not render mermaid: no job pushes to
  the default branch, and the only write to it is the merge of the graph PR.

- [ ] **Step 4: Format and verify.**

  ```bash
  pnpm fmt
  pnpm verify
  ```

  Expected output: `pnpm fmt` reports the formatted file count, and `pnpm verify` is green but for the known `sortEntries` locale pair from Task 2 Step 7. Re-read the feature doc after `pnpm fmt` — oxfmt reformats fenced code inside markdown.

- [ ] **Step 5: Commit.**

  ```bash
  cat > /tmp/msg-part3-task3.txt <<'EOF'
  docs(features:self-refreshing-compact-knowledge-graph): close the feature doc

  Fills Summary and Diagram, and points links.code / links.tests at what shipped
  across the three parts: the v3 renderer, the workflow template, and noldor's own
  copy of it.

  Noldor-FD: self-refreshing-compact-knowledge-graph
  EOF
  git add docs/features/self-refreshing-compact-knowledge-graph.md
  git commit -F /tmp/msg-part3-task3.txt
  ```
