# Graph Report - src  (2026-06-01)

## Corpus Check
- Large corpus: 318 files · ~155,166 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 1035 nodes · 2316 edges · 60 communities (53 shown, 7 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 224 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_SDD Report & Feature Gaps|SDD Report & Feature Gaps]]
- [[_COMMUNITY_CR Lanes & Config|CR Lanes & Config]]
- [[_COMMUNITY_Path Allowlist & Rollout|Path Allowlist & Rollout]]
- [[_COMMUNITY_Garden Detection|Garden Detection]]
- [[_COMMUNITY_Release Notes & FD Changelog|Release Notes & FD Changelog]]
- [[_COMMUNITY_PR Flow & CR Retry|PR Flow & CR Retry]]
- [[_COMMUNITY_Invariants & API Checks|Invariants & API Checks]]
- [[_COMMUNITY_Dashboard Mutations & Write Blocks|Dashboard Mutations & Write Blocks]]
- [[_COMMUNITY_Dashboard Server & Data Loaders|Dashboard Server & Data Loaders]]
- [[_COMMUNITY_CR Codex Driver|CR Codex Driver]]
- [[_COMMUNITY_Rules Resolve & Stage|Rules Resolve & Stage]]
- [[_COMMUNITY_Dashboard Path Resolution|Dashboard Path Resolution]]
- [[_COMMUNITY_Feature Validation|Feature Validation]]
- [[_COMMUNITY_Dashboard Views|Dashboard Views]]
- [[_COMMUNITY_Milestones|Milestones]]
- [[_COMMUNITY_Dashboard Backlog & Counts|Dashboard Backlog & Counts]]
- [[_COMMUNITY_Template Sync|Template Sync]]
- [[_COMMUNITY_Release CLI & Markers|Release CLI & Markers]]
- [[_COMMUNITY_Graph-to-Toon|Graph-to-Toon]]
- [[_COMMUNITY_Dashboard Static JS|Dashboard Static JS]]
- [[_COMMUNITY_Plan Snippet Linting|Plan Snippet Linting]]
- [[_COMMUNITY_Consumer Config & Areas|Consumer Config & Areas]]
- [[_COMMUNITY_Worktree Status|Worktree Status]]
- [[_COMMUNITY_Dashboard Doc Pages|Dashboard Doc Pages]]
- [[_COMMUNITY_CR Aggregate|CR Aggregate]]
- [[_COMMUNITY_Garden Receipt|Garden Receipt]]
- [[_COMMUNITY_Docs How-To|Docs How-To]]
- [[_COMMUNITY_Docs Link Check|Docs Link Check]]
- [[_COMMUNITY_FD Resource Sync|FD Resource Sync]]
- [[_COMMUNITY_Commit Classification|Commit Classification]]
- [[_COMMUNITY_Dashboard Layout|Dashboard Layout]]
- [[_COMMUNITY_Feature Migration|Feature Migration]]
- [[_COMMUNITY_Changelog Migration|Changelog Migration]]
- [[_COMMUNITY_Changelog Core|Changelog Core]]
- [[_COMMUNITY_Release Marker Fill|Release Marker Fill]]
- [[_COMMUNITY_Release Notes|Release Notes]]
- [[_COMMUNITY_Pre-Push Hook|Pre-Push Hook]]
- [[_COMMUNITY_Worktree Launch|Worktree Launch]]
- [[_COMMUNITY_Skill Catalog Validation|Skill Catalog Validation]]
- [[_COMMUNITY_FD Commits-to-PRs Migration|FD Commits-to-PRs Migration]]
- [[_COMMUNITY_Release Changelog|Release Changelog]]
- [[_COMMUNITY_Garden Detect Runner|Garden Detect Runner]]
- [[_COMMUNITY_Docs Transclude|Docs Transclude]]
- [[_COMMUNITY_Docs API Generation|Docs API Generation]]
- [[_COMMUNITY_CLI Dispatch|CLI Dispatch]]
- [[_COMMUNITY_Touch Extraction|Touch Extraction]]
- [[_COMMUNITY_Plan-Only Tier Rename|Plan-Only Tier Rename]]
- [[_COMMUNITY_Feature Slug Scope Check|Feature Slug Scope Check]]
- [[_COMMUNITY_Triage Scoring|Triage Scoring]]
- [[_COMMUNITY_Agent Rules Guard|Agent Rules Guard]]
- [[_COMMUNITY_Phase Flip Done|Phase Flip Done]]
- [[_COMMUNITY_Phase Revert|Phase Revert]]
- [[_COMMUNITY_Noldor Page Validation|Noldor Page Validation]]
- [[_COMMUNITY_Shared Files Check|Shared Files Check]]
- [[_COMMUNITY_Branch Protection|Branch Protection]]

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
- `detectAllowlistDrift()` --calls--> `isMicroChoreAllowed()`  [INFERRED]
  garden/detectors/allowlist-drift.ts → core/allowlist.ts
