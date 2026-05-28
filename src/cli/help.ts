import { MANIFEST } from './manifest.js';

export function printHelp(group?: string): void {
  if (!group) {
    console.log('Usage: noldor <command> [subcommand] [args]\n\nCommands:');
    for (const [name, g] of Object.entries(MANIFEST)) {
      console.log(`  ${name.padEnd(16)} ${g.desc}`);
    }
    console.log('\n  --version          Print version');
    console.log('  --help             Print this help');
    return;
  }
  const g = MANIFEST[group];
  if (!g) {
    console.error(`Unknown command: ${group}`);
    process.exit(1);
  }
  // Leaf command: single '' subcommand.
  if (g.subs['']) {
    console.log(`Usage: noldor ${group} [flags] [args]\n\n${g.desc}`);
    return;
  }
  console.log(`Usage: noldor ${group} <subcommand> [args]\n\n${g.desc}\n\nSubcommands:`);
  for (const [name, sub] of Object.entries(g.subs)) {
    console.log(`  ${name.padEnd(22)} ${sub.desc}`);
  }
}
