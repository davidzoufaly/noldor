import type { CommitFact, FeatureFact, RepoFacts } from '../types';
import type { FeatureFrontmatter } from '../../core/feature-schema';

export function emptyFacts(overrides: Partial<RepoFacts> = {}): RepoFacts {
  return {
    commits: [],
    features: [],
    intake: [],
    laneFindings: [],
    agentEvents: [],
    escalations: [],
    drainState: null,
    releases: [],
    warnings: [],
    ...overrides,
  };
}

export function feature(slug: string, fm: Partial<FeatureFrontmatter> = {}): FeatureFact {
  return {
    slug,
    fm: {
      area: 'tooling',
      category: 'Tooling',
      deps: [],
      links: { code: [], docs: [], tests: [] },
      name: slug,
      packages: ['scripts'],
      phase: 'done',
      'noldor-tier': 'full',
      ...fm,
    } as FeatureFrontmatter,
  };
}

export function commit(overrides: Partial<CommitFact> = {}): CommitFact {
  return {
    sha: 'abc123',
    date: '2026-01-10T00:00:00+00:00',
    subject: 'feat: x',
    trailers: {},
    insertions: 1,
    deletions: 0,
    ...overrides,
  };
}