- `runGardenDetectViaCli()` --calls--> `noldorCliCommand()`  [INFERRED]
  garden/garden-detect-runner.ts → core/noldor-cli.ts

## Communities (60 total, 7 thin omitted)

### Community 0 - "SDD Report & Feature Gaps"
Cohesion: 0.06
Nodes (58): loadSddInput(), applyProposal(), backupFeatures(), extractSummary(), generateProposal(), main(), parseLlmResponse(), parseProposal() (+50 more)

### Community 1 - "CR Lanes & Config"
Cohesion: 0.06
Nodes (33): amendSubagentReceipt(), writeJsonAtomic(), loadConfig(), main(), escalate(), spawnDeepReview(), writeContext(), execAsync() (+25 more)

### Community 2 - "Path Allowlist & Rollout"
Cohesion: 0.05
Nodes (32): isMicroChoreAllowed(), isReleaseSweepAllowed(), isPostRollout(), readRolloutMarker(), appendToMessage(), formatTrailers(), parseTrailers(), buildSuggestion() (+24 more)

### Community 3 - "Garden Detection"
Cohesion: 0.07
Nodes (38): loadDocRoots(), findMilestoneMatch(), formatEntry(), getSuggestions(), getTopPriorityNext(), isWritePendingDeprecated(), loadInProgressFds(), loadMilestoneGate() (+30 more)

### Community 4 - "Release Notes & FD Changelog"
Cohesion: 0.08
Nodes (32): prsSinceLastTag(), buildPrompt(), joinSubjectsDeterministic(), polishSummary(), runClaudePolish(), extractUnreleasedSummary(), generateFdChangelogs(), prependChangelogBlock() (+24 more)

### Community 5 - "PR Flow & CR Retry"
Cohesion: 0.1
Nodes (27): runCrRetryLoop(), discoverAddedFiles(), execGit(), loadFdSummary(), nodeSpawn(), normalizeRepoUrl(), parseCrTrailersFromLog(), pickMostRecentByDatePrefix() (+19 more)

### Community 6 - "Invariants & API Checks"
Cohesion: 0.09
Nodes (11): formatResults(), printResults(), runAll(), makeBoundariesInvariant(), formatInvariantError(), makeInvariants(), runInvariants(), runInvariantSafely() (+3 more)

### Community 7 - "Dashboard Mutations & Write Blocks"
Cohesion: 0.14
Nodes (22): atomicWriteFile(), crossSection(), handleDemote(), handleMove(), handlePromote(), sha256(), main(), parseArgv() (+14 more)

### Community 8 - "Dashboard Server & Data Loaders"
Cohesion: 0.11
Nodes (28): getBacklogPath(), getRoadmapPath(), loadFeatures(), loadHotZones(), loadVelocity(), loadWipAge(), loadWorktreeHealth(), setDocRootsOverride() (+20 more)

### Community 9 - "CR Codex Driver"
Cohesion: 0.12
Nodes (20): parseCliArgs(), filenameSelector(), hashPaths(), isGateLane(), printFindings(), readFeatureMd(), readIfExists(), readSession() (+12 more)

### Community 10 - "Rules Resolve & Stage"
Cohesion: 0.12
Nodes (12): runList(), runResolve(), runValidate(), main(), main(), main(), dirStamp(), getRules() (+4 more)

### Community 11 - "Dashboard Path Resolution"
Cohesion: 0.12
Nodes (25): countScriptFiles(), getDocRoot(), getFeaturesDir(), getNoldorDir(), getReleaseNotesPath(), getScriptsDir(), getSkillsDir(), getVisionPath() (+17 more)

### Community 12 - "Feature Validation"
Cohesion: 0.15
Nodes (24): collectTestFiles(), extractCodePackages(), main(), normalizeDeclaredPackage(), validateDocFeatureSlugs(), validateDocTagPresence(), validateFiles(), validatePackagesField() (+16 more)

