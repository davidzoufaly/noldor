import {
  areaFromPackage,
  inferTier,
  slugify,
  yamlToBacklogBlock,
  yamlToFeatureMd,
} from '../migrate-features.js';

// @tests: dashboard-roadmap-drag-drop, feature-md-links-overhaul
describe(slugify, () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Undo/Redo')).toBe('undo-redo');
    expect(slugify('3D Viewport')).toBe('3d-viewport');
    expect(slugify('Manifold WASM Integration')).toBe('manifold-wasm-integration');
  });

  it('strips non-alphanumeric except hyphens', () => {
    expect(slugify('STL Export')).toBe('stl-export');
  });
});

describe(areaFromPackage, () => {
  it('maps known package strings to areas', () => {
    expect(areaFromPackage('viewport')).toBe('viewport');
    expect(areaFromPackage('format')).toBe('format');
  });

  it('returns cross-cutting for comma-separated packages', () => {
    expect(areaFromPackage('format,engine,web')).toBe('cross-cutting');
  });
});

describe(yamlToFeatureMd, () => {
  it('produces valid MD for a done entry', () => {
    const md = yamlToFeatureMd({
      description: 'Snapshot-based undo/redo with coalescing.',
      name: 'Undo/Redo',
      package: 'web',
      status: 'done',
      version: '0.1.0',
    });

    expect(md).toContain('name: Undo/Redo');
    expect(md).toContain('phase: done');
    expect(md).toContain('introduced: "0.1.0"');
    expect(md).toContain('area: web');
    expect(md).toContain('packages:\n  - web');
    expect(md).toContain('## Summary\n\nSnapshot-based undo/redo with coalescing.');
    expect(md).toContain('## User Story\n\n<!-- TODO');
    expect(md).toContain('## Usage\n\n<!-- TODO');
  });
});

describe(yamlToBacklogBlock, () => {
  it('produces a schema-C block for a planned entry', () => {
    const block = yamlToBacklogBlock({
      description: '3MF format export for richer 3D print metadata.',
      name: '3MF Export',
      package: 'engine',
      status: 'planned',
      version: '0.2.0',
    });

    expect(block).toContain('### 3MF Export');
    expect(block).toContain('- area: engine');
    expect(block).toContain('- phase: later');
    expect(block).toContain('3MF format export for richer 3D print metadata.');
  });

  it('stamps since: YYYY-MM-DD with todays date', () => {
    const block = yamlToBacklogBlock({
      description: 'Sync.',
      name: 'Cloud Sync',
      package: 'web',
      status: 'planned',
      version: '0.4.0',
    });
    const today = new Date().toISOString().slice(0, 10);
    expect(block).toContain(`- since: ${today}`);
  });
});

describe(inferTier, () => {
  it('assigns full when links.spec present', () => {
    const fm = {
      name: 'Test Feature',
      links: { spec: 'docs/design/specs/x.md' },
    };
    const result = inferTier(fm);
    expect(result['noldor-tier']).toBe('full');
  });

  it('assigns specs-only when links.spec absent', () => {
    const fm = {
      name: 'Test Feature',
      links: {},
    };
    const result = inferTier(fm);
    expect(result['noldor-tier']).toBe('specs-only');
  });

  it('leaves existing noldor-tier alone (idempotent)', () => {
    const fm = {
      name: 'Test Feature',
      'noldor-tier': 'full' as unknown,
      links: {},
    };
    const result = inferTier(fm);
    expect(result['noldor-tier']).toBe('full');
  });
});
