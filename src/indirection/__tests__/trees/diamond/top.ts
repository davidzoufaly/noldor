import { left } from './left.js';
import { right } from './right.js';
import { solo } from './solo.js';
export const top = (): string => left() + right() + solo();
