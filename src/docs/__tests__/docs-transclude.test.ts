// @tests: doc-gardening-skill
import { transcludeMarkers } from '../docs-transclude.js';

describe(transcludeMarkers, () => {
  it('replaces example body between markers', () => {
    const tutorial = `# Tutorial

Some prose.

<!-- example:start your-first-shape -->
<!-- example:end -->

More prose.
`;
    const exampleSource = `export function yourFirstShape() {\n  return 42;\n}\n`;
    const out = transcludeMarkers(tutorial, new Map([['your-first-shape', exampleSource]]));
    expect(out).toContain('<!-- example:start your-first-shape -->');
    expect(out).toContain('<!-- example:end -->');
    expect(out).toContain('```typescript');
    expect(out).toContain('export function yourFirstShape()');
  });

  it('is idempotent — running twice produces same output', () => {
    const tutorial = `<!-- example:start x -->
<!-- example:end -->
`;
    const sources = new Map([['x', 'const x = 1;\n']]);
    const once = transcludeMarkers(tutorial, sources);
    const twice = transcludeMarkers(once, sources);
    expect(twice).toBe(once);
  });

  it('leaves prose outside markers untouched', () => {
    const tutorial = `Before.
<!-- example:start a -->
<!-- example:end -->
After.
`;
    const sources = new Map([['a', 'x\n']]);
    expect(transcludeMarkers(tutorial, sources)).toContain('Before.');
    expect(transcludeMarkers(tutorial, sources)).toContain('After.');
  });

  it('throws if the example name has no source', () => {
    const tutorial = `<!-- example:start missing -->
<!-- example:end -->
`;
    expect(() => transcludeMarkers(tutorial, new Map())).toThrow(/missing/);
  });
});
