/** Compile-time constant injected by `bun build --define` (spec Unit 2). */
declare const NOLDOR_BINARY_VERSION: string;

/**
 * Minimal Bun surface the entry touches. The pack rides as an extra compile
 * input and is read back as bytes — no `.pack` import statement exists, so
 * the dist import-graph audit never sees it. bun-types is deliberately not
 * a dependency.
 */
declare const Bun: {
  embeddedFiles: Array<{ name: string; arrayBuffer(): Promise<ArrayBuffer> }>;
};
