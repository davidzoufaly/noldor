import { input, select } from '@inquirer/prompts';

export interface PromptTextOpts {
  message: string;
  default?: string;
}

export async function promptText(opts: PromptTextOpts): Promise<string> {
  return input({ message: opts.message, default: opts.default });
}

export interface PromptSelectOpts<T extends string> {
  message: string;
  choices: Array<{ name: string; value: T; description?: string }>;
}

export async function promptSelect<T extends string>(opts: PromptSelectOpts<T>): Promise<T> {
  return select<T>({ message: opts.message, choices: opts.choices });
}
