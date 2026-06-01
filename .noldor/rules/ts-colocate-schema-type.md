---
id: ts-colocate-schema-type
applies-to: ["src/**/*.ts"]
stage: [code]
enforce: false
links: [.claude/engineering-rules.md]
---
Co-locate the zod schema and its inferred type so they are a single source of truth: `export const fooSchema = z.object({...}); export type Foo = z.infer<typeof fooSchema>;`. The schema name uses the lowercase `fooSchema` suffix, not PascalCase.
