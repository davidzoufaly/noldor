# Changelog

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
