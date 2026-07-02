// @tests: doc-gardening-skill
import { addGeneratedHeader } from '../docs-api.js';

describe(addGeneratedHeader, () => {
  it('prepends a do-not-edit comment as the first line', () => {
    const input = '# Some Symbol\n\nBody.\n';
    const out = addGeneratedHeader(input);
    expect(out.startsWith('<!-- generated: do-not-edit -->\n')).toBeTruthy();
    expect(out).toContain('# Some Symbol');
  });

  it('is idempotent — running twice does not double the header', () => {
    const input = '# Some Symbol\n';
    const once = addGeneratedHeader(input);
    const twice = addGeneratedHeader(once);
    expect(twice).toBe(once);
  });

  it('preserves trailing newline if present', () => {
    const input = '# X\n';
    expect(addGeneratedHeader(input).endsWith('\n')).toBeTruthy();
  });
});
