/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      from: { path: '^packages/engine/src' },
      name: 'engine-no-viewport',
      to: { path: '^packages/viewport/' },
    },
    { from: { path: '^packages/engine/src' }, name: 'engine-no-web', to: { path: '^apps/web/' } },
    {
      from: { path: '^packages/viewport/src' },
      name: 'viewport-no-web',
      to: { path: '^apps/web/' },
    },
    {
      from: { path: '^packages/format/src' },
      name: 'format-no-non-format',
      to: { path: '^(packages/(?!format(?:/|$))|apps/)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '__tests__|\\.test\\.ts$' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
  },
};
