# Changelog

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
