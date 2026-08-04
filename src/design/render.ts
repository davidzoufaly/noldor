import type { LedgerState } from './ledger.js';

export interface RenderOpts {
  slug: string;
  kind: 'spec' | 'plan';
  /** Scope text already resolved by `loadScope` — the renderer does no I/O. */
  scope: string;
}

const RULE = '─'.repeat(60);

/**
 * Render the design-context block: the running state an operator needs to answer
 * a design question without reconstructing it from memory.
 *
 * Fixed section order — Scope → Decided → Open → Existing support — because the
 * caller pastes this block immediately *above* the question, so the question
 * stays the last thing read.
 *
 * No caps: every decision, unresolved thread, and support anchor renders, one
 * line each. Hiding early decisions would drop context exactly where
 * self-contradiction risk is highest.
 *
 * Every value line keeps its `- ` storage prefix. That is deliberate: the caller
 * pastes this into chat, and a stripped value could start a line and forge a
 * heading in the *pasted* block even though it cannot in the file. (The fenced
 * code block the skill wraps this in is the second, independent layer.)
 *
 * Pure — same state in, same string out. All I/O lives in `ledger.ts`.
 */
export function renderContext(state: LedgerState, opts: RenderOpts): string {
  const openThreads = state.open.filter((o) => o.resolvedBy === null);
  const lines: string[] = [`${RULE}`, `DESIGN CONTEXT — ${opts.slug}`, ''];

  lines.push(opts.kind === 'plan' ? 'Plan scope' : 'Scope', `- ${opts.scope}`, '');

  lines.push(`Decided (${state.decided.length})`);
  if (state.decided.length === 0) lines.push('- (no decisions recorded yet)');
  else for (const d of state.decided) lines.push(`- ${d.id} ${d.text}`);
  lines.push('');

  lines.push(`Open (${openThreads.length})`);
  if (openThreads.length === 0) lines.push('- (none open)');
  else for (const o of openThreads) lines.push(`- ${o.id} ${o.text}`);
  lines.push('');

  lines.push(`Existing support (${state.support.length})`);
  if (state.support.length === 0) lines.push('- (none recorded)');
  else for (const s of state.support) lines.push(`- ${s}`);

  for (const section of state.unparsed) {
    lines.push('', `⚠ ledger section unparsed: ${section}`);
  }

  lines.push(RULE);
  return `${lines.join('\n')}\n`;
}
