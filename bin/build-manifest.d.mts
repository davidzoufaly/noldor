/**
 * Type surface for bin/build-manifest.mjs — lets src/ TypeScript (the
 * pack-list builder) import the runtime-asset manifest without duplicating
 * it. Hand-maintained beside the .mjs; keep exports in sync.
 */
export declare const RUNTIME_ASSETS: string[];
export declare const NON_RUNTIME_FILES: Record<string, string>;
export declare function allSourceFiles(root: string): string[];
export declare function compiledInputs(root: string): string[];
export declare function digestInputs(root: string): string[];
export declare function expectedOutputs(root: string): string[];
export declare function unmanifestedAssets(root: string): string[];
export declare function readInput(root: string, rel: string): Buffer;
