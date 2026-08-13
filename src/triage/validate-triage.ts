import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import matter from 'gray-matter';

import { parseBacklog, parseRoadmap, type BacklogEntry } from '../utils/parse-blocks.js';
import { COUNTER_PATH_DEFAULT, ENTRY_ID_RE } from './entry-id.js';
import { RETIRED_IDS_PATH_DEFAULT, loadRetiredIds, retiredRefs } from './retired-ids.js';

export interface TriageIssue {
  file: 'docs/roadmap.md' | 'docs/backlog.md';
  rule:
    | 'duplicate-name'
    | 'missing-required-field'
    | 'missing-optional-field'
    | 'unknown-type-value'
    | 'missing-entry-id'
    | 'malformed-entry-id'
    | 'duplicate-entry-id'
    | 'unknown-blocked-by-ref'
    | 'empty-group-heading';
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
  /**
   * Whether `.noldor/id-counter.json` exists. Gates the `missing-entry-id`
   * error: absent counter ⇒ the repo hasn't opted into stable IDs, so a missing
   * `id` is silent (adoption-safe). Malformed/duplicate IDs are always errors
   * regardless. The CLI injects `existsSync(...)`; tests pass it directly.
   */
  counterExists: boolean;
  /**
   * Slugs of existing feature MDs (`docs/features/*.md` basenames). Widens the
   * known-ref set for `unknown-blocked-by-ref` so a `blocked-by:` ref pointing at
   * already-shipped work whose queue entry was retired still resolves. The CLI
   * fills this from `readdir`; tests pass it directly. Defaults to empty.
   */
  featureSlugs?: readonly string[];
  /**
   * `entry-id:` frontmatter values of existing feature MDs. Same purpose as
   * {@link ValidateTriageInputs.featureSlugs} but for ID-shaped `blocked-by:`
   * refs (`Q-NNNN`) that target a shipped feature. Defaults to empty.
   */
  featureEntryIds?: readonly string[];
  /**
   * IDs *and slugs* from the retired-ID map (`.noldor/retired-entry-ids.json`)
   * — entries retired by the no-FD paths (fast-track, attach), whose IDs land
   * in no FD frontmatter. Both forms are included because `blocked-by:` accepts
   * either (`<slug|Q-id>`). Widens the known-ref set the same way as
   * {@link ValidateTriageInputs.featureEntryIds}. The CLI fills this via
   * `loadRetiredIds` (keys + record slugs); tests pass it directly. Defaults to
   * empty.
   */
  retiredEntryIds?: readonly string[];
  /**
   * When true, `unknown-blocked-by-ref` alone is promoted to an error while
   * every other advisory keeps its default severity. Self-host CI runs with
   * this (`--strict-refs`) so a dangling ref cannot land, while consumer
   * validation stays advisory by default.
   */
  strictRefs?: boolean;
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

  pushEmptyGroupIssues(input.roadmapRaw, 'docs/roadmap.md', errors);
  pushEmptyGroupIssues(input.backlogRaw, 'docs/backlog.md', errors);

  pushIdIssues(roadmap, backlog, input.counterExists, errors);
  pushBlockedByIssues(
    roadmap,
    backlog,
    input.featureSlugs ?? [],
    [...(input.featureEntryIds ?? []), ...(input.retiredEntryIds ?? [])],
    input.strict || (input.strictRefs ?? false),
    errors,
    advisories,
  );

  return { errors, advisories };
}

/**
 * Flag `### <Heading>` blocks that are neither an entry nor a populated group.
 *
 * The queue file format is frozen at one level: every entry is a `### <Entry
 * Name>` carrying an `- area:` bullet, and writers never mint grouping
 * containers (see `docs/noldor/triage.md` → File format is frozen). An H3
 * without `- area:` is therefore a legacy category container — `parseRoadmap`
 * still reads its `#### <Entry>` children for back-compat, so a *populated*
 * category is tolerated while a consumer repo migrates. An **empty** one is
 * dead structure: the entries it grouped drained away and the heading stayed,
 * burying the priority-ordered list the gate's Step 0 pickup has to scan. That
 * is what this rule catches, so a drained category cannot linger.
 *
 * A group is populated when at least one `#### ` heading appears before the
 * next `### `. Code fences are skipped so a markdown example inside a block is
 * not mistaken for real structure.
 */
