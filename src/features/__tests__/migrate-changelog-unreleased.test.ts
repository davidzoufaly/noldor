// packages/noldor/src/features/__tests__/migrate-changelog-unreleased.test.ts
// @tests: dynamic-fd-changelog

import { describe, expect, it } from 'vitest';

import { migrateChangelogContent } from '../migrate-changelog-unreleased.js';

describe('migrateChangelogContent', () => {
  it('returns noop for body with no ## Changelog section', () => {
    const body = '## Summary\n\nFoo.\n';
    const result = migrateChangelogContent(body, {});
    expect(result.action).toBe('noop');
    expect(result.newBody).toBe(body);
  });

  it('returns noop for body with ## Changelog but no ### Unreleased', () => {
    const body = '## Changelog\n\n### 0.3.0\n\n#### Summary\n\nold\n';
    const result = migrateChangelogContent(body, { updated: '0.3.0' });
    expect(result.action).toBe('noop');
    expect(result.newBody).toBe(body);
  });

  it('promotes ### Unreleased to ### <updated> when updated frontmatter is set and no clash', () => {
    const body = [
      '## Changelog',
      '',
      '### Unreleased',
      '',
      '#### Summary',
      '',
      'Staged copy.',
      '',
      '### 0.2.0',
      '',
      '#### Summary',
      '',
      'older.',
      '',
    ].join('\n');
    const result = migrateChangelogContent(body, { updated: '0.3.0' });
    expect(result.action).toBe('promoted');
    expect(result.newBody).not.toContain('### Unreleased');
    expect(result.newBody).toContain('### 0.3.0');
    expect(result.newBody).toContain('Staged copy.');
    expect(result.newBody).toContain('### 0.2.0');
  });

  it('strips ### Unreleased when frontmatter has no updated field', () => {
    const body = [
      '## Changelog',
      '',
      '### Unreleased',
      '',
      '#### Summary',
      '',
      'Staged copy.',
      '',
    ].join('\n');
    const result = migrateChangelogContent(body, {});
    expect(result.action).toBe('stripped');
    expect(result.newBody).not.toContain('### Unreleased');
    expect(result.newBody).not.toContain('Staged copy.');
    expect(result.newBody).toContain('## Changelog');
  });

  it('logs warning and leaves both blocks intact on clash', () => {
    const body = [
      '## Changelog',
      '',
      '### Unreleased',
      '',
      '#### Summary',
      '',
      'Staged.',
      '',
      '### 0.3.0',
      '',
      '#### Summary',
      '',
      'Already shipped.',
      '',
    ].join('\n');
    const result = migrateChangelogContent(body, { updated: '0.3.0' });
    expect(result.action).toBe('clash');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/0\.3\.0/);
    // Both blocks preserved untouched.
    expect(result.newBody).toContain('### Unreleased');
    expect(result.newBody).toContain('### 0.3.0');
    expect(result.newBody).toContain('Staged.');
    expect(result.newBody).toContain('Already shipped.');
  });

  it('strips #### Commits subsections from any ### <version> block (defensive)', () => {
    const body = [
      '## Changelog',
      '',
      '### 0.2.0',
      '',
      '#### Summary',
      '',
      'Shipped.',
      '',
      '#### Commits',
      '',
      '- feat: a ([abc](https://x/commit/abc))',
      '- fix: b ([def](https://x/commit/def))',
      '',
      '### 0.1.0',
      '',
      '#### Summary',
      '',
      'First.',
      '',
    ].join('\n');
    const result = migrateChangelogContent(body, {});
    expect(result.newBody).toContain('### 0.2.0');
    expect(result.newBody).toContain('Shipped.');
    expect(result.newBody).not.toContain('#### Commits');
    expect(result.newBody).not.toContain('- feat: a');
    expect(result.newBody).toContain('### 0.1.0');
    expect(result.newBody).toContain('First.');
  });

  it('is idempotent: running twice on a promote case yields identical output', () => {
    const body = [
      '## Changelog',
      '',
      '### Unreleased',
      '',
      '#### Summary',
      '',
      'Staged copy.',
      '',
    ].join('\n');
    const first = migrateChangelogContent(body, { updated: '0.3.0' });
    const second = migrateChangelogContent(first.newBody, { updated: '0.3.0' });
    expect(second.action).toBe('noop');
    expect(second.newBody).toBe(first.newBody);
  });

  it('preserves head content above ## Changelog untouched', () => {
    const body = [
      '## Summary',
      '',
      'Keep me.',
      '',
      '## User Story',
      '',
      'Also me.',
      '',
      '## Changelog',
      '',
      '### Unreleased',
      '',
      '#### Summary',
      '',
      'staged.',
      '',
    ].join('\n');
    const result = migrateChangelogContent(body, {});
    expect(result.newBody).toContain('## Summary\n\nKeep me.');
    expect(result.newBody).toContain('## User Story\n\nAlso me.');
    expect(result.newBody).not.toContain('### Unreleased');
  });
});
