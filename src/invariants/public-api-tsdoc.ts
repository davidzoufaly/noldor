import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import type { Invariant, InvariantResult, InvariantViolation } from './types.js';

// This invariant deliberately carries no `typescript` dependency. TypeScript 7
// dropped the in-process JS compiler API (`ts.createSourceFile` and friends) —
// the published package exports only `version` plus the `unstable/*` surfaces,
// where parsing means spawning the tsgo API server against a real tsconfig
// project. A doc-lint over top-level declarations does not need a type checker,
// and going dependency-free also lets JS consumers run it (they never had
// `typescript` on disk, which is why the old code imported it lazily).

const PACKAGE_GLOB_DIRS = ['packages', 'apps'] as const;

/** `export { a, b as c } from './mod.js'` — group 1 = specifiers, group 2 = module. */
const EXPORT_FROM_RE =
  /^[ \t]*export[ \t]+(?:type[ \t]+)?\{([^}]*)\}[ \t]*from[ \t]*['"]([^'"]+)['"]/gm;

async function findIndexFiles(repoRoot: string): Promise<string[]> {
  const indices: string[] = [];
  for (const dir of PACKAGE_GLOB_DIRS) {
    const root = join(repoRoot, dir);
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const pkg of entries) {
      const idx = join(root, pkg, 'src/index.ts');
      try {
        await readFile(idx, 'utf8');
        indices.push(idx);
      } catch {
        // Missing index.ts → skip
      }
    }
  }
  return indices;
}

/**
 * Comments in the trivia directly above `declStart`, innermost first.
 *
 * Mirrors what `ts.getLeadingCommentRanges` returned for a statement node: the
 * contiguous run of block and line comments separated from the declaration (and
 * from each other) by whitespace only.
 */
function leadingComments(text: string, declStart: number): string[] {
  const comments: string[] = [];
  let pos = declStart;
  for (;;) {
    let i = pos - 1;
    while (i >= 0 && /\s/.test(text[i] as string)) {
      i--;
    }
    if (i < 1) {
      break;
    }
    if (text[i] === '/' && text[i - 1] === '*') {
      const start = text.lastIndexOf('/*', i - 1);
      if (start < 0) {
        break;
      }
      comments.push(text.slice(start, i + 1));
      pos = start;
      continue;
    }
    const lineStart = text.lastIndexOf('\n', i) + 1;
    const line = text.slice(lineStart, i + 1);
    if (line.trimStart().startsWith('//')) {
      comments.push(line.trim());
      pos = lineStart;
      continue;
    }
    break;
  }
  return comments;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Declaration {
  /** Offset of the first non-whitespace character of the declaration statement. */
  readonly start: number;
  /** 1-based line of `start`. */
  readonly line: number;
}

/**
 * Locate a top-level declaration of `name`.
 *
 * noldor:cut single-declarator statements — a name in a second declarator
 * (`export const a = 1, b = 2`) is not found and so is not flagged; extend the
 * pattern to scan the declarator list when a consumer hits it.
 */
function findDeclaration(sourceText: string, name: string): Declaration | null {
  const pattern = new RegExp(
    `^[ \\t]*(?:export[ \\t]+(?:default[ \\t]+)?)?(?:declare[ \\t]+)?(?:abstract[ \\t]+)?(?:async[ \\t]+)?(?:function[ \\t]*\\*?|class|interface|type|const|let|var|enum)[ \\t]+${escapeForRegExp(name)}\\b`,
    'm',
  );
  const match = pattern.exec(sourceText);
  if (!match) {
    return null;
  }
  const leadingWhitespace = /^[ \t]*/.exec(match[0])?.[0].length ?? 0;
  const start = match.index + leadingWhitespace;
  return { line: sourceText.slice(0, start).split('\n').length, start };
}

interface ReExport {
  readonly name: string;
  readonly fromFileBase: string;
}

function collectReExports(indexText: string, indexDir: string): ReExport[] {
  const out: ReExport[] = [];
  for (const match of indexText.matchAll(EXPORT_FROM_RE)) {
    const spec = match[2] as string;
    const resolvedRel = spec.replace(/\.(js|ts|tsx)$/, '');
    const resolved = resolve(indexDir, resolvedRel);
    for (const raw of (match[1] as string).split(',')) {
      // `a`, `a as b`, `type a`, `default as a` → the name in the source module
      const name = raw
        .trim()
        .replace(/^type[ \t]+/, '')
        .split(/[ \t]+as[ \t]+/)[0]
        ?.trim();
      if (!name) {
        continue;
      }
      out.push({ fromFileBase: resolved, name });
    }
  }
  return out;
}

async function readResolvedSourceFile(
  fromFileBase: string,
): Promise<{ readonly path: string; readonly text: string } | null> {
  const candidates = [
    `${fromFileBase}.ts`,
    `${fromFileBase}.tsx`,
    join(fromFileBase, 'index.ts'),
    join(fromFileBase, 'index.tsx'),
  ];

  for (const candidate of candidates) {
    try {
      return { path: candidate, text: await readFile(candidate, 'utf8') };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }

  return null;
}

/**
 * Build the public-api-tsdoc invariant plugin.
 *
 * @param repoRoot - Absolute path to repo root.
 * @returns Plugin that scans every `packages/*\/src/index.ts` and
 *   `apps/*\/src/index.ts`, traces re-exports to source declarations,
 *   and flags any missing TSDoc.
 */
export function makePublicApiTsdocInvariant(repoRoot: string): Invariant {
  return {
    description: 'Public API exports must have TSDoc',
    name: 'public-api-tsdoc',
    async run(): Promise<InvariantResult> {
      const start = Date.now();
      const violations: InvariantViolation[] = [];
      const indices = await findIndexFiles(repoRoot);
      for (const idxPath of indices) {
        const idxText = await readFile(idxPath, 'utf8');
        const reExports = collectReExports(idxText, dirname(idxPath));
        for (const re of reExports) {
          const resolved = await readResolvedSourceFile(re.fromFileBase);
          if (!resolved) continue;
          const decl = findDeclaration(resolved.text, re.name);
          if (!decl) continue;
          const comments = leadingComments(resolved.text, decl.start);
          if (comments.some((comment) => comment.includes('@internal'))) continue;
          if (!comments.some((comment) => comment.startsWith('/**'))) {
            violations.push({
              file: relative(repoRoot, resolved.path),
              line: decl.line,
              message: `exported '${re.name}' missing TSDoc`,
            });
          }
        }
      }
      return {
        invariant: 'public-api-tsdoc',
        violations,
        durationMs: Date.now() - start,
      };
    },
  };
}

/** Pre-built singleton using `process.cwd()` as repo root. */
export const publicApiTsdoc: Invariant = makePublicApiTsdocInvariant(process.cwd());
