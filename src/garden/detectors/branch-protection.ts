export interface GhApiResult {
  stdout: string;
  exitCode: number;
}

export type GhApiFn = (endpoint: string) => Promise<GhApiResult>;

export interface BranchProtectionResult {
  severity: 'OK' | 'WARN';
  message?: string;
}

interface ProtectionResponse {
  required_pull_request_reviews: unknown;
  enforce_admins: { enabled: boolean } | null;
}

export async function checkBranchProtection(opts: {
  owner: string;
  repo: string;
  ghApi: GhApiFn;
}): Promise<BranchProtectionResult> {
  const r = await opts.ghApi(`repos/${opts.owner}/${opts.repo}/branches/main/protection`);
  if (r.exitCode !== 0) {
    return {
      severity: 'WARN',
      message:
        'Branch protection not configured on origin/main. Apply settings per docs/noldor/pr-flow.md.',
    };
  }
  let data: ProtectionResponse;
  try {
    data = JSON.parse(r.stdout) as ProtectionResponse;
  } catch {
    return { severity: 'WARN', message: 'Could not parse gh api branch-protection response.' };
  }
  if (data.required_pull_request_reviews == null) {
    return { severity: 'WARN', message: 'PR required setting is off on origin/main.' };
  }
  if (!data.enforce_admins?.enabled) {
    return {
      severity: 'WARN',
      message: 'Admin bypass is allowed on origin/main (enforce_admins=false).',
    };
  }
  return { severity: 'OK' };
}
