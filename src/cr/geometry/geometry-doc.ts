// @tests: ui-design-review-lane
// The normalized geometry document both sides of the `geometry-compare` lane
// produce (spec D4). Two untrusted producers write it — a dispatched pencil-MCP
// child and a consumer-owned browser command — so every invariant the prose
// states is enforced here rather than assumed downstream: a structurally valid
// document that violates the contract is exactly what this boundary catches.

import { z } from 'zod';

const finite = z.number().finite();
const nonNeg = finite.min(0);

/**
 * Origin-relative box in CSS pixels at device pixel ratio 1. The DERIVED edges
 * are checked too, not just the fields: `x` and `w` can each be finite while
 * `x + w` overflows to `Infinity`, and the comparison then evaluates
 * `Infinity - Infinity` as `NaN` and reports drift between identical documents.
 */
export const geometryBoxSchema = z
  .object({ x: finite, y: finite, w: nonNeg, h: nonNeg })
  .strict()
  .refine((b) => Number.isFinite(b.x + b.w) && Number.isFinite(b.y + b.h), {
    message: 'box edges overflow to a non-finite value (x + w, y + h)',
  });
/** A node box, validated including its derived right and bottom edges. */
export type GeometryBox = z.infer<typeof geometryBoxSchema>;

/**
 * Declared spacing. Four-tuples keep zero sides POSITIONALLY (`[8,0,8,0]` is a
 * real declaration and cannot drop its zeros without losing which side is
 * which); excluding zeros is the population's job in
 * `geometry-compare-core.ts`, not the record's.
 */
export const geometrySpacingSchema = z
  .object({
    rowGap: nonNeg.optional(),
    columnGap: nonNeg.optional(),
    padding: z.tuple([nonNeg, nonNeg, nonNeg, nonNeg]).optional(),
    // Signed: negative margins are real on the implementation side.
    margin: z.tuple([finite, finite, finite, finite]).optional(),
  })
  .strict();
/** Declared spacing on one node; zero sides are kept, and excluded from the population later. */
export type GeometrySpacing = z.infer<typeof geometrySpacingSchema>;

/** Fields every node carries, whatever its kind. `text` is NOT among them —
 * see the per-kind members: a text node must carry it and no other kind may. */
const nodeCommon = {
  name: z.string().optional(),
  box: geometryBoxSchema,
  spacing: geometrySpacingSchema.optional(),
};

/**
 * A text-bearing node: `fontSize` is REQUIRED here and absent from every other
 * kind. A discriminated union rather than one object plus a refinement, so the
 * coupling holds in the TYPE as well as at runtime — downstream code reading
 * `n.fontSize` after narrowing on `kind` gets a `number`, not `number |
 * undefined`, and a producer document with an inherited wrapper font-size
 * cannot type-check its way past the boundary.
 */
export const geometryTextNodeSchema = z
  .object({
    ...nodeCommon,
    kind: z.literal('text'),
    fontSize: finite.positive(),
    /** The rendered text, required here: `kind: 'text'` means text-bearing, and
     * a producer that cannot say what the text is has mis-classified the node. */
    text: z.string().min(1),
  })
  .strict();
/** A validated text-bearing node: `fontSize` and `text` are both present. */
export type GeometryTextNode = z.infer<typeof geometryTextNodeSchema>;

/** A node with element children but no direct text of its own. */
export const geometryContainerNodeSchema = z
  .object({ ...nodeCommon, kind: z.literal('container') })
  .strict();

/** Anything else with a box: leaf shapes, images, SVG roots. */
export const geometryShapeNodeSchema = z
  .object({ ...nodeCommon, kind: z.literal('shape') })
  .strict();

/** Any node: the per-kind members unioned on `kind`. */
export const geometryNodeSchema = z.discriminatedUnion('kind', [
  geometryTextNodeSchema,
  geometryContainerNodeSchema,
  geometryShapeNodeSchema,
]);
/** A validated node of any kind. */
export type GeometryNode = z.infer<typeof geometryNodeSchema>;
/** `'text' | 'container' | 'shape'`, derived from the union rather than restated. */
export type GeometryNodeKind = GeometryNode['kind'];

/** One surface's whole document: viewport plus a flat node list. */
export const geometryDocSchema = z
  .object({
    surface: z.string().min(1),
    viewport: z.object({ width: finite.positive(), height: finite.positive() }).strict(),
    nodes: z.array(geometryNodeSchema),
  })
  .strict();
/** One surface's validated document. */
export type GeometryDoc = z.infer<typeof geometryDocSchema>;

/** Which producer wrote the document — the design side may not carry margin. */
export type GeometrySide = 'design' | 'impl';

/** Boundary-parse result: the document, or why it was refused. */
export type GeometryParse = { ok: true; doc: GeometryDoc } | { ok: false; detail: string };

/**
 * Boundary parse. Returns a result rather than throwing: an unparseable
 * document is an expected outcome of reviewing untrusted producer output, and
 * the lane maps `detail` into a `geometry-unparseable` sink.
 */
export function parseGeometryDoc(
  raw: unknown,
  side: GeometrySide,
  expectedSurface: string,
): GeometryParse {
  const parsed = geometryDocSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first.path.length > 0 ? `${first.path.join('.')}: ` : '';
    return { ok: false, detail: `${side} document invalid — ${path}${first.message}` };
  }
  const doc = parsed.data;
  if (doc.surface !== expectedSurface) {
    return {
      ok: false,
      detail: `${side} document reports surface '${doc.surface}', expected '${expectedSurface}'`,
    };
  }
  if (side === 'design') {
    const i = doc.nodes.findIndex((n) => n.spacing?.margin !== undefined);
    if (i >= 0) {
      return {
        ok: false,
        detail: `design document node ${i} carries margin — pen has no margin property, so a design-side margin means the producer invented a value`,
      };
    }
  }
  return { ok: true, doc };
}
