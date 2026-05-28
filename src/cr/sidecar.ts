import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const FindingSchema = z.object({
  file: z.string(),
  line: z.number().int().positive().nullable(),
  severity: z.enum(['high', 'medium']).nullable(),
  message: z.string(),
  suggestion: z.string().nullable(),
});

// scripts/cr/cr-record.schema.json is regenerated from this schema via zod-to-json-schema; scripts/cr/__tests__/schema-parity.test.ts asserts equality at CI time. OpenAI strict structured-output rejects root $ref + missing required keys, so we generate a flat schema with $refStrategy:'none' and use .nullable() (not .optional()) on every field so all keys land in `required`. Regen: pnpm exec tsx -e "import {CrRecordSchema} from './scripts/cr/sidecar.ts'; import {zodToJsonSchema} from 'zod-to-json-schema'; import {writeFileSync} from 'node:fs'; writeFileSync('scripts/cr/cr-record.schema.json', JSON.stringify(zodToJsonSchema(CrRecordSchema, {target:'jsonSchema7',\$refStrategy:'none'}), null, 2)+'\n')"
export const CrRecordSchema = z
  .object({
    blockers: z.array(FindingSchema),
    suggestions: z.array(FindingSchema),
    summary: z.string(),
  })
  .strict();
export type CrRecord = z.infer<typeof CrRecordSchema>;

export type SidecarSelector =
  | { kind: 'gate'; tree: string }
  | { kind: 'sha'; tree: string }
  | { kind: 'working'; tree: string; timestamp: number }
  | { kind: 'range'; from: string; to: string }
  | { kind: 'paths'; tree: string; pathsHash: string };

export function sidecarFilename(s: SidecarSelector): string {
  switch (s.kind) {
    case 'gate':
    case 'sha':
      return `${s.tree}.codex.json`;
    case 'working':
      return `working-${s.tree}-${s.timestamp}.codex.json`;
    case 'range':
      return `range-${s.from}-${s.to}.codex.json`;
    case 'paths':
      return `paths-${s.tree}-${s.pathsHash}.codex.json`;
  }
}

const DIR = ['.noldor', 'cr-records'] as const;

export function writeSidecar(cwd: string, filename: string, record: CrRecord): void {
  const dir = join(cwd, ...DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), JSON.stringify(record, null, 2) + '\n', 'utf8');
}

// Throws if the file does not exist (ENOENT) or if the JSON fails CrRecordSchema validation.
export function readSidecar(cwd: string, filename: string): CrRecord {
  const raw = readFileSync(join(cwd, ...DIR, filename), 'utf8');
  return CrRecordSchema.parse(JSON.parse(raw));
}
