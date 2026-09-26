// @tests: ui-design-review-lane
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AgentResult, SpawnAgentOpts } from '../../../core/agent-runner/types.js';
import { DEFAULT_DISPATCH_TIMEOUT_MS } from '../../../core/config.js';
import type { Slug } from '../../../core/slug.js';
import type { AnswerLocation, RepairContext } from '../../lane-answer.js';
import { setLaneSpawn } from '../../lane-spawn.js';
import {
  buildGeometryExtractPrompt,
  buildGeometryExtractRepairPrompt,
  dispatchGeometryExtract,
  GEOMETRY_EXTRACT_ANSWER,
  GEOMETRY_EXTRACT_SHAPE,
  geometryExtractReportSchema,
  setGeometryExtractDispatcher,
} from '../../lanes/geometry-extract-dispatch.js';
import type { GeometryExtractInput } from '../../lanes/geometry-extract-dispatch.js';

const input: GeometryExtractInput = {
  penPath: '/tmp/scratch/slug.pen',
  requests: [
    { surface: 'dashboard', pageSelector: 'overview', outPath: '/tmp/out/dashboard.json' },
    { surface: 'settings', outPath: '/tmp/out/settings.json' },
  ],
};

/** A repo root with an empty config, so runner resolution falls back to the default. */
const at = (): AnswerLocation => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'noldor-geo-extract-'));
  mkdirSync(join(repoRoot, '.noldor'), { recursive: true });
  writeFileSync(join(repoRoot, '.noldor', 'config.json'), '{}');
  return { repoRoot, slug: 'geometry-adhoc' as Slug, kind: 'code' };
};

const VALID = '{"surfaces":[{"surface":"dashboard","candidates":["overview"]}]}';

afterEach(() => {
  setGeometryExtractDispatcher(undefined);
  setLaneSpawn(undefined);
});

describe('buildGeometryExtractPrompt', () => {
  it('names the scratch pen, every surface, and its output path', () => {
    const p = buildGeometryExtractPrompt(input);
    expect(p).toContain('/tmp/scratch/slug.pen');
    expect(p).toContain('`dashboard`');
    expect(p).toContain('page selector: `overview`');
    expect(p).toContain('/tmp/out/settings.json');
  });

  it('carries the bridge-wake recipe and forbids touching repo designs', () => {
    const p = buildGeometryExtractPrompt(input);
    expect(p).toContain('design pen-bridge');
    expect(p).toContain('never touch any design file under the repository');
  });

  it('absolutizes inside the visitor, resolves variables, and makes boxes page-relative', () => {
    const p = buildGeometryExtractPrompt(input);
    expect(p).toContain('k = k.parentCtx');
    expect(p).toContain('{ resolveVariables: true }');
    expect(p).toContain('content: n.content');
    expect(p).toContain("subtract the page node's own accumulated origin");
  });

  it('states the document rules the parent validates', () => {
    const p = buildGeometryExtractPrompt(input);
    expect(p).toContain("`viewport` is the selected page node's own resolved size");
    expect(p).toContain('empty or whitespace-only `content` → `"shape"`');
    expect(p).toContain('Every `"text"` node carries `text`');
    expect(p).toContain('NEVER emit `margin`');
    expect(p).toContain("list its name in that surface's `excluded` report entry");
  });

  it("asks for the selected page's node id, which the parent checks against the .pen on disk", () => {
    expect(buildGeometryExtractPrompt(input)).toContain(
      '`pageId` (the node id of the page you selected and read',
    );
  });
});

describe('the answer contract', () => {
  it('runs as the geometry-extract role', () => {
    expect(GEOMETRY_EXTRACT_ANSWER.lane).toBe('geometry-extract');
  });

  it('shows the child an example that is itself a valid report', () => {
    expect(geometryExtractReportSchema.safeParse(JSON.parse(GEOMETRY_EXTRACT_SHAPE)).success).toBe(
      true,
    );
  });

  it('rejects a verdict field — the child has nothing to judge', () => {
    const r = geometryExtractReportSchema.safeParse({
      surfaces: [{ surface: 'a', candidates: [], verdict: 'pass' }],
    });
    expect(r.success).toBe(false);
  });

  it('builds a repair prompt that transcribes and never re-reads the design', () => {
    const ctx: RepairContext = { stdout: 'found overview', rejected: 'nope', error: 'bad JSON' };
    const p = buildGeometryExtractRepairPrompt(ctx);
    expect(p).toContain('bad JSON');
    expect(p).toContain('found overview');
    expect(p).toContain('do not open the design');
  });
});

describe('dispatchGeometryExtract (injected child)', () => {
  it('returns the validated report, defaulting excluded to []', async () => {
    setGeometryExtractDispatcher(async () => VALID);
    const answer = await dispatchGeometryExtract(input, at());
    expect(answer.ok).toBe(true);
    if (answer.ok) {
      expect(answer.answer.surfaces[0]).toEqual({
        surface: 'dashboard',
        candidates: ['overview'],
        excluded: [],
      });
    }
  });

  it('recovers a rejected first answer through one repair round', async () => {
    const repairs: Array<RepairContext | undefined> = [];
    setGeometryExtractDispatcher(async (_in, repair) => {
      repairs.push(repair);
      return repair === undefined ? 'not json' : VALID;
    });
    const answer = await dispatchGeometryExtract(input, at());
    expect(answer.ok).toBe(true);
    expect(answer.notes[0]).toContain('repair round');
    expect(repairs[1]).toMatchObject({ stdout: '', rejected: 'not json' });
    expect(repairs[1]?.error).toContain('not valid JSON');
  });

  it('fails with the schema error when the repair writes nothing', async () => {
    setGeometryExtractDispatcher(async (_in, repair) =>
      repair === undefined ? '{"surfaces":[{"nope":1}]}' : null,
    );
    const answer = await dispatchGeometryExtract(input, at());
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.detail).toContain('geometry-extract schema');
  });
});

describe('dispatchGeometryExtract (real spawn path)', () => {
  const calls: Array<{ prompt: string; opts: SpawnAgentOpts }> = [];
  const spawnWriting = (text: string, result: Partial<AgentResult> = {}): void =>
    setLaneSpawn(async (prompt, opts): Promise<AgentResult> => {
      calls.push({ prompt, opts });
      const path = /write your answer to the file `([^`]+)`/.exec(prompt)?.[1];
      if (path !== undefined && result.timedOut !== true) writeFileSync(path, text);
      return { exitCode: 0, stdout: '', stderr: '', stderrBytes: 0, timedOut: false, ...result };
    });
  afterEach(() => {
    calls.length = 0;
  });

  it('spawns the geometry-extract role with the default timeout and a slugged answer file', async () => {
    spawnWriting(VALID);
    const answer = await dispatchGeometryExtract(input, at());
    expect(answer.ok).toBe(true);
    expect(calls[0]?.opts.role).toBe('geometry-extract');
    expect(calls[0]?.opts.timeoutMs).toBe(DEFAULT_DISPATCH_TIMEOUT_MS);
    expect(calls[0]?.prompt).toContain('geometry-adhoc-code-geometry-extract-');
  });

  it('throws GeometryExtractError with reason timeout on a timed-out child', async () => {
    spawnWriting(VALID, { exitCode: 124, timedOut: true });
    await expect(dispatchGeometryExtract(input, at())).rejects.toMatchObject({
      name: 'GeometryExtractError',
      reason: 'timeout',
    });
  });
});
