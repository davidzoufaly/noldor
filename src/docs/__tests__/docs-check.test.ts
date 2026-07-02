// @tests: doc-gardening-skill
import { checkLinks, extractLinks, slugifyHeading } from '../docs-check.js';

describe(extractLinks, () => {
  it('finds inline markdown links and skips external', () => {
    const md = `Body [a](./x.md) [b](https://x.com) [c](mailto:foo@bar)`;
    const links = extractLinks(md);
    expect(links.map((l) => l.href)).toStrictEqual(['./x.md']);
  });

  it('keeps anchor fragment in href', () => {
    const md = `[a](./x.md#section)`;
    const links = extractLinks(md);
    expect(links[0].href).toBe('./x.md#section');
  });
});

describe(slugifyHeading, () => {
  it('lowercases and replaces spaces', () => {
    expect(slugifyHeading('A Heading')).toBe('a-heading');
  });

  it('strips punctuation', () => {
    expect(slugifyHeading("It's complicated")).toBe('its-complicated');
  });
});

describe(checkLinks, () => {
  it('returns no errors for the good fixture', async () => {
    const errors = await checkLinks(['src/fixtures/docs-check/good.md']);
    expect(errors).toStrictEqual([]);
  });

  it('flags missing files and missing anchors', async () => {
    const errors = await checkLinks(['src/fixtures/docs-check/broken.md']);
    expect(errors).toHaveLength(1);
    expect(errors[0].file).toContain('broken.md');
    expect(errors[0].issues.some((i) => i.includes('does-not-exist.md'))).toBeTruthy();
    expect(errors[0].issues.some((i) => i.includes('missing-anchor'))).toBeTruthy();
  });
});
