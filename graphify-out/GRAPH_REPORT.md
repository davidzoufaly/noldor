# Graph Report - src  (2026-06-01)

## Corpus Check
- Large corpus: 318 files · ~155,421 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 1036 nodes · 2318 edges · 53 communities (47 shown, 6 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 224 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_garden|garden]]
- [[_COMMUNITY_release|release]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_cr|cr]]
- [[_COMMUNITY_garden|garden]]
- [[_COMMUNITY_release|release]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_invariants|invariants]]
- [[_COMMUNITY_utils|utils]]
- [[_COMMUNITY_cr|cr]]
- [[_COMMUNITY_rules|rules]]
- [[_COMMUNITY_dashboard|dashboard]]
- [[_COMMUNITY_sync|sync]]
- [[_COMMUNITY_dashboard|dashboard]]
- [[_COMMUNITY_dashboard|dashboard]]
- [[_COMMUNITY_milestones|milestones]]
- [[_COMMUNITY_templates|templates]]
- [[_COMMUNITY_graphify|graphify]]
- [[_COMMUNITY_dashboardstatic|dashboard/static]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_dashboard|dashboard]]
- [[_COMMUNITY_worktrees|worktrees]]
- [[_COMMUNITY_dashboard|dashboard]]
- [[_COMMUNITY_cr|cr]]
- [[_COMMUNITY_docs|docs]]
- [[_COMMUNITY_dashboard|dashboard]]
- [[_COMMUNITY_sync|sync]]
- [[_COMMUNITY_features|features]]
- [[_COMMUNITY_features|features]]
- [[_COMMUNITY_dashboard|dashboard]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_hooks|hooks]]
- [[_COMMUNITY_worktrees|worktrees]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_features|features]]
- [[_COMMUNITY_docs|docs]]
- [[_COMMUNITY_docs|docs]]
- [[_COMMUNITY_cli|cli]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_checks|checks]]
- [[_COMMUNITY_triage|triage]]
- [[_COMMUNITY_hooks|hooks]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_checks|checks]]
- [[_COMMUNITY_gardendetectors|garden/detectors]]

