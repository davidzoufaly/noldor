import { runList } from './cli-cores.js';
import { isEntrypoint } from '../core/cli-entry.js';

function main(): void {
  for (const r of runList(process.cwd())) {
    const scope = r.appliesTo.length ? r.appliesTo.join(',') : '(stage-level)';
    console.log(
      `${r.id}\t${r.stage.join(',') || 'any'}\t${r.enforce ? 'enforce' : 'inject'}\t${scope}`,
    );
  }
}

if (isEntrypoint(import.meta.url)) main();
