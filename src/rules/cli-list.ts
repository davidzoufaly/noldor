import { runList } from './cli-cores.js';

function main(): void {
  for (const r of runList(process.cwd())) {
    const scope = r.appliesTo.length ? r.appliesTo.join(',') : '(stage-level)';
    console.log(
      `${r.id}\t${r.stage.join(',') || 'any'}\t${r.enforce ? 'enforce' : 'inject'}\t${scope}`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
