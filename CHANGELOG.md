# Changelog

## v1.8.0 — 2026-09-03

### Features

- feat(pr-flow): lead the PR Scope section with the queue entry's task ID (#427) ([5dd6350](https://github.com/davidzoufaly/noldor/commit/5dd63508c2993fdd4b83de46692867a8e6cf4949)) ([#427](https://github.com/davidzoufaly/noldor/pull/427))

### Fixes

- fix(design): report artifact links against the main checkout, not the worktree (#428) ([e8ee82e](https://github.com/davidzoufaly/noldor/commit/e8ee82e7043f9efa1b306f48492caaa7b6b11424)) ([#428](https://github.com/davidzoufaly/noldor/pull/428))
- fix(pr-flow): link every plan part in the PR body (#426) ([45e0542](https://github.com/davidzoufaly/noldor/commit/45e0542b4e937f76e476cdf09212f689483272e7)) ([#426](https://github.com/davidzoufaly/noldor/pull/426))
- fix(indirection): resolve tsconfig path aliases via enhanced-resolve (#425) ([8f9327c](https://github.com/davidzoufaly/noldor/commit/8f9327cbf09989370f82e517c9cdf96736a31f09)) ([#425](https://github.com/davidzoufaly/noldor/pull/425))
- fix(indirection): seed the ratchet baseline on consumer install (#424) ([a41bc49](https://github.com/davidzoufaly/noldor/commit/a41bc49c56694d1b5d607855e7db3ff57bdcb048)) ([#424](https://github.com/davidzoufaly/noldor/pull/424))

### Other changes

- chore(release-sweep): pre-empt sdd:report drift (#430) ([2a1e75d](https://github.com/davidzoufaly/noldor/commit/2a1e75d55969f8cb1056026edecfdff1650f766b)) ([#430](https://github.com/davidzoufaly/noldor/pull/430))
- docs(triage): reorder roadmap priorities, capture 6 lessons, widen drain-log ignore (#429) ([2b9ec5f](https://github.com/davidzoufaly/noldor/commit/2b9ec5f356fc8d35bff18496ea7f72cc2306b426)) ([#429](https://github.com/davidzoufaly/noldor/pull/429))
- docs: capture six lessons from the v1.7.0 release sweep (#423) ([0370326](https://github.com/davidzoufaly/noldor/commit/037032679c639712147dab60b7513288bf87492e)) ([#423](https://github.com/davidzoufaly/noldor/pull/423))

## v1.7.0 — 2026-09-02

### Features

- feat(features:pendev-ui-design-phase): open .pen files in the pen.dev desktop app (#419) ([49ac3d2](https://github.com/davidzoufaly/noldor/commit/49ac3d2da70a57b555d16d91f24e0ec7ac6805b5)) ([#419](https://github.com/davidzoufaly/noldor/pull/419))
- feat(design): make the artifact tab opt-in via design.autoOpen, default off (#418) ([e6ee2d2](https://github.com/davidzoufaly/noldor/commit/e6ee2d25d27fd96289c07f519c8272eaeeb062bd)) ([#418](https://github.com/davidzoufaly/noldor/pull/418))
- feat(features:auto-open-design-artifacts): auto-open specs/plans and report a link that resolves (#416) ([1d6fc05](https://github.com/davidzoufaly/noldor/commit/1d6fc05f21629bcb111e596de0f3c1373bbe9aed)) ([#416](https://github.com/davidzoufaly/noldor/pull/416))
- feat(autonomous): scale the drain iteration timeout by entry size (#415) ([10c2d47](https://github.com/davidzoufaly/noldor/commit/10c2d4768747c462a48925ae2c2bbed1cf24e86a)) ([#415](https://github.com/davidzoufaly/noldor/pull/415))
- feat(indirection): measure per-module transitive import closure (#411) ([86ed29a](https://github.com/davidzoufaly/noldor/commit/86ed29ab25ee79110fa9fe61f5af2efeafee5108)) ([#411](https://github.com/davidzoufaly/noldor/pull/411))

### Fixes

- fix(design): open specs, plans and .pen files without stealing window focus (#417) ([dc489c4](https://github.com/davidzoufaly/noldor/commit/dc489c4fcf028299d65ba44b7651fd27b99890f6)) ([#417](https://github.com/davidzoufaly/noldor/pull/417))
- fix(cr): gate the in-flight wait on lane resolution, not stale artifact findings (#414) ([30f2cf9](https://github.com/davidzoufaly/noldor/commit/30f2cf93f0823d43d4685c1e8341aada8c9a065b)) ([#414](https://github.com/davidzoufaly/noldor/pull/414))
- fix(docs): stop the architecture module advisory firing on generated trees (#413) ([92d5b28](https://github.com/davidzoufaly/noldor/commit/92d5b28a95b88be1e06461a0f3ac178afa2a1ea1)) ([#413](https://github.com/davidzoufaly/noldor/pull/413))
- fix(garden): give fd-command-rot an ignore marker for rejected-option prose (#412) ([ca08377](https://github.com/davidzoufaly/noldor/commit/ca0837797588a1d46c4357d82b6642e5ceb13f2a)) ([#412](https://github.com/davidzoufaly/noldor/pull/412))

### Other changes

- docs: fix README config-block count, garden skill command, and sdd-report drift (#422) ([c3e7307](https://github.com/davidzoufaly/noldor/commit/c3e7307d7702e22cf742bff7c4e4ee6951fcf2f9)) ([#422](https://github.com/davidzoufaly/noldor/pull/422))
- chore(release-sweep): pre-empt sdd:report drift (#421) ([d7a5480](https://github.com/davidzoufaly/noldor/commit/d7a5480719c0408d86651bbaca6754ae27e28d10)) ([#421](https://github.com/davidzoufaly/noldor/pull/421))
- docs(noldor): file triage batch Q-0201..Q-0208 and close drain-log ignore gap (#420) ([ba3d782](https://github.com/davidzoufaly/noldor/commit/ba3d782b17601bf7be61f3e0ff93971832ca6566)) ([#420](https://github.com/davidzoufaly/noldor/pull/420))

## v1.6.0 — 2026-08-30

### BREAKING CHANGES

- **The supported runtime floor moves from Node 20 to Node 24** (#409). `RegExp.escape` — a Node 24+ built-in the `platform-over-dependency` rule mandates — is evaluated at module top level, so the package threw `TypeError: RegExp.escape is not a function` on Node 20 and 22 while `engines.node` still advertised `>=20`. `engines.node` now declares `>=24` and every CI job runs it. Consumers on Node 20 or 22 must upgrade Node; `bin/engines-check.mjs` refuses to start with a named message rather than failing mid-command.

### Features

- feat(design): enforce the design-approval signal at commit and review time (#406) ([365ab39](https://github.com/davidzoufaly/noldor/commit/365ab391f66a9d15505813b4422e7055340a2cdc)) ([#406](https://github.com/davidzoufaly/noldor/pull/406))
- feat(docs:consumer-architecture-doc-surface): carry a C4 diagram in every scaffolded FD (#405) ([c601952](https://github.com/davidzoufaly/noldor/commit/c6019528800a85d15ac9bcf8ab51c6df96c2da47)) ([#405](https://github.com/davidzoufaly/noldor/pull/405))
- feat(features:pendev-ui-design-phase): rest UI baseline freshness on a capture receipt (#401) ([4d506ad](https://github.com/davidzoufaly/noldor/commit/4d506ad1553ba058829404a0e1bd93a111127b78)) ([#401](https://github.com/davidzoufaly/noldor/pull/401))
- feat(docs:consumer-architecture-doc-surface): carry section sets in the architecture registry (#400) ([c6c09f8](https://github.com/davidzoufaly/noldor/commit/c6c09f8d9a3ebf19a37a56481b6bb8a0514c98d2)) ([#400](https://github.com/davidzoufaly/noldor/pull/400))
- feat(features:pendev-ui-design-phase): take an operator verdict on the .pen before implementation (#399) ([a54c9f1](https://github.com/davidzoufaly/noldor/commit/a54c9f1560cfd695cb1fc778e88187b6557b197c)) ([#399](https://github.com/davidzoufaly/noldor/pull/399))
- feat(invariants): assert the toolchain floor and add five scoped platform rules (#388) ([e655cb5](https://github.com/davidzoufaly/noldor/commit/e655cb5481b9b871daa087a9fa590fa1f2a205c9)) ([#388](https://github.com/davidzoufaly/noldor/pull/388))
- feat(cr): add the normalized geometry document contract (#383) ([5a1b323](https://github.com/davidzoufaly/noldor/commit/5a1b323e19405457534e7056232390cfb6c7594f)) ([#383](https://github.com/davidzoufaly/noldor/pull/383))
- feat(doctor): probe lockfile-vs-installed-modules freshness (#378) ([cff59e0](https://github.com/davidzoufaly/noldor/commit/cff59e00a6e2f68fefda4988d67b70cac1b54974)) ([#378](https://github.com/davidzoufaly/noldor/pull/378))

### Fixes

- fix(release)!: raise the runtime floor to Node 24 to match the APIs the rules mandate (#409) ([9a5cd14](https://github.com/davidzoufaly/noldor/commit/9a5cd14)) ([#409](https://github.com/davidzoufaly/noldor/pull/409))
- fix(skills): correct the UI-design step's pencil seed and screenshot recipes (#404) ([539ac04](https://github.com/davidzoufaly/noldor/commit/539ac04f2b20dc855c3c4e98a86c10d99693cb1e)) ([#404](https://github.com/davidzoufaly/noldor/pull/404))
- fix(docs): scope the attach-path UI verdict to the session's own Touches (#403) ([a0768ce](https://github.com/davidzoufaly/noldor/commit/a0768ce1f4fe43cc6eb8d3f8143d9bbfc926a034)) ([#403](https://github.com/davidzoufaly/noldor/pull/403))
- fix(release): carve indeterminate out of skipped in UI freshness (#402) ([2cfdb16](https://github.com/davidzoufaly/noldor/commit/2cfdb160afa8feef7abdc0f78405bbff8f1f1e07)) ([#402](https://github.com/davidzoufaly/noldor/pull/402))
- fix(worktrees): guard slug-derived paths in the worktree family (#397) ([366cb50](https://github.com/davidzoufaly/noldor/commit/366cb50aeba7c075c18db3ff6d9c02c1513be48f)) ([#397](https://github.com/davidzoufaly/noldor/pull/397))
- fix(tooling): repoint every FD links pointer the archive seam moves (#396) ([b4c8396](https://github.com/davidzoufaly/noldor/commit/b4c8396f2734170d31d921187e92687dabf4267f)) ([#396](https://github.com/davidzoufaly/noldor/pull/396))
- fix(tooling): guard .pen writes against the wrong open canvas (#395) ([11875c0](https://github.com/davidzoufaly/noldor/commit/11875c070ab810a154134ca3298b113f53a80d10)) ([#395](https://github.com/davidzoufaly/noldor/pull/395))
- fix(tooling): replay the real pre-push hook in the gate's push preflight (#386) ([663c0bb](https://github.com/davidzoufaly/noldor/commit/663c0bb420d0cac0a2ca213608b47c53927ade62)) ([#386](https://github.com/davidzoufaly/noldor/pull/386))
- fix(release): union both no-review lanes in the CR gate's file fallback (#385) ([4959984](https://github.com/davidzoufaly/noldor/commit/4959984ac6a6dbc38e9db8c391144d279b5136e1)) ([#385](https://github.com/davidzoufaly/noldor/pull/385))
- fix(split-check): cut plan-part splits along capability, not the task list (#384) ([17c0ff3](https://github.com/davidzoufaly/noldor/commit/17c0ff3f87eecf996b548da9ef1b102bf21f771a)) ([#384](https://github.com/davidzoufaly/noldor/pull/384))
- fix(design): wake the pencil bridge instead of waiving the UI-design step (#382) ([4262832](https://github.com/davidzoufaly/noldor/commit/426283264b94cab6eda11bdc87bb84c8ed38b388)) ([#382](https://github.com/davidzoufaly/noldor/pull/382))
- fix(cr): repair a malformed verify verdict before fail-closing on it (#381) ([948ea8c](https://github.com/davidzoufaly/noldor/commit/948ea8c82b15af9b4d146f18c7f954da0c874df1)) ([#381](https://github.com/davidzoufaly/noldor/pull/381))
- fix(garden): exempt phase: later from the stale-backlog SDD gap (#380) ([d9986c1](https://github.com/davidzoufaly/noldor/commit/d9986c1aa2260152518c7c9fd98d9592e069522b)) ([#380](https://github.com/davidzoufaly/noldor/pull/380))
- fix(cli:validate-script-catalog-gate): join the catalog diff on the leaf command as well as the source (#379) ([41322cb](https://github.com/davidzoufaly/noldor/commit/41322cb33184f0122660920cdb2f1d0f4d36bad1)) ([#379](https://github.com/davidzoufaly/noldor/pull/379))
- fix(core): admit triage bookkeeping counters to the micro-chore lane (#377) ([44ecd76](https://github.com/davidzoufaly/noldor/commit/44ecd76a0b6886d486c7f265ff6a288e4d759b83)) ([#377](https://github.com/davidzoufaly/noldor/pull/377))
- fix(cli): diagnose framework skew when a hook names a removed subcommand (#376) ([bee30b2](https://github.com/davidzoufaly/noldor/commit/bee30b2f941ec44dd3d9c7ed99d1e02ee83ce7ef)) ([#376](https://github.com/davidzoufaly/noldor/pull/376))
- fix(triage): floor the mint counter at the live corpus max (#375) ([1f10a8b](https://github.com/davidzoufaly/noldor/commit/1f10a8b3798a85bfa7697193b678e88ea6800908)) ([#375](https://github.com/davidzoufaly/noldor/pull/375))
- fix(autonomous): reject --only on a parked slug instead of shipping nothing (#374) ([78e6c8f](https://github.com/davidzoufaly/noldor/commit/78e6c8f0dd1eef8338ff1dc1f550b162f6f0897e)) ([#374](https://github.com/davidzoufaly/noldor/pull/374))
- fix(autonomous): spare live worktrees from the drain's shipped-worktree prune (#373) ([7e362e3](https://github.com/davidzoufaly/noldor/commit/7e362e3c9feab5feb6ed932d3f086a385963a572)) ([#373](https://github.com/davidzoufaly/noldor/pull/373))
- fix(autonomous): derive drain finish-vs-rebuild from the branch, not an absent flag (#372) ([2fab4ec](https://github.com/davidzoufaly/noldor/commit/2fab4ec24f01d1605b1ad975b933874e46dc26c3)) ([#372](https://github.com/davidzoufaly/noldor/pull/372))

### Other changes

- chore(release): pre-release graphify sweep and sdd-report regen (#408) ([d7c5cbc](https://github.com/davidzoufaly/noldor/commit/d7c5cbc5d8ae6baff6fcbe83bcf95a17b1d246e5)) ([#408](https://github.com/davidzoufaly/noldor/pull/408))
- chore(clones): rebaseline the ratchet at 28844 and capture the facade false-positive (#407) ([61d74d3](https://github.com/davidzoufaly/noldor/commit/61d74d39fd5e305161f018c9c020365e32402419)) ([#407](https://github.com/davidzoufaly/noldor/pull/407))
- refactor(noldor): lift the mtime walker to repo-paths beside scanRoots (#398) ([f311816](https://github.com/davidzoufaly/noldor/commit/f311816a5eec692189a466a00860e2005117fe34)) ([#398](https://github.com/davidzoufaly/noldor/pull/398))
- docs(triage): correct Q-0195's rationale and drop it down the queue (#394) ([759e219](https://github.com/davidzoufaly/noldor/commit/759e2195474828c0988e4d8ed4917fef99c3ddec)) ([#394](https://github.com/davidzoufaly/noldor/pull/394))
- docs(triage): carve the CR lane-injection debt and retire its predecessor (#393) ([2ec109a](https://github.com/davidzoufaly/noldor/commit/2ec109aad28d4287e4de163298a5b95e2c4c6f2f)) ([#393](https://github.com/davidzoufaly/noldor/pull/393))
- test(dashboard): repay the four tests that survive a gutted implementation (#392) ([a627777](https://github.com/davidzoufaly/noldor/commit/a627777b6508ebdbe35447e14994486b9d721fd4)) ([#392](https://github.com/davidzoufaly/noldor/pull/392))
- docs(rules): make the Deletion Test and mocking boundaries binding (#391) ([f670165](https://github.com/davidzoufaly/noldor/commit/f6701652ec522935d33909347774b7c097ca5c11)) ([#391](https://github.com/davidzoufaly/noldor/pull/391))
- refactor(tooling): extract a shared tsconfig base and split the typecheck config (#390) ([4923dbf](https://github.com/davidzoufaly/noldor/commit/4923dbf694ac86822dc239d6a3a79d4cfb1b8dd1)) ([#390](https://github.com/davidzoufaly/noldor/pull/390))
- docs(triage): reprioritize the queue and prune absorbed lessons (#389) ([251afb6](https://github.com/davidzoufaly/noldor/commit/251afb6d54e6fdbdf79713f40c8a0a4636996466)) ([#389](https://github.com/davidzoufaly/noldor/pull/389))
- docs(noldor): triage 17 ideas and absorb 6 lessons (#387) ([ed618dd](https://github.com/davidzoufaly/noldor/commit/ed618dd3950b21c502c660f392b81fa3fcb183bb)) ([#387](https://github.com/davidzoufaly/noldor/pull/387))
- chore(bookkeeping): absorb lessons + triage two ideas onto the roadmap (#371) ([cf81b10](https://github.com/davidzoufaly/noldor/commit/cf81b101bc9482a6031f3b3613a0defec44d13ae)) ([#371](https://github.com/davidzoufaly/noldor/pull/371))

## v1.5.0 — 2026-08-23

### Features

- feat(cr): add the render-compare lane — boot the app and pixel-diff routes against the session's .pen (#366) ([c488b25](https://github.com/davidzoufaly/noldor/commit/c488b25f6bd60e113cfeddad39d539a4fd1dbcbf)) ([#366](https://github.com/davidzoufaly/noldor/pull/366))
- feat(checks): validate README commands on the shared resolver (#365) ([77620df](https://github.com/davidzoufaly/noldor/commit/77620df585817aefec2a224687908df54b2fb767)) ([#365](https://github.com/davidzoufaly/noldor/pull/365))
- feat(binary): record spike-verified bun floor (#363) ([51ac63d](https://github.com/davidzoufaly/noldor/commit/51ac63dd2dd2d25d2e38fa59f8637f5d2f95243b)) ([#363](https://github.com/davidzoufaly/noldor/pull/363))
- feat(design): draft-first dialogues with a decision-context digest (#362) ([fd05534](https://github.com/davidzoufaly/noldor/commit/fd05534c345f1bbbbda5041500a2367a3d498c88)) ([#362](https://github.com/davidzoufaly/noldor/pull/362))
- feat(pr-flow): enforce Why/How/What at the PR seam, free commit bodies (#361) ([17e26a3](https://github.com/davidzoufaly/noldor/commit/17e26a3c498b130004e267460bdc6d9232dd716b)) ([#361](https://github.com/davidzoufaly/noldor/pull/361))
- feat(cli): execute compiled dist, falling back to tsx only when the build is stale (#359) ([6549d4e](https://github.com/davidzoufaly/noldor/commit/6549d4e872d4f0645079c668a20a8a4b4111b3c7)) ([#359](https://github.com/davidzoufaly/noldor/pull/359))

### Fixes

- fix(build): let the runtime-asset scan ignore generated trees git ignores (#360) ([b34c2e7](https://github.com/davidzoufaly/noldor/commit/b34c2e7cb835ad1930c8325f01186e85e1b62954)) ([#360](https://github.com/davidzoufaly/noldor/pull/360))

### Other changes

- chore(release): converge sdd-report on the pre-release override row (#370) ([50339a1](https://github.com/davidzoufaly/noldor/commit/50339a15091e44932fd989769db9922979a84901)) ([#370](https://github.com/davidzoufaly/noldor/pull/370))
- chore(release): clear the 1.5.0 preflight — README drift, revert exemption, sweep findings (#369) ([58e9539](https://github.com/davidzoufaly/noldor/commit/58e9539d7e07df3a17a422a9352d249e6179b801)) ([#369](https://github.com/davidzoufaly/noldor/pull/369))
- chore(release-sweep): pre-empt sdd:report drift (#368) ([4c1f680](https://github.com/davidzoufaly/noldor/commit/4c1f6804b2d12d7239030ac3216f47667fbc0012)) ([#368](https://github.com/davidzoufaly/noldor/pull/368))
- docs(garden): close 65 of 67 SDD gaps before the 1.5.0 release (#367) ([57134eb](https://github.com/davidzoufaly/noldor/commit/57134ebf514f45978e3286d08465b3d5ffd2c6f8)) ([#367](https://github.com/davidzoufaly/noldor/pull/367))
- Revert "feat(binary): record spike-verified bun floor (#363)" (#364) ([c36ad34](https://github.com/davidzoufaly/noldor/commit/c36ad34a36ddaec5719caff185da51e763ab917d)) ([#364](https://github.com/davidzoufaly/noldor/pull/364))
- chore(deps): move to typescript 7 native compiler (#358) ([2ab5570](https://github.com/davidzoufaly/noldor/commit/2ab55709a56b6d28e2c351ed78ea94ffc8839183)) ([#358](https://github.com/davidzoufaly/noldor/pull/358))

## v1.4.0 — 2026-08-20

### Features

- feat(dashboard): serve the architecture doc surface (#353) ([1e7a5c4](https://github.com/davidzoufaly/noldor/commit/1e7a5c4dbab6d971e10b1a08476efedb5b6aaeb1)) ([#353](https://github.com/davidzoufaly/noldor/pull/353))
- feat(rules): record the noldor-wait preference as a scoped rule (#352) ([be061ac](https://github.com/davidzoufaly/noldor/commit/be061acd4723e6b50627d53d8c6ec58d57de4598)) ([#352](https://github.com/davidzoufaly/noldor/pull/352))
- feat(triage): add roadmap has-block, the queued-entry predicate (#351) ([fdc4687](https://github.com/davidzoufaly/noldor/commit/fdc4687dff71c1c89a412459505de2312480cbf8)) ([#351](https://github.com/davidzoufaly/noldor/pull/351))
- feat(autonomous): add drain selection narrowing and the uncommitted-triage guard (#348) ([242ed80](https://github.com/davidzoufaly/noldor/commit/242ed80325e6f0ed1b82f52e20f3528ab0e8f36f)) ([#348](https://github.com/davidzoufaly/noldor/pull/348))
- feat(docs): add doc-surface enumeration and reachability verdict (#345) ([fd2ce3b](https://github.com/davidzoufaly/noldor/commit/fd2ce3b2cc99c690512e367f479b05ad3552e905)) ([#345](https://github.com/davidzoufaly/noldor/pull/345))
- feat(cr): add the ui-reviewer lane — design-fidelity review against the session's .pen (#343) ([5dba1c7](https://github.com/davidzoufaly/noldor/commit/5dba1c7d8dfe30276abca308abc4436b8a908f7a)) ([#343](https://github.com/davidzoufaly/noldor/pull/343))
- feat(core): add uiPaths + uiSurfaces to consumer config schema (#342) ([2221d4c](https://github.com/davidzoufaly/noldor/commit/2221d4cc4352554ffc9c7e81d5d92881655bdc62)) ([#342](https://github.com/davidzoufaly/noldor/pull/342))
- feat(cr): force a codex round at spec+code stages on M/L/XL sessions (#341) ([5b9cc42](https://github.com/davidzoufaly/noldor/commit/5b9cc42ddb0fbc53ac4512286cc59414d7402fcf)) ([#341](https://github.com/davidzoufaly/noldor/pull/341))
- feat(adr): add the decision-record surface — validator, authoring CLI, append-only push gate, release row (#339) ([1f1f4c0](https://github.com/davidzoufaly/noldor/commit/1f1f4c0f407008fd9ca16cd1a9909524c414691b)) ([#339](https://github.com/davidzoufaly/noldor/pull/339))
- feat(sync): unify links.code, links.tests and links.docs behind one projection engine (#338) ([caa969a](https://github.com/davidzoufaly/noldor/commit/caa969a36af4efc190d2fb88a4432bbc9c3f82cd)) ([#338](https://github.com/davidzoufaly/noldor/pull/338))
- feat(docs): add the architecture doc surface (#333) ([5c35053](https://github.com/davidzoufaly/noldor/commit/5c35053cee5db2986e4628ce099a28b227b95d76)) ([#333](https://github.com/davidzoufaly/noldor/pull/333))
- feat(triage): parse split provenance fields and record splits in the retired-ID map (#332) ([0b1acf0](https://github.com/davidzoufaly/noldor/commit/0b1acf059ffb0777a58d3d3e88e0ae01a050230a)) ([#332](https://github.com/davidzoufaly/noldor/pull/332))
- feat(split-check): add assessSpecSplit S1/S2 spec size signals (#331) ([a84c39b](https://github.com/davidzoufaly/noldor/commit/a84c39bd6622181191bb9390101a2c7635b78566)) ([#331](https://github.com/davidzoufaly/noldor/pull/331))
- feat(rules): migrate error-flow, state and concurrency disciplines into enforce cascade rules (#330) ([888ea00](https://github.com/davidzoufaly/noldor/commit/888ea008d810d2b1ece1dbfdb63d00374c8adc1c)) ([#330](https://github.com/davidzoufaly/noldor/pull/330))
- feat(cr): thread prior-round reviewer context into re-round prompts (#328) ([5acbe68](https://github.com/davidzoufaly/noldor/commit/5acbe6852ac01ce54d3ab4a59def4f71580662ca)) ([#328](https://github.com/davidzoufaly/noldor/pull/328))
- feat(agent-runner): add bounded stderr capture and a foreground spawn mode (#326) ([cd9c9d8](https://github.com/davidzoufaly/noldor/commit/cd9c9d8e97a19871305f92010e91a64ab6ec626c)) ([#326](https://github.com/davidzoufaly/noldor/pull/326))

### Fixes

- fix(prep): prescribe a plan commit shape the push gate accepts (#349) ([a5ca6c1](https://github.com/davidzoufaly/noldor/commit/a5ca6c141ad49cc867f61e7ace453d78304889cb)) ([#349](https://github.com/davidzoufaly/noldor/pull/349))
- fix(cr): route the codex model-version 400 to an upgrade hint instead of asserting expired auth (#340) ([1f1b2e2](https://github.com/davidzoufaly/noldor/commit/1f1b2e25857771100b6a2642767c8498734acef7)) ([#340](https://github.com/davidzoufaly/noldor/pull/340))
- fix(checks): verify the consumer's root lefthook wiring in doctor and init (#337) ([7cc597f](https://github.com/davidzoufaly/noldor/commit/7cc597f80153ddb26962a23181fd95638f054ad3)) ([#337](https://github.com/davidzoufaly/noldor/pull/337))
- fix(tests): spawn the repo-local tsx instead of npx in CLI-spawning suites (#336) ([dab1c77](https://github.com/davidzoufaly/noldor/commit/dab1c77bb1a5edfeff806ba5026df75701cd8e8d)) ([#336](https://github.com/davidzoufaly/noldor/pull/336))

### Other changes

- chore(garden): regen sdd-report after the sweep and exemption merges (#356) ([a597b56](https://github.com/davidzoufaly/noldor/commit/a597b56d16cff01bcd0223edb6fb93c0de4f9f20)) ([#356](https://github.com/davidzoufaly/noldor/pull/356))
- chore(release): exempt the sweep squash from the CR receipt gate (#355) ([9461457](https://github.com/davidzoufaly/noldor/commit/9461457978d07ed19f658cb96a05ad0fc85ec7c1)) ([#355](https://github.com/davidzoufaly/noldor/pull/355))
- chore(release-sweep): pre-empt sdd:report drift (#354) ([32b851a](https://github.com/davidzoufaly/noldor/commit/32b851a1b70e7db0b8b0cbdff8a74aeb29bbd2d6)) ([#354](https://github.com/davidzoufaly/noldor/pull/354))
- refactor(garden): collapse stale-plan/stale-spec detection onto one implementation (#347) ([46994e9](https://github.com/davidzoufaly/noldor/commit/46994e913309b8c9c779b312d8ab6155b5ac3daf)) ([#347](https://github.com/davidzoufaly/noldor/pull/347))
- docs(roadmap): retire feature-doc-links-point-at-code-deleted-in-pr-328 — shipped via fast-track (no FD) (#350) ([b48fb8f](https://github.com/davidzoufaly/noldor/commit/b48fb8fb570642acd0899e62bf646460f20a15cd)) ([#350](https://github.com/davidzoufaly/noldor/pull/350))
- docs(triage): ship the pending queue-document triage (Q-0149, Q-0150, Q-0151, Q-0152) (#346) ([985dcb8](https://github.com/davidzoufaly/noldor/commit/985dcb88316e0a6d193108ca0a1f723e8fdbaa88)) ([#346](https://github.com/davidzoufaly/noldor/pull/346))
- docs(triage): file Q-0145 lessons + raise Q-0139 in the roadmap (#344) ([d8a11f5](https://github.com/davidzoufaly/noldor/commit/d8a11f50fbd76f0d54d3842fd3e12d04e08863d9)) ([#344](https://github.com/davidzoufaly/noldor/pull/344))
- docs(triage): queue Q-0139..Q-0144 and absorb operator lessons into the runbooks (#335) ([0be9ffe](https://github.com/davidzoufaly/noldor/commit/0be9ffeb1bc23d4f3f133a1a2b7e9bd4fb05a8c5)) ([#335](https://github.com/davidzoufaly/noldor/pull/335))
- docs(triage): queue the Q-0093 followups and land the pending backlog triage (#334) ([04c9799](https://github.com/davidzoufaly/noldor/commit/04c9799efe7093022e77912d962e6acfcff7469d)) ([#334](https://github.com/davidzoufaly/noldor/pull/334))
- docs(gate): bound artifact-stage re-rounds — design-only triggers + hard cap (#329) ([abda394](https://github.com/davidzoufaly/noldor/commit/abda3944e0580c5e49de822d21eca66d227914e1)) ([#329](https://github.com/davidzoufaly/noldor/pull/329))
- docs(noldor-gate): preflight push-range gates before code-stage CR + delta receipt re-earn (#327) ([46ece54](https://github.com/davidzoufaly/noldor/commit/46ece544d34c361992805afb6aeec7421ae7bc96)) ([#327](https://github.com/davidzoufaly/noldor/pull/327))
- docs(rules): scope pr-summary-why-how-what to code-carrying changes (#325) ([4ed8ad7](https://github.com/davidzoufaly/noldor/commit/4ed8ad76a0b952b15ad9fdbd7f9001c20862f28f)) ([#325](https://github.com/davidzoufaly/noldor/pull/325))
- docs(roadmap): re-prioritize the queue order (#324) ([8749cc0](https://github.com/davidzoufaly/noldor/commit/8749cc0ea782ab09b1a03d9209d9e52afc26376f)) ([#324](https://github.com/davidzoufaly/noldor/pull/324))

## v1.3.0 — 2026-08-14

### Features

- feat(core): reject a code commit whose body does not explain the change (#321) ([93f1ba4](https://github.com/davidzoufaly/noldor/commit/93f1ba480339321b01ff3f53781c10fa4b4667f5)) ([#321](https://github.com/davidzoufaly/noldor/pull/321))

### Fixes

- fix(triage): forward retired entry IDs so blocked-by refs stop dangling (Q-0107) (#317) ([9979819](https://github.com/davidzoufaly/noldor/commit/9979819cc9d1eb94ab53fe0c593fbb6365c55f88)) ([#317](https://github.com/davidzoufaly/noldor/pull/317))
- fix(milestones): serialize frontmatter via gray-matter, retiring hand-rolled yamlScalar (Q-0105) (#316) ([9fbc26d](https://github.com/davidzoufaly/noldor/commit/9fbc26def7e0cc75a5a7fb64ffd300a4ea76928e)) ([#316](https://github.com/davidzoufaly/noldor/pull/316))
- fix(dashboard): name the --root repository-root contract for the docs flag (Q-0104) (#315) ([a0bfbdd](https://github.com/davidzoufaly/noldor/commit/a0bfbdd0a4bf9e1f1204c0a4a206bbc663cdb00e)) ([#315](https://github.com/davidzoufaly/noldor/pull/315))
- fix(clones): union untracked files into the diff-scoped verdict (Q-0123) (#313) ([e173304](https://github.com/davidzoufaly/noldor/commit/e1733047b74dc38132c1ab2e81996421846656fa)) ([#313](https://github.com/davidzoufaly/noldor/pull/313))
- fix(clones): flag diff-scoped clones on coverage, not mere overlap (Q-0095) (#312) ([984e510](https://github.com/davidzoufaly/noldor/commit/984e5103fe1c739194252e4bd52e1cd398cfc232)) ([#312](https://github.com/davidzoufaly/noldor/pull/312))
- fix(worktrees): surface worktree session path hazards (Q-0118) (#310) ([3634a6c](https://github.com/davidzoufaly/noldor/commit/3634a6cc2a7d46f33ac1048487842c04e608bc81)) ([#310](https://github.com/davidzoufaly/noldor/pull/310))
- fix(cr): report a missing expected sink as unresolved (Q-0100) (#309) ([ef66c87](https://github.com/davidzoufaly/noldor/commit/ef66c87ecd2a96cfcd2f69f5eaa3f941eb46a2a3)) ([#309](https://github.com/davidzoufaly/noldor/pull/309))
- fix(cr): give the codex lane a real code-review path (--code) (#308) ([7114dd0](https://github.com/davidzoufaly/noldor/commit/7114dd068355298213650fac87cc899238d0b6ee)) ([#308](https://github.com/davidzoufaly/noldor/pull/308))
- fix(docs): repair broken internal links and widen docs-check to design artifacts (#307) ([e8cdb91](https://github.com/davidzoufaly/noldor/commit/e8cdb91ec16d1fa607e74df563435b88bc73a82b)) ([#307](https://github.com/davidzoufaly/noldor/pull/307))
- fix(core): source the PR title and no-FD summary from the substantive commit (#304) ([3816d20](https://github.com/davidzoufaly/noldor/commit/3816d206d1c8d77a0d0354378129764afa411256)) ([#304](https://github.com/davidzoufaly/noldor/pull/304))
- fix(dashboard): count zero scripts when scripts/ directory is absent (#298) ([9036fea](https://github.com/davidzoufaly/noldor/commit/9036fea05324d0206ae4d7f4769b24c10318962b)) ([#298](https://github.com/davidzoufaly/noldor/pull/298))

### Other changes

- chore(release-sweep): pre-empt sdd:report drift (#323) ([aa6d998](https://github.com/davidzoufaly/noldor/commit/aa6d9986d4319807a5a64f9d9f7f0f8e9adbd00a)) ([#323](https://github.com/davidzoufaly/noldor/pull/323))
- docs(triage): queue Q-0125..Q-0128 from the 2026-08-14 ideas batch (#322) ([fac641f](https://github.com/davidzoufaly/noldor/commit/fac641f09e987e75e40870a089b11adc319a9954)) ([#322](https://github.com/davidzoufaly/noldor/pull/322))
- docs(ideas): capture the Q-0124 spike findings and the commit-object redesign (#320) ([47caf76](https://github.com/davidzoufaly/noldor/commit/47caf7609dc55b8295619d4792988f11f6b728ad)) ([#320](https://github.com/davidzoufaly/noldor/pull/320))
- docs(roadmap): retire clone-detector-flags-chained-builder-schemas — shipped via fast-track (no FD) (#319) ([34b29e4](https://github.com/davidzoufaly/noldor/commit/34b29e44a2e8625976c354789aee972a8d106b72)) ([#319](https://github.com/davidzoufaly/noldor/pull/319))
- docs(roadmap): retire doctor-ahead-anchor-dead-end — shipped via fast-track (no FD) (#318) ([ef974e2](https://github.com/davidzoufaly/noldor/commit/ef974e273948206d901a529540dee139c8d9dcf2)) ([#318](https://github.com/davidzoufaly/noldor/pull/318))
- docs(ideas): file two drain-supervisor lessons from the S/impact-high batch (#314) ([aa0b7f7](https://github.com/davidzoufaly/noldor/commit/aa0b7f7b71d7ca2d3a2c223337a724827dfd0fa4)) ([#314](https://github.com/davidzoufaly/noldor/pull/314))
- docs(roadmap): split Q-0095 into sibling entries per the Step 0 oversize guard (#311) ([aecbca4](https://github.com/davidzoufaly/noldor/commit/aecbca4955d4949575045a899f49593f968affc4)) ([#311](https://github.com/davidzoufaly/noldor/pull/311))
- docs(roadmap): triage nine lessons into Q-0118..Q-0122 + two merges (#306) ([25c9d1d](https://github.com/davidzoufaly/noldor/commit/25c9d1dfb2c7a4166cef5697a09f936148b34ec1)) ([#306](https://github.com/davidzoufaly/noldor/pull/306))
- docs(ideas): archive every stamped bullet under ## Triaged (#305) ([7d88d9f](https://github.com/davidzoufaly/noldor/commit/7d88d9f055d28339a2a8e979fe5a259ec2ad5e8e)) ([#305](https://github.com/davidzoufaly/noldor/pull/305))
- docs(roadmap): retire triaged-bullet-archive-section — shipped via fast-track (no FD) (#303) ([c7872db](https://github.com/davidzoufaly/noldor/commit/c7872dbd8644b2840c5c3b17cd3b7ae4920e310f)) ([#303](https://github.com/davidzoufaly/noldor/pull/303))
- docs(roadmap): retire dashboard-favicon-shows-the-project-initial — shipped via fast-track (no FD) (#302) ([1c1e333](https://github.com/davidzoufaly/noldor/commit/1c1e333adaccf100f27309d6ca7447c60aae2fcb)) ([#302](https://github.com/davidzoufaly/noldor/pull/302))
- docs(roadmap): retire pr-summary-rule-why-how-what — shipped via fast-track (no FD) (#301) ([ac044b2](https://github.com/davidzoufaly/noldor/commit/ac044b2da52dcd690b8058c656d67f150edc3b90)) ([#301](https://github.com/davidzoufaly/noldor/pull/301))
- docs(roadmap): retire dashboard-roadmap-add-route-writes-invalid-entries — shipped via fast-track (no FD) (#300) ([0d58bd7](https://github.com/davidzoufaly/noldor/commit/0d58bd757913bee59f63a3b525c4d1bef8ebffb4)) ([#300](https://github.com/davidzoufaly/noldor/pull/300))
- docs(roadmap): retire package-engines-runtime-floor — shipped via fast-track (no FD) (#299) ([7544545](https://github.com/davidzoufaly/noldor/commit/7544545a0ca2bd9759ddeb0d36ac6537f33c591f)) ([#299](https://github.com/davidzoufaly/noldor/pull/299))
- docs(roadmap): triage 2026-08-12 deep-audit findings into roadmap + backlog (#297) ([ce85517](https://github.com/davidzoufaly/noldor/commit/ce8551714d6a43288efb046deaf50f54b647ae82)) ([#297](https://github.com/davidzoufaly/noldor/pull/297))
- docs(features:rules-cascade-v1): revert phase done → in-progress for attach session (#296) ([05e0bbf](https://github.com/davidzoufaly/noldor/commit/05e0bbf3aa2ce46276851b5fa0aac251ddfebcb0)) ([#296](https://github.com/davidzoufaly/noldor/pull/296))
- docs(roadmap): retire clone-duplication-ratchet — shipped via fast-track (no FD) (#295) ([fffea74](https://github.com/davidzoufaly/noldor/commit/fffea745ba2ea9f4d67e49669173e5db753e4ea3)) ([#295](https://github.com/davidzoufaly/noldor/pull/295))
- docs(ideas): capture 2026-08-12 deep-audit findings + multiagent/task-split ideas (#294) ([2eac5be](https://github.com/davidzoufaly/noldor/commit/2eac5bea9a795ee5b49ec0a2e354467c0903551d)) ([#294](https://github.com/davidzoufaly/noldor/pull/294))
- docs(features:code-clone-detector): revert phase done → in-progress for attach session (#293) ([f7c52b9](https://github.com/davidzoufaly/noldor/commit/f7c52b98bb105ebf94db2df8a33da402ad8d974a)) ([#293](https://github.com/davidzoufaly/noldor/pull/293))
- docs(features:release-sweep-process-hardening): revert phase done → in-progress for attach session (#292) ([869b714](https://github.com/davidzoufaly/noldor/commit/869b7145f3a33e581a3614d7507fd2d9a3646993)) ([#292](https://github.com/davidzoufaly/noldor/pull/292))
- docs(features:specs-cr-gate-multi-reviewer): revert phase done → in-progress for attach session (#291) ([60e2382](https://github.com/davidzoufaly/noldor/commit/60e2382477c5ff299f7c391d8437d696da3889b9)) ([#291](https://github.com/davidzoufaly/noldor/pull/291))
- docs(roadmap): retire reviewer-lane-dispatch-timeout-configurable — shipped via fast-track (no FD) (#290) ([4487a8d](https://github.com/davidzoufaly/noldor/commit/4487a8d309ee0903cc3cc08d7f942044bdc54d88)) ([#290](https://github.com/davidzoufaly/noldor/pull/290))
- docs(roadmap): retire sdd-report-quote-normalization — shipped via fast-track (no FD) (#289) ([2ce4078](https://github.com/davidzoufaly/noldor/commit/2ce407844b2fcc89a44db3b568eb7f2a2c22ba19)) ([#289](https://github.com/davidzoufaly/noldor/pull/289))
- docs(roadmap): retire cr-receipt-amend-must-replace-same-key-trailer — shipped via fast-track (no FD) (#288) ([7a212ab](https://github.com/davidzoufaly/noldor/commit/7a212ab5b0198f97606c2915cc6821b5686068b3)) ([#288](https://github.com/davidzoufaly/noldor/pull/288))
- docs(roadmap): retire sync-code-links-destructive-without-fd-tags — shipped via fast-track (no FD) (#287) ([1ceef3d](https://github.com/davidzoufaly/noldor/commit/1ceef3dab7f6cb84890890d396b3453747b8c415)) ([#287](https://github.com/davidzoufaly/noldor/pull/287))
- docs(triage): land Q-0087..Q-0093 — charuy-dogfood + operator triage batch (#286) ([8430935](https://github.com/davidzoufaly/noldor/commit/8430935983e273c7dc86b6067da0377592f9c615)) ([#286](https://github.com/davidzoufaly/noldor/pull/286))
- docs(roadmap): retire worktree-envlocal-not-ignored — shipped via fast-track (no FD) (#285) ([363c76a](https://github.com/davidzoufaly/noldor/commit/363c76ab7c4d812980906e546a42b95a07e0c67a)) ([#285](https://github.com/davidzoufaly/noldor/pull/285))
- docs(triage): land Q-0079..Q-0086 — post-v1.2.0 triage batch + impact reorder (#284) ([cc69a4c](https://github.com/davidzoufaly/noldor/commit/cc69a4cdf5001de17cdcb946907b6ece162d238d)) ([#284](https://github.com/davidzoufaly/noldor/pull/284))
- docs: fix npm package name in README pitch + land post-release roadmap reorder (#283) ([4a77ddd](https://github.com/davidzoufaly/noldor/commit/4a77ddd591011f7fafd97e903fbe636e763f07d9)) ([#283](https://github.com/davidzoufaly/noldor/pull/283))

## v1.2.0 — 2026-08-10

### Features

- feat(tooling): check in .oxlintrc.json + template twin (#271) ([2cbe606](https://github.com/davidzoufaly/noldor/commit/2cbe606fd07cd2c28891d9d6216e62edc1926bca)) ([#271](https://github.com/davidzoufaly/noldor/pull/271))
- feat(cr): scope simplification into the fast-track review profile (#269) ([adce172](https://github.com/davidzoufaly/noldor/commit/adce172971e890f36438ae72971bb084732e1218)) ([#269](https://github.com/davidzoufaly/noldor/pull/269))

### Fixes

- fix(dashboard): raise git() abort budget 1.5s -> 10s — hot-zones blanked under load (#281) ([697bda6](https://github.com/davidzoufaly/noldor/commit/697bda66911257064872c32cd88b2127358692f7)) ([#281](https://github.com/davidzoufaly/noldor/pull/281))
- fix(core): declare per-prerequisite version args in the doctor probe (#264) ([b1103bd](https://github.com/davidzoufaly/noldor/commit/b1103bde937ad6014676d6ca14fcb953502f8e2f)) ([#264](https://github.com/davidzoufaly/noldor/pull/264))

### Other changes

- chore(release-sweep): pre-empt sdd:report drift (#282) ([8b0542d](https://github.com/davidzoufaly/noldor/commit/8b0542d0ed601f07bd4abfeee2f16b26c08d21f0)) ([#282](https://github.com/davidzoufaly/noldor/pull/282))
- docs(ideas): unbreak live-tree sdd-report tests reddened by PR #279 bullet moves (#280) ([1e88ae1](https://github.com/davidzoufaly/noldor/commit/1e88ae1184ae9c13c73d470a15f96f3640a67719)) ([#280](https://github.com/davidzoufaly/noldor/pull/280))
- docs(triage): land Q-0078 triage residue + absorb three Q-0073 lessons (#279) ([a0061b1](https://github.com/davidzoufaly/noldor/commit/a0061b1e048a349b8682741ac37546f5821ef3d3)) ([#279](https://github.com/davidzoufaly/noldor/pull/279))
- docs(skills): wire lazy-decision-ladder + noldor:cut discipline into noldor-refactor (#278) ([b6d9776](https://github.com/davidzoufaly/noldor/commit/b6d97760c649b33fb111ad2aa307ad1e8f386ef7)) ([#278](https://github.com/davidzoufaly/noldor/pull/278))
- docs(features:rules-cascade-v1): revert phase done → in-progress for attach session (#277) ([f2f1734](https://github.com/davidzoufaly/noldor/commit/f2f1734159dfc99db3e9572d9b0e7bfbc3bfcc42)) ([#277](https://github.com/davidzoufaly/noldor/pull/277))
- docs(features:specs-cr-gate-multi-reviewer): revert phase done → in-progress for attach session (#276) ([b151dcd](https://github.com/davidzoufaly/noldor/commit/b151dcd05081bf5877ca1b46f81c46a0a553ade7)) ([#276](https://github.com/davidzoufaly/noldor/pull/276))
- docs(roadmap): retire post-merge-cleanup-reporting-gaps — shipped via fast-track (no FD) (#275) ([70346e8](https://github.com/davidzoufaly/noldor/commit/70346e8f2db77d5a9acbc589992ce773d9283eea)) ([#275](https://github.com/davidzoufaly/noldor/pull/275))
- docs(roadmap): retire publish-access-public-invariant — shipped via fast-track (no FD) (#274) ([611b8f1](https://github.com/davidzoufaly/noldor/commit/611b8f1dc4ce7bf4bf7b5b0a0711989b3dcc4910)) ([#274](https://github.com/davidzoufaly/noldor/pull/274))
- docs(roadmap): retire noldor-commit-wrapper — shipped via fast-track (no FD) (#273) ([60e3064](https://github.com/davidzoufaly/noldor/commit/60e306473647274fea78410ac640a73af4aed73e)) ([#273](https://github.com/davidzoufaly/noldor/pull/273))
- docs(roadmap): retire graph-staleness-gate-loud-in-ci — shipped via fast-track (no FD) (#272) ([9ae0bc0](https://github.com/davidzoufaly/noldor/commit/9ae0bc09124fbb209dd69a48f81d4be3d728c838)) ([#272](https://github.com/davidzoufaly/noldor/pull/272))
- docs(roadmap): retire upgrade-never-advances-a-stale-anchor-on-an-empty-migration-chain — shipped via fast-track (no FD) (#270) ([1ae254a](https://github.com/davidzoufaly/noldor/commit/1ae254adbbecff3c052803ff98d36f9aa261744f)) ([#270](https://github.com/davidzoufaly/noldor/pull/270))
- docs(roadmap): retire drain-false-retry-on-in-flight-cr-lane — shipped via fast-track (no FD) (#268) ([bab98cb](https://github.com/davidzoufaly/noldor/commit/bab98cb2b67b1ada6ee383d1c49be5c56d482c89)) ([#268](https://github.com/davidzoufaly/noldor/pull/268))
- docs(roadmap): retire cr-review-dimension-coverage — shipped via fast-track (no FD) (#267) ([6c96cf2](https://github.com/davidzoufaly/noldor/commit/6c96cf21338f7770d8ee545d3d8eb459ca9d405d)) ([#267](https://github.com/davidzoufaly/noldor/pull/267))
- docs(roadmap): retire cr-delta-short-circuit-green-washes-red-prior-sinks — shipped via fast-track (no FD) (#266) ([ac1fed5](https://github.com/davidzoufaly/noldor/commit/ac1fed5c887357963826b241600cd7e03f715c84)) ([#266](https://github.com/davidzoufaly/noldor/pull/266))
- docs(roadmap): retire dashboard-port-collision-detection-across-projects — shipped via fast-track (no FD) (#265) ([29276fe](https://github.com/davidzoufaly/noldor/commit/29276fe2b3815b9dab6e2c16bb550bfead840a21)) ([#265](https://github.com/davidzoufaly/noldor/pull/265))
- docs(triage): land Q-0076 + Q-0077 — two consumer-facing CLI bugs (#263) ([a773e14](https://github.com/davidzoufaly/noldor/commit/a773e1402dddfb38265eb48446356ad0ebfbcd8e)) ([#263](https://github.com/davidzoufaly/noldor/pull/263))

## v1.1.1 — 2026-08-06

### Fixes

- fix(core): skip gh's local checkout in worktree context on direct-merge fallback (#258) ([b9d9063](https://github.com/davidzoufaly/noldor/commit/b9d90639fcaaa5d941811d7d65c7db5b3e0c938f)) ([#258](https://github.com/davidzoufaly/noldor/pull/258))
- fix(hooks): name the missing session marker instead of the trailer (#256) ([cba976c](https://github.com/davidzoufaly/noldor/commit/cba976ce2cfdf0610775667db28c8893cc9fbed6)) ([#256](https://github.com/davidzoufaly/noldor/pull/256))
- fix(triage): freeze roadmap/backlog format at one heading level (#249) ([6d4faac](https://github.com/davidzoufaly/noldor/commit/6d4faacd6a08b764cc375b322f3174e7d6509264)) ([#249](https://github.com/davidzoufaly/noldor/pull/249))

### Other changes

- docs(sdd-report): regen after garden archive pass (#262) ([4cf269a](https://github.com/davidzoufaly/noldor/commit/4cf269a512187078ada245ae6d427acd0933b41d)) ([#262](https://github.com/davidzoufaly/noldor/pull/262))
- docs(garden): archive 5 shipped plans + regen fd-resources (#261) ([4a0afc9](https://github.com/davidzoufaly/noldor/commit/4a0afc9649a237b6a06bce0d3b801dd3742ca0d1)) ([#261](https://github.com/davidzoufaly/noldor/pull/261))
- chore(release): pre-release graphify AST sweep + sdd-report regen (#260) ([f0010fc](https://github.com/davidzoufaly/noldor/commit/f0010fcb4fe8cbaabf3237068e06eac39ec1dba3)) ([#260](https://github.com/davidzoufaly/noldor/pull/260))
- docs(triage): land triage batch — Q-0072..Q-0075 + ideas markers (#259) ([03ffd8e](https://github.com/davidzoufaly/noldor/commit/03ffd8e81587832ff6b34b0fe270b0ad5daea00e)) ([#259](https://github.com/davidzoufaly/noldor/pull/259))
- chore(hooks): flip pre-commit fmt job to auto-fix + stage_fixed (#257) ([40d212d](https://github.com/davidzoufaly/noldor/commit/40d212dc1a9194d44caa58a75954be1d11081553)) ([#257](https://github.com/davidzoufaly/noldor/pull/257))
- docs(roadmap): retire mask-volatile-metrics-in-the-sdd-report-release-gate — shipped via fast-track (no FD) (#255) ([bb1bbfd](https://github.com/davidzoufaly/noldor/commit/bb1bbfd0939260d14944cc709a6ddd7d3808dacd)) ([#255](https://github.com/davidzoufaly/noldor/pull/255))
- docs(roadmap): retire mandatory-reviewer-lane-for-spec-plan-cr — shipped via fast-track (no FD) (#254) ([4726f65](https://github.com/davidzoufaly/noldor/commit/4726f65f04c90146f18dda0acc9e4c83514881c9)) ([#254](https://github.com/davidzoufaly/noldor/pull/254))
- docs(triage): land triage batch — Q-0058 + Q-0059..Q-0071 (#253) ([1b09c90](https://github.com/davidzoufaly/noldor/commit/1b09c90f90dbf4c626ed1c0ba0ea9e52652c5475)) ([#253](https://github.com/davidzoufaly/noldor/pull/253))
- docs(roadmap): retire Q-0052 archive-spec-plan-at-done-flip — shipped via PR #251 (#252) ([99509bf](https://github.com/davidzoufaly/noldor/commit/99509bf034a97bc8523b2bbfabc2067b08d22aa0)) ([#252](https://github.com/davidzoufaly/noldor/pull/252))
- docs(features:doc-gardening-skill): revert phase done → in-progress for attach session (#251) ([c34f91e](https://github.com/davidzoufaly/noldor/commit/c34f91ea84c46ab23ee839e7c9bc201885411dd7)) ([#251](https://github.com/davidzoufaly/noldor/pull/251))
- docs(features:de-superpowers-vendor-spec-plan-and-worktree-flows): revert phase done → in-progress for attach session (#250) ([3b840e6](https://github.com/davidzoufaly/noldor/commit/3b840e63e42fddbad2dd26789fd6dc37a7619247)) ([#250](https://github.com/davidzoufaly/noldor/pull/250))
- docs(triage): land Q-0057 + prune absorbed lesson bullets (#248) ([7dd46fd](https://github.com/davidzoufaly/noldor/commit/7dd46fdf863ed071415f0862ee8b1ff3e56ecf5c)) ([#248](https://github.com/davidzoufaly/noldor/pull/248))
- docs: add Q-0056 (freeze roadmap format) + drop auto-merge from README pitch (#247) ([879aae5](https://github.com/davidzoufaly/noldor/commit/879aae5a69b3795ae3f18838d8470ee751051674)) ([#247](https://github.com/davidzoufaly/noldor/pull/247))
- docs(noldor): absorb 2026-07-25 lessons + add Q-0054/Q-0055 (#246) ([4350ea8](https://github.com/davidzoufaly/noldor/commit/4350ea8b49c8048b2880f871f46d6f56291107f1)) ([#246](https://github.com/davidzoufaly/noldor/pull/246))
- docs(roadmap): add Q-0053 — show design context inline during spec/plan dialogue (#245) ([01c29d0](https://github.com/davidzoufaly/noldor/commit/01c29d02266ce670cd1a75332dffe0f7d8561a4b)) ([#245](https://github.com/davidzoufaly/noldor/pull/245))
- docs(roadmap): add Q-0052 — archive spec/plan at done-flip, not release-sweep (#244) ([1595710](https://github.com/davidzoufaly/noldor/commit/1595710bdbbde462329dcea30c76a115c3baeea1)) ([#244](https://github.com/davidzoufaly/noldor/pull/244))

## v1.1.0 — 2026-07-24

### Features

- feat(dashboard): expandable milestone body on /milestones page (#240) ([e688adf](https://github.com/davidzoufaly/noldor/commit/e688adf84da5eda808da35e811fdf471706bcaac)) ([#240](https://github.com/davidzoufaly/noldor/pull/240))
- feat(dashboard): derive top-nav brand from repo folder name (#239) ([1fced0d](https://github.com/davidzoufaly/noldor/commit/1fced0d8a420e9c0465c2ee3f36f038693a04e46)) ([#239](https://github.com/davidzoufaly/noldor/pull/239))

### Other changes

- chore(release): regen sdd-report date line for release gate (#243) ([57c1571](https://github.com/davidzoufaly/noldor/commit/57c15719f851e2f1a79a55cdf76c24c0f1541a6f)) ([#243](https://github.com/davidzoufaly/noldor/pull/243))
- chore(release-sweep): pre-empt sdd:report drift (#242) ([5c70212](https://github.com/davidzoufaly/noldor/commit/5c7021254a3b30408c4551292cee105a219efd91)) ([#242](https://github.com/davidzoufaly/noldor/pull/242))
- chore(state): commit Q-0051 triage tail + #239 test-link backfill (#241) ([61acfec](https://github.com/davidzoufaly/noldor/commit/61acfecf8aa1fdc2443d82a7b09a4680cd9705c8)) ([#241](https://github.com/davidzoufaly/noldor/pull/241))
- docs(ideas): capture open-source publish-saga lessons + inbox notes (#238) ([47ffbe3](https://github.com/davidzoufaly/noldor/commit/47ffbe34d2eb5883b4ff72b2b0a62541a4db256e)) ([#238](https://github.com/davidzoufaly/noldor/pull/238))

## v1.0.2 — 2026-07-15

### Other changes

- chore(release-sweep): pre-empt sdd:report drift for v1.0.2 (#237) ([76cea6f](https://github.com/davidzoufaly/noldor/commit/76cea6f853158dd1e1f085fdb8c41dcfe5760e68)) ([#237](https://github.com/davidzoufaly/noldor/pull/237))
- docs(sdd-report): refresh for v1.0.2 release (#236) ([edff656](https://github.com/davidzoufaly/noldor/commit/edff656f4e34b4b4c4aa67427f72477c9f0b8097)) ([#236](https://github.com/davidzoufaly/noldor/pull/236))
- build(release): add MIT license field to package.json (#235) ([200fd6e](https://github.com/davidzoufaly/noldor/commit/200fd6e3eb7289231cc5ce237dd4b6f246e9222d)) ([#235](https://github.com/davidzoufaly/noldor/pull/235))

## v1.0.1 — 2026-07-15

### Other changes

- chore(release-sweep): pre-empt sdd:report drift (#232) ([a072624](https://github.com/davidzoufaly/noldor/commit/a072624f6248d3fc1161ffae020e5b4640dcae5b)) ([#232](https://github.com/davidzoufaly/noldor/pull/232))
- docs: rewrite README — catchy overview + dashboard screenshots (#231) ([6358227](https://github.com/davidzoufaly/noldor/commit/6358227338b57e714fd912d4eed60b8ae3c49580)) ([#231](https://github.com/davidzoufaly/noldor/pull/231))
- docs(features:registry-distribution-for-the-noldor-package): revert phase done → in-progress for attach session (#230) ([35222c5](https://github.com/davidzoufaly/noldor/commit/35222c57c0c34e83d471c7697e0a536657a2ca39)) ([#230](https://github.com/davidzoufaly/noldor/pull/230))

## v1.0.0 — 2026-07-15

### Features

- feat(dashboard): reorg top-nav — Framework standalone last, Blocked-by to Health (#224) ([31c64c5](https://github.com/davidzoufaly/noldor/commit/31c64c519a6a689b3edb252b44c126f7f4214d1f)) ([#224](https://github.com/davidzoufaly/noldor/pull/224))
- feat(core): verify-lane bake-in — flip self-host verifyMode to blocking + attach verify evidence to PR body (#192) ([2f1aefb](https://github.com/davidzoufaly/noldor/commit/2f1aefbcbb2a0692f68656cb47307584e3ebe8bd)) ([#192](https://github.com/davidzoufaly/noldor/pull/192))

### Fixes

- fix(cli): shim codex+opencode in doctor test so contract-e2e passes on clean CI (#225) ([00c3eed](https://github.com/davidzoufaly/noldor/commit/00c3eedaf1112b0f3bf97afc4dd72bec254dc8a4)) ([#225](https://github.com/davidzoufaly/noldor/pull/225))

### Other changes

- chore(release): pre-release graphify + sdd-report sweep (#229) ([ba76783](https://github.com/davidzoufaly/noldor/commit/ba76783499ce97d72c2a82c05cc2f6bc48c8ab36)) ([#229](https://github.com/davidzoufaly/noldor/pull/229))
- refactor(noldor)!: rename docs/superpowers → docs/design (Q-0006) (#228) ([beb4ba9](https://github.com/davidzoufaly/noldor/commit/beb4ba98c52ff62f890e5db894fa09e7265249fe)) ([#228](https://github.com/davidzoufaly/noldor/pull/228))
- docs(ideas): update inbox — triage stamps, PR #216 lessons, new priority items (#227) ([ee4fce9](https://github.com/davidzoufaly/noldor/commit/ee4fce99e9da29c3aebab5ce746c38abb4b057bf)) ([#227](https://github.com/davidzoufaly/noldor/pull/227))
- docs(features:readme-rewrite-consumer-journey-order): add spec for readme-rewrite-consumer-journey-order (#226) ([0ec3d5a](https://github.com/davidzoufaly/noldor/commit/0ec3d5a4265986135553f4096b438fa314730ea3)) ([#226](https://github.com/davidzoufaly/noldor/pull/226))
- docs(roadmap): verify Q-0011 (b) done + trigger unfired, narrow scope to (c) (#223) ([adb5d14](https://github.com/davidzoufaly/noldor/commit/adb5d14ff8c7a6f0578ec270e5dbe281265273b5)) ([#223](https://github.com/davidzoufaly/noldor/pull/223))
- docs(roadmap): retire fd-command-rot-garden-detector — shipped via fast-track (no FD) (#222) ([f03e5ec](https://github.com/davidzoufaly/noldor/commit/f03e5ec51f3f2e83562f9aadc3b5aef1400ea640)) ([#222](https://github.com/davidzoufaly/noldor/pull/222))
- docs(features:vendored-systematic-debugging-discipline): add spec for vendored-systematic-debugging-discipline (#221) ([0d3cf17](https://github.com/davidzoufaly/noldor/commit/0d3cf1768708f72ac6d22899787384506eef6062)) ([#221](https://github.com/davidzoufaly/noldor/pull/221))
- docs(roadmap): retire non-claude-runner-parity-follow-ups Q-0025 — shipped via PR #219 (#220) ([847988e](https://github.com/davidzoufaly/noldor/commit/847988e1ad85e0f0c2356188ba5d453212719266)) ([#220](https://github.com/davidzoufaly/noldor/pull/220))
- docs(features:make-noldor-agent-agnostic): revert phase done → in-progress for attach session (#219) ([6faa9b8](https://github.com/davidzoufaly/noldor/commit/6faa9b88b29cc973b9254f809eb03c6cd71501d8)) ([#219](https://github.com/davidzoufaly/noldor/pull/219))
- docs(roadmap): retire vendored-verification-before-completion-discipline — shipped via fast-track (no FD) (#218) ([6fdb605](https://github.com/davidzoufaly/noldor/commit/6fdb6051f4ce15af37a7fd3059da12f856a3d489)) ([#218](https://github.com/davidzoufaly/noldor/pull/218))
- docs(features:validate-script-catalog-gate): add spec for validate-script-catalog-gate (#217) ([999c48f](https://github.com/davidzoufaly/noldor/commit/999c48fc79e3a1d23cf9c6ce9e73a5caeb61bc7d)) ([#217](https://github.com/davidzoufaly/noldor/pull/217))
- docs(roadmap): retire consumer-hygiene-batch — shipped via fast-track (no FD) (#216) ([03612af](https://github.com/davidzoufaly/noldor/commit/03612af82682f992d118283b8acf1472b9af4606)) ([#216](https://github.com/davidzoufaly/noldor/pull/216))
- docs(features:state-file-fail-open-hardening): add spec for state-file-fail-open-hardening (#215) ([db008cd](https://github.com/davidzoufaly/noldor/commit/db008cde36c0ef7c4840773211748169abb24096)) ([#215](https://github.com/davidzoufaly/noldor/pull/215))
- chore(gitignore): ignore .playwright-cli/ browser-automation scratch (#214) ([82fff8b](https://github.com/davidzoufaly/noldor/commit/82fff8bcfb2fff178842e1d40842891a95486643)) ([#214](https://github.com/davidzoufaly/noldor/pull/214))
- docs(roadmap): retire operator-spec-plan-links-on-feature-pages — shipped via fast-track (no FD) (#213) ([6df0769](https://github.com/davidzoufaly/noldor/commit/6df076984aca265b9de205707adbfd7dfeda606d)) ([#213](https://github.com/davidzoufaly/noldor/pull/213))
- docs(roadmap): retire refined-top-nav-bar — shipped via fast-track (no FD) (#212) ([5cb8c72](https://github.com/davidzoufaly/noldor/commit/5cb8c72a45264664d5f33219e896c4859ff5d7c1)) ([#212](https://github.com/davidzoufaly/noldor/pull/212))
- docs(roadmap): retire live-drain-log-newest-first-clear-when-idle — shipped via fast-track (no FD) (#211) ([2585bd9](https://github.com/davidzoufaly/noldor/commit/2585bd9ac5e7c5a1f162dd1739e29f15547f6c17)) ([#211](https://github.com/davidzoufaly/noldor/pull/211))
- docs(roadmap): retire roadmap-backlog-table-layout-consistency — shipped via fast-track (no FD) (#210) ([25b6f47](https://github.com/davidzoufaly/noldor/commit/25b6f4768de8a42df4c31ce9d1177ab2cee07c0f)) ([#210](https://github.com/davidzoufaly/noldor/pull/210))
- docs(roadmap): triage 4 dashboard UI entries + land audit batch (#209) ([505c4e7](https://github.com/davidzoufaly/noldor/commit/505c4e710882ac35dc7b4676b26f124fec72388a)) ([#209](https://github.com/davidzoufaly/noldor/pull/209))
- docs(features:code-clone-detector): add spec for code-clone-detector (#208) ([b1f37d9](https://github.com/davidzoufaly/noldor/commit/b1f37d9d5ec7c3f6b723de4cb8911abba1c641d5)) ([#208](https://github.com/davidzoufaly/noldor/pull/208))
- docs(features:memory-intake-lessons-learned-pipeline): revert phase done → in-progress for attach session (#207) ([bc4c585](https://github.com/davidzoufaly/noldor/commit/bc4c5855286f23449fb42ddd2432d773655b1713)) ([#207](https://github.com/davidzoufaly/noldor/pull/207))
- docs(features:dashboard-blocked-by-graph-view): add spec for dashboard-blocked-by-graph-view (#206) ([4bdc1d9](https://github.com/davidzoufaly/noldor/commit/4bdc1d9b44a000d03f6ba3c532bceb62f8755f86)) ([#206](https://github.com/davidzoufaly/noldor/pull/206))
- docs(features:skill-vs-code-drift-detector): add spec for skill-vs-code-drift-detector (#205) ([ea3815a](https://github.com/davidzoufaly/noldor/commit/ea3815a1e13206011623b5ef36260ab41e9d35de)) ([#205](https://github.com/davidzoufaly/noldor/pull/205))
- docs(roadmap): retire agent-events-log-rotation — shipped via fast-track (no FD) (#204) ([2c9efb0](https://github.com/davidzoufaly/noldor/commit/2c9efb0888674d3822adbe1569fd4936a660c3d3)) ([#204](https://github.com/davidzoufaly/noldor/pull/204))
- docs(features:outcome-telemetry-and-effectiveness-metrics): revert phase done → in-progress for attach session (#203) ([4d7c5b5](https://github.com/davidzoufaly/noldor/commit/4d7c5b52af9477861e26d363bdb3b45b4cb4a741)) ([#203](https://github.com/davidzoufaly/noldor/pull/203))
- docs(roadmap): retire dashboard-merge-skills-into-framework — shipped via fast-track (no FD) (#202) ([648ccb6](https://github.com/davidzoufaly/noldor/commit/648ccb697c0764e3cf49ece0851b9479514bb9c4)) ([#202](https://github.com/davidzoufaly/noldor/pull/202))
- docs(roadmap): retire dashboard-merge-hot-zones-into-wip-age — shipped via fast-track (no FD) (#201) ([1ff812c](https://github.com/davidzoufaly/noldor/commit/1ff812cfaac70da96a8fb03f8e567dc418494bd4)) ([#201](https://github.com/davidzoufaly/noldor/pull/201))
- docs(roadmap): retire dashboard-actions-row-full-height — shipped via fast-track (no FD) (#200) ([eaa0749](https://github.com/davidzoufaly/noldor/commit/eaa074979ba3c817971803b40dc055d93b49e176)) ([#200](https://github.com/davidzoufaly/noldor/pull/200))
- docs(roadmap): triage 5 ideas + land queue-prep moves (#199) ([d165a21](https://github.com/davidzoufaly/noldor/commit/d165a21125c22836e51ffeb637a33aca0ff59014)) ([#199](https://github.com/davidzoufaly/noldor/pull/199))
- docs(features:memory-intake-lessons-learned-pipeline): add spec for memory-intake-lessons-learned-pipeline (#198) ([5d102fe](https://github.com/davidzoufaly/noldor/commit/5d102fedcf0d064030d330fc814f1b78448ca694)) ([#198](https://github.com/davidzoufaly/noldor/pull/198))
- docs(roadmap): retire dashboard-entry-move-to-top-bottom-actions — shipped via fast-track (no FD) (#197) ([2225ac5](https://github.com/davidzoufaly/noldor/commit/2225ac5fde00ec12e322e0885643b9e3d50ff47d)) ([#197](https://github.com/davidzoufaly/noldor/pull/197))
- docs(roadmap): retire dashboard-task-id-under-task-title — shipped via fast-track (no FD) (#196) ([9121fac](https://github.com/davidzoufaly/noldor/commit/9121fac5a2a497cc6b795fda1c2f3f7117dda589)) ([#196](https://github.com/davidzoufaly/noldor/pull/196))
- docs(ideas): capture dashboard merge ideas — hot-zones→wip-age, skills→framework (#195) ([60be7dc](https://github.com/davidzoufaly/noldor/commit/60be7dcf32330c86a8632882066ae2547d18b8cb)) ([#195](https://github.com/davidzoufaly/noldor/pull/195))
- docs(features:dashboard-broken-pages-audit): add spec for dashboard-broken-pages-audit (#194) ([21a7c0a](https://github.com/davidzoufaly/noldor/commit/21a7c0ae7c1fcd156a8f8b460b18a09b07ea1726)) ([#194](https://github.com/davidzoufaly/noldor/pull/194))
- docs(triage): land triage batch 2026-07-11 — Q-0027..Q-0029 roadmap + backlog + ideas markers (#193) ([3edfd79](https://github.com/davidzoufaly/noldor/commit/3edfd79be73a4c8d6263c3b3fc918deeb0850285)) ([#193](https://github.com/davidzoufaly/noldor/pull/193))
- docs(roadmap): retire test-tag-presence-on-src-layout — shipped via fast-track (no FD) (#191) ([2734cfd](https://github.com/davidzoufaly/noldor/commit/2734cfd7da3aaa2ada69a0d9246c77371f4051e8)) ([#191](https://github.com/davidzoufaly/noldor/pull/191))
- docs(roadmap): retire plans-source-drain-deps-gating — shipped via fast-track (no FD) (#190) ([faaa601](https://github.com/davidzoufaly/noldor/commit/faaa60119d28f6888104ad1bdca98ddc63d5bdc5)) ([#190](https://github.com/davidzoufaly/noldor/pull/190))
- docs(roadmap): retire pr-flow-fallback-merges-on-red-ci — shipped via fast-track (no FD) (#189) ([5b766bb](https://github.com/davidzoufaly/noldor/commit/5b766bb34fad189231322b2969aed6292633e0ca)) ([#189](https://github.com/davidzoufaly/noldor/pull/189))
- docs(roadmap): retire add-templates-docs-to-micro-chore-and-release-sweep-allowlists — shipped via fast-track (no FD) (#188) ([ee35c45](https://github.com/davidzoufaly/noldor/commit/ee35c45bc19354afdc3a6ae97fbcd12d518dd31e)) ([#188](https://github.com/davidzoufaly/noldor/pull/188))
- docs(roadmap): make trigger-parked Q-0011 drain-ineligible (multi-bullet body) (#187) ([533d1c8](https://github.com/davidzoufaly/noldor/commit/533d1c8620dcfb30a41da48e041de34ea82622ff)) ([#187](https://github.com/davidzoufaly/noldor/pull/187))
- docs(roadmap): stage drain batch — move Q-0019/Q-0020/Q-0021/Q-0022 from backlog, retire shipped Q-0011(a), park Q-0011(b)(c) trigger-parked (#186) ([a86237e](https://github.com/davidzoufaly/noldor/commit/a86237e39058ad5bc21d6dc768892af8b70239e8)) ([#186](https://github.com/davidzoufaly/noldor/pull/186))

## v0.5.1 — 2026-07-11

### Fixes

- fix(core): centralize all-ignored fmt no-op guard behind `noldor fmt` (#184) ([1061f98](https://github.com/davidzoufaly/noldor/commit/1061f98e242feb45171def1c8c788b3eec89c759)) ([#184](https://github.com/davidzoufaly/noldor/pull/184))
- fix(core): idempotent delivery guard skips push/PR when branch already on origin (#180) ([0b1435c](https://github.com/davidzoufaly/noldor/commit/0b1435ceb4cd62fdcf4658956e66529c2d8d10d1)) ([#180](https://github.com/davidzoufaly/noldor/pull/180))
- fix(autonomous): drain recognizes a merged fast-track PR → no re-spawn loop (#176) ([48884a8](https://github.com/davidzoufaly/noldor/commit/48884a8dd337ac3765c27ead23488e2b0d4dc807)) ([#176](https://github.com/davidzoufaly/noldor/pull/176))
- fix(core): init enumerates all template conflicts + capture consumer-3 friction (#175) ([5bfc4dd](https://github.com/davidzoufaly/noldor/commit/5bfc4dd15d07bc8fe975170b2af2e42cdf3f2220)) ([#175](https://github.com/davidzoufaly/noldor/pull/175))
- fix(core): fmt no-target guard + scaffold autonomous config block (#174) ([c2ce358](https://github.com/davidzoufaly/noldor/commit/c2ce3582ebe2f070a0f15a7d30d202179623537d)) ([#174](https://github.com/davidzoufaly/noldor/pull/174))
- fix(core): adoption UX — upgrade anchor bootstrap, doctor node_modules probe, guide -w (#173) ([1c45035](https://github.com/davidzoufaly/noldor/commit/1c4503584537d10da51be49e10d9d9b56e572720)) ([#173](https://github.com/davidzoufaly/noldor/pull/173))

### Other changes

- chore(release-sweep): pre-empt sdd:report drift (#185) ([1833951](https://github.com/davidzoufaly/noldor/commit/18339514c5a2fa834ad373fd2e6aba5d45c96cf0)) ([#185](https://github.com/davidzoufaly/noldor/pull/185))
- docs(features:noldor-native-wait-primitive): add spec for noldor-native-wait-primitive (#183) ([6513550](https://github.com/davidzoufaly/noldor/commit/6513550323c7a6a5e718366651d1aca4d00d47ab)) ([#183](https://github.com/davidzoufaly/noldor/pull/183))
- docs(features:prefix-skills-with-noldor): add spec for prefix-skills-with-noldor (#182) ([9a2e52e](https://github.com/davidzoufaly/noldor/commit/9a2e52e46def10e5e4d42a21aafa9fc17b171a35)) ([#182](https://github.com/davidzoufaly/noldor/pull/182))
- docs(roadmap): retire Q-0008 idempotent-drain-delivery-guard (shipped PR #180) (#181) ([8333be5](https://github.com/davidzoufaly/noldor/commit/8333be5354fcea016dc649fa69267c93193712d7)) ([#181](https://github.com/davidzoufaly/noldor/pull/181))
- chore(noldor): absorb Claude memory into framework docs + queue entries (#179) ([026845f](https://github.com/davidzoufaly/noldor/commit/026845fba4d104e1dd7cb0da1279e2fed4ed22dd)) ([#179](https://github.com/davidzoufaly/noldor/pull/179))
- docs(roadmap): retire Q-0004 section-age-staleness-detector (subsumed by Detector 15) (#178) ([3e3fcae](https://github.com/davidzoufaly/noldor/commit/3e3fcae5b658e36fb140f45f32c7d13803647d06)) ([#178](https://github.com/davidzoufaly/noldor/pull/178))
- docs(roadmap): retire Q-0001 real-consumer-2-adoption-dogfood (met by consumer-3 charuy dogfood) (#177) ([c9a2293](https://github.com/davidzoufaly/noldor/commit/c9a229353cf5172d99b9ad469af94c497411812d)) ([#177](https://github.com/davidzoufaly/noldor/pull/177))

## v0.5.0 — 2026-07-07

### Features

- feat(triage): parse blocked-by: as first-class alias of deps: (#161) ([7e9e5d8](https://github.com/davidzoufaly/noldor/commit/7e9e5d8e87e15864dab2e347728f8acd80169d6a)) ([#161](https://github.com/davidzoufaly/noldor/pull/161))
- feat(core): accept Noldor-Sibling-Scope trailer in noldor-scope validation (#158) ([f9af1f6](https://github.com/davidzoufaly/noldor/commit/f9af1f684509735ec9379ad352690b5d9ddf3517)) ([#158](https://github.com/davidzoufaly/noldor/pull/158))
- feat(triage): stable entry IDs (Q-NNNN) for roadmap + backlog (#157) ([511734d](https://github.com/davidzoufaly/noldor/commit/511734d9114143d9550a99943929dacf3a122974)) ([#157](https://github.com/davidzoufaly/noldor/pull/157))
- feat(core): add split-suggestion oversize heuristics (E1-E3, F1, P1) (#155) ([52d2209](https://github.com/davidzoufaly/noldor/commit/52d2209b9686cac2c304ef7e9827e4f9fede0a99)) ([#155](https://github.com/davidzoufaly/noldor/pull/155))
- feat(agents): add promptDispatch runner capability (#151) ([c63f3c1](https://github.com/davidzoufaly/noldor/commit/c63f3c121bfb65d1c10a2467f9365894a2abb53f)) ([#151](https://github.com/davidzoufaly/noldor/pull/151))
- feat(core): agent-event vocabulary — paired spawned/exited rows with spawnId (#150) ([4c1b10b](https://github.com/davidzoufaly/noldor/commit/4c1b10b0896f5a8e47ae36efacdd2a34318b43b6)) ([#150](https://github.com/davidzoufaly/noldor/pull/150))
- feat(noldor): release-sweep graphify passes default to AST-only, full-semantic opt-in (#148) ([17071c1](https://github.com/davidzoufaly/noldor/commit/17071c1c1f1feb692b1a205736b3ca0341638be2)) ([#148](https://github.com/davidzoufaly/noldor/pull/148))
- feat(autonomous): add noldor autonomous status subcommand (#147) ([6cf47de](https://github.com/davidzoufaly/noldor/commit/6cf47de7bae5cc4b162759ff1b8ece9931897022)) ([#147](https://github.com/davidzoufaly/noldor/pull/147))
- feat(core): add repo-paths provider (scanRoots + actualPackageNames) (#144) ([f88c8a9](https://github.com/davidzoufaly/noldor/commit/f88c8a9a213494870544f0f820f58a843b476571)) ([#144](https://github.com/davidzoufaly/noldor/pull/144))
- feat(init): unblock JS-consumer bootstrap (lazy tsdoc import, graceful invariants, starters) (#140) ([b33efc7](https://github.com/davidzoufaly/noldor/commit/b33efc782ec5385412bc74b95f429a36668e2729)) ([#140](https://github.com/davidzoufaly/noldor/pull/140))
- feat(release): add release.publish config block (default-off consumer safety) (#139) ([0a1d4f4](https://github.com/davidzoufaly/noldor/commit/0a1d4f42b22852ea3f675623c50c181bd08e380c)) ([#139](https://github.com/davidzoufaly/noldor/pull/139))
- feat(doctor): probe declared stack prerequisites before template drift (#137) ([fbd8bd0](https://github.com/davidzoufaly/noldor/commit/fbd8bd025ea6aa91d383659979a0fcd5b6a53244)) ([#137](https://github.com/davidzoufaly/noldor/pull/137))
- feat(release): add release.crGateExemptCommits config schema (#133) ([0961d4c](https://github.com/davidzoufaly/noldor/commit/0961d4c647dcffdd5197abf2b486d847dcd48cdf)) ([#133](https://github.com/davidzoufaly/noldor/pull/133))
- feat(release): add release-state persistence for interrupted releases (#132) ([7a8cd17](https://github.com/davidzoufaly/noldor/commit/7a8cd1741c9f0cc55519ed67e002be1118670729)) ([#132](https://github.com/davidzoufaly/noldor/pull/132))
- feat(garden): derive sdd-report scan roots from consumer scanPaths + backfill test co-tags (#122) ([d57aacc](https://github.com/davidzoufaly/noldor/commit/d57aaccda05ba5e3ba0092e965d730645db118b5)) ([#122](https://github.com/davidzoufaly/noldor/pull/122))
- feat(garden): fd-link-rot detector + one-shot link-rot migration CLI (#121) ([1c76f0e](https://github.com/davidzoufaly/noldor/commit/1c76f0e3fdd59c5712ce4c3001c04242a8cc65af)) ([#121](https://github.com/davidzoufaly/noldor/pull/121))
- feat(autonomous): port run hardening into watch — cycle reconcile, SIGTERM group-kill, pgid heartbeat (#120) ([bc26f66](https://github.com/davidzoufaly/noldor/commit/bc26f6623d109a18609cdc85a4a4188ddf5df934)) ([#120](https://github.com/davidzoufaly/noldor/pull/120))
- feat(cli): portable gate CLIs + config scaffold + consumer install fixes (#119) ([0dba987](https://github.com/davidzoufaly/noldor/commit/0dba987c955d941c7ae37d2fd12b535782015834)) ([#119](https://github.com/davidzoufaly/noldor/pull/119))
- feat(core): arm gate enforcement via committed rollout marker (#118) ([18050da](https://github.com/davidzoufaly/noldor/commit/18050da9eb349b4f2ef4de6c760f9d8771ab1137)) ([#118](https://github.com/davidzoufaly/noldor/pull/118))

### Fixes

- fix(core): allowlist first-adoption commit in noldor-scope hook (#166) ([3b39269](https://github.com/davidzoufaly/noldor/commit/3b39269aebfdb1e91874e72fa6fa9472eda9707b)) ([#166](https://github.com/davidzoufaly/noldor/pull/166))
- fix(invariants): soft-warn rule-pairs referencing consumer-owned docs (#164) ([dc20b81](https://github.com/davidzoufaly/noldor/commit/dc20b8146cdf0135bb1ccced5da62e5226f560e4)) ([#164](https://github.com/davidzoufaly/noldor/pull/164))
- fix(cli): reconcile init --adopt drift to one source of truth (#163) ([490fa84](https://github.com/davidzoufaly/noldor/commit/490fa84dbc84ed809e7346bee0db98f25c80f7c5)) ([#163](https://github.com/davidzoufaly/noldor/pull/163))
- fix(ci): declare packageManager so pnpm/action-setup resolves a pnpm version (#135) ([1d21d3a](https://github.com/davidzoufaly/noldor/commit/1d21d3a1331cf548edfcbfad7456aeae2557ef24)) ([#135](https://github.com/davidzoufaly/noldor/pull/135))
- fix(prep): promote commit trailers ride one paragraph so interpret-trailers sees them (#129) ([ef39664](https://github.com/davidzoufaly/noldor/commit/ef396643d8df97a63007738f82257d4f05936995)) ([#129](https://github.com/davidzoufaly/noldor/pull/129))
- fix(prep): prep promote --ship mirrors pr-flow direct squash-merge fallback (#128) ([2c05cf7](https://github.com/davidzoufaly/noldor/commit/2c05cf72277db632e404790c4fde6f4fcdc24ee0)) ([#128](https://github.com/davidzoufaly/noldor/pull/128))
- fix(prep): preflight ignores untracked files, blocks only on tracked changes (#127) ([6b24251](https://github.com/davidzoufaly/noldor/commit/6b242512e3c7289a2aac480049d5e34ae47cfcff)) ([#127](https://github.com/davidzoufaly/noldor/pull/127))
- fix(cli): derive --version from package.json; refresh stale README status (#126) ([28d850b](https://github.com/davidzoufaly/noldor/commit/28d850b117fec767593726de1f00ff8bc14a10f4)) ([#126](https://github.com/davidzoufaly/noldor/pull/126))
- fix(gate): refresh release-sweep session startedAt on every green pre-commit pass (#125) ([293c2ae](https://github.com/davidzoufaly/noldor/commit/293c2aea20d3a9b345045ddb057dc5f163a920dc)) ([#125](https://github.com/davidzoufaly/noldor/pull/125))
- fix(skills): audit release-sweep skill against post-reorg CLI + src layout (#124) ([b6be521](https://github.com/davidzoufaly/noldor/commit/b6be5218e2f16e7fea241cefbc4f195bca43afc8)) ([#124](https://github.com/davidzoufaly/noldor/pull/124))

### Other changes

- chore(release): pre-empt sdd-report drift (override-audit + CR metrics) (#172) ([5b904a3](https://github.com/davidzoufaly/noldor/commit/5b904a3786c60236580b95adfcdb15ca82371b4b)) ([#172](https://github.com/davidzoufaly/noldor/pull/172))
- chore(noldor): sync introduced-fill twins for drain-mode + research-fanout (#171) ([bbbc88d](https://github.com/davidzoufaly/noldor/commit/bbbc88deefc82c8fa15cc3c2c4ffb30f730a22ae)) ([#171](https://github.com/davidzoufaly/noldor/pull/171))
- chore(release): pre-release graphify sweep (AST-only) (#170) ([a18b52b](https://github.com/davidzoufaly/noldor/commit/a18b52b2f4f4bbdbdee23965153e3fbde37e7134)) ([#170](https://github.com/davidzoufaly/noldor/pull/170))
- docs(features:sdd-detector-5-idea-merge-semantic-similarity): add spec for sdd-detector-5-idea-merge-semantic-similarity (#169) ([4906c98](https://github.com/davidzoufaly/noldor/commit/4906c98d4cc04e5d584e5a23d8b0328d876250bc)) ([#169](https://github.com/davidzoufaly/noldor/pull/169))
- docs(features:registry-distribution-for-the-noldor-package): revert phase done → in-progress for attach session (#168) ([d3bc2b0](https://github.com/davidzoufaly/noldor/commit/d3bc2b08039a41d4237d7d311882935198066682)) ([#168](https://github.com/davidzoufaly/noldor/pull/168))
- docs(noldor): adoption-guide sweep — lockstep=paths + bootstrap gotchas; retire Q-0013/0015/0016 (#167) ([90a0046](https://github.com/davidzoufaly/noldor/commit/90a0046fcc435b1154dd8885dd35f5b7cee94332)) ([#167](https://github.com/davidzoufaly/noldor/pull/167))
- chore(roadmap): retire Q-0017 consumer-rule-conflicts-graceful-degradation (shipped #164) (#165) ([a7f270e](https://github.com/davidzoufaly/noldor/commit/a7f270ee5b50ce77f7aa94b458ac6eaee2f82ced)) ([#165](https://github.com/davidzoufaly/noldor/pull/165))
- chore(triage): consumer-2 dogfood friction → roadmap Q-0013..Q-0017 + backlog Q-0018 (#162) ([d94c1db](https://github.com/davidzoufaly/noldor/commit/d94c1dba8ae8107499476338d49b9efaad89aca0)) ([#162](https://github.com/davidzoufaly/noldor/pull/162))
- chore(core): delete dead cr-retry loop, drop gate survives-on-disk note (#159) ([8368f57](https://github.com/davidzoufaly/noldor/commit/8368f570ebc03cceadae97cebe718fd6330b71f7)) ([#159](https://github.com/davidzoufaly/noldor/pull/159))
- refactor(core): relocate repo config loader, review profiles, and stdin prompts out of src/cr (#156) ([007e4e3](https://github.com/davidzoufaly/noldor/commit/007e4e3719ce05e0a4915e025511f46f7ab4fd5f)) ([#156](https://github.com/davidzoufaly/noldor/pull/156))
- docs(plans): add implementation plans for phase-6 structural batch (5 FDs) (#154) ([8bcac84](https://github.com/davidzoufaly/noldor/commit/8bcac84856ff01aaa946da1e1181b45b9dff46d9)) ([#154](https://github.com/davidzoufaly/noldor/pull/154))
- docs(roadmap): rephrase blocked-by Touches clause as prose for drain eligibility (#153) ([1cb7558](https://github.com/davidzoufaly/noldor/commit/1cb7558e0f58148a5473a8bd88693e5e50ca16dc)) ([#153](https://github.com/davidzoufaly/noldor/pull/153))
- docs: promote prep-batch 2026-07-03 phase-6 (5 FDs) (#152) ([a890954](https://github.com/davidzoufaly/noldor/commit/a890954e225056f59bf3bbb4a2bd288348fa5e05)) ([#152](https://github.com/davidzoufaly/noldor/pull/152))
- docs(plans): add implementation plans for agent-events dashboard + portable gate entrypoint (#149) ([5ed6e20](https://github.com/davidzoufaly/noldor/commit/5ed6e2052932bc762732d6b4a9844f08e7e195dc)) ([#149](https://github.com/davidzoufaly/noldor/pull/149))
- docs(roadmap): phase-5 queue hygiene — drain-eligible status entry, retire checkpoint-resume (#146) ([e2ebf85](https://github.com/davidzoufaly/noldor/commit/e2ebf855fb6f9052b3604b3f0547af0d1ada2332)) ([#146](https://github.com/davidzoufaly/noldor/pull/146))
- docs: promote prep-batch 2026-07-03 (2 FDs) (#145) ([d015f16](https://github.com/davidzoufaly/noldor/commit/d015f167f028ac6faf3c54da561de8e0ba53ff45)) ([#145](https://github.com/davidzoufaly/noldor/pull/145))
- chore(features): backfill @tests tags and links.code ownership (tag judgment pass) (#143) ([1eb43c6](https://github.com/davidzoufaly/noldor/commit/1eb43c692d6e9aaba44d6e8e1ad9ae8d4467df56)) ([#143](https://github.com/davidzoufaly/noldor/pull/143))
- docs(plans): add implementation plan for scan-roots-repo-paths-provider (#142) ([24d7886](https://github.com/davidzoufaly/noldor/commit/24d78868aace0a11ce4ad84e03df4e3cfc371536)) ([#142](https://github.com/davidzoufaly/noldor/pull/142))
- docs(features): promote scan-roots-repo-paths-provider (prep batch 2026-07-03b) (#141) ([7001d1e](https://github.com/davidzoufaly/noldor/commit/7001d1e1a80181782f012c7b20dcc89308d0531d)) ([#141](https://github.com/davidzoufaly/noldor/pull/141))
- docs(plans): add implementation plan for registry-distribution-for-the-noldor-package (#138) ([4e09878](https://github.com/davidzoufaly/noldor/commit/4e0987848da34229d89247044926af34fbbfcb16)) ([#138](https://github.com/davidzoufaly/noldor/pull/138))
- docs: promote prep-batch 2026-07-03 (1 FDs) (#136) ([cfb750a](https://github.com/davidzoufaly/noldor/commit/cfb750a01f7d3f6acc963c74e77eb480bd6b0f8a)) ([#136](https://github.com/davidzoufaly/noldor/pull/136))
- docs(noldor): sync gate docs with code — trailer schema, PR-only finish, retired cr-retry loop (#134) ([d077109](https://github.com/davidzoufaly/noldor/commit/d0771091681652dab108bfca2aec700d16bdea52)) ([#134](https://github.com/davidzoufaly/noldor/pull/134))
- docs(plans): add implementation plans for release-bypass-retirement and pnpm-release-resume (#131) ([7490095](https://github.com/davidzoufaly/noldor/commit/7490095e62722dd6e7d83059d0865a3b3293d874)) ([#131](https://github.com/davidzoufaly/noldor/pull/131))
- docs: promote prep-batch 2026-07-02 (2 FDs) (#130) ([4404525](https://github.com/davidzoufaly/noldor/commit/4404525e46a54f8f85fdb1a206a5df8543b08a19)) ([#130](https://github.com/davidzoufaly/noldor/pull/130))
- docs(triage): phase-0 queue hygiene — verify relevancy, retire shipped/stale, reorder by execution phases (#123) ([4b955b6](https://github.com/davidzoufaly/noldor/commit/4b955b6885a325e49542601bc80aab9f57aa2a37)) ([#123](https://github.com/davidzoufaly/noldor/pull/123))
- chore(ci): run pnpm verify on pull requests (#117) ([19a74a1](https://github.com/davidzoufaly/noldor/commit/19a74a10e8e844e021b08fe616992eae1b56f977)) ([#117](https://github.com/davidzoufaly/noldor/pull/117))
- docs(features:parallel-agent-dispatch-for-research-jobs): add spec for parallel-agent-dispatch-for-research-jobs (#116) ([bc1893a](https://github.com/davidzoufaly/noldor/commit/bc1893a909005b6d34fdec250a30d37d83c9d4a4)) ([#116](https://github.com/davidzoufaly/noldor/pull/116))
- docs(ideas): add v0.4.0 release-sweep retrospective (#115) ([a76b7b2](https://github.com/davidzoufaly/noldor/commit/a76b7b269f68e19efed3e0d2f597d9716fa1e078)) ([#115](https://github.com/davidzoufaly/noldor/pull/115))

## v0.4.0 — 2026-07-01

### Features

- feat(cr): bootstrap-immunity for self-gating features (#110) ([38015b0](https://github.com/davidzoufaly/noldor/commit/38015b09fe708aad7c4bd05f8e622870c3522b0f)) ([#110](https://github.com/davidzoufaly/noldor/pull/110))
- feat(graphify): doc nodes + plan-of/spec-of edges, graph-adjacency stale fallback (#109) ([074c19c](https://github.com/davidzoufaly/noldor/commit/074c19cd2dfba0ad24bc61aad68bc0b2ee464dba)) ([#109](https://github.com/davidzoufaly/noldor/pull/109))
- feat(milestones): connect features to milestones across schema, garden, and dashboard (#108) ([2a0603b](https://github.com/davidzoufaly/noldor/commit/2a0603bcc1e8e488f026d522f116e627a57acfbf)) ([#108](https://github.com/davidzoufaly/noldor/pull/108))
- feat(autonomous:drain-startup-reconciliation-of-a-prior-dead-run): reconcile a prior dead drain run at startup (#107) ([30a5f81](https://github.com/davidzoufaly/noldor/commit/30a5f81f03b67ff1e6a1947193396277cb0b0c05)) ([#107](https://github.com/davidzoufaly/noldor/pull/107))
- feat(autonomous:parallel-drain-roadmapmd-conflict-auto-resolution): auto-resolve adjacent roadmap.md block conflicts in K>1 drain (#106) ([e6d726e](https://github.com/davidzoufaly/noldor/commit/e6d726e9ec782e1fa88780021b23e0bc8216ee49)) ([#106](https://github.com/davidzoufaly/noldor/pull/106))
- feat(migrations): add semver parse + compare helpers (#104) ([ad38407](https://github.com/davidzoufaly/noldor/commit/ad3840740893a8449dfec9b23f32192250b7be8d)) ([#104](https://github.com/davidzoufaly/noldor/pull/104))
- feat(tooling): add consumer.dev surface config block (#103) ([2793178](https://github.com/davidzoufaly/noldor/commit/2793178ddc908fd97131764176a8d6d80d28fb74)) ([#103](https://github.com/davidzoufaly/noldor/pull/103))
- feat(sync): add // @fd: code tag parser + slug→code map (#100) ([04c4401](https://github.com/davidzoufaly/noldor/commit/04c44018a69fdc25133a82c25f25def63d052b4a)) ([#100](https://github.com/davidzoufaly/noldor/pull/100))
- feat(testing): register hermetic stub runner in agent registry (#99) ([2246759](https://github.com/davidzoufaly/noldor/commit/22467599efe506996171d4e3b339f52ecdc0ee87)) ([#99](https://github.com/davidzoufaly/noldor/pull/99))
- feat(cr): add review-profile schema and built-in profiles (#98) ([d357d69](https://github.com/davidzoufaly/noldor/commit/d357d692f0624697810a99a7776d4202d7642a7e)) ([#98](https://github.com/davidzoufaly/noldor/pull/98))
- feat(prep): add --slugs filter to prep fanout (#95) ([82e6e86](https://github.com/davidzoufaly/noldor/commit/82e6e86fe558dad9ac6ea70be94f7cdbb5578a71)) ([#95](https://github.com/davidzoufaly/noldor/pull/95))
- feat(release): relax graph freshness for test-only and doc-only diffs (#91) ([0b99c46](https://github.com/davidzoufaly/noldor/commit/0b99c4612301642f073697485d209edda00fa2b2)) ([#91](https://github.com/davidzoufaly/noldor/pull/91))
- feat(dashboard): roadmap/backlog row remove + add-entry controls (#88) ([78f826f](https://github.com/davidzoufaly/noldor/commit/78f826f3d5c2af071406a32edb7c2cc1bedaeb94)) ([#88](https://github.com/davidzoufaly/noldor/pull/88))
- feat(noldor): add watch --detach for unattended drain launch (#87) ([67111ba](https://github.com/davidzoufaly/noldor/commit/67111ba595c386c08c7a3f5f3590be61110f6642)) ([#87](https://github.com/davidzoufaly/noldor/pull/87))
- feat(garden): cross-check release-push receipts against release-commit shape (#80) ([bb2bd77](https://github.com/davidzoufaly/noldor/commit/bb2bd77e42a82935278aaef6596bf1ba417a2f6f)) ([#80](https://github.com/davidzoufaly/noldor/pull/80))

### Fixes

- fix(hooks): exclude graphify-out from fmt lefthook step + refresh graph (#114) ([5432d68](https://github.com/davidzoufaly/noldor/commit/5432d68e95e2cc8df959f9445f91fcdf1e27a81d)) ([#114](https://github.com/davidzoufaly/noldor/pull/114))
- fix(autonomous): plan-drain resume rides autonomous directive on prompt (#101) ([cd6a7bf](https://github.com/davidzoufaly/noldor/commit/cd6a7bf17d31ab3799bf0ac01f49cc00eb07465a)) ([#101](https://github.com/davidzoufaly/noldor/pull/101))
- fix(tooling): wire graph.json arg into pnpm toon script (#92) ([573e4b4](https://github.com/davidzoufaly/noldor/commit/573e4b4c9a64853a1fc5bafb72e8de7be950f6bd)) ([#92](https://github.com/davidzoufaly/noldor/pull/92))
- fix(garden): derive receipt freshness from consumer scanPaths (#90) ([0974883](https://github.com/davidzoufaly/noldor/commit/09748836df3d51bc4199cd0552a88968df48d897)) ([#90](https://github.com/davidzoufaly/noldor/pull/90))
- fix(core): label fast-track PR summary as Fast-track not Micro-chore (#89) ([519cb16](https://github.com/davidzoufaly/noldor/commit/519cb16f66bfc1f7b125ccd02fcb5848e107a058)) ([#89](https://github.com/davidzoufaly/noldor/pull/89))
- fix(cli): guard --help on subcommands before dispatch (#86) ([16b08d6](https://github.com/davidzoufaly/noldor/commit/16b08d6f97ce94ca8686ea40c378ddc4e4009622)) ([#86](https://github.com/davidzoufaly/noldor/pull/86))
- fix(autonomous): drain skips deps-in-queue + matches Touches: anywhere (#83) ([6afe19b](https://github.com/davidzoufaly/noldor/commit/6afe19bb7278ac8333e0a00c851b8f814dbd5266)) ([#83](https://github.com/davidzoufaly/noldor/pull/83))
- fix(gate): stash uncommitted work before micro-chore reset --hard (#82) ([df4af54](https://github.com/davidzoufaly/noldor/commit/df4af544a6d292a0b05db8835eb20faf39998fc2)) ([#82](https://github.com/davidzoufaly/noldor/pull/82))
- fix(tooling): stop stray graphify output breaking fmt:check (#78) ([0986079](https://github.com/davidzoufaly/noldor/commit/0986079858c7661b8cfbea615794b3769b3f3f8a)) ([#78](https://github.com/davidzoufaly/noldor/pull/78))

### Other changes

- docs(ideas): add Noldor-native long-task wait primitive idea (#113) ([e685c1f](https://github.com/davidzoufaly/noldor/commit/e685c1f730ef973339ff8d31618873c95b476a4b)) ([#113](https://github.com/davidzoufaly/noldor/pull/113))
- docs(roadmap): drop shipped Trailer Scope-Alias Map entry (#112) ([340a955](https://github.com/davidzoufaly/noldor/commit/340a9555eb7a680824340b768c23d5b9520521af)) ([#112](https://github.com/davidzoufaly/noldor/pull/112))
- docs(roadmap): replace Drop-Branched-Worktrees with Parallel-Agent Dispatch for Research Jobs (#111) ([d084621](https://github.com/davidzoufaly/noldor/commit/d0846210ec6966496be99d64f9214df5c9d07567)) ([#111](https://github.com/davidzoufaly/noldor/pull/111))
- docs: promote prep-batch 2026-06-14 (5 FDs) (#105) ([799f0f7](https://github.com/davidzoufaly/noldor/commit/799f0f72c3789ee17e857950e18b2fc57fb6be17)) ([#105](https://github.com/davidzoufaly/noldor/pull/105))
- docs: prune delivered triaged bullets + stale backlog entry (#102) ([884978f](https://github.com/davidzoufaly/noldor/commit/884978fe90d1f8afa28ab6818c52bed883f6f7d4)) ([#102](https://github.com/davidzoufaly/noldor/pull/102))
- docs(triage): triage 2 prep-promote findings to roadmap (#97) ([b74805c](https://github.com/davidzoufaly/noldor/commit/b74805c622865081ca208c0d65de8d732f54e892)) ([#97](https://github.com/davidzoufaly/noldor/pull/97))
- docs: promote prep-batch 2026-06-13 (5 FDs) (#96) ([61811c8](https://github.com/davidzoufaly/noldor/commit/61811c8f09f3471bcc67033db0ab22dd8273d808)) ([#96](https://github.com/davidzoufaly/noldor/pull/96))
- docs(roadmap): drop redundant sdd-report-review-skip-count-non-idempotent entry (#94) ([a653012](https://github.com/davidzoufaly/noldor/commit/a6530120eecd3cab0b3ad7575a92becb08f12476)) ([#94](https://github.com/davidzoufaly/noldor/pull/94))
- docs(roadmap): drop stale gitignore-release-pushes-log entry (#93) ([abb469f](https://github.com/davidzoufaly/noldor/commit/abb469f3cc66ed637fbe5b0cb553b996a4007e26)) ([#93](https://github.com/davidzoufaly/noldor/pull/93))
- docs(triage): triage 6 autonomous-drain retrospective findings (#85) ([a12ddd8](https://github.com/davidzoufaly/noldor/commit/a12ddd882cc2d2c1729a09ffe2f676bad6295ea5)) ([#85](https://github.com/davidzoufaly/noldor/pull/85))
- docs(roadmap): retire shipped isDrainEligible drain-eligibility entry (#84) ([4eee15d](https://github.com/davidzoufaly/noldor/commit/4eee15d059305b2c5a1f3280eeb6e1fdeb84c2cf)) ([#84](https://github.com/davidzoufaly/noldor/pull/84))
- docs(roadmap): retire shipped PR-Flow Tree-Shape Validation entry (#81) ([a06290c](https://github.com/davidzoufaly/noldor/commit/a06290cbba2088dc5169e60e26f2a1bce80963c5)) ([#81](https://github.com/davidzoufaly/noldor/pull/81))
- docs: refresh README Status version (0.2.0 → 0.3.0), retire roadmap entry (#79) ([85e3ee5](https://github.com/davidzoufaly/noldor/commit/85e3ee561225782ee7644b6abd590d6af586f0f1)) ([#79](https://github.com/davidzoufaly/noldor/pull/79))
- docs(triage): triage 26 ideas into roadmap + backlog (#77) ([ab9ed7e](https://github.com/davidzoufaly/noldor/commit/ab9ed7e6eefa195bdb4b144458c952c29bb0ca99)) ([#77](https://github.com/davidzoufaly/noldor/pull/77))
- docs(triage): triage 26 ideas into roadmap + backlog (#76) ([b72c94b](https://github.com/davidzoufaly/noldor/commit/b72c94b83c476a8d8ea9c78dc80c5557bce3e668)) ([#76](https://github.com/davidzoufaly/noldor/pull/76))
- refactor(gate): localize on-disk inputs instead of asking blind (#75) ([cba2f92](https://github.com/davidzoufaly/noldor/commit/cba2f92d556ea028ea34708d8a18fb1a72edb061)) ([#75](https://github.com/davidzoufaly/noldor/pull/75))
- docs(features:acceptance-verify-lane): promote from roadmap (tier full) (#74) ([ec7bf0b](https://github.com/davidzoufaly/noldor/commit/ec7bf0b7c52523977f4fa8ab95551f800054806e)) ([#74](https://github.com/davidzoufaly/noldor/pull/74))
- docs(features:outcome-telemetry-and-effectiveness-metrics): promote from roadmap (tier full) (#73) ([4b13193](https://github.com/davidzoufaly/noldor/commit/4b13193620fea30e0d0333c877c7ee7bcb80876c)) ([#73](https://github.com/davidzoufaly/noldor/pull/73))
- docs(features:continuous-drain-daemon-and-escalation-inbox): promote from roadmap (tier full) (#72) ([f47e8dd](https://github.com/davidzoufaly/noldor/commit/f47e8dd2cf93fccf04e513bbb52ddf04d9ea7e62)) ([#72](https://github.com/davidzoufaly/noldor/pull/72))
- docs(features:make-noldor-agent-agnostic): promote from roadmap (tier full) (#71) ([4c7c7ab](https://github.com/davidzoufaly/noldor/commit/4c7c7abba676c5f6f2eee88f65751b37e4cafd5e)) ([#71](https://github.com/davidzoufaly/noldor/pull/71))
- docs(features:de-superpowers-vendor-spec-plan-and-worktree-flows): promote from roadmap (tier full) (#70) ([f98eff1](https://github.com/davidzoufaly/noldor/commit/f98eff11b7af16c688890df6b53b404de35b6d06)) ([#70](https://github.com/davidzoufaly/noldor/pull/70))

## v0.3.0 — 2026-06-11

### Features

- feat(noldor): add worktree:conflicts pre-flight conflict scan (#56) ([beebfe4](https://github.com/davidzoufaly/noldor/commit/beebfe43d3e4d78e2f63be1b64eb403816ee02a1)) ([#56](https://github.com/davidzoufaly/noldor/pull/56))
- feat(dashboard): add git last-commit sort to /features listing (#55) ([f1956a1](https://github.com/davidzoufaly/noldor/commit/f1956a195b3ac777ce059cf570406ede0fe36c40)) ([#55](https://github.com/davidzoufaly/noldor/pull/55))
- feat(dashboard): add ?format=json to /hot-zones endpoint (#53) ([8532121](https://github.com/davidzoufaly/noldor/commit/8532121064761539bd7c6286c924bb8b650532f6)) ([#53](https://github.com/davidzoufaly/noldor/pull/53))
- feat(dashboard): add graphify health snapshot page (#50) ([772a291](https://github.com/davidzoufaly/noldor/commit/772a291685e7ac6842a5c30f6c9ca8ab34a10caa)) ([#50](https://github.com/davidzoufaly/noldor/pull/50))
- feat(prep): parallel prep pipeline — fanout drafts + promote bridge as noldor CLI (#30) ([00da3c6](https://github.com/davidzoufaly/noldor/commit/00da3c63c6d3b57acd47ff5714e77b84e30ab895)) ([#30](https://github.com/davidzoufaly/noldor/pull/30))
- feat(cr): add codex --plan/--spec review mode + fix lane invocation (#27) ([2de8885](https://github.com/davidzoufaly/noldor/commit/2de8885d288b3c8af72dc62b2a213f9d68cc55f9)) ([#27](https://github.com/davidzoufaly/noldor/pull/27))
- feat(core): size→path routing helper + suggestedPath on gate suggestions (#26) ([793b127](https://github.com/davidzoufaly/noldor/commit/793b127b1750db4ec939f4511fe966719194f95d)) ([#26](https://github.com/davidzoufaly/noldor/pull/26))
- feat(gate): allowlist template twins + skip path-confirm on resume (#20) ([211e3ae](https://github.com/davidzoufaly/noldor/commit/211e3aef26700debb19af49610d9f869e36f025c)) ([#20](https://github.com/davidzoufaly/noldor/pull/20))

### Fixes

- fix(cr): repair multiterminal standalone lane — stale scripts/cr paths (#34) ([8a3f305](https://github.com/davidzoufaly/noldor/commit/8a3f305f7edad9ca869d7f22062b3f8baa63ed8b)) ([#34](https://github.com/davidzoufaly/noldor/pull/34))
- fix(autonomous): pass /gate --drain <slug> so headless roadmap drain enters drain mode (#33) ([5fc8660](https://github.com/davidzoufaly/noldor/commit/5fc86609cf069f8e789778d95480129969ccddc2)) ([#33](https://github.com/davidzoufaly/noldor/pull/33))
- fix(gate): hoist NOLDOR_DRAIN entry-check above interactive Step 0 (#32) ([2d5a66d](https://github.com/davidzoufaly/noldor/commit/2d5a66dd1622c95c0dd37b55383fae50b5a67113)) ([#32](https://github.com/davidzoufaly/noldor/pull/32))
- fix(cr): silence pnpm banner in codex CR lane so JSON.parse(stdout) doesn't choke (#29) ([7dd659f](https://github.com/davidzoufaly/noldor/commit/7dd659fee68690a3f749a1de2c2d5c7e5965fb7d)) ([#29](https://github.com/davidzoufaly/noldor/pull/29))
- fix(noldor): repair detector-15 source paths + sweep framework-doc drift (#13) ([b298f0a](https://github.com/davidzoufaly/noldor/commit/b298f0a49b119b98e58573be61d916ad53f6cf0f)) ([#13](https://github.com/davidzoufaly/noldor/pull/13))

### Other changes

- chore: regenerate sdd-report for release gate (untriaged-ideas drift) (#69) ([5367031](https://github.com/davidzoufaly/noldor/commit/536703191a9e3e0174806562080fe040cf676898)) ([#69](https://github.com/davidzoufaly/noldor/pull/69))
- docs: correct stale README Status (extraction done, self-hosting) (#68) ([e1641b8](https://github.com/davidzoufaly/noldor/commit/e1641b878347984c69cd820d1f61eb2dbc35476f)) ([#68](https://github.com/davidzoufaly/noldor/pull/68))
- chore(release-sweep): pre-empt sdd:report drift (#67) ([5b0ff06](https://github.com/davidzoufaly/noldor/commit/5b0ff069498bf6e31be0567b3fae0490a93807b5)) ([#67](https://github.com/davidzoufaly/noldor/pull/67))
- chore: oxfmt-ignore graphify-out generated output + gitignore graphify caches (#66) ([cddd9f1](https://github.com/davidzoufaly/noldor/commit/cddd9f1f80c8b665d97720f392db39b280e7e35c)) ([#66](https://github.com/davidzoufaly/noldor/pull/66))
- docs(roadmap): relocate 2 entries from backlog + reprioritize Noldor Framework (#65) ([571abdc](https://github.com/davidzoufaly/noldor/commit/571abdc840c98ad35439fb946d1584160586d581)) ([#65](https://github.com/davidzoufaly/noldor/pull/65))
- docs(roadmap): incorporate 11 post-queue opportunity entries (adoption, autonomy, verification) (#64) ([1779ced](https://github.com/davidzoufaly/noldor/commit/1779ced017d731f82c8f460e6ebce92a48bff797)) ([#64](https://github.com/davidzoufaly/noldor/pull/64))
- docs(roadmap): add 5 autonomous-drain hardening entries from 2026-06-11 drain session (#63) ([8742e43](https://github.com/davidzoufaly/noldor/commit/8742e431ddd1441dd21dd2b8c4f546e15e1ebba4)) ([#63](https://github.com/davidzoufaly/noldor/pull/63))
- docs(roadmap): retire mark-fd-phasedone-in-feature-pr-not-at-release — already shipped via drop-manual-md-update (#62) ([3fb4ec2](https://github.com/davidzoufaly/noldor/commit/3fb4ec281b2a578cff35d2ad6432e2ae65f32931)) ([#62](https://github.com/davidzoufaly/noldor/pull/62))
- docs(roadmap): retire dashboard-filter-features-missing-introduced — shipped via fast-track (no FD) (#61) ([2743317](https://github.com/davidzoufaly/noldor/commit/2743317f32a1f8d13f4df0e0da12708d61248c56)) ([#61](https://github.com/davidzoufaly/noldor/pull/61))
- docs(noldor): print detailed spec summary at specs-only handoff (#60) ([e6edc67](https://github.com/davidzoufaly/noldor/commit/e6edc670e5319232256f201bd71ecf48671aebda)) ([#60](https://github.com/davidzoufaly/noldor/pull/60))
- docs(roadmap): retire dashboard-auto-start-on-project-load — shipped via fast-track (no FD) (#59) ([ca209c9](https://github.com/davidzoufaly/noldor/commit/ca209c96fc37b113ac8901e1613d07c7fecb7bbd)) ([#59](https://github.com/davidzoufaly/noldor/pull/59))
- docs(roadmap): retire e2e-tests-referenced-by-multiple-fds — already shipped via feature-md-links-overhaul (#58) ([d1a1b24](https://github.com/davidzoufaly/noldor/commit/d1a1b241847a1b648b1ac012ab26c20491f7296e)) ([#58](https://github.com/davidzoufaly/noldor/pull/58))
- docs(roadmap): retire auto-promotion-of-stale-ideas — shipped via fast-track (no FD) (#57) ([734ab29](https://github.com/davidzoufaly/noldor/commit/734ab2918a0dc944c02e9a35e09bff5261bb27a6)) ([#57](https://github.com/davidzoufaly/noldor/pull/57))
- docs(roadmap): retire hot-zones-json-endpoint — shipped via fast-track (PR #53) (#54) ([ec1d7c8](https://github.com/davidzoufaly/noldor/commit/ec1d7c80efca66a49052c830e9c2ad1d2b0f7ef8)) ([#54](https://github.com/davidzoufaly/noldor/pull/54))
- docs(engineering-rules): add implementer subagent commit scope-guard template (#52) ([288a9aa](https://github.com/davidzoufaly/noldor/commit/288a9aa7e6120ec6bfcfa21c58273a25d5cb2b82)) ([#52](https://github.com/davidzoufaly/noldor/pull/52))
- docs(roadmap): retire dashboard-graphify-health-snapshot — shipped via fast-track (no FD) (#51) ([0c1aa1a](https://github.com/davidzoufaly/noldor/commit/0c1aa1a0374c6b549999ad2c528d698946700743)) ([#51](https://github.com/davidzoufaly/noldor/pull/51))
- docs(roadmap): retire sdd-graphify-lift-audit-theoretical-substrate-scan — shipped via fast-track (no FD) (#48) ([7f62f46](https://github.com/davidzoufaly/noldor/commit/7f62f46d97f705fb72a714cf5bba1f75c8409c99)) ([#48](https://github.com/davidzoufaly/noldor/pull/48))
- docs(roadmap): retire extract-requirefreshgraph-helper — shipped via fast-track (no FD) (#47) ([c698d7c](https://github.com/davidzoufaly/noldor/commit/c698d7ca8d006765347e597699102e53f8cf6b92)) ([#47](https://github.com/davidzoufaly/noldor/pull/47))
- docs(roadmap): retire hot-zones-lines-changed-metric — shipped via fast-track (no FD) (#45) ([c8d56d2](https://github.com/davidzoufaly/noldor/commit/c8d56d2931846bc2aeed4c37992d197b2ade8d7b)) ([#45](https://github.com/davidzoufaly/noldor/pull/45))
- docs(roadmap): retire stalespecs-spec-without-fd-archive-candidate — shipped via fast-track (no FD) (#44) ([467424d](https://github.com/davidzoufaly/noldor/commit/467424d0fdd26a72f32baf3aac8520ab52ad658e)) ([#44](https://github.com/davidzoufaly/noldor/pull/44))
- docs(roadmap): retire multi-line-trailer-value-detection — shipped via fast-track (no FD) (#43) ([e1fefd5](https://github.com/davidzoufaly/noldor/commit/e1fefd59bb87923091b2f024b70a7b91b8a0a841)) ([#43](https://github.com/davidzoufaly/noldor/pull/43))
- docs(roadmap): retire dashboard-skills-browser-page — shipped via fast-track (no FD) (#41) ([62208aa](https://github.com/davidzoufaly/noldor/commit/62208aa06cf0b4ad900d286d24141d8f38cf459a)) ([#41](https://github.com/davidzoufaly/noldor/pull/41))
- docs(roadmap): retire subagent-reviewer-verify-before-flag-protocol — shipped via fast-track (no FD) (#39) ([f03ef88](https://github.com/davidzoufaly/noldor/commit/f03ef88a76225b8a05fe1a6cdb9775c7f71262fc)) ([#39](https://github.com/davidzoufaly/noldor/pull/39))
- docs(roadmap): retire dashboard-test-pyramid-page — shipped via fast-track (no FD) (#38) ([2d3ec82](https://github.com/davidzoufaly/noldor/commit/2d3ec82c78313ed2cd8f763695460f447c861b0b)) ([#38](https://github.com/davidzoufaly/noldor/pull/38))
- docs(roadmap): retire dashboard-backlog-age-buckets — shipped via fast-track (no FD) (#37) ([7cb7dfc](https://github.com/davidzoufaly/noldor/commit/7cb7dfc9231b59049cb8a26493ac0caab552dcc3)) ([#37](https://github.com/davidzoufaly/noldor/pull/37))
- docs(roadmap): retire triagenow-direct-shortcut — shipped via fast-track (no FD) (#35) ([da74711](https://github.com/davidzoufaly/noldor/commit/da74711159477e9bd31a63ef0f2dab56f116db5b)) ([#35](https://github.com/davidzoufaly/noldor/pull/35))
- docs(features:parallel-drain): scaffold FD (spec pre-exists from #30) (#31) ([103ad25](https://github.com/davidzoufaly/noldor/commit/103ad255dd7e5d2fa64499a0b41395ae7a501066)) ([#31](https://github.com/davidzoufaly/noldor/pull/31))
- docs(features:autonomous-queue-drain-runner): add spec for autonomous-queue-drain-runner (#28) ([e40bd58](https://github.com/davidzoufaly/noldor/commit/e40bd58280660ea36e676297839c42a019752031)) ([#28](https://github.com/davidzoufaly/noldor/pull/28))
- docs(gate): drop redundant path-confirm + auto-commit spec artifact (#25) ([1f08bd2](https://github.com/davidzoufaly/noldor/commit/1f08bd2377ab3b20826b56e0024a18afd486df6a)) ([#25](https://github.com/davidzoufaly/noldor/pull/25))
- docs(features:trailer-scope-alias-map): scaffold FD (#24) ([a170639](https://github.com/davidzoufaly/noldor/commit/a1706390096475cf52321553b70fc3554e107dd4)) ([#24](https://github.com/davidzoufaly/noldor/pull/24))
- docs(features:noldor): revert phase done → in-progress for attach session (#23) ([c137ba1](https://github.com/davidzoufaly/noldor/commit/c137ba10f6ebfcd8e13fe4a5e64181da2f79abe0)) ([#23](https://github.com/davidzoufaly/noldor/pull/23))
- docs(features:noldor): revert phase done → in-progress for attach session (#22) ([362fc25](https://github.com/davidzoufaly/noldor/commit/362fc25f82e7db944fce930eb97de0d2c373650e)) ([#22](https://github.com/davidzoufaly/noldor/pull/22))
- docs(features:noldor): revert phase done → in-progress for attach session (#21) ([5895e47](https://github.com/davidzoufaly/noldor/commit/5895e47c3e1e10322974091f49fb9e8138015cca)) ([#21](https://github.com/davidzoufaly/noldor/pull/21))
- docs(features:noldor): attach drop-manual-md-update + revert phase done → in-progress (#19) ([7a10224](https://github.com/davidzoufaly/noldor/commit/7a1022444caf1f3d5344fe4ce8587aca420cf3f9)) ([#19](https://github.com/davidzoufaly/noldor/pull/19))
- docs(roadmap): bump Dynamic FD pointers to top priority; capture new ideas (#18) ([e5d69b1](https://github.com/davidzoufaly/noldor/commit/e5d69b1c5791e3a3ecb5646cd7cf945b27cf8c7d)) ([#18](https://github.com/davidzoufaly/noldor/pull/18))
- docs(features:release-script-sddreport-skip-if-only-count-line-changed): add spec for release-script sdd:report count-only-diff guard (#17) ([65ae561](https://github.com/davidzoufaly/noldor/commit/65ae561eb5728e9151990c601d1bc489abbc896b)) ([#17](https://github.com/davidzoufaly/noldor/pull/17))
- docs(features:noldor): attach end-of-flow-ergonomics + revert phase done → in-progress (#16) ([417b33c](https://github.com/davidzoufaly/noldor/commit/417b33c52dbaaba29e3b1ec8a2d724bdd13eea02)) ([#16](https://github.com/davidzoufaly/noldor/pull/16))
- docs(features:release-script-sddreport-skip-if-only-count-line-changed): add spec for release-script sdd:report count-only-diff guard (#15) ([3406ccc](https://github.com/davidzoufaly/noldor/commit/3406cccbcc843e0c84d631ff063fdd96e4e9ceed)) ([#15](https://github.com/davidzoufaly/noldor/pull/15))
- docs(roadmap): drop obsolete phase-validator entry; fold pending triage edits (#14) ([15c8e66](https://github.com/davidzoufaly/noldor/commit/15c8e666ea1b08e84fd8d64708d85471696c5c5d)) ([#14](https://github.com/davidzoufaly/noldor/pull/14))

## v0.2.0 — 2026-06-01

### Features

- feat(rules): gate template-sync in pre-commit + pre-push ([50968b6](https://github.com/davidzoufaly/noldor/commit/50968b63ebb3cda182dafbe9443a16d4fc3cc9db))
- feat(rules): add template-sync CLI driver + manifest entry ([6fc326c](https://github.com/davidzoufaly/noldor/commit/6fc326cd21467462f9829e56e3d22e9b35d93139))
- feat(rules): add template-sync drift core ([cf69a7a](https://github.com/davidzoufaly/noldor/commit/cf69a7a6486a402ef8b5bd3f570ba58edf493618))

### Fixes

- fix(release): point lockstepPackages at root package.json path (#10) ([8b6b7f6](https://github.com/davidzoufaly/noldor/commit/8b6b7f679c32a05eed2edf11e43d125f28f08316)) ([#10](https://github.com/davidzoufaly/noldor/pull/10))
- fix(garden): skip root genesis commit in trailer-scope detector (#7) ([6e713be](https://github.com/davidzoufaly/noldor/commit/6e713be91de02e9bc5233210e47b517a850b56d5)) ([#7](https://github.com/davidzoufaly/noldor/pull/7))
- fix(rules): rules-cascade v1 follow-ups (fmt glob, rule id-check, tsconfig ref) ([e88025c](https://github.com/davidzoufaly/noldor/commit/e88025cbc6f27a578b958ccc745a1ebb8379068f))
- fix(noldor): tolerate same-line CR severity items + self-host path resolution ([437ebfe](https://github.com/davidzoufaly/noldor/commit/437ebfe69d4b09cdb3f50ff31ad78ac28f40c465))

### Other changes

- chore(release-sweep): refresh sdd-report review-skip count (8->9) (#12) ([f66934f](https://github.com/davidzoufaly/noldor/commit/f66934ffc32edb5c19b76be267cfd5f6bf4bbfd8)) ([#12](https://github.com/davidzoufaly/noldor/pull/12))
- chore(release): refresh graph snapshot after lockstep config fix (#11) ([9b827a2](https://github.com/davidzoufaly/noldor/commit/9b827a2c10a66a3535ea9f87d1d749524929de8a)) ([#11](https://github.com/davidzoufaly/noldor/pull/11))
- chore(release-sweep): refresh sdd-report after garden archival + fast-track fixes (#9) ([d361eb4](https://github.com/davidzoufaly/noldor/commit/d361eb4a180a5a81fb87e3018222efdb8ab4a931)) ([#9](https://github.com/davidzoufaly/noldor/pull/9))
- chore(release): refresh graph snapshot after gate-compliance + gitignore fixes (#8) ([5683482](https://github.com/davidzoufaly/noldor/commit/5683482400489ccbfb08819b414164bfc575d181)) ([#8](https://github.com/davidzoufaly/noldor/pull/8))
- chore(gate): ignore operator-local marker files + admit .gitignore to micro-chore (#6) ([8299e07](https://github.com/davidzoufaly/noldor/commit/8299e07aed2ae933d0fa1a352221f1277045c1ab)) ([#6](https://github.com/davidzoufaly/noldor/pull/6))
- chore(release-sweep): pre-empt sdd:report drift (#5) ([4204fd0](https://github.com/davidzoufaly/noldor/commit/4204fd0f5a3219e7073a767fa3c5dfefc8ee7918)) ([#5](https://github.com/davidzoufaly/noldor/pull/5))
- docs(ideas): drop shipped rules-cascade v1 follow-ups (#4) ([797eb08](https://github.com/davidzoufaly/noldor/commit/797eb08d6781ba10e7e7cf16136b159e50484e33)) ([#4](https://github.com/davidzoufaly/noldor/pull/4))
- docs(rules): implementation plan for template-sync gate ([374a5b2](https://github.com/davidzoufaly/noldor/commit/374a5b2f69daa1af419257b3659bb451f2087de7))
- docs(rules): spec for template-sync gate ([af29d88](https://github.com/davidzoufaly/noldor/commit/af29d88c589005c2598df2cce126da34c7da5ca3))
- Rules Cascade v1 substrate + self-host consumer bootstrap (#2) ([380fe2f](https://github.com/davidzoufaly/noldor/commit/380fe2ffa6610d19502d0e7ac74285bab05f1b7d)) ([#2](https://github.com/davidzoufaly/noldor/pull/2))
- test(noldor): fixture-anchor dashboard doc-surfaces for self-host ([2cc2888](https://github.com/davidzoufaly/noldor/commit/2cc28883e9d7e88ec74a839274e0bf75817b293e))
- test(noldor): re-anchor dashboard + release config tests to noldor content ([fc9cd6e](https://github.com/davidzoufaly/noldor/commit/fc9cd6e3fbc04da3cf6bbe5548e066cf595d487a))
- test(noldor): re-anchor spawn paths + inject config into drift detector ([493c721](https://github.com/davidzoufaly/noldor/commit/493c721d2a92233bece0234dd70ef07b00805378))
- test(noldor): re-anchor fixture paths + config expectations for self-host ([a11858c](https://github.com/davidzoufaly/noldor/commit/a11858c84105aa163af99ae4fe3ef6142dd16feb))
- chore(noldor): scope oxfmt to code + re-sync FD test links to src/ ([15ddf9f](https://github.com/davidzoufaly/noldor/commit/15ddf9fccd58935d64f57c32efaf823a298b4c1b))
- chore(noldor): bootstrap lint/fmt/lefthook toolchain + unblock gate ([7400a27](https://github.com/davidzoufaly/noldor/commit/7400a2728e3e547969a48d2ba4d3e592a7291c8e))
- docs(gate): re-anchor stale script paths to src/ after self-host extract ([66eb97e](https://github.com/davidzoufaly/noldor/commit/66eb97e3c0c7eb1bb85d56a8d834aaa0163ecef1))
- chore(noldor): bootstrap self-host consumer config + fix self-host bugs ([99ffdcc](https://github.com/davidzoufaly/noldor/commit/99ffdccd2296eac4ba484bc26e972b59a45dc1b3))
- docs(features:framework-doc-extraction): mark phase=done ([2cd03dc](https://github.com/davidzoufaly/noldor/commit/2cd03dc52fbd54c101281c69f78b722b28338dcd))
- chore(noldor): self-host consumer files + commit lockfile ([3394024](https://github.com/davidzoufaly/noldor/commit/3394024eaedbfc6a0d6eb315da316e2790fc5db8))
