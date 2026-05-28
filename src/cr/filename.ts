import { laneSchema } from './findings-schema.js';
import type { Lane } from './findings-schema.js';

export function inferLaneFromFilename(file: string): Lane | null {
  return laneSchema.options.find((l) => file.endsWith(`-${l}.json`)) ?? null;
}
