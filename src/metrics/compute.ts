import { execFileSync } from 'node:child_process';
import { extractFacts } from './facts.js';
import { collectCycleTime } from './collect/cycle-time.js';
import { collectRoutingAccuracy } from './collect/routing-accuracy.js';
import { collectCrEffectiveness } from './collect/cr-effectiveness.js';
import { collectDrainReliability } from './collect/drain-reliability.js';
import { collectOverridePressure } from './collect/override-pressure.js';
import { collectTokensPerFeature } from './collect/tokens-per-feature.js';
import type { Collector, MetricsReport } from './types.js';

export const COLLECTORS: readonly Collector[] = [
  collectCycleTime,
  collectRoutingAccuracy,
  collectCrEffectiveness,
  collectDrainReliability,
  collectOverridePressure,
  collectTokensPerFeature,
];

/** Derive-on-demand: one facts pass, all collectors. No persistent store — git is the store. */
export async function compute(cwd: string = process.cwd()): Promise<MetricsReport> {
  const facts = await extractFacts(cwd);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  return {
    generatedAt: new Date().toISOString(),
    head,
    factsWarnings: facts.warnings,
    metrics: COLLECTORS.map((c) => c(facts)),
  };
}
