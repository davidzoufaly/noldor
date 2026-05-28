import { extractUntriagedBullets } from '../triage-list-untriaged.js';

// @tests: scripts-reorganization-by-feature-area
describe(extractUntriagedBullets, () => {
  it('returns Now/Next/Later bullets under ## Verticals without a [triaged …] marker', () => {
    const md = `# Ideas

## Verticals

### Business

#### Next

- raw idea one
- another raw idea
`;
    const out = extractUntriagedBullets(md);
    expect(out.map((b) => b.text)).toStrictEqual(['raw idea one', 'another raw idea']);
  });

  it('skips bullets that already carry a [triaged …] marker', () => {
    const md = `# Ideas

## Verticals

### Business

#### Later

- raw [triaged 2026-04-27 → cloud-sync]
- still raw
`;
    const out = extractUntriagedBullets(md);
    expect(out.map((b) => b.text)).toStrictEqual(['still raw']);
  });

  it('ignores nested-list lines and bullets above ## Verticals', () => {
    const md = `# Ideas

- header note (skip; not under Verticals)

## Verticals

### Tooling

#### Now

- top-level idea
  - nested detail (skip)
  - another nested
- another top-level
`;
    const out = extractUntriagedBullets(md);
    expect(out.map((b) => b.text)).toStrictEqual(['top-level idea', 'another top-level']);
  });

  it('skips bullets in #### Done sections', () => {
    const md = `## Verticals

### Core Product

#### Next

- raw next item

#### Done

- already done item
`;
    const out = extractUntriagedBullets(md);
    expect(out.map((b) => b.text)).toStrictEqual(['raw next item']);
  });

  it('skips bullets in ## In Progress / ## Not groomed', () => {
    const md = `## In Progress

- working item

## Not groomed

- placeholder

## Verticals

### Business

#### Next

- real candidate
`;
    const out = extractUntriagedBullets(md);
    expect(out.map((b) => b.text)).toStrictEqual(['real candidate']);
  });

  it('records 1-indexed line numbers', () => {
    const md = `## Verticals\n\n### Business\n\n#### Now\n\n- seventh-line idea\n`;
    const out = extractUntriagedBullets(md);
    expect(out[0]?.line).toBe(7);
  });
});