### Community 13 - "Dashboard Views"
Cohesion: 0.14
Nodes (17): walkTokens(), escapeHtml(), handleFeatureDetail(), handleVision(), plainTextPreview(), renderBacklog(), renderChipRow(), renderCounter() (+9 more)

### Community 14 - "Milestones"
Cohesion: 0.19
Nodes (11): activateMilestone(), draftMilestone(), listMilestones(), loadMilestoneBySlug(), loadMilestones(), preflightActivate(), readMilestone(), serializeMilestone() (+3 more)

### Community 15 - "Dashboard Backlog & Counts"
Cohesion: 0.16
Nodes (18): countMatching(), featureSlugsForCodePath(), loadBacklog(), loadBacklogWithHash(), loadCounts(), loadGaps(), loadRoadmapWithHash(), parseBacklogFromString() (+10 more)

### Community 16 - "Template Sync"
Cohesion: 0.22
Nodes (7): checkTemplateSync(), main(), resolveChangedFiles(), adoptTemplate(), copyTemplate(), computeDrift(), templateFiles()

### Community 17 - "Release CLI & Markers"
Cohesion: 0.2
Nodes (10): noldorCliCommand(), fillAllNoldorMarkers(), fillNoldorMarker(), ensureCleanTreeOnMain(), ensureGhAvailable(), ensureGraphFresh(), run(), runCheck() (+2 more)

### Community 18 - "Graph-to-Toon"
Cohesion: 0.28
Nodes (16): buildIdToLabel(), buildNodeCommunityMap(), classifyEdges(), deriveCommunityLabel(), deriveCommunityLabels(), extractConceptsAndRationales(), extractPackages(), formatCrossEdgeLine() (+8 more)

### Community 19 - "Dashboard Static JS"
Cohesion: 0.17
Nodes (6): edgeScrollVelocity(), init(), shouldInsertBefore(), wireButtons(), wireDescriptionOverflow(), wireDescriptionToggles()

### Community 20 - "Plan Snippet Linting"
Cohesion: 0.27
Nodes (12): admitsLiteralHyphen(), extractFencedBlocks(), findMessageFlag(), formatFindingHuman(), isCloseFence(), isGitCommitLine(), lineContainsFlag(), lintSnippets() (+4 more)

### Community 21 - "Consumer Config & Areas"
Cohesion: 0.24
Nodes (6): loadAreaCategories(), loadConsumerConfig(), areaToCategory(), bumpAllPackages(), bumpPackageJson(), main()

### Community 22 - "Worktree Status"
Cohesion: 0.28
Nodes (10): allocatePorts(), computeWarnings(), describeWarning(), detectFileOverlap(), formatStatus(), gatherStats(), gitOrEmpty(), main() (+2 more)

### Community 23 - "Dashboard Doc Pages"
Cohesion: 0.23
Nodes (13): loadFrameworkPage(), loadFrameworkPages(), loadUserDoc(), loadUserDocs(), rewriteDocLinks(), handleFrameworkIndex(), handleFrameworkPage(), handleUserDoc() (+5 more)

### Community 24 - "CR Aggregate"
Cohesion: 0.33
Nodes (5): aggregate(), main(), parseArgs(), templateShaFor(), inferLaneFromFilename()

### Community 25 - "Garden Receipt"
Cohesion: 0.36
Nodes (7): ensureGardenFresh(), evaluateGardenFreshness(), main(), readGardenReceipt(), writeGardenReceipt(), autoStampOnCleanDetect(), defaultStamp()

### Community 26 - "Docs How-To"
Cohesion: 0.31
Nodes (5): loadCategories(), firstParagraph(), loadHowtos(), main(), renderHowToIndex()

### Community 27 - "Docs Link Check"
Cohesion: 0.42
Nodes (8): checkLinks(), extractHeadings(), extractLinks(), fileExists(), main(), slugifyHeading(), stripCodeRegions(), walkMd()

### Community 28 - "FD Resource Sync"
Cohesion: 0.4
Nodes (6): appendList(), applyBlock(), buildResourcesBlock(), main(), resolveSpecPath(), syncFile()

### Community 29 - "Commit Classification"
Cohesion: 0.36
Nodes (5): classifyCommit(), classifyCommits(), deriveBumpLevel(), readCommitsSince(), refExists()

