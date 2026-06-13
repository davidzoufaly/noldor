// @tests: dynamic-fd-file-pointers-via-frontmatter

import { describe, expect, it } from 'vitest';

import { insertFdTag } from '../migrate-code-tags.js';

describe('insertFdTag', () => {
  it('prepends a tag to an untagged file', () => {
    expect(insertFdTag('import x;\n', 'foo')).toBe('// @fd: foo\n\nimport x;\n');
  });

  it('is idempotent when the tag already names the slug', () => {
    const src = '// @fd: foo\n\nimport x;\n';
    expect(insertFdTag(src, 'foo')).toBe(src);
  });

  it('merges a new slug into an existing // @fd: line (co-ownership)', () => {
    expect(insertFdTag('// @fd: foo\n\nimport x;\n', 'bar')).toBe(
      '// @fd: foo, bar\n\nimport x;\n',
    );
  });

  it('inserts after a shebang line', () => {
    expect(insertFdTag('#!/usr/bin/env node\nimport x;\n', 'foo')).toBe(
      '#!/usr/bin/env node\n// @fd: foo\nimport x;\n',
    );
  });
});
