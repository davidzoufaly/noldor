// @tests: ui-design-review-lane
// Shape rules for `consumer.uiBoot` recipes (spec R2), shared by the config
// schema's validate-time checks and the render-compare lane's runtime
// substitution. Lives in core because `consumer-config.ts` must enforce them
// and lane code may not be imported from here.

/** Placeholders a `screenshotCommand` template must carry — all four, no others. */
export const SCREENSHOT_PLACEHOLDERS = ['url', 'out', 'width', 'height'] as const;
/** One of the four `screenshotCommand` placeholder names. */
export type ScreenshotPlaceholder = (typeof SCREENSHOT_PLACEHOLDERS)[number];

/**
 * The deliberately narrow route charset (spec R2): no shell metacharacters —
 * `$`, backtick, quotes, parentheses, `;` are unrepresentable, and `&` alone is
 * tolerable only because every substitution is single-quoted (see
 * `substituteScreenshotCommand` in the lane). Routes must also start with `/`.
 */
export const ROUTE_CHARSET_RE = /^[A-Za-z0-9\-._~/?=&%]*$/;

/**
 * Artifact filename from a surface name: lowercase, every char outside
 * `[a-z0-9-]` replaced with `-`, runs collapsed, leading/trailing trimmed.
 * Fixed algorithm (spec R6) — the validate-time collision check below is what
 * makes its non-injectivity safe.
 */
export function sanitizeSurfaceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Config-level guard for the sanitizer's non-injectivity: names that sanitize
 * to the same string, or to nothing, are a config error caught at validate
 * time — never a silent artifact overwrite. Returns one message per problem.
 *
 * noldor:cut — on today's domain this cannot fire: every `uiSurfaces`/`uiBoot`
 * key already matches `SURFACE_NAME_RE`, whose language the sanitizer maps to
 * itself. Kept deliberately as the spec-R6/AC3 pin so a future loosening of
 * the surface-name rule cannot silently reintroduce artifact collisions.
 */
export function sanitizationIssues(names: readonly string[]): string[] {
  const bySanitized = new Map<string, string[]>();
  const issues: string[] = [];
  for (const name of names) {
    const s = sanitizeSurfaceName(name);
    if (s === '') {
      issues.push(`surface name '${name}' sanitizes to an empty artifact name`);
      continue;
    }
    bySanitized.set(s, [...(bySanitized.get(s) ?? []), name]);
  }
  for (const [s, originals] of bySanitized) {
    if (originals.length > 1) {
      issues.push(
        `surface names ${originals.map((o) => `'${o}'`).join(', ')} all sanitize to '${s}' — artifact files would overwrite each other`,
      );
    }
  }
  return issues;
}

/**
 * Template problems `validate noldor-config` rejects: a missing required
 * placeholder, any `{token}` outside the four the lane substitutes, or ANY
 * single quote. The lane wraps every substituted value in single quotes, so a
 * consumer-quoted placeholder (`cap '{url}' …`) would produce `''…''` — the
 * value lands OUTSIDE the quoting and its permitted `&` could split the
 * command. Write templates with bare placeholders; static arguments that need
 * quoting use double quotes.
 */
export function screenshotTemplateIssues(template: string): string[] {
  const issues: string[] = [];
  for (const p of SCREENSHOT_PLACEHOLDERS) {
    if (!template.includes(`{${p}}`)) issues.push(`screenshotCommand is missing {${p}}`);
  }
  for (const m of template.matchAll(/\{([^{}]*)\}/g)) {
    if (!(SCREENSHOT_PLACEHOLDERS as readonly string[]).includes(m[1])) {
      issues.push(`screenshotCommand carries unknown placeholder {${m[1]}}`);
    }
  }
  if (template.includes("'")) {
    issues.push(
      'screenshotCommand may not contain single quotes — the lane single-quotes every substituted placeholder itself',
    );
  }
  // Double quotes are rejected too: a placeholder inside them ("{url}") would
  // make the lane's inserted single quotes LITERAL characters while $ and
  // backticks stay live — the quoting contract only holds for bare
  // placeholders in an otherwise quote-free template.
  if (template.includes('"')) {
    issues.push(
      'screenshotCommand may not contain double quotes — write bare placeholders; the lane owns all quoting',
    );
  }
  return issues;
}
