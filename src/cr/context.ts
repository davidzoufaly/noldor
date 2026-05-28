export type Lane =
  | { kind: 'gate' }
  | { kind: 'working' }
  | { kind: 'sha'; sha: string }
  | { kind: 'range'; from: string; to: string };

export interface BuildContextInput {
  lane: Lane;
  paths?: readonly string[];
  runGit: (args: string[]) => string;
  featureMd: string;
  rules: string;
}

export interface PromptContext {
  diff: string;
  featureMd: string;
  rules: string;
}

export function buildContext(input: BuildContextInput): PromptContext {
  const baseArgs = diffArgs(input.lane);
  const args =
    input.paths && input.paths.length > 0 ? [...baseArgs, '--', ...input.paths] : baseArgs;
  const diff = input.runGit(args);
  return { diff, featureMd: input.featureMd, rules: input.rules };
}

function diffArgs(lane: Lane): string[] {
  switch (lane.kind) {
    case 'gate':
      return ['diff', 'main...HEAD'];
    case 'working':
      return ['diff', 'HEAD'];
    case 'sha':
      return ['diff', `main...${lane.sha}`];
    case 'range':
      return ['diff', `${lane.from}..${lane.to}`];
  }
}