function pushEmptyGroupIssues(raw: string, file: TriageIssue['file'], errors: TriageIssue[]): void {
  interface PendingGroup {
    name: string;
    line: number;
    hasArea: boolean;
    childCount: number;
  }

  let pending: PendingGroup | null = null;
  let inFence = false;

  const flush = (): void => {
    if (pending === null) return;
    if (!pending.hasArea && pending.childCount === 0) {
      errors.push({
        entryName: pending.name,
        file,
        message: `Heading '${pending.name}' (line ${pending.line}) is a group heading with no entry beneath it — it carries no \`- area:\` bullet of its own and no \`#### \` entry follows. Drop it: the queue is a flat list of \`### <Entry Name>\` blocks and writers never mint grouping categories.`,
        rule: 'empty-group-heading',
      });
    }
    pending = null;
  };

  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const h3 = /^###\s+(.+?)\s*$/.exec(line);
    if (h3) {
      flush();
      pending = { name: h3[1], line: i + 1, hasArea: false, childCount: 0 };
      continue;
    }
    if (pending === null) continue;
    if (/^####\s+\S/.test(line)) pending.childCount++;
    else if (/^-\s+area:/.test(line) && pending.childCount === 0) pending.hasArea = true;
  }
  flush();
}

/**
 * Validate that every `blocked-by:` ref (the first-class field; `deps:` is its
 * legacy alias — both land in {@link BacklogEntry.deps}) resolves to a known
 * entry: an entry ID or slug present in roadmap/backlog, the slug/`entry-id`
 * of an existing feature MD, or an ID in the retired-ID map (the caller unions
 * those into `featureEntryIds` — together they cover refs on already-shipped
 * work whose queue entry was retired). Unknown refs are advisory by default
 * (adoption-safe: pre-existing stale refs must not hard-break `validate:triage`)
 * and promoted to errors under `--strict` (all advisories) or `--strict-refs`
 * (this rule alone), mirroring the missing-optional-field policy.
 */
function pushBlockedByIssues(
  roadmap: BacklogEntry[],
  backlog: BacklogEntry[],
  featureSlugs: readonly string[],
  featureEntryIds: readonly string[],
  strict: boolean,
  errors: TriageIssue[],
  advisories: TriageIssue[],
): void {
  const known = new Set<string>([...featureSlugs, ...featureEntryIds]);
  for (const entry of [...roadmap, ...backlog]) {
    if (entry.id !== undefined) known.add(entry.id);
    if (entry.slug.length > 0) known.add(entry.slug);
  }
  const scan = (entries: BacklogEntry[], file: TriageIssue['file']): void => {
    for (const entry of entries) {
      for (const ref of entry.deps ?? []) {
        if (known.has(ref)) continue;
        const issue: TriageIssue = {
          entryName: entry.name,
          file,
          message: `Entry '${entry.name}' has \`blocked-by\` ref '${ref}' that matches no known entry ID, slug, or feature MD.`,
          rule: 'unknown-blocked-by-ref',
        };
        if (strict) errors.push(issue);
        else advisories.push(issue);
      }
    }
  };
  scan(roadmap, 'docs/roadmap.md');
  scan(backlog, 'docs/backlog.md');
}

/**
 * Cross-file entry-ID checks. Unlike the per-file `duplicate-name` pass, ID
 * uniqueness spans roadmap **and** backlog combined — the single `Q-` namespace
 * means a collision across files is the parallel-branch mint-race backstop.
 *
 * - `missing-entry-id` — error, gated on the counter file existing (a repo that
 *   never ran backfill isn't blocked).
 * - `malformed-entry-id` — id present but fails {@link ENTRY_ID_RE}. Always error.
 * - `duplicate-entry-id` — same id in two entries across both files. Always error.
 */
