// @fd: architecture-decision-record-surface
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { runIfDirect } from '../core/cli-entry.js';
import { loadDocRoots } from '../core/doc-roots.js';
import { toPosixRelative } from '../core/repo-paths.js';
import { ADR_FILENAME_RE, parseAdrFrontmatter, type AdrFrontmatter } from './adr-schema.js';

/** Why one record failed. One finding per file per rule, never more. */
export type AdrRule =
  | 'bad-filename'
  | 'dup-number'
  | 'bad-frontmatter'
  | 'missing-superseded-by'
  | 'stray-superseded-by'
  | 'dangling-superseded-by'
  | 'bad-supersedes'
  | 'unreadable';

/** A blocking problem with a record. A non-empty list means `invalid`. */
export interface AdrFinding {
  /** Repo-relative path, POSIX separators. */
  readonly file: string;
  readonly rule: AdrRule;
  readonly message: string;
}

export interface AdrReport {
  /**
   * `absent` — the folder does not exist or contains no `NNNN-<slug>.md`
   * record. Callers skip on it: a stray README does not opt a repo in, and
   * `noldor init` scaffolds nothing here, so no untouched-scaffold special
   * case is needed (unlike `checkArchitecture`).
   */
  readonly status: 'absent' | 'ok' | 'invalid';
  readonly findings: readonly AdrFinding[];
}

interface RecordRead {
  readonly label: string;
  readonly number: string;
  readonly frontmatter: AdrFrontmatter;
}

/**
 * Check the decision-record surface: filenames conform, every record's
 * frontmatter validates, numbers are unique, and the supersede chain holds in
 * both directions — a `superseded` record names an existing successor, and a
 * `supersedes` pointer names an existing record that is actually superseded.
 *
 * Every filesystem read is caught at this boundary, so an unreadable folder or
 * record becomes a finding rather than a throw reaching the CLI, garden or
 * release preflight. Findings sort by file then rule; output is deterministic.
 *
 * @param cwd - Consumer root
 * @returns Report whose `findings` are all blocking (there is no advisory class)
 */
export async function checkAdr(cwd: string): Promise<AdrReport> {
  const dir = loadDocRoots(cwd).adr;
  const dirLabel = toPosixRelative(cwd, dir);

  let entries: string[];
  try {
    if (!(await stat(dir)).isDirectory()) {
      return {
        status: 'invalid',
        findings: [
          {
            file: dirLabel,
            rule: 'unreadable',
            message: `${dirLabel} exists but is not a directory`,
          },
        ],
      };
    }
    entries = (await readdir(dir)).filter((name) => name.endsWith('.md')).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'absent', findings: [] };
    }
    return {
      status: 'invalid',
      findings: [
        {
          file: dirLabel,
          rule: 'unreadable',
          message: `cannot read ${dirLabel}: ${(err as Error).message}`,
        },
      ],
    };
  }

  const findings: AdrFinding[] = [];
  const records: RecordRead[] = [];
  const byNumber = new Map<string, string[]>();
  let conformingFiles = 0;

  for (const name of entries) {
    const label = `${dirLabel}/${name}`;
    const match = ADR_FILENAME_RE.exec(name);
    if (!match) {
      findings.push({
        file: label,
        rule: 'bad-filename',
        message: `${label} does not match NNNN-<slug>.md`,
      });
      continue;
    }
    conformingFiles += 1;
    const number = match[1];
    byNumber.set(number, [...(byNumber.get(number) ?? []), label]);

    let raw: string;
    try {
      raw = await readFile(join(dir, name), 'utf8');
    } catch (err) {
      findings.push({
        file: label,
        rule: 'unreadable',
        message: `${label} could not be read: ${(err as Error).message}`,
      });
      continue;
    }
    const parsed = parseAdrFrontmatter(raw);
    if (!parsed.success) {
      findings.push({
        file: label,
        rule: 'bad-frontmatter',
        message: `${label}: ${parsed.errors.join('; ')}`,
      });
      continue;
    }
    records.push({ label, number, frontmatter: parsed.data });
  }

  for (const [number, labels] of byNumber) {
    if (labels.length < 2) continue;
    for (const label of labels) {
      findings.push({
        file: label,
        rule: 'dup-number',
        message: `${label} shares number ${number} with ${labels.filter((l) => l !== label).join(', ')}`,
      });
    }
  }

  // Chain rules need the whole folder: statuses are looked up by number.
  const statusByNumber = new Map(records.map((r) => [r.number, r.frontmatter.status]));
  for (const record of records) {
    const fm = record.frontmatter;
    const successor = fm['superseded-by'];
    if (fm.status === 'superseded' && successor === undefined) {
      findings.push({
        file: record.label,
        rule: 'missing-superseded-by',
        message: `${record.label} is superseded but names no superseded-by record`,
      });
    }
    if (fm.status === 'accepted' && successor !== undefined) {
      findings.push({
        file: record.label,
        rule: 'stray-superseded-by',
        message: `${record.label} is accepted but carries superseded-by: ${successor}`,
      });
    }
    if (successor !== undefined && !statusByNumber.has(successor)) {
      findings.push({
        file: record.label,
        rule: 'dangling-superseded-by',
        message: `${record.label} names superseded-by ${successor}, which does not exist`,
      });
    }
    if (fm.supersedes !== undefined) {
      const targetStatus = statusByNumber.get(fm.supersedes);
      if (targetStatus === undefined) {
        findings.push({
          file: record.label,
          rule: 'bad-supersedes',
          message: `${record.label} supersedes ${fm.supersedes}, which does not exist`,
        });
      } else if (targetStatus !== 'superseded') {
        findings.push({
          file: record.label,
          rule: 'bad-supersedes',
          message: `${record.label} supersedes ${fm.supersedes}, whose status is not superseded`,
        });
      }
    }
  }

  // Opt-in is a folder with at least one NNNN-<slug>.md file: a stray README
  // or notes file never opts a repo in, so with zero conforming filenames the
  // bad-filename findings — the only kind that can exist here, since per-file
  // reads happen only on conforming files and directory-level failures return
  // above — are suppressed and the surface reads `absent` (spec AC5). A
  // conforming filename opts in even when its frontmatter fails: a
  // half-written record is drift to report, not a repo that never adopted.
  if (conformingFiles === 0) {
    return { status: 'absent', findings: [] };
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule));
  return { status: findings.length > 0 ? 'invalid' : 'ok', findings };
}

/**
 * `noldor docs adr [--check]` — `--check` is the only mode and the default,
 * so the bare invocation behaves identically. Exit 0 on `ok` and `absent`,
 * 1 on `invalid` with findings on stderr.
 */
async function main(): Promise<number> {
  const report = await checkAdr(process.cwd());

  if (report.status === 'absent') {
    console.log('adr: no decision records in docs/adr/ — nothing to check.');
    return 0;
  }
  if (report.findings.length === 0) {
    console.log('adr: all records OK.');
    return 0;
  }
  for (const finding of report.findings) {
    console.error(`${finding.rule}: ${finding.message}`);
  }
  console.error(`\n${report.findings.length} adr finding(s).`);
  return 1;
}

runIfDirect('docs-adr', 'docs-adr', main);
