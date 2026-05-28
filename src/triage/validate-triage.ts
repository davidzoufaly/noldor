import { readFile } from 'node:fs/promises';

import { parseBacklog, parseRoadmap, type BacklogEntry } from '../utils/parse-blocks.js';

export interface TriageIssue {
  file: 'docs/roadmap.md' | 'docs/backlog.md';
  rule:
    | 'duplicate-name'
    | 'missing-required-field'
    | 'missing-optional-field'
    | 'unknown-type-value';
  message: string;
  entryName: string;
}

export interface TriageValidationResult {
  errors: TriageIssue[];
  advisories: TriageIssue[];
}

export interface ValidateTriageInputs {
  roadmapRaw: string;
  backlogRaw: string;
  /** When true, advisory issues (e.g. missing size/impact) are promoted to errors. */
  strict: boolean;
}

const REQUIRED_FIELDS_BACKLOG: ReadonlyArray<keyof BacklogEntry> = ['area', 'type', 'since'];
const REQUIRED_FIELDS_ROADMAP: ReadonlyArray<keyof BacklogEntry> = [
  'area',
  'type',
  'since',
  'size',
  'impact',
];
const ADVISORY_FIELDS_BACKLOG = ['size', 'impact'] as const satisfies ReadonlyArray<
  keyof BacklogEntry
>;
const ADVISORY_FIELDS_ROADMAP: ReadonlyArray<keyof BacklogEntry> = [];
const KNOWN_TYPES = new Set(['feat', 'fix', 'refactor', 'chore', 'docs', 'perf', 'test']);

export function validateTriageInputs(input: ValidateTriageInputs): TriageValidationResult {
  const errors: TriageIssue[] = [];
  const advisories: TriageIssue[] = [];

  const roadmap = parseRoadmap(input.roadmapRaw);
  const backlog = parseBacklog(input.backlogRaw);

  pushIssues(
    roadmap,
    'docs/roadmap.md',
    REQUIRED_FIELDS_ROADMAP,
    ADVISORY_FIELDS_ROADMAP,
    input.strict,
    errors,
    advisories,
  );
  pushIssues(
    backlog,
    'docs/backlog.md',
    REQUIRED_FIELDS_BACKLOG,
    ADVISORY_FIELDS_BACKLOG,
    input.strict,
    errors,
    advisories,
  );

  return { errors, advisories };
}

function pushIssues(
  entries: BacklogEntry[],
  file: TriageIssue['file'],
  requiredFields: ReadonlyArray<keyof BacklogEntry>,
  advisoryFields: ReadonlyArray<keyof BacklogEntry>,
  strict: boolean,
  errors: TriageIssue[],
  advisories: TriageIssue[],
): void {
  const seen = new Map<string, number>();
  for (const entry of entries) {
    const key = entry.name;
    const prior = seen.get(key);
    if (prior !== undefined) {
      errors.push({
        entryName: entry.name,
        file,
        message: `Duplicate name '${entry.name}' within ${
          file === 'docs/roadmap.md' ? 'roadmap' : 'backlog'
        } (already used at priority ${prior}).`,
        rule: 'duplicate-name',
      });
    }
    seen.set(key, entry.priority ?? -1);

    for (const field of requiredFields) {
      if (!entry[field]) {
        errors.push({
          entryName: entry.name,
          file,
          message: `Entry '${entry.name}' is missing required field \`${field}\`.`,
          rule: 'missing-required-field',
        });
      }
    }

    if (entry.type && !KNOWN_TYPES.has(entry.type)) {
      errors.push({
        entryName: entry.name,
        file,
        message: `Entry '${entry.name}' has unknown type \`${entry.type}\` (expected one of ${[...KNOWN_TYPES].join(', ')}).`,
        rule: 'unknown-type-value',
      });
    }

    for (const field of advisoryFields) {
      if (!entry[field]) {
        const issue: TriageIssue = {
          entryName: entry.name,
          file,
          message: `Entry '${entry.name}' is missing field \`${field}\` (advisory until backfill is complete).`,
          rule: 'missing-optional-field',
        };
        if (strict) errors.push(issue);
        else advisories.push(issue);
      }
    }
  }
}

interface CliOptions {
  strict: boolean;
  cwd: string;
}

function parseArgv(argv: string[]): CliOptions {
  return {
    strict: argv.includes('--strict'),
    cwd: process.cwd(),
  };
}

async function main(): Promise<void> {
  const opts = parseArgv(process.argv.slice(2));
  const [roadmapRaw, backlogRaw] = await Promise.all([
    readFile(`${opts.cwd}/docs/roadmap.md`, 'utf8'),
    readFile(`${opts.cwd}/docs/backlog.md`, 'utf8'),
  ]);
  const result = validateTriageInputs({ roadmapRaw, backlogRaw, strict: opts.strict });
  for (const advisory of result.advisories) {
    console.warn(`advisory [${advisory.rule}] ${advisory.file}: ${advisory.message}`);
  }
  for (const err of result.errors) {
    console.error(`error    [${err.rule}] ${err.file}: ${err.message}`);
  }
  if (result.errors.length > 0) {
    console.error(`validate:triage failed with ${result.errors.length} error(s).`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `validate:triage OK (${result.advisories.length} advisor${result.advisories.length === 1 ? 'y' : 'ies'}).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
