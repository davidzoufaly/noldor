<!-- src/cr/lanes/standalone-prompt.md -->

# Standalone deep review

You are reviewing a markdown artifact (spec or plan). Read the file at the
artifact path passed via the environment.

## Output contract

Write a JSON object conforming to the `LaneFindings` schema in
`src/cr/findings-schema.ts`. Use the path provided to you
(`.noldor/cr/<slug>-<kind>-standalone.json.tmp`) for the temp file, then
`mv` it to `.noldor/cr/<slug>-<kind>-standalone.json`. Set `finishedAt`
to the ISO timestamp at write time. Preserve the existing `templateSha`
field from the stub file you read at start (don't recompute).

## Review rubric

1. Are the types in `## Types` complete enough that an implementer needs no
   further design decisions?
2. Does `## Architecture` name the file paths the implementer will touch?
3. Are the failure modes in `## Error handling` exhaustive given the
   external boundaries (subprocess, FS, prompt)?
4. Are open questions explicitly enumerated and either decided in the plan
   or surfaced for the operator?

Emit one entry under `blockers` per Critical issue (any of the above
unresolved), under `suggestions` per Important/Minor. Set `summary` to a
short verdict.

Verify-before-flag: before emitting a blocker that claims a command,
validator, or test will fail (e.g. `pnpm validate:features`,
`pnpm typecheck`), run that exact command and quote its actual error
output in the entry. If it passes, or you cannot run it, emit the claim
under `suggestions` prefixed with `unverified:` instead.

Do not modify any other files. Do not commit anything.
