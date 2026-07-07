# Changelog

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
