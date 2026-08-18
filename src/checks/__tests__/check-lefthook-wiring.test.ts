// @tests: noldor-package-lift
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  NOLDOR_BLOCK,
  ROOT_LEFTHOOK,
  checkLefthookWiring,
  frameworkHooks,
} from '../check-lefthook-wiring.js';

const BLOCK = [
  'pre-commit:',
  '  jobs:',
  '    - name: fmt',
  '      run: pnpm noldor fmt',
  '    - name: validate',
  '      run: pnpm noldor validate features',
  'commit-msg:',
  '  jobs:',
  '    - name: noldor-scope',
  '      run: pnpm noldor validate noldor-scope {1}',
  '',
].join('\n');

/** A consumer repo root; `opts.block` omitted means lefthook/noldor.yml is absent. */
function consumer(opts: { root?: string; block?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'lefthook-wiring-'));
  if (opts.root !== undefined) writeFileSync(join(dir, ROOT_LEFTHOOK), opts.root);
  if (opts.block !== undefined) {
    mkdirSync(join(dir, 'lefthook'), { recursive: true });
    writeFileSync(join(dir, 'lefthook/noldor.yml'), opts.block);
  }
  return dir;
}

const WIRED = `extends:\n  - ${NOLDOR_BLOCK}\n`;

describe('checkLefthookWiring', () => {
  it('passes a root file that extends the framework block', () => {
    const r = checkLefthookWiring(consumer({ root: WIRED, block: BLOCK }));
    expect(r.status).toBe('ok');
    expect(r.deadHooks).toEqual([]);
  });

  it('accepts the extends entry written without the ./ prefix', () => {
    const r = checkLefthookWiring(
      consumer({ root: 'extends:\n  - lefthook/noldor.yml\n', block: BLOCK }),
    );
    expect(r.status).toBe('ok');
  });

  it('accepts a bare-string extends, not only a list', () => {
    const r = checkLefthookWiring(consumer({ root: `extends: ${NOLDOR_BLOCK}\n`, block: BLOCK }));
    expect(r.status).toBe('ok');
  });

  it('passes when the consumer appends its own hooks alongside the extends', () => {
    const root = `${WIRED}\npre-push:\n  jobs:\n    - name: project\n      run: make check\n`;
    expect(checkLefthookWiring(consumer({ root, block: BLOCK })).status).toBe('ok');
  });

  // The charuy failure verbatim: a root file that predates adoption, valid
  // YAML, no extends — lefthook still banners, every noldor job is inert.
  it('fails a comment-only pre-adoption stub, naming the dead hooks and the repair', () => {
    const r = checkLefthookWiring(consumer({ root: '# project hooks go here\n', block: BLOCK }));
    expect(r.status).toBe('not-extended');
    expect(r.deadHooks).toEqual(['pre-commit (2 jobs)', 'commit-msg (1 job)']);
    expect(r.detail).toContain('pre-commit (2 jobs)');
    expect(r.detail).toContain(NOLDOR_BLOCK);
    expect(r.detail).toContain('extends');
  });

  it('fails a root file that extends something else entirely', () => {
    const root = 'extends:\n  - ./lefthook/project.yml\n';
    expect(checkLefthookWiring(consumer({ root, block: BLOCK })).status).toBe('not-extended');
  });

  it('reports a missing root file distinctly from an unwired one', () => {
    const r = checkLefthookWiring(consumer({ block: BLOCK }));
    expect(r.status).toBe('root-missing');
    expect(r.detail).toContain(ROOT_LEFTHOOK);
  });

  it('reports a missing framework block rather than blaming the root file', () => {
    const r = checkLefthookWiring(consumer({ root: WIRED }));
    expect(r.status).toBe('block-missing');
    expect(r.detail).toContain('init --update');
  });

  it('reports unparseable YAML instead of throwing', () => {
    const r = checkLefthookWiring(consumer({ root: 'extends:\n  - [unclosed\n', block: BLOCK }));
    expect(r.status).toBe('root-unparseable');
    expect(r.detail).toContain(ROOT_LEFTHOOK);
  });

  it('still reports the wiring finding when the framework block is unreadable', () => {
    const r = checkLefthookWiring(consumer({ root: '# stub\n', block: 'pre-commit: [unclosed\n' }));
    expect(r.status).toBe('not-extended');
    expect(r.deadHooks).toEqual([]);
  });

  it('treats an empty root file as unwired, not as valid', () => {
    expect(checkLefthookWiring(consumer({ root: '', block: BLOCK })).status).toBe('not-extended');
  });
});

describe('frameworkHooks', () => {
  it('names each hook group with its job count', () => {
    expect(frameworkHooks(consumer({ block: BLOCK }))).toEqual([
      'pre-commit (2 jobs)',
      'commit-msg (1 job)',
    ]);
  });

  it('returns an empty list when the block is absent', () => {
    expect(frameworkHooks(consumer({}))).toEqual([]);
  });
});

describe('this repo wires its own hooks', () => {
  it('passes on the live repo root — the check must not fail its own author', () => {
    expect(checkLefthookWiring(process.cwd()).status).toBe('ok');
  });
});
