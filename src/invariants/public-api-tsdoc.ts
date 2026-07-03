import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

// `typescript` is a peer-ish tool: present in TS consumers, absent in JS ones
// (it lives in noldor's devDependencies, so consumer installs never carry it).
// Import it lazily inside run() — a static import crashes `checks invariants`
// for every JS consumer at module load (ERR_MODULE_NOT_FOUND).
import type TsModule from 'typescript';

import type { Invariant, InvariantResult, InvariantViolation } from './types.js';

type Ts = typeof TsModule;

const PACKAGE_GLOB_DIRS = ['packages', 'apps'] as const;

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

function hasTsdoc(ts: Ts, node: TsModule.Node, sourceText: string): boolean {
  const ranges = ts.getLeadingCommentRanges(sourceText, node.getFullStart()) ?? [];
  return ranges.some((r) => {
    const text = sourceText.slice(r.pos, r.end);
    return text.startsWith('/**');
  });
}

function isInternal(ts: Ts, node: TsModule.Node, sourceText: string): boolean {
  const ranges = ts.getLeadingCommentRanges(sourceText, node.getFullStart()) ?? [];
  return ranges.some((r) => sourceText.slice(r.pos, r.end).includes('@internal'));
}

interface ReExport {
  readonly name: string;
  readonly fromFileBase: string;
}

function collectReExports(ts: Ts, sourceFile: TsModule.SourceFile, indexDir: string): ReExport[] {
  const out: ReExport[] = [];
  for (const stmt of sourceFile.statements) {
    if (!ts.isExportDeclaration(stmt) || !stmt.moduleSpecifier) {
      continue;
    }
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) {
      continue;
    }
    const spec = stmt.moduleSpecifier.text;
    const resolvedRel = spec.replace(/\.(js|ts|tsx)$/, '');
    const resolved = resolve(indexDir, resolvedRel);
    if (!stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) {
      continue;
    }
    for (const el of stmt.exportClause.elements) {
      out.push({ fromFileBase: resolved, name: el.propertyName?.text ?? el.name.text });
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

function createSourceFile(ts: Ts, filePath: string, sourceText: string): TsModule.SourceFile {
  const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
}

function findDeclaration(
  ts: Ts,
  sourceFile: TsModule.SourceFile,
  name: string,
): TsModule.Node | null {
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) {
      return stmt;
    }
    if (ts.isClassDeclaration(stmt) && stmt.name?.text === name) {
      return stmt;
    }
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === name) {
      return stmt;
    }
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === name) {
      return stmt;
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name) {
          return stmt;
        }
      }
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
      // No package indices → nothing to scan; return before touching the
      // typescript module so JS consumers never need it on disk.
      if (indices.length === 0) {
        return { invariant: 'public-api-tsdoc', violations, durationMs: Date.now() - start };
      }
      let ts: Ts;
      try {
        ts = (await import('typescript')).default;
      } catch {
        console.error(
          "public-api-tsdoc: 'typescript' not installed — skipping (add it as a devDependency to enable this invariant)",
        );
        return { invariant: 'public-api-tsdoc', violations, durationMs: Date.now() - start };
      }
      for (const idxPath of indices) {
        const idxText = await readFile(idxPath, 'utf8');
        const idxSf = createSourceFile(ts, idxPath, idxText);
        const reExports = collectReExports(ts, idxSf, dirname(idxPath));
        for (const re of reExports) {
          const resolved = await readResolvedSourceFile(re.fromFileBase);
          if (!resolved) continue;
          const srcSf = createSourceFile(ts, resolved.path, resolved.text);
          const decl = findDeclaration(ts, srcSf, re.name);
          if (!decl) continue;
          if (isInternal(ts, decl, resolved.text)) continue;
          if (!hasTsdoc(ts, decl, resolved.text)) {
            const { line } = srcSf.getLineAndCharacterOfPosition(decl.getStart());
            violations.push({
              file: relative(repoRoot, resolved.path),
              line: line + 1,
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
