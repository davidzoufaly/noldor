import { describe, expect, it } from 'vitest';

import { renderIndex } from '../index-doc.js';
import { readApprovedSlugs } from '../staging.js';

import type { StagingManifest } from '../types.js';

const manifest: StagingManifest = {
  today: '2026-06-10',
  batchDir: '.noldor/prep-batch/2026-06-10',
  entries: [
    {
      slug: 'aaa',
      name: 'Aaa',
      tier: 'full',
      size: 'L',
      area: 'tooling',
      deps: [],
      specFile: '.noldor/prep-batch/2026-06-10/aaa.spec.md',
      planFile: '.noldor/prep-batch/2026-06-10/aaa.plan.md',
      complete: true,
      summary: 'does aaa',
      confidence: 'high',
      risks: ['r1'],
      openQuestions: [{ question: 'q1?', recommendation: 'do x', rationale: 'because' }],
    },
    {
      slug: 'bbb',
      name: 'Bbb',
      tier: 'specs-only',
      size: 'M',
      area: 'tooling',
      deps: [],
      specFile: '.noldor/prep-batch/2026-06-10/bbb.spec.md',
      planFile: '',
      complete: false,
      summary: 'does bbb',
      confidence: 'low',
      risks: [],
      openQuestions: [],
    },
  ],
};

describe('renderIndex', () => {
  const md = renderIndex(manifest);

  it('renders header, per-feature sections, approve markers, and the bridge note', () => {
    expect(md).toContain('# Prep batch — 2026-06-10');
    expect(md).toContain('## aaa');
    expect(md).toContain('## bbb');
    expect(md).toContain('- [ ] approve');
    expect(md).toContain('## Promote bridge');
    expect(md).toContain('do x'); // open-question recommendation surfaced
  });

  it('marks incomplete drafts', () => {
    expect(md).toContain('⚠');
  });

  it('round-trips with readApprovedSlugs when the first approve is ticked', () => {
    const ticked = md.replace('- [ ] approve', '- [x] approve'); // first section = aaa
    expect(readApprovedSlugs(ticked)).toEqual(['aaa']);
  });
});
