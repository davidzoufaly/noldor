// @tests: parallel-agent-dispatch-for-research-jobs
import { describe, expect, it } from 'vitest';
import { buildResearchPrompt, parseResearchStdout } from '../prompt';
import { FALLBACK_META, taskSpecSchema } from '../types';

const task = taskSpecSchema.parse({
  id: 'cr-guard',
  question: 'How does the CR overwrite-guard decide archive vs skip?',
  scope: ['src/cr/'],
  context: 'CR sinks live under .noldor/cr/.',
  expects: 'Name the deciding function and its inputs.',
});

describe('buildResearchPrompt', () => {
  it('carries question, scope, context, expects and the read-only directive', () => {
    const p = buildResearchPrompt(task);
    expect(p).toContain(task.question);
    expect(p).toContain('src/cr/');
    expect(p).toContain('CR sinks live under');
    expect(p).toContain('Name the deciding function');
    expect(p).toMatch(/do not edit, write, create, or delete/i);
    expect(p).toContain('```json');
  });

  it('omits optional sections cleanly', () => {
    const bare = taskSpecSchema.parse({ id: 'a', question: 'q?' });
    const p = buildResearchPrompt(bare);
    expect(p).not.toContain('Context:');
    expect(p).not.toContain('Start here:');
  });
});

describe('parseResearchStdout', () => {
  const meta = '```json\n{"status":"answered","headline":"Uses guardLaneOverwrite"}\n```';

  it('splits findings from the trailing meta fence', () => {
    const r = parseResearchStdout(`## Findings\n\nBody text.\n\n${meta}\n`);
    expect(r.parsed).toBe(true);
    expect(r.meta.status).toBe('answered');
    expect(r.findings).toBe('## Findings\n\nBody text.');
  });

  it('uses the LAST json fence when several exist', () => {
    const first = '```json\n{"status":"blocked","headline":"early example"}\n```';
    const r = parseResearchStdout(`${first}\n\nmore text\n\n${meta}`);
    expect(r.parsed).toBe(true);
    expect(r.meta.headline).toBe('Uses guardLaneOverwrite');
  });

  it('falls back on missing fence — raw output preserved', () => {
    const r = parseResearchStdout('just prose, no fence');
    expect(r.parsed).toBe(false);
    expect(r.meta).toEqual(FALLBACK_META);
    expect(r.findings).toBe('just prose, no fence');
  });

  it('falls back on invalid JSON', () => {
    const r = parseResearchStdout('text\n```json\n{not json}\n```');
    expect(r.parsed).toBe(false);
    expect(r.findings).toContain('text');
  });

  it('falls back on schema-invalid meta', () => {
    const r = parseResearchStdout('text\n```json\n{"status":"maybe","headline":"h"}\n```');
    expect(r.parsed).toBe(false);
  });

  it('falls back on empty stdout', () => {
    const r = parseResearchStdout('');
    expect(r.parsed).toBe(false);
    expect(r.findings).toBe('');
  });
});