## God Nodes (most connected - your core abstractions)
1. `loadDocRoots()` - 21 edges
2. `loadConsumerConfig()` - 20 edges
3. `collectGaps()` - 18 edges
4. `readRolloutMarker()` - 15 edges
5. `main()` - 15 edges
6. `detectAll()` - 15 edges
7. `renderMarkdown()` - 15 edges
8. `run()` - 14 edges
9. `commitsForFeature()` - 14 edges
10. `runCli()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `loadConfig()`  [INFERRED]
  validate/noldor-config.ts → cr/config.ts
- `runCli()` --calls--> `loadConfig()`  [INFERRED]
  core/pr-flow-cli.ts → cr/config.ts
- `runCli()` --calls--> `promptSelect()`  [INFERRED]
  core/pr-flow-cli.ts → cr/prompt-stdin.ts
- `loadSddGaps()` --calls--> `noldorCliCommand()`  [INFERRED]
  garden/garden-detect.ts → core/noldor-cli.ts
- `normalizeDeclaredPackage()` --calls--> `loadConsumerConfig()`  [INFERRED]
  features/validate-features.ts → core/consumer-config.ts

## Communities (53 total, 6 thin omitted)

### Community 0 - "garden"
Cohesion: 0.06
Nodes (61): loadAreaCategories(), loadConsumerConfig(), loadSddInput(), applyProposal(), backupFeatures(), extractSummary(), generateProposal(), main() (+53 more)

### Community 1 - "release"
Cohesion: 0.05
Nodes (45): loadCategories(), noldorCliCommand(), fillAllNoldorMarkers(), fillNoldorMarker(), firstParagraph(), loadHowtos(), main(), renderHowToIndex() (+37 more)

### Community 2 - "core"
Cohesion: 0.05
Nodes (35): isMicroChoreAllowed(), isReleaseSweepAllowed(), isPostRollout(), readRolloutMarker(), appendToMessage(), formatTrailers(), parseTrailers(), buildSuggestion() (+27 more)

### Community 3 - "cr"
Cohesion: 0.06
Nodes (33): amendSubagentReceipt(), writeJsonAtomic(), loadConfig(), main(), escalate(), spawnDeepReview(), writeContext(), execAsync() (+25 more)

### Community 4 - "garden"
Cohesion: 0.07
Nodes (36): loadDocRoots(), findMilestoneMatch(), formatEntry(), getSuggestions(), getTopPriorityNext(), isWritePendingDeprecated(), loadInProgressFds(), loadMilestoneGate() (+28 more)

### Community 5 - "release"
Cohesion: 0.09
Nodes (29): buildPrompt(), joinSubjectsDeterministic(), polishSummary(), runClaudePolish(), extractUnreleasedSummary(), generateFdChangelogs(), prependChangelogBlock(), renderInitialReleaseBlock() (+21 more)

### Community 6 - "core"
Cohesion: 0.1
Nodes (27): runCrRetryLoop(), discoverAddedFiles(), execGit(), loadFdSummary(), nodeSpawn(), normalizeRepoUrl(), parseCrTrailersFromLog(), pickMostRecentByDatePrefix() (+19 more)

### Community 7 - "invariants"
Cohesion: 0.09
Nodes (11): formatResults(), printResults(), runAll(), makeBoundariesInvariant(), formatInvariantError(), makeInvariants(), runInvariants(), runInvariantSafely() (+3 more)

### Community 8 - "utils"
Cohesion: 0.14
Nodes (22): atomicWriteFile(), crossSection(), handleDemote(), handleMove(), handlePromote(), sha256(), main(), parseArgv() (+14 more)

### Community 9 - "cr"
Cohesion: 0.12
Nodes (20): parseCliArgs(), filenameSelector(), hashPaths(), isGateLane(), printFindings(), readFeatureMd(), readIfExists(), readSession() (+12 more)

### Community 10 - "rules"
Cohesion: 0.12
Nodes (12): runList(), runResolve(), runValidate(), main(), main(), main(), dirStamp(), getRules() (+4 more)

### Community 11 - "dashboard"
Cohesion: 0.12
Nodes (26): countMatching(), countScriptFiles(), getDocRoot(), getFeaturesDir(), getNoldorDir(), getReleaseNotesPath(), getScriptsDir(), getSkillsDir() (+18 more)

### Community 12 - "sync"
Cohesion: 0.15
Nodes (24): collectTestFiles(), extractCodePackages(), main(), normalizeDeclaredPackage(), validateDocFeatureSlugs(), validateDocTagPresence(), validateFiles(), validatePackagesField() (+16 more)

### Community 13 - "dashboard"
Cohesion: 0.12
Nodes (20): walkTokens(), escapeHtml(), handleFeatureDetail(), handleFeatures(), handleHotZones(), handleWipAge(), plainTextPreview(), renderBacklog() (+12 more)

### Community 14 - "dashboard"
Cohesion: 0.13
Nodes (21): getBacklogPath(), getRoadmapPath(), loadActiveMilestone(), loadGaps(), loadWorktreeHealth(), setDocRootsOverride(), handle(), handleApiDemote() (+13 more)

### Community 15 - "milestones"
Cohesion: 0.19
Nodes (11): activateMilestone(), draftMilestone(), listMilestones(), loadMilestoneBySlug(), loadMilestones(), preflightActivate(), readMilestone(), serializeMilestone() (+3 more)

### Community 16 - "templates"
Cohesion: 0.22
Nodes (7): checkTemplateSync(), main(), resolveChangedFiles(), adoptTemplate(), copyTemplate(), computeDrift(), templateFiles()

### Community 17 - "graphify"
Cohesion: 0.28
Nodes (16): buildIdToLabel(), buildNodeCommunityMap(), classifyEdges(), deriveCommunityLabel(), deriveCommunityLabels(), extractConceptsAndRationales(), extractPackages(), formatCrossEdgeLine() (+8 more)

### Community 18 - "dashboard/static"
Cohesion: 0.17
Nodes (6): edgeScrollVelocity(), init(), shouldInsertBefore(), wireButtons(), wireDescriptionOverflow(), wireDescriptionToggles()

### Community 19 - "core"
Cohesion: 0.27
Nodes (12): admitsLiteralHyphen(), extractFencedBlocks(), findMessageFlag(), formatFindingHuman(), isCloseFence(), isGitCommitLine(), lineContainsFlag(), lintSnippets() (+4 more)

### Community 20 - "dashboard"
Cohesion: 0.22
Nodes (13): featureSlugsForCodePath(), loadBacklog(), loadBacklogWithHash(), loadRoadmapWithHash(), parseBacklogFromString(), parseRoadmap(), parseRoadmapFromString(), sha256Hex() (+5 more)

### Community 21 - "worktrees"
Cohesion: 0.28
Nodes (10): allocatePorts(), computeWarnings(), describeWarning(), detectFileOverlap(), formatStatus(), gatherStats(), gitOrEmpty(), main() (+2 more)

### Community 22 - "dashboard"
Cohesion: 0.23
Nodes (13): loadFrameworkPage(), loadFrameworkPages(), loadUserDoc(), loadUserDocs(), rewriteDocLinks(), handleFrameworkIndex(), handleFrameworkPage(), handleUserDoc() (+5 more)

### Community 23 - "cr"
Cohesion: 0.33
Nodes (5): aggregate(), main(), parseArgs(), templateShaFor(), inferLaneFromFilename()

### Community 24 - "docs"
Cohesion: 0.42
Nodes (8): checkLinks(), extractHeadings(), extractLinks(), fileExists(), main(), slugifyHeading(), stripCodeRegions(), walkMd()

### Community 25 - "dashboard"
Cohesion: 0.33
Nodes (6): loadReleaseNotes(), renderLayout(), handleReleaseNotes(), renderReleaseNotes(), shell(), shell()

### Community 26 - "sync"
Cohesion: 0.4
Nodes (6): appendList(), applyBlock(), buildResourcesBlock(), main(), resolveSpecPath(), syncFile()

### Community 27 - "features"
Cohesion: 0.54
Nodes (6): areaFromPackage(), inferTier(), main(), walkFeaturesDir(), yamlToBacklogBlock(), yamlToFeatureMd()

### Community 28 - "features"
Cohesion: 0.43
Nodes (5): main(), migrateChangelogContent(), migrateFeaturesDir(), parseChangelogSection(), renderSection()

### Community 29 - "dashboard"
Cohesion: 0.36
Nodes (8): loadFeatures(), loadHotZones(), loadVelocity(), loadWipAge(), tryGit(), handleOverview(), handleVelocity(), renderVelocity()

### Community 30 - "core"
Cohesion: 0.52
Nodes (5): filterCommitsForPage(), listPageSlugs(), loadCommits(), main(), parseScope()

### Community 31 - "hooks"
Cohesion: 0.62
Nodes (5): evaluatePrePush(), main(), pushesMain(), readStdinWithTimeout(), recordReleasePush()

### Community 32 - "worktrees"
Cohesion: 0.57
Nodes (5): escapeShell(), main(), parseWorktrees(), renderPrompt(), resolveMainWorktreePath()

### Community 33 - "core"
Cohesion: 0.67
Nodes (4): diffSkillSets(), loadSkillSlugs(), main(), parseCatalogSlugs()

### Community 34 - "features"
Cohesion: 0.6
Nodes (4): extractLegacyBlock(), findLineStartingWith(), main(), migrateFd()

### Community 35 - "docs"
Cohesion: 0.6
Nodes (4): addGeneratedHeader(), annotateAll(), main(), walkMd()

### Community 36 - "docs"
Cohesion: 0.6
Nodes (4): loadExamples(), main(), processTutorialDir(), transcludeMarkers()

### Community 37 - "cli"
Cohesion: 0.6
Nodes (3): printHelp(), dispatch(), main()

### Community 38 - "core"
Cohesion: 0.7
Nodes (3): extractTouches(), looksLikePath(), normalizePath()

### Community 39 - "core"
Cohesion: 0.7
Nodes (3): collectFiles(), main(), renamePlanOnlyTier()

### Community 40 - "checks"
Cohesion: 0.7
Nodes (3): loadKnownSlugs(), main(), validateFeatureSlugScope()

### Community 41 - "triage"
Cohesion: 0.8
Nodes (3): main(), resolveIsShipped(), scoreEntry()

## Knowledge Gaps
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `loadConsumerConfig()` connect `garden` to `release`, `core`, `invariants`, `sync`, `dashboard`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Why does `promptSelect()` connect `cr` to `core`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `readSession()` connect `core` to `core`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Are the 14 inferred relationships involving `loadDocRoots()` (e.g. with `loadInProgressFds()` and `loadMilestoneGate()`) actually correct?**
  _`loadDocRoots()` has 14 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `loadConsumerConfig()` (e.g. with `detectMissingCoTags()` and `newestMtimeInRoots()`) actually correct?**
  _`loadConsumerConfig()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `readRolloutMarker()` (e.g. with `detectTrailerScopeMismatch()` and `detectAllowlistDrift()`) actually correct?**
  _`readRolloutMarker()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `main()` (e.g. with `loadDocRoots()` and `parseBacklog()`) actually correct?**
  _`main()` has 3 INFERRED edges - model-reasoned connections that need verification._