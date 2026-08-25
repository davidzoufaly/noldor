// @tests: ui-design-review-lane
// The one thing every `design geometry-*` entrypoint shares: where its lines go.
// Each command takes an `emit` so tests read output as strings instead of
// capturing a stream, and each defaults it to stdout — declared once here so the
// default cannot drift per command (and so the repeated signature stops reading
// as a duplicated block to the clone detector).

/** Sink for one output line. */
export type Emit = (line: string) => void;

/** The production default: one line to stdout. */
export const stdoutEmit: Emit = (line) => process.stdout.write(`${line}\n`);
