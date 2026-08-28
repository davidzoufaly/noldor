// @tests: architecture-decision-record-surface, graphify-plan-of-edges-nodes-for-plans-specs
import { describe, expect, it } from 'vitest';

import {
  ADR_STRUCTURAL_CONTEXT_PLACEHOLDER,
  STRUCTURAL_CONTEXT_HEADING,
} from '../../core/structural-context-contract.js';
import { parseAdrFrontmatter, renderAdrTemplate } from '../adr-schema.js';

const rendered = (): string => renderAdrTemplate({ slug: 'a-decision', date: '2026-08-28' });

describe('renderAdrTemplate structural context', () => {
  it('writes the section as an H2', () => {
    expect(rendered()).toContain(`## ${STRUCTURAL_CONTEXT_HEADING}`);
  });

  it('writes the exact placeholder the detector matches', () => {
    expect(rendered()).toContain(ADR_STRUCTURAL_CONTEXT_PLACEHOLDER);
  });

  it('places it between Context and Decision, where it reads as evidence', () => {
    const body = rendered();
    expect(body.indexOf('## Context')).toBeLessThan(
      body.indexOf(`## ${STRUCTURAL_CONTEXT_HEADING}`),
    );
    expect(body.indexOf(`## ${STRUCTURAL_CONTEXT_HEADING}`)).toBeLessThan(
      body.indexOf('## Decision'),
    );
  });

  it('still parses — the section is additive, not a frontmatter change', () => {
    const parsed = parseAdrFrontmatter(rendered());
    expect(parsed.success).toBe(true);
  });
});
