import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compute } from './compute.js';
import type { MetricsReport } from './types.js';

export interface CliArgs {
  jsonPath: string | undefined;
  metric: string | undefined;
}

export function parseArgs(argv: string[]): CliArgs {
  const jsonIdx = argv.indexOf('--json');
  const metricIdx = argv.indexOf('--metric');
  return {
    jsonPath: jsonIdx >= 0 ? argv[jsonIdx + 1] : undefined,
    metric: metricIdx >= 0 ? argv[metricIdx + 1] : undefined,
  };
}

export function formatReport(report: MetricsReport, onlyMetric: string | undefined): string {
  const metrics = onlyMetric ? report.metrics.filter((m) => m.id === onlyMetric) : report.metrics;
  if (onlyMetric && metrics.length === 0) return `no metric with id '${onlyMetric}'\n`;
  const lines: string[] = [`metrics @ ${report.head.slice(0, 7)} (${report.generatedAt})`, ''];
  for (const m of metrics) {
    lines.push(`## ${m.id} [${m.unit}]`);
    lines.push(JSON.stringify(m.value, null, 2));
    lines.push(`formula: ${m.formula}`);
    lines.push(`blind spots: ${m.blindSpots.join(' | ')}`);
    lines.push('');
  }
  if (report.factsWarnings.length > 0) lines.push(`warnings: ${report.factsWarnings.join(' | ')}`);
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await compute(process.cwd());
  const outPath = args.jsonPath ?? join(process.cwd(), 'metrics.json');
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(formatReport(report, args.metric));
  process.stdout.write(`wrote ${outPath}\n`);
}

const invokedDirect = /[\\/]compute-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
