// @tests: ui-design-review-lane
// The geometry lane's evidence report (spec D7) and severity rule (spec D6). The
// shipped core returns bare values; this maps each unmatched value back to its
// producing nodes by re-scanning that side's document. Pure: no IO.

import type { Severity } from '../findings-schema.js';
import {
  extractFamilies,
  GEOMETRY_FAMILIES,
  type FamilyOutcome,
  type FamilyRecord,
  type FamilyValues,
  type GeometryComparison,
  type GeometryFamily,
} from './geometry-compare-core.js';
import type {
  GeometryBox,
  GeometryDoc,
  GeometryNode,
  GeometryNodeKind,
  GeometrySide,
} from './geometry-doc.js';

/** What the report shows of a node: enough to find it in pen or the DOM. */
export interface ReportNode {
  name?: string;
  kind: GeometryNodeKind;
  box: GeometryBox;
  text?: string;
}

/** One value with no counterpart, and every node on its side that produced it. */
export interface UnmatchedValue {
  family: GeometryFamily;
  side: GeometrySide;
  value: number;
  nodes: ReportNode[];
}

/** The `<surface>.report.json` evidence file. */
export interface SurfaceReport {
  surface: string;
  verdict: GeometryComparison['verdict'];
  families: FamilyRecord<FamilyOutcome>;
  /** Every value each side contributed, per family. */
  values: { design: FamilyValues; impl: FamilyValues };
  unmatched: UnmatchedValue[];
}

/** Whether `node` contributes `value` to `family` — the reads `extractFamilies` makes. */
function produces(node: GeometryNode, family: GeometryFamily, value: number): boolean {
  switch (family) {
    case 'edgesX':
      return node.box.x === value || node.box.x + node.box.w === value;
    case 'edgesY':
      return node.box.y === value || node.box.y + node.box.h === value;
    case 'fontSize':
      return node.kind === 'text' && node.fontSize === value;
    case 'spacing': {
      const s = node.spacing;
      if (s === undefined) return false;
      return [s.rowGap, s.columnGap, ...(s.padding ?? []), ...(s.margin ?? [])].includes(value);
    }
  }
}

const reportNode = (n: GeometryNode): ReportNode => ({
  ...(n.name !== undefined ? { name: n.name } : {}),
  kind: n.kind,
  box: n.box,
  ...(n.kind === 'text' ? { text: n.text } : {}),
});

export function buildSurfaceReport(
  surface: string,
  design: GeometryDoc,
  impl: GeometryDoc,
  comparison: GeometryComparison,
): SurfaceReport {
  const docs = { design, impl };
  const unmatched: UnmatchedValue[] = [];
  for (const family of GEOMETRY_FAMILIES) {
    const o = comparison.families[family];
    const sides = [
      ['design', o.designOnly],
      ['impl', o.implOnly],
    ] as const;
    for (const [side, values] of sides) {
      for (const value of values) {
        const nodes = docs[side].nodes.filter((n) => produces(n, family, value)).map(reportNode);
        unmatched.push({ family, side, value, nodes });
      }
    }
  }
  return {
    surface,
    verdict: comparison.verdict,
    families: comparison.families,
    values: { design: extractFamilies(design), impl: extractFamilies(impl) },
    unmatched,
  };
}

/** Spec D6: `med` for 1–2 unmatched values, `high` for 3 or more. */
export const familySeverity = (unmatched: number): Severity => (unmatched >= 3 ? 'high' : 'med');

/** A short handle for a node in a finding: its layer name, else its text, else its kind. */
export function nodeLabel(n: ReportNode): string {
  if (n.name !== undefined) return n.name;
  if (n.text !== undefined) return `"${n.text.length > 24 ? `${n.text.slice(0, 24)}…` : n.text}"`;
  return n.kind;
}
