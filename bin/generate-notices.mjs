#!/usr/bin/env node
// THIRD_PARTY_NOTICES.txt generator (spec Unit 5). Fail-closed: a production
// dependency with no license text or unrecognizable license field fails the
// build. --stdout prints instead of writing the file.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const deps = Object.keys(pkg.dependencies ?? {}).sort();

function licenseTextFor(dep) {
  const dir = join(root, 'node_modules', dep);
  const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  if (typeof meta.license !== 'string' || meta.license === '') {
    console.error(`generate-notices: ${dep} has no recognizable license field`);
    process.exit(1);
  }
  const file = readdirSync(dir).find((f) => /^licen[cs]e(\.|$)/i.test(f));
  const body = file
    ? readFileSync(join(dir, file), 'utf8').trim()
    : '(license text not shipped; see package metadata)';
  return `## ${dep}\nLicense: ${meta.license}\n\n${body}\n`;
}

const sections = deps.map(licenseTextFor);
sections.push(
  '## Bun runtime\nLicense: MIT\n\nThe compiled binary embeds the Bun runtime (https://bun.sh), distributed under the MIT license.\n',
);
const out = `Third-party notices for the noldor binary distribution\n\n${sections.join('\n')}`;
if (process.argv.includes('--stdout')) process.stdout.write(out);
else writeFileSync(join(root, 'THIRD_PARTY_NOTICES.txt'), out);
