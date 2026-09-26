// @tests: ui-design-review-lane
// noldor design geometry-review — compare one surface of an ALREADY-RUNNING app
// against its design, without a CR round. It calls the same function the lane
// calls per surface, so an operator debugging a lane row can reproduce it.

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runIfDirect } from '../../core/cli-entry.js';
import { sanitizeSurfaceName, screenshotTemplateIssues } from '../../core/ui-boot.js';
import { designCommand, emitFamilyLines } from './geometry-cli-emit.js';
import { reviewSurfaceGeometry } from './geometry-review.js';

const LABEL = 'geometry-review';
const USAGE = `usage: noldor design ${LABEL} --pen <file.pen> --surface <name> --url <url> --capture <template> [--page <name>] [--slug <slug>]`;

/** Exit 0 = every family within budget, 1 = drift, 2 = declined (a reason code) or usage error. */
export const runGeometryReview = designCommand(
  { label: LABEL, usage: USAGE, required: ['--url', '--capture'], optional: [], positional: 0 },
  async (flags, { penPath, surface, pageSelector, slug }, emit) => {
    const { '--url': url, '--capture': geometryCommand } = flags.required;
    // The same template contract `validate noldor-config` applies to a recipe's
    // geometryCommand, so a hand run cannot accept what the lane would reject.
    const issues = screenshotTemplateIssues(geometryCommand, '--capture');
    if (issues.length > 0) {
      for (const issue of issues) emit(`${LABEL}: ${issue}`);
      return 2;
    }
    const dir = await mkdtemp(join(tmpdir(), 'noldor-geometry-review-'));
    const result = await reviewSurfaceGeometry({
      penPath,
      surface,
      ...(pageSelector !== undefined ? { pageSelector } : {}),
      url,
      geometryCommand,
      outDir: dir,
      implPath: join(dir, `${sanitizeSurfaceName(surface)}.impl.json`),
      repoRoot: process.cwd(),
      slug,
    });
    if (result.kind === 'declined') {
      emit(`${LABEL}: ${result.reason}: ${result.detail}`);
      emit(`documents in ${dir}`);
      return 2;
    }
    if (result.excluded.length > 0) {
      emit(
        `${LABEL}: excluded ${result.excluded.length} clipped design node(s): ${result.excluded.join(', ')}`,
      );
    }
    emit(`surface '${surface}' — ${result.comparison.verdict}`);
    emitFamilyLines(result.comparison, emit);
    emit(`documents in ${dir}`);
    return result.comparison.verdict === 'fail' ? 1 : 0;
  },
);

runIfDirect('geometry-review-cli', `design ${LABEL}`, (argv) => runGeometryReview(argv));
