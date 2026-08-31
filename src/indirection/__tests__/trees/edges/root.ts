import type { Shape } from './typed.js';
import { leaf } from './leaf.js';

export const load = async (): Promise<unknown> => (await import('./dyn.js')).dyn;
export const root = (s: Shape): number => s.n + leaf;
