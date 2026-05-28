import { fillMarkers } from '../release-markers.js';

describe(fillMarkers, () => {
  it('fills introduced when phase=done and introduced absent', () => {
    const md = `---
name: Example
phase: done
area: test
packages: [format]
links:
  code: []
  tests: []
---

## Summary
x
`;
    const out = fillMarkers(md, {
      hasChangelogBlock: false,
      newVersion: '0.2.0',
    });
    expect(out).toMatch(/introduced:\s*['"]?0\.2\.0['"]?/);
  });

  it('fills updated when phase=done and file modified since last tag', () => {
    const md = `---
name: Example
phase: done
introduced: "0.1.0"
area: test
packages: [format]
links:
  code: []
  tests: []
---

## Summary
x
`;
    const out = fillMarkers(md, {
      hasChangelogBlock: true,
      newVersion: '0.2.0',
    });
    expect(out).toMatch(/updated:\s*['"]?0\.2\.0['"]?/);
    expect(out).toMatch(/introduced:\s*['"]?0\.1\.0['"]?/);
  });

  it('does not touch unmodified, already-introduced done MDs', () => {
    const md = `---
name: Example
phase: done
introduced: "0.1.0"
area: test
packages: [format]
links:
  code: []
  tests: []
---

## Summary
x
`;
    expect(fillMarkers(md, { hasChangelogBlock: false, newVersion: '0.2.0' })).toBe(md);
  });

  it('does not touch in-progress MDs regardless of modification', () => {
    const md = `---
name: Example
phase: in-progress
area: test
packages: [format]
links:
  code: []
  tests: []
---

## Summary
x
`;
    expect(fillMarkers(md, { hasChangelogBlock: true, newVersion: '0.2.0' })).toBe(md);
  });
});

describe('fillMarkers (changelog-driven updated rule)', () => {
  it('flips `updated` when hasChangelogBlock is true', () => {
    const md = [
      '---',
      'name: F',
      'phase: done',
      "introduced: '0.1.0'",
      'category: Editor',
      'area: f',
      'packages:',
      '  - web',
      'links:',
      '  code: []',
      '  docs: []',
      '  tests: []',
      '---',
      '',
      '## Summary',
      '',
      'x',
      '',
    ].join('\n');
    const out = fillMarkers(md, { newVersion: '0.2.0', hasChangelogBlock: true });
    expect(out).toContain('updated: 0.2.0');
  });

  it('does NOT flip `updated` when hasChangelogBlock is false', () => {
    const md = [
      '---',
      'name: F',
      'phase: done',
      "introduced: '0.1.0'",
      'category: Editor',
      'area: f',
      'packages:',
      '  - web',
      'links:',
      '  code: []',
      '  docs: []',
      '  tests: []',
      '---',
      '',
      '## Summary',
      '',
      'x',
      '',
    ].join('\n');
    const out = fillMarkers(md, { newVersion: '0.2.0', hasChangelogBlock: false });
    expect(out).not.toContain('updated:');
  });
});