function pushIdIssues(
  roadmap: BacklogEntry[],
  backlog: BacklogEntry[],
  counterExists: boolean,
  errors: TriageIssue[],
): void {
  const seen = new Map<string, { file: TriageIssue['file']; name: string }>();
  const scan = (entries: BacklogEntry[], file: TriageIssue['file']): void => {
    for (const entry of entries) {
      if (entry.id === undefined) {
        if (counterExists) {
          errors.push({
            entryName: entry.name,
            file,
            message: `Entry '${entry.name}' is missing required field \`id\` (run \`pnpm noldor triage backfill-ids\`).`,
            rule: 'missing-entry-id',
          });
        }
        continue;
      }
      if (!ENTRY_ID_RE.test(entry.id)) {
        errors.push({
          entryName: entry.name,
          file,
          message: `Entry '${entry.name}' has malformed \`id\` '${entry.id}' (expected \`Q-NNNN\`).`,
          rule: 'malformed-entry-id',
        });
        continue;
      }
      const prior = seen.get(entry.id);
      if (prior !== undefined) {
        errors.push({
          entryName: entry.name,
          file,
          message: `Duplicate id '${entry.id}' on '${entry.name}' (already used by '${prior.name}' in ${prior.file}).`,
          rule: 'duplicate-entry-id',
        });
        continue;
      }
      seen.set(entry.id, { file, name: entry.name });
    }
  };
  scan(roadmap, 'docs/roadmap.md');
  scan(backlog, 'docs/backlog.md');
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
  strictRefs: boolean;
  cwd: string;
}

function parseArgv(argv: string[]): CliOptions {
  return {
    strict: argv.includes('--strict'),
    strictRefs: argv.includes('--strict-refs'),
    cwd: process.cwd(),
  };
}

/**
 * Scan `docs/features` for existing feature MDs, returning their slugs (file
 * basenames) and `entry-id:` frontmatter values. Feeds the known-ref set for
 * `unknown-blocked-by-ref`. A missing directory yields empty arrays.
 */
async function loadFeatureRefs(
  featuresDir: string,
): Promise<{ featureSlugs: string[]; featureEntryIds: string[] }> {
  if (!existsSync(featuresDir)) return { featureSlugs: [], featureEntryIds: [] };
  const featureSlugs: string[] = [];
  const featureEntryIds: string[] = [];
  for (const file of await readdir(featuresDir)) {
    if (!file.endsWith('.md')) continue;
    featureSlugs.push(file.slice(0, -3));
    const parsed = matter(await readFile(join(featuresDir, file), 'utf8'));
    const entryId = (parsed.data as { 'entry-id'?: unknown })['entry-id'];
    if (typeof entryId === 'string') featureEntryIds.push(entryId);
  }
  return { featureSlugs, featureEntryIds };
}

async function main(): Promise<void> {
  const opts = parseArgv(process.argv.slice(2));
  const [roadmapRaw, backlogRaw] = await Promise.all([
    readFile(`${opts.cwd}/docs/roadmap.md`, 'utf8'),
    readFile(`${opts.cwd}/docs/backlog.md`, 'utf8'),
  ]);
  const counterExists = existsSync(`${opts.cwd}/${COUNTER_PATH_DEFAULT}`);
  const { featureSlugs, featureEntryIds } = await loadFeatureRefs(`${opts.cwd}/docs/features`);
  const retiredMap = loadRetiredIds(`${opts.cwd}/${RETIRED_IDS_PATH_DEFAULT}`);
  const retiredEntryIds = [...retiredRefs(retiredMap)];
  const result = validateTriageInputs({
    roadmapRaw,
    backlogRaw,
    strict: opts.strict,
    strictRefs: opts.strictRefs,
    counterExists,
    featureSlugs,
    featureEntryIds,
    retiredEntryIds,
  });
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
