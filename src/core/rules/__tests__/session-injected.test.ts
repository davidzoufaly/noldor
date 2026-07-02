// @tests: autonomous-plan-to-pr-merge, release-script-self-provisions-its-own-session-marker, release-sweep-process-hardening
import { describe, expect, it } from 'vitest';
import { SessionMarkerSchema } from '../../session.js';

describe('SessionMarker injectedRules', () => {
  it('accepts an injectedRules array', () => {
    const m = SessionMarkerSchema.parse({
      path: 'fast-track',
      startedAt: '2026-06-01T00:00:00Z',
      injectedRules: ['rule-a', 'rule-b'],
    });
    expect(m.injectedRules).toEqual(['rule-a', 'rule-b']);
  });

  it('treats injectedRules as optional', () => {
    const m = SessionMarkerSchema.parse({ path: 'fast-track', startedAt: 'x' });
    expect(m.injectedRules).toBeUndefined();
  });
});
