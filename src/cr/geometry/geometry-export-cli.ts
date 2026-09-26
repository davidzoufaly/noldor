// @tests: ui-design-review-lane
// noldor design geometry-export — read one surface's resolved geometry out of a
// `.pen` and write it as a normalized document. The `geometry-compare` lane does
// this for every affected surface inside a round; this entrypoint lets an
// operator produce the design half by hand and diff it against a captured
// implementation document without booting anything.

import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { runIfDirect } from '../../core/cli-entry.js';
import { errMessage } from '../../core/err-message.js';
import type { LaneAnswer } from '../lane-answer.js';
import {
  dispatchGeometryExtract,
  GeometryExtractError,
  selectVerifiedPage,
  type GeometryExtractReport,
} from '../lanes/geometry-extract-dispatch.js';
import { designCommand } from './geometry-cli-emit.js';
import { parseGeometryDoc } from './geometry-doc.js';

const LABEL = 'geometry-export';
const USAGE = `usage: noldor design ${LABEL} --pen <file.pen> --surface <name> --out <doc.json> [--page <name>] [--slug <slug>]`;

/**
 * Exit 0 = a conformant document was written, 1 = the design could not be read
 * for this surface (no usable answer, ambiguous page, missing or non-conformant
 * document), 2 = usage error or the dispatch itself failed. The 1-vs-2 split
 * mirrors the lane's own distinction between "cannot review this surface" and
 * "the round broke".
 */
export const runGeometryExport = designCommand(
  { label: LABEL, usage: USAGE, required: ['--out'], optional: [], positional: 0 },
  async (flags, { penPath, surface, pageSelector, slug }, emit) => {
    // Absolute: the child is told to write exactly where the prompt says.
    const outPath = resolve(flags.required['--out']);
    // A document left from an earlier run (possibly another page) must never pass
    // as this dispatch's output: a child that answers but writes nothing fails.
    await rm(outPath, { force: true });
    let answer: LaneAnswer<GeometryExtractReport>;
    try {
      answer = await dispatchGeometryExtract(
        {
          penPath,
          requests: [{ surface, ...(pageSelector !== undefined ? { pageSelector } : {}), outPath }],
        },
        { repoRoot: process.cwd(), slug, kind: 'code' },
      );
    } catch (err) {
      emit(
        `${LABEL}: ${err instanceof GeometryExtractError ? err.message : `dispatch failed: ${errMessage(err)}`}`,
      );
      return 2;
    }
    for (const note of answer.notes) emit(`${LABEL}: note: ${note}`);
    if (!answer.ok) {
      // Without a valid answer there is no trustworthy page enumeration, so a
      // file on disk could be the WRONG page — fail rather than trust it.
      emit(
        `${LABEL}: the reader gave no usable answer, so page selection is unverified — ${answer.detail}`,
      );
      return 1;
    }
    const row = answer.answer.surfaces.find((s) => s.surface === surface);
    if (row === undefined) {
      emit(`${LABEL}: the reader's answer omits surface '${surface}'`);
      return 1;
    }
    // The child ENUMERATES, this side SELECTS: re-run the shared selection rule
    // over the reported candidates so the child's own judgment never decides
    // which page was read, then confirm against the file on disk that the
    // child read the named .pen and not the editor's active one.
    const selection = await selectVerifiedPage(penPath, surface, row, pageSelector);
    if (!selection.ok) {
      emit(`${LABEL}: ${selection.detail}`);
      return 1;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(outPath, 'utf8'));
    } catch (err) {
      emit(`${LABEL}: the reader wrote no readable document: ${errMessage(err)}`);
      return 1;
    }
    const doc = parseGeometryDoc(raw, 'design', surface);
    if (!doc.ok) {
      emit(`${LABEL}: ${doc.detail}`);
      return 1;
    }
    if (row.excluded.length > 0) {
      emit(`${LABEL}: excluded ${row.excluded.length} clipped node(s): ${row.excluded.join(', ')}`);
    }
    emit(
      `${LABEL}: wrote ${outPath} from page '${selection.page}' — ${doc.doc.nodes.length} node(s), viewport ${doc.doc.viewport.width}x${doc.doc.viewport.height}`,
    );
    return 0;
  },
);

runIfDirect('geometry-export-cli', `design ${LABEL}`, (argv) => runGeometryExport(argv));
