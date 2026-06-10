import type { FeatureDraft, StagingManifest } from './types.js';

function specLink(d: FeatureDraft): string {
  return `[spec](./${d.slug}.spec.md)`;
}

function planLink(d: FeatureDraft): string {
  return d.planFile ? `[plan](./${d.slug}.plan.md)` : '—';
}

/** Render the one batch-review surface: table + per-feature open-Q sections + promote-bridge note. */
export function renderIndex(m: StagingManifest): string {
  const rows = m.entries.map((d, i) => {
    const decision = d.complete ? '`[ ] approve`' : '⚠ incomplete';
    return `| ${i + 1} | ${d.slug} | ${d.size}/${d.tier} | ${d.summary.replace(/\|/g, '\\|')} | ${d.openQuestions.length} | ${d.confidence} | ${specLink(d)} | ${planLink(d)} | ${decision} |`;
  });

  const sections = m.entries.map((d) => {
    const risks = d.risks.length > 0 ? d.risks.map((r) => `- ${r}`).join('\n') : '- _none flagged_';
    const qs =
      d.openQuestions.length > 0
        ? d.openQuestions
            .map(
              (q, i) =>
                `${i + 1}. *${q.question}*\n   - **Recommend:** ${q.recommendation}\n   - **Why:** ${q.rationale}`,
            )
            .join('\n')
        : '_No open questions._';
    return [
      `## ${d.slug}`,
      '',
      `**${d.name}** — ${d.size}/${d.tier}. ${d.summary}`,
      d.complete
        ? ''
        : '\n> ⚠ Draft incomplete — the drafting child did not finish. Re-run `prep fanout` or draft by hand.',
      '',
      '**Risks**',
      '',
      risks,
      '',
      '**Open questions (recommended answers)**',
      '',
      qs,
      '',
      '**Decision** (tick one):',
      '',
      '- [ ] approve',
      '- [ ] edit',
      '- [ ] skip',
      '',
    ].join('\n');
  });

  const completeCount = m.entries.filter((e) => e.complete).length;

  return [
    `# Prep batch — ${m.today}`,
    '',
    `${m.entries.length} feature(s) drafted in parallel (${completeCount} complete), each by an independent agent that self-answered its own open questions. Review all at once: tick **approve** under each feature you accept (edit the draft files in place first if needed), then run \`pnpm noldor prep promote\` to turn the approved ones into in-progress FDs.`,
    '',
    '| # | Slug | Size/Tier | Summary | Open Qs | Conf | Spec | Plan | Decision |',
    '| - | ---- | --------- | ------- | ------- | ---- | ---- | ---- | -------- |',
    ...rows,
    '',
    ...sections,
    '## Promote bridge',
    '',
    'Approved features are promoted **serially** (each `prep promote` step removes a block from `docs/roadmap.md`): per feature it scaffolds `docs/features/<slug>.md` (phase: in-progress), copies this spec to `docs/superpowers/specs/<date>-<slug>-design.md`, lifts User Story + Usage into the FD, copies the plan (full tier) to `docs/superpowers/plans/<date>-<slug>.md`, and commits — all on one branch (`--ship` also opens an auto-merged PR). The result — in-progress FDs carrying spec + plan — is the input for the autonomous plan-runner.',
    '',
  ].join('\n');
}