### Community 30 - "Dashboard Layout"
Cohesion: 0.36
Nodes (5): renderLayout(), handleReleaseNotes(), renderReleaseNotes(), shell(), shell()

### Community 31 - "Feature Migration"
Cohesion: 0.54
Nodes (6): areaFromPackage(), inferTier(), main(), walkFeaturesDir(), yamlToBacklogBlock(), yamlToFeatureMd()

### Community 32 - "Changelog Migration"
Cohesion: 0.43
Nodes (5): main(), migrateChangelogContent(), migrateFeaturesDir(), parseChangelogSection(), renderSection()

### Community 33 - "Changelog Core"
Cohesion: 0.52
Nodes (5): filterCommitsForPage(), listPageSlugs(), loadCommits(), main(), parseScope()

### Community 34 - "Release Marker Fill"
Cohesion: 0.48
Nodes (3): fillAllMarkers(), fillMarkers(), main()

### Community 35 - "Release Notes"
Cohesion: 0.48
Nodes (5): collectFeaturesForRelease(), extractChangelogSummary(), extractFirstParagraph(), prependToReleaseNotes(), renderReleaseNotesEntry()

### Community 36 - "Pre-Push Hook"
Cohesion: 0.62
Nodes (5): evaluatePrePush(), main(), pushesMain(), readStdinWithTimeout(), recordReleasePush()

### Community 37 - "Worktree Launch"
Cohesion: 0.57
Nodes (5): escapeShell(), main(), parseWorktrees(), renderPrompt(), resolveMainWorktreePath()

### Community 38 - "Skill Catalog Validation"
Cohesion: 0.67
Nodes (4): diffSkillSets(), loadSkillSlugs(), main(), parseCatalogSlugs()

### Community 39 - "FD Commits-to-PRs Migration"
Cohesion: 0.6
Nodes (4): extractLegacyBlock(), findLineStartingWith(), main(), migrateFd()

### Community 40 - "Release Changelog"
Cohesion: 0.53
Nodes (3): prependToChangelog(), renderChangelogEntry(), renderCommit()

### Community 42 - "Docs Transclude"
Cohesion: 0.6
Nodes (4): loadExamples(), main(), processTutorialDir(), transcludeMarkers()

### Community 43 - "Docs API Generation"
Cohesion: 0.6
Nodes (4): addGeneratedHeader(), annotateAll(), main(), walkMd()

### Community 44 - "CLI Dispatch"
Cohesion: 0.6
Nodes (3): printHelp(), dispatch(), main()

### Community 45 - "Touch Extraction"
Cohesion: 0.7
Nodes (3): extractTouches(), looksLikePath(), normalizePath()

### Community 46 - "Plan-Only Tier Rename"
Cohesion: 0.7
Nodes (3): collectFiles(), main(), renamePlanOnlyTier()

### Community 47 - "Feature Slug Scope Check"
Cohesion: 0.7
Nodes (3): loadKnownSlugs(), main(), validateFeatureSlugScope()

### Community 48 - "Triage Scoring"
Cohesion: 0.8
Nodes (3): main(), resolveIsShipped(), scoreEntry()

## Knowledge Gaps
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `loadConsumerConfig()` connect `Consumer Config & Areas` to `SDD Report & Feature Gaps`, `Path Allowlist & Rollout`, `Invariants & API Checks`, `Feature Validation`, `Dashboard Views`, `Release CLI & Markers`, `Docs How-To`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Why does `promptSelect()` connect `CR Lanes & Config` to `PR Flow & CR Retry`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `loadConfig()` connect `CR Lanes & Config` to `PR Flow & CR Retry`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Are the 14 inferred relationships involving `loadDocRoots()` (e.g. with `loadInProgressFds()` and `loadMilestoneGate()`) actually correct?**
  _`loadDocRoots()` has 14 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `loadConsumerConfig()` (e.g. with `detectMissingCoTags()` and `newestMtimeInRoots()`) actually correct?**
  _`loadConsumerConfig()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `readRolloutMarker()` (e.g. with `detectTrailerScopeMismatch()` and `detectAllowlistDrift()`) actually correct?**
  _`readRolloutMarker()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `main()` (e.g. with `loadDocRoots()` and `parseBacklog()`) actually correct?**
  _`main()` has 3 INFERRED edges - model-reasoned connections that need verification._