# Graph Report - .  (2026-06-11)

## Corpus Check
- Large corpus: 486 files · ~362,884 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 1250 nodes · 2879 edges · 66 communities (58 shown, 8 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 284 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Autonomous Drain|Autonomous Drain]]
- [[_COMMUNITY_Code-Review Lanes|Code-Review Lanes]]
- [[_COMMUNITY_Garden  SDD|Garden / SDD]]
- [[_COMMUNITY_Release Pipeline|Release Pipeline]]
- [[_COMMUNITY_Prep Fan-out|Prep Fan-out]]
- [[_COMMUNITY_Config Sync|Config Sync]]
- [[_COMMUNITY_Core (gatesessionpr-flow)|Core (gate/session/pr-flow)]]
- [[_COMMUNITY_Release Pipeline (7)|Release Pipeline (7)]]
- [[_COMMUNITY_Dashboard|Dashboard]]
- [[_COMMUNITY_Code-Review Lanes (9)|Code-Review Lanes (9)]]
- [[_COMMUNITY_Invariants|Invariants]]
- [[_COMMUNITY_Rules Engine|Rules Engine]]
- [[_COMMUNITY_Dashboard (12)|Dashboard (12)]]
- [[_COMMUNITY_Dashboard (13)|Dashboard (13)]]
- [[_COMMUNITY_Garden  SDD (14)|Garden / SDD (14)]]
- [[_COMMUNITY_Worktrees|Worktrees]]
- [[_COMMUNITY_Core (gatesessionpr-flow) (16)|Core (gate/session/pr-flow) (16)]]
- [[_COMMUNITY_Dashboard (17)|Dashboard (17)]]
- [[_COMMUNITY_Milestones|Milestones]]
- [[_COMMUNITY_Git Hooks|Git Hooks]]
- [[_COMMUNITY_Utils|Utils]]
- [[_COMMUNITY_Templates|Templates]]
- [[_COMMUNITY_Graphify|Graphify]]
- [[_COMMUNITY_Release Pipeline (23)|Release Pipeline (23)]]
- [[_COMMUNITY_Dashboard  Static|Dashboard / Static]]
- [[_COMMUNITY_Core (gatesessionpr-flow) (25)|Core (gate/session/pr-flow) (25)]]
- [[_COMMUNITY_Garden Detectors|Garden Detectors]]
- [[_COMMUNITY_Dashboard (27)|Dashboard (27)]]
- [[_COMMUNITY_Dashboard (28)|Dashboard (28)]]
- [[_COMMUNITY_Detectors  Tests|Detectors / Tests]]
- [[_COMMUNITY_Docs API|Docs API]]
- [[_COMMUNITY_Config Sync (31)|Config Sync (31)]]
- [[_COMMUNITY_Core (gatesessionpr-flow) (32)|Core (gate/session/pr-flow) (32)]]
- [[_COMMUNITY_Dashboard (33)|Dashboard (33)]]
- [[_COMMUNITY_Scripts  Migration|Scripts / Migration]]
- [[_COMMUNITY_Features|Features]]
- [[_COMMUNITY_Features (36)|Features (36)]]
- [[_COMMUNITY_Core (gatesessionpr-flow) (37)|Core (gate/session/pr-flow) (37)]]
- [[_COMMUNITY_Dashboard (38)|Dashboard (38)]]
- [[_COMMUNITY_Git Hooks (39)|Git Hooks (39)]]
- [[_COMMUNITY_Worktrees (40)|Worktrees (40)]]
- [[_COMMUNITY_Core (gatesessionpr-flow) (41)|Core (gate/session/pr-flow) (41)]]
- [[_COMMUNITY_Garden Detectors (42)|Garden Detectors (42)]]
- [[_COMMUNITY_Features (43)|Features (43)]]
- [[_COMMUNITY_Docs API (44)|Docs API (44)]]
- [[_COMMUNITY_Docs API (45)|Docs API (45)]]
- [[_COMMUNITY_Cli|Cli]]
- [[_COMMUNITY_Core (gatesessionpr-flow) (47)|Core (gate/session/pr-flow) (47)]]
- [[_COMMUNITY_Garden  SDD (48)|Garden / SDD (48)]]
- [[_COMMUNITY_Garden Detectors (49)|Garden Detectors (49)]]
- [[_COMMUNITY_Checks|Checks]]
- [[_COMMUNITY_Triage|Triage]]
- [[_COMMUNITY_Git Hooks (52)|Git Hooks (52)]]
- [[_COMMUNITY_Core (gatesessionpr-flow) (53)|Core (gate/session/pr-flow) (53)]]
- [[_COMMUNITY_Core (gatesessionpr-flow) (54)|Core (gate/session/pr-flow) (54)]]
- [[_COMMUNITY_Core (gatesessionpr-flow) (55)|Core (gate/session/pr-flow) (55)]]
- [[_COMMUNITY_Checks (56)|Checks (56)]]
- [[_COMMUNITY_Garden Detectors (57)|Garden Detectors (57)]]

## God Nodes (most connected - your core abstractions)
1. `loadDocRoots()` - 31 edges
2. `loadConsumerConfig()` - 23 edges
3. `collectGaps()` - 18 edges
4. `parseBacklog()` - 17 edges
5. `run()` - 16 edges
6. `renderMarkdown()` - 16 edges
7. `readRolloutMarker()` - 15 edges
8. `main()` - 15 edges
9. `detectAll()` - 15 edges
10. `escapeHtml()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `loadSddFeatures()`  [INFERRED]
  scripts/migration/classify-feature-track.ts → src/garden/sdd-report.ts
- `main()` --calls--> `parseBacklog()`  [INFERRED]
  scripts/migration/classify-feature-track.ts → src/utils/parse-blocks.ts
- `main()` --calls--> `withReleaseSession()`  [INFERRED]
  src/release/index.ts → src/release/release-session.ts
- `main()` --calls--> `loadConfig()`  [INFERRED]
  src/validate/noldor-config.ts → src/cr/config.ts
- `promoteOne()` --calls--> `removeBlock()`  [INFERRED]
  src/prep/prep-promote.ts → src/utils/write-blocks.ts

## Communities (66 total, 8 thin omitted)

### Community 0 - "Autonomous Drain"
Cohesion: 0.05
Nodes (48): isDrainEligible(), classifyMergeView(), mergePr(), openPrExistsFor(), spawnGate(), syncMainCleanState(), acquireLock(), isAlive() (+40 more)

### Community 1 - "Code-Review Lanes"
Cohesion: 0.05
Nodes (40): aggregate(), main(), parseArgs(), templateShaFor(), amendSubagentReceipt(), writeJsonAtomic(), loadConfig(), resolveSessionTtlHours() (+32 more)

### Community 2 - "Garden / SDD"
Cohesion: 0.06
Nodes (62): loadSddInput(), commitOnlyTouchesReport(), applyProposal(), backupFeatures(), extractSummary(), generateProposal(), main(), parseLlmResponse() (+54 more)

### Community 3 - "Release Pipeline"
Cohesion: 0.05
Nodes (43): noldorCliCommand(), fillAllNoldorMarkers(), fillNoldorMarker(), extractJsonLine(), runGardenDetectViaCli(), ensureGardenFresh(), evaluateGardenFreshness(), main() (+35 more)

### Community 4 - "Prep Fan-out"
Cohesion: 0.07
Nodes (48): loadAreaCategories(), loadDocRoots(), extractTouches(), looksLikePath(), normalizePath(), sizeSkipsSpec(), sizeToPath(), sizeToTier() (+40 more)

### Community 5 - "Config Sync"
Cohesion: 0.08
Nodes (34): loadCategories(), loadConsumerConfig(), loadScopeAliases(), firstParagraph(), loadHowtos(), main(), renderHowToIndex(), collectTestFiles() (+26 more)

### Community 6 - "Core (gate/session/pr-flow)"
Cohesion: 0.09
Nodes (27): runCrRetryLoop(), clearMicroChoreSession(), discoverAddedFiles(), execGit(), loadFdSummary(), nodeSpawn(), normalizeRepoUrl(), parseCrTrailersFromLog() (+19 more)

### Community 7 - "Release Pipeline (7)"
Cohesion: 0.1
Nodes (27): buildPrompt(), joinSubjectsDeterministic(), polishSummary(), runClaudePolish(), extractUnreleasedSummary(), generateFdChangelogs(), prependChangelogBlock(), renderInitialReleaseBlock() (+19 more)

### Community 8 - "Dashboard"
Cohesion: 0.1
Nodes (32): getBacklogPath(), getRoadmapPath(), loadActiveMilestone(), loadFeatures(), loadVelocity(), loadVision(), loadWipAge(), loadWorktreeHealth() (+24 more)

### Community 9 - "Code-Review Lanes (9)"
Cohesion: 0.11
Nodes (23): parseCliArgs(), filenameSelector(), hashPaths(), isGateLane(), printFindings(), readFeatureMd(), readIfExists(), readSession() (+15 more)

### Community 10 - "Invariants"
Cohesion: 0.09
Nodes (11): formatResults(), printResults(), runAll(), makeBoundariesInvariant(), formatInvariantError(), makeInvariants(), runInvariants(), runInvariantSafely() (+3 more)

### Community 11 - "Rules Engine"
Cohesion: 0.12
Nodes (12): runList(), runResolve(), runValidate(), main(), main(), main(), dirStamp(), getRules() (+4 more)

### Community 12 - "Dashboard (12)"
Cohesion: 0.11
Nodes (26): countTestCases(), getDocRoot(), getFeaturesDir(), getNoldorDir(), getScriptsDir(), getVisionPath(), graphReportSection(), isTestPath() (+18 more)

### Community 13 - "Dashboard (13)"
Cohesion: 0.13
Nodes (16): walkTokens(), escapeHtml(), handleFeatureDetail(), ageBucket(), plainTextPreview(), renderBacklog(), renderChipRow(), renderCounter() (+8 more)

### Community 14 - "Garden / SDD (14)"
Cohesion: 0.15
Nodes (17): auditCodexCrOverrides(), detectAll(), detectContradictions(), detectInvariants(), detectSourceDrift(), detectStalePlans(), detectStaleSpecs(), detectUnusedBacklog() (+9 more)

### Community 15 - "Worktrees"
Cohesion: 0.15
Nodes (18): buildCommunityMap(), communityForFile(), computeSharedCommunities(), formatConflicts(), hasHardConflict(), loadGraph(), main(), scoreConflicts() (+10 more)

### Community 16 - "Core (gate/session/pr-flow) (16)"
Cohesion: 0.16
Nodes (12): isMicroChoreAllowed(), isReleaseSweepAllowed(), appendToMessage(), detectDroppedTrailers(), formatTrailers(), parseTrailers(), detectAllowlistDrift(), getReleasePackageFiles() (+4 more)

### Community 17 - "Dashboard (17)"
Cohesion: 0.13
Nodes (22): countMatching(), countScriptFiles(), featureSlugsForCodePath(), getSkillsDir(), loadBacklog(), loadBacklogWithHash(), loadCounts(), loadGaps() (+14 more)

### Community 18 - "Milestones"
Cohesion: 0.19
Nodes (11): activateMilestone(), draftMilestone(), listMilestones(), loadMilestoneBySlug(), loadMilestones(), preflightActivate(), readMilestone(), serializeMilestone() (+3 more)

### Community 19 - "Git Hooks"
Cohesion: 0.21
Nodes (9): isPostRollout(), readRolloutMarker(), isSessionStale(), enforceReviewReceipt(), getStagedPaths(), logOverride(), runPreCommit(), staleResult() (+1 more)

### Community 20 - "Utils"
Cohesion: 0.3
Nodes (14): atomicWriteFile(), crossSection(), handleDemote(), handleMove(), handlePromote(), sha256(), collapseConsecutiveBlanks(), extractLines() (+6 more)

### Community 21 - "Templates"
Cohesion: 0.22
Nodes (7): checkTemplateSync(), main(), resolveChangedFiles(), adoptTemplate(), copyTemplate(), computeDrift(), templateFiles()

### Community 22 - "Graphify"
Cohesion: 0.28
Nodes (16): buildIdToLabel(), buildNodeCommunityMap(), classifyEdges(), deriveCommunityLabel(), deriveCommunityLabels(), extractConceptsAndRationales(), extractPackages(), formatCrossEdgeLine() (+8 more)

### Community 23 - "Release Pipeline (23)"
Cohesion: 0.18
Nodes (10): renderMarkdown(), renderPrSection(), renderToHtml(), renderDescription(), prsSinceLastTag(), applyBump(), findPreviousTag(), getRepoUrl() (+2 more)

### Community 24 - "Dashboard / Static"
Cohesion: 0.17
Nodes (6): edgeScrollVelocity(), init(), shouldInsertBefore(), wireButtons(), wireDescriptionOverflow(), wireDescriptionToggles()

### Community 25 - "Core (gate/session/pr-flow) (25)"
Cohesion: 0.27
Nodes (12): admitsLiteralHyphen(), extractFencedBlocks(), findMessageFlag(), formatFindingHuman(), isCloseFence(), isGitCommitLine(), lineContainsFlag(), lintSnippets() (+4 more)

### Community 26 - "Garden Detectors"
Cohesion: 0.2
Nodes (6): auditOverrides(), auditOverrideTrailers(), auditReleasePushes(), classifyOverrideTrailer(), detectTierMismatch(), detectGateCompliance()

### Community 27 - "Dashboard (27)"
Cohesion: 0.23
Nodes (13): loadFrameworkPage(), loadFrameworkPages(), loadUserDoc(), loadUserDocs(), rewriteDocLinks(), handleFrameworkIndex(), handleFrameworkPage(), handleUserDoc() (+5 more)

### Community 28 - "Dashboard (28)"
Cohesion: 0.29
Nodes (7): getReleaseNotesPath(), loadReleaseNotes(), renderLayout(), handleReleaseNotes(), renderReleaseNotes(), shell(), shell()

### Community 29 - "Detectors / Tests"
Cohesion: 0.27
Nodes (3): detectFdWithoutPlan(), findCreationSha(), hasPlan()

### Community 30 - "Docs API"
Cohesion: 0.42
Nodes (8): checkLinks(), extractHeadings(), extractLinks(), fileExists(), main(), slugifyHeading(), stripCodeRegions(), walkMd()

### Community 31 - "Config Sync (31)"
Cohesion: 0.4
Nodes (6): appendList(), applyBlock(), buildResourcesBlock(), main(), resolveSpecPath(), syncFile()

### Community 32 - "Core (gate/session/pr-flow) (32)"
Cohesion: 0.39
Nodes (6): buildSuggestion(), loadKnownSlugs(), loadStagedFiles(), main(), renderAffected(), validateScope()

### Community 33 - "Dashboard (33)"
Cohesion: 0.42
Nodes (6): ensureDashboard(), isDashboardUp(), main(), resolveMainRoot(), sleep(), spawnDetachedServer()

### Community 34 - "Scripts / Migration"
Cohesion: 0.43
Nodes (3): partitionBlocks(), slugify(), stageFrameworkDocs()

### Community 35 - "Features"
Cohesion: 0.54
Nodes (6): areaFromPackage(), inferTier(), main(), walkFeaturesDir(), yamlToBacklogBlock(), yamlToFeatureMd()

### Community 36 - "Features (36)"
Cohesion: 0.43
Nodes (5): main(), migrateChangelogContent(), migrateFeaturesDir(), parseChangelogSection(), renderSection()

### Community 37 - "Core (gate/session/pr-flow) (37)"
Cohesion: 0.52
Nodes (5): filterCommitsForPage(), listPageSlugs(), loadCommits(), main(), parseScope()

### Community 38 - "Dashboard (38)"
Cohesion: 0.43
Nodes (6): loadSkill(), loadSkills(), handleSkillPage(), handleSkillsIndex(), renderSkillPage(), renderSkillsIndex()

### Community 39 - "Git Hooks (39)"
Cohesion: 0.62
Nodes (5): evaluatePrePush(), main(), pushesMain(), readStdinWithTimeout(), recordReleasePush()

### Community 40 - "Worktrees (40)"
Cohesion: 0.57
Nodes (5): escapeShell(), main(), parseWorktrees(), renderPrompt(), resolveMainWorktreePath()

### Community 41 - "Core (gate/session/pr-flow) (41)"
Cohesion: 0.67
Nodes (4): diffSkillSets(), loadSkillSlugs(), main(), parseCatalogSlugs()

### Community 43 - "Features (43)"
Cohesion: 0.6
Nodes (4): extractLegacyBlock(), findLineStartingWith(), main(), migrateFd()

### Community 44 - "Docs API (44)"
Cohesion: 0.6
Nodes (4): addGeneratedHeader(), annotateAll(), main(), walkMd()

### Community 45 - "Docs API (45)"
Cohesion: 0.6
Nodes (4): loadExamples(), main(), processTutorialDir(), transcludeMarkers()

### Community 46 - "Cli"
Cohesion: 0.6
Nodes (3): printHelp(), dispatch(), main()

### Community 47 - "Core (gate/session/pr-flow) (47)"
Cohesion: 0.7
Nodes (3): collectFiles(), main(), renamePlanOnlyTier()

### Community 48 - "Garden / SDD (48)"
Cohesion: 0.8
Nodes (3): resolveByLinksPlan(), resolveByLinksSpec(), scanFdsForOwner()

### Community 50 - "Checks"
Cohesion: 0.7
Nodes (3): loadKnownSlugs(), main(), validateFeatureSlugScope()

### Community 51 - "Triage"
Cohesion: 0.8
Nodes (3): main(), resolveIsShipped(), scoreEntry()

## Knowledge Gaps
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `loadDocRoots()` connect `Prep Fan-out` to `Autonomous Drain`, `Garden / SDD`, `Dashboard`, `Dashboard (12)`, `Garden / SDD (14)`, `Garden / SDD (48)`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **Why does `loadConsumerConfig()` connect `Config Sync` to `Garden / SDD`, `Release Pipeline`, `Prep Fan-out`, `Invariants`, `Dashboard (12)`, `Dashboard (13)`, `Core (gate/session/pr-flow) (16)`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Why does `plansSource()` connect `Autonomous Drain` to `Prep Fan-out`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Are the 19 inferred relationships involving `loadDocRoots()` (e.g. with `run()` and `listSpecFiles()`) actually correct?**
  _`loadDocRoots()` has 19 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `loadConsumerConfig()` (e.g. with `detectMissingCoTags()` and `newestMtimeInRoots()`) actually correct?**
  _`loadConsumerConfig()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `parseBacklog()` (e.g. with `main()` and `demoteStaleBacklog()`) actually correct?**
  _`parseBacklog()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `run()` (e.g. with `loadDocRoots()` and `discoverPrepEntries()`) actually correct?**
  _`run()` has 11 INFERRED edges - model-reasoned connections that need verification._