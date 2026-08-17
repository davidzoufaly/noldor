import { parseRemoveBlockArgs } from '../remove-block-cli.js';

/** Unwrap a parse expected to succeed, failing loudly instead of silently passing. */
function ok(argv: string[]) {
  const result = parseRemoveBlockArgs(argv);
  if (!result.success) throw new Error(`expected success, got: ${result.errors.join('; ')}`);
  return result.data;
}

// @tests: stable-entry-ids-for-roadmap-backlog
describe(parseRemoveBlockArgs, () => {
  it('reads the slug from the first positional token', () => {
    expect(ok(['some-entry'])).toStrictEqual({
      slug: 'some-entry',
      backlog: false,
    });
  });

  it('carries --retired-into as the absorbing FD slug', () => {
    expect(ok(['some-entry', '--retired-into', 'parent-fd'])).toStrictEqual({
      slug: 'some-entry',
      backlog: false,
      retiredInto: 'parent-fd',
    });
  });

  it('accepts the --retired-into=<slug> inline form', () => {
    expect(ok(['--retired-into=parent-fd', 'some-entry'])).toStrictEqual({
      slug: 'some-entry',
      backlog: false,
      retiredInto: 'parent-fd',
    });
  });

  it('does not mistake the --retired-into value for the slug', () => {
    expect(ok(['--retired-into', 'parent-fd'])).toStrictEqual({
      backlog: false,
      slug: undefined,
      retiredInto: 'parent-fd',
    });
  });

  it('does not swallow a following flag as the retiredInto value', () => {
    expect(ok(['some-entry', '--retired-into', '--backlog'])).toStrictEqual({
      slug: 'some-entry',
      backlog: true,
    });
  });

  it('omits retiredInto when the flag is absent or empty', () => {
    expect(ok(['some-entry', '--backlog'])).toStrictEqual({
      slug: 'some-entry',
      backlog: true,
    });
    expect(ok(['some-entry', '--retired-into='])).toStrictEqual({
      slug: 'some-entry',
      backlog: false,
    });
  });

  describe('--split-into', () => {
    it('splits a comma list into sibling slugs', () => {
      expect(ok(['some-entry', '--split-into', 'slice-a,slice-b'])).toStrictEqual({
        slug: 'some-entry',
        backlog: false,
        splitInto: ['slice-a', 'slice-b'],
      });
    });

    it('accepts the inline = form identically', () => {
      expect(ok(['some-entry', '--split-into=slice-a,slice-b'])).toStrictEqual(
        ok(['some-entry', '--split-into', 'slice-a,slice-b']),
      );
    });

    it('tolerates whitespace and empty members in the list', () => {
      expect(ok(['some-entry', '--split-into', 'slice-a, slice-b,'])).toStrictEqual({
        slug: 'some-entry',
        backlog: false,
        splitInto: ['slice-a', 'slice-b'],
      });
    });

    // The regression this flag would otherwise introduce: the positional-slug
    // scan used to skip only the token after --retired-into, so a flag-first
    // invocation bound the comma list as the slug. That resolves no block and
    // exits 0 with "nothing to do" — a silent no-op gate/drain read as success.
    it('does not bind the split list as the slug when the flag comes first', () => {
      expect(ok(['--split-into', 'slice-a,slice-b', 'some-entry'])).toStrictEqual({
        slug: 'some-entry',
        backlog: false,
        splitInto: ['slice-a', 'slice-b'],
      });
    });

    it('omits splitInto when the flag is valueless or empty', () => {
      expect(ok(['some-entry', '--split-into='])).toStrictEqual({
        slug: 'some-entry',
        backlog: false,
      });
      expect(ok(['some-entry', '--split-into', '--backlog'])).toStrictEqual({
        slug: 'some-entry',
        backlog: true,
      });
    });
  });

  describe('mutual exclusion', () => {
    it('rejects --retired-into together with --split-into', () => {
      const result = parseRemoveBlockArgs([
        'some-entry',
        '--retired-into',
        'parent-fd',
        '--split-into',
        'slice-a',
      ]);
      expect(result.success).toBe(false);
      expect(result).toMatchObject({ errors: [expect.stringContaining('mutually exclusive')] });
    });

    // Exclusivity is decided on flag presence, not on extracted values: both
    // valueless and inline forms would otherwise slip past a check written
    // against the parsed result.
    it.each([
      ['valueless split', ['e', '--split-into', '--backlog', '--retired-into', 'parent-fd']],
      ['inline retired', ['e', '--split-into', 'slice-a', '--retired-into=parent-fd']],
      ['both inline', ['e', '--split-into=slice-a', '--retired-into=parent-fd']],
      ['both valueless', ['e', '--split-into=', '--retired-into=']],
    ])('rejects the %s form too', (_label, argv) => {
      expect(parseRemoveBlockArgs(argv).success).toBe(false);
    });
  });
});
