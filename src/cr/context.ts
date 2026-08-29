export type Lane =
  | { kind: 'gate' }
  | { kind: 'working' }
  | { kind: 'sha'; sha: string }
  | { kind: 'range'; from: string; to: string };

export interface BuildContextInput {
  lane: Lane;
  paths?: readonly string[];
  runGit: (args: string[]) => string;
  featureMd: string;
  rules: string;
}

export interface PromptContext {
  diff: string;
  featureMd: string;
  rules: string;
}

/**
 * Build output, excluded from every review diff.
 *
 * Not a size optimisation — a correctness one. These files are machine-written
 * from sources that ARE in the diff, so a reviewer judges the generator rather
 * than its output, and they are large enough to crowd out the code under
 * review: one branch's regenerated `graphify-out/` was 97.5% of a 5.2MB diff,
 * past the codex lane's 1MB input cap, so the whole review failed on content
 * nobody reads.
 *
 * The list is deliberately narrow. **Lockfiles are NOT excluded**: a
 * dependency-only change lives entirely in the lock, and the security-relevant
 * half of it — a new transitive package, a changed `resolution:` URL, an
 * altered integrity hash — has no other representation in the diff. Dropping
 * them would let a lockfile-only commit reach the mandatory lane as an empty
 * diff and pass unreviewed. Nor is this the graph-freshness exclusion list,
 * which drops tests and markdown a reviewer must see.
 *
 * `:(exclude,glob)` magic: `glob` makes the double-star cross directory
 * boundaries so the pattern matches at any depth, including the repo root.
 */
export const REVIEW_IRRELEVANT_EXCLUDES: readonly string[] = [
  ':(exclude,glob)graphify-out/**',
  ':(exclude,glob)dist/**',
];

export function buildContext(input: BuildContextInput): PromptContext {
  const baseArgs = diffArgs(input.lane);
  // The pathspec separator carries the excludes even when the caller named no
  // paths of its own — an empty positive pathspec set plus excludes means
  // "everything except these", which is exactly the intent.
  const args = [...baseArgs, '--', ...(input.paths ?? []), ...REVIEW_IRRELEVANT_EXCLUDES];
  const diff = input.runGit(args);
  return { diff, featureMd: input.featureMd, rules: input.rules };
}

function diffArgs(lane: Lane): string[] {
  switch (lane.kind) {
    case 'gate':
      return ['diff', 'main...HEAD'];
    case 'working':
      return ['diff', 'HEAD'];
    case 'sha':
      return ['diff', `main...${lane.sha}`];
    case 'range':
      return ['diff', `${lane.from}..${lane.to}`];
  }
}
