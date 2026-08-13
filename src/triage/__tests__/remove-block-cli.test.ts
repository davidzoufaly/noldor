import { parseRemoveBlockArgs } from '../remove-block-cli.js';

// @tests: stable-entry-ids-for-roadmap-backlog
describe(parseRemoveBlockArgs, () => {
  it('reads the slug from the first positional token', () => {
    expect(parseRemoveBlockArgs(['some-entry'])).toStrictEqual({
      slug: 'some-entry',
      backlog: false,
    });
  });

  it('carries --retired-into as the absorbing FD slug', () => {
    expect(parseRemoveBlockArgs(['some-entry', '--retired-into', 'parent-fd'])).toStrictEqual({
      slug: 'some-entry',
      backlog: false,
      retiredInto: 'parent-fd',
    });
  });

  it('accepts the --retired-into=<slug> inline form', () => {
    expect(parseRemoveBlockArgs(['--retired-into=parent-fd', 'some-entry'])).toStrictEqual({
      slug: 'some-entry',
      backlog: false,
      retiredInto: 'parent-fd',
    });
  });

  it('does not mistake the --retired-into value for the slug', () => {
    expect(parseRemoveBlockArgs(['--retired-into', 'parent-fd'])).toStrictEqual({
      backlog: false,
      slug: undefined,
      retiredInto: 'parent-fd',
    });
  });

  it('omits retiredInto when the flag is absent or empty', () => {
    expect(parseRemoveBlockArgs(['some-entry', '--backlog'])).toStrictEqual({
      slug: 'some-entry',
      backlog: true,
    });
    expect(parseRemoveBlockArgs(['some-entry', '--retired-into='])).toStrictEqual({
      slug: 'some-entry',
      backlog: false,
    });
  });
});
