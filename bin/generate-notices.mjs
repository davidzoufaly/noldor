#!/usr/bin/env node
// THIRD_PARTY_NOTICES.txt generator (spec Unit 5). Fail-closed: any package in
// the production dependency tree with a missing or unrecognizable license
// fails the build. --stdout prints instead of writing the file.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

// The full transitive production tree, not just direct dependencies — every
// bundled package carries redistribution obligations.
const raw = execFileSync('pnpm', ['licenses', 'list', '--json', '--prod'], {
  cwd: root,
  encoding: 'utf8',
});
const byLicense = JSON.parse(raw);
const packages = new Map();
for (const [license, pkgs] of Object.entries(byLicense)) {
  for (const p of pkgs) {
    if (typeof license !== 'string' || license === '' || license === 'Unknown') {
      console.error(`generate-notices: ${p.name} has an unrecognizable license ('${license}')`);
      process.exit(1);
    }
    packages.set(p.name, { license, paths: p.paths ?? [] });
  }
}

function licenseBody(name, info) {
  for (const dir of info.paths) {
    if (!dir || !existsSync(dir)) continue;
    const file = readdirSync(dir).find((f) => /^licen[cs]e(\.|$)/i.test(f));
    if (file) return readFileSync(join(dir, file), 'utf8').trim();
  }
  return '(license text not shipped in the package; see package metadata)';
}

const names = [...packages.keys()].sort();
const sections = names.map((name) => {
  const info = packages.get(name);
  return `## ${name}\nLicense: ${info.license}\n\n${licenseBody(name, info)}\n`;
});
sections.push(
  '## Bun runtime\nLicense: MIT\n\nThe compiled binary embeds the Bun runtime (https://bun.sh), distributed under the MIT license.\n',
);
const out = `Third-party notices for the noldor binary distribution\n\n${sections.join('\n')}`;
if (process.argv.includes('--stdout')) process.stdout.write(out);
else writeFileSync(join(root, 'THIRD_PARTY_NOTICES.txt'), out);
console.error(`generate-notices: ${names.length} package(s) + Bun runtime`);
