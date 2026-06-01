import { runResolve } from './cli-cores.js';
import type { Stage } from '../core/rules/stage.js';

function main(): void {
  const args = process.argv.slice(2);
  let file: string | undefined;
  let stage: Stage | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file') file = args[++i];
    else if (args[i] === '--stage') stage = args[++i] as Stage;
  }
  const { injected, enforce } = runResolve(process.cwd(), { file, stage });
  console.log(JSON.stringify({ injected, enforce }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
