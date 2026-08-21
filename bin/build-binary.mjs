#!/usr/bin/env node
// pnpm build:binary [--target=<bun-target>] [--outfile=<path>]
// Guard bun >= floor -> pnpm build (tsgo dist) -> assemble assets.pack ->
// bun build --compile (spec Unit 4).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.cwd();

function fail(msg) {
  console.error(`build-binary: ${msg}`);
  process.exit(1);
}

// 1. Guard: bun present. Floor check happens after the dist build (the floor
// constant ships as compiled dist output).
let bunVersion;
try {
  bunVersion = execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim();
} catch {
  fail('bun is not installed — see https://bun.sh (external tool, not a devDependency)');
}

// 2. Build dist first (also produces dist/binary/bun-floor.js on a cold tree).
const build = spawnSync('node', ['bin/build.mjs'], { stdio: 'inherit' });
if (build.status !== 0) fail('dist build failed');

const { BUN_FLOOR } = await import(join(root, 'dist/binary/bun-floor.js'));
const lt = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
};
if (lt(bunVersion, BUN_FLOOR)) fail(`bun ${bunVersion} < floor ${BUN_FLOOR}`);

// 3. Assemble assets.pack from the derived list.
const { packFileList } = await import(join(root, 'dist/binary/pack-list.js'));
const { buildPack } = await import(join(root, 'dist/binary/asset-pack.js'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const files = packFileList(root).map((path) => ({
  path,
  mode: path.startsWith('bin/') ? 0o755 : 0o644,
  data: readFileSync(join(root, path)),
}));
writeFileSync(join(root, 'assets.pack'), buildPack(pkg.version, files));
console.log(`assets.pack: ${files.length} entries`);

// 4. Compile.
const targetArg = process.argv.find((a) => a.startsWith('--target='));
const outArg = process.argv.find((a) => a.startsWith('--outfile='));
const outfile = outArg ? outArg.slice('--outfile='.length) : join('out', 'noldor');
mkdirSync(join(root, dirname(outfile)), { recursive: true });
const args = [
  'build',
  '--compile',
  'dist/binary/entry.js',
  'assets.pack',
  '--define',
  `NOLDOR_BINARY_VERSION=${JSON.stringify(pkg.version)}`,
  '--outfile',
  outfile,
];
if (targetArg) args.splice(2, 0, `--target=${targetArg.slice('--target='.length)}`);
const compile = spawnSync('bun', args, { stdio: 'inherit' });
if (compile.status !== 0) fail('bun compile failed');
console.log(`built ${outfile} (bun ${bunVersion}, version ${pkg.version})`);
