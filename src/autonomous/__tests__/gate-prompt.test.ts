// @tests: portable-gate-entrypoint-for-non-claude-runners
import { describe, expect, it } from 'vitest';
import { buildDrainGatePrompt, buildResumeGatePrompt } from '../gate-prompt.js';

// Today's plansSource literal (drain-source.ts pre-extraction) — the
// slash-command branch must return it byte-identically.
const RESUME_SLASH_LITERAL = [
  '/gate --resume designed --autonomous',
  '',
  'Autonomous plan-drain context: run this resume end-to-end with NO interactive prompts.',
  'Immediately set autonomous mode (`pnpm noldor noldor set-autonomous`) right after the',
  'session marker is written — do NOT ask autonomous-vs-interactive. Implement the plan',
  'inline, run code-stage CR, and ship via pr-flow. On CR-red or test-red run',
  '`cr escalate --autonomous` (config `autonomous.onFailure` governs). Never pause for a',
  'lane picker or PR approval.',
].join('\n');

describe('buildDrainGatePrompt', () => {
  it("slash-command returns today's drain literal verbatim", () => {
    expect(buildDrainGatePrompt('alpha', 'slash-command')).toBe('/gate --drain alpha');
  });

  it('prose is self-contained: slug, fast/<slug>, drain-mode.md pointer, portable CLIs, no /gate token', () => {
    const p = buildDrainGatePrompt('alpha', 'prose');
    expect(p).toContain("'alpha'");
    expect(p).toContain('fast/alpha');
    expect(p).toContain('docs/noldor/drain-mode.md');
    expect(p).toContain('pnpm noldor roadmap remove-block alpha');
    expect(p).toContain('pnpm noldor noldor set-autonomous');
    expect(p).not.toContain('/gate');
  });
});

describe('buildResumeGatePrompt', () => {
  it("slash-command returns today's resume literal verbatim", () => {
    expect(buildResumeGatePrompt('designed', 'slash-command')).toBe(RESUME_SLASH_LITERAL);
  });

  it('prose is self-contained: slug, feat/<slug>, drain-mode.md, autonomous directives, no /gate token', () => {
    const p = buildResumeGatePrompt('designed', 'prose');
    expect(p).toContain("'designed'");
    expect(p).toContain('feat/designed');
    expect(p).toContain('docs/noldor/drain-mode.md');
    expect(p).toContain('pnpm noldor noldor set-autonomous');
    expect(p).toContain('NO interactive prompts');
    expect(p).not.toContain('/gate');
  });
});
