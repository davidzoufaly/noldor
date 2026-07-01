# Graph Report - .  (2026-07-01)

## Corpus Check
- Large corpus: 669 files · ~522,368 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 1656 nodes · 3989 edges · 95 communities (85 shown, 10 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 405 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]

## God Nodes (most connected - your core abstractions)
1. `loadDocRoots()` - 43 edges
2. `loadConsumerConfig()` - 35 edges
3. `detectAll()` - 23 edges
4. `main()` - 21 edges
5. `collectGaps()` - 18 edges
6. `readRolloutMarker()` - 17 edges
7. `spawnAgent()` - 17 edges
8. `main()` - 17 edges
9. `parseBacklog()` - 17 edges
10. `escapeHtml()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `loadSddFeatures()`  [INFERRED]
  scripts/migration/classify-feature-track.ts → src/garden/sdd-report.ts
- `main()` --calls--> `parseBacklog()`  [INFERRED]
  scripts/migration/classify-feature-track.ts → src/utils/parse-blocks.ts
- `runVerify()` --calls--> `write()`  [INFERRED]
  src/cr/lanes/verify.ts → src/cr/__tests__/read-fd-summary.test.ts
- `main()` --calls--> `withReleaseSession()`  [INFERRED]
  src/release/index.ts → src/release/release-session.ts
- `main()` --calls--> `compute()`  [INFERRED]
  src/garden/sdd-report.ts → src/metrics/compute.ts

## Communities (95 total, 10 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (63): loadSddInput(), commitOnlyTouchesReport(), applyProposal(), backupFeatures(), extractSummary(), generateProposal(), main(), parseLlmResponse() (+55 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (40): checkRunners(), compareDotted(), referencedRunners(), loadAgentsConfig(), planSpawn(), resolveRunner(), spawnAgent(), checkTemplateSync() (+32 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (39): isMicroChoreAllowed(), isReleaseSweepAllowed(), isPostRollout(), readRolloutMarker(), appendToMessage(), detectDroppedTrailers(), formatTrailers(), parseTrailers() (+31 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (49): collectRoutingAccuracy(), loadAreaCategories(), extractTouches(), looksLikePath(), normalizePath(), sizeSkipsSpec(), sizeToPath(), sizeToTier() (+41 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (35): createWorktree(), main(), parseArgs(), bootDevSurfaces(), buildLaunchCommand(), escapeShell(), launchTree(), main() (+27 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (30): isDirty(), loadConfigTolerant(), main(), parseFrom(), runUpgrade(), loadCategories(), loadConsumerConfig(), loadDevConfig() (+22 more)

### Community 6 - "Community 6"
Cohesion: 0.09
Nodes (29): collectCrEffectiveness(), collectCycleTime(), percentile(), collectDrainReliability(), collectOverridePressure(), releaseWindow(), renderMetricsSection(), reviewSkipCountLine() (+21 more)

### Community 7 - "Community 7"
Cohesion: 0.09
Nodes (28): runCrRetryLoop(), clearMicroChoreSession(), discoverAddedFiles(), execGit(), loadFdSummary(), nodeSpawn(), normalizeRepoUrl(), parseCrTrailersFromLog() (+20 more)

### Community 8 - "Community 8"
Cohesion: 0.1
Nodes (22): walkTokens(), escapeHtml(), renderLayout(), handleFeatureDetail(), handleReleaseNotes(), ageBucket(), plainTextPreview(), renderAddEntryForm() (+14 more)

### Community 9 - "Community 9"
Cohesion: 0.12
Nodes (25): detectAllowlistDrift(), auditCodexCrOverrides(), auditOverrides(), detectPlanWithoutFd(), planSlug(), detectTierMismatch(), detectTrailerScopeMismatch(), detectAll() (+17 more)

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (11): formatResults(), printResults(), runAll(), makeBoundariesInvariant(), formatInvariantError(), makeInvariants(), runInvariants(), runInvariantSafely() (+3 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (28): countScriptFiles(), countTestCases(), getDocRoot(), getFeaturesDir(), getNoldorDir(), getReleaseNotesPath(), getScriptsDir(), getSkillsDir() (+20 more)

### Community 12 - "Community 12"
Cohesion: 0.12
Nodes (12): runList(), runResolve(), runValidate(), main(), main(), main(), dirStamp(), getRules() (+4 more)

### Community 13 - "Community 13"
Cohesion: 0.13
Nodes (25): collectTestFiles(), extractCodePackages(), main(), normalizeDeclaredPackage(), validateDocFeatureSlugs(), validateDocTagPresence(), validateFiles(), validateMilestoneRef() (+17 more)

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (19): parseCliArgs(), filenameSelector(), hashPaths(), isGateLane(), printFindings(), readFeatureMd(), readIfExists(), readSession() (+11 more)

### Community 15 - "Community 15"
Cohesion: 0.12
Nodes (26): getBacklogPath(), getRoadmapPath(), loadActiveMilestone(), loadMetricsReport(), setDocRootsOverride(), handle(), handleApiAdd(), handleApiDemote() (+18 more)

### Community 16 - "Community 16"
Cohesion: 0.16
Nodes (18): extractUnreleasedSummary(), generateFdChangelogs(), prependChangelogBlock(), renderInitialReleaseBlock(), renderPerReleaseBlock(), stripUnreleasedBlock(), commitsForFeature(), escapeForRegex() (+10 more)

### Community 17 - "Community 17"
Cohesion: 0.14
Nodes (12): detectMilestoneShippedIncomplete(), activateMilestone(), draftMilestone(), listMilestones(), loadMilestoneBySlug(), loadMilestones(), preflightActivate(), readMilestone() (+4 more)

### Community 18 - "Community 18"
Cohesion: 0.15
Nodes (13): flag(), runBootstrapCli(), injectBootstrapOverrides(), resolveIntroducedGate(), gateEntry(), isBootstrapReason(), declaredGateKeys(), detectBootstrapOverrideAudit() (+5 more)

### Community 19 - "Community 19"
Cohesion: 0.12
Nodes (6): isDrainEligible(), decideNext(), plansSource(), roadmapSource(), specsSource(), buildSource()

### Community 20 - "Community 20"
Cohesion: 0.25
Nodes (18): atomicWriteFile(), buildRoadmapBlock(), crossSection(), handleAdd(), handleDemote(), handleMove(), handlePromote(), handleRemove() (+10 more)

### Community 21 - "Community 21"
Cohesion: 0.21
Nodes (15): loadDocRoots(), findMilestoneMatch(), formatEntry(), getSuggestions(), getTopPriorityNext(), isWritePendingDeprecated(), loadInProgressFds(), loadMilestoneGate() (+7 more)

### Community 22 - "Community 22"
Cohesion: 0.22
Nodes (10): demoteStaleBacklog(), main(), parseArgv(), pushIssues(), validateTriageInputs(), createSlugTracker(), parseBacklog(), parseEntries() (+2 more)

### Community 23 - "Community 23"
Cohesion: 0.2
Nodes (13): basePayload(), commitProse(), buildVerifyPrompt(), dispatcher(), dispatchVerify(), parseVerifyVerdict(), setVerifyDispatcher(), mkFinding() (+5 more)

### Community 24 - "Community 24"
Cohesion: 0.16
Nodes (18): countMatching(), featureSlugsForCodePath(), loadBacklog(), loadBacklogWithHash(), loadCounts(), loadGaps(), loadRoadmapWithHash(), parseBacklogFromString() (+10 more)

### Community 25 - "Community 25"
Cohesion: 0.15
Nodes (12): assertQueueSourceSynced(), assertQueueSourceSyncedAt(), classifyMergeView(), mergePr(), openPrExistsFor(), spawnGate(), syncMainCleanState(), detectStale() (+4 more)

### Community 26 - "Community 26"
Cohesion: 0.19
Nodes (8): amendSubagentReceipt(), parseArgs(), execAsync(), guardLaneOverwrite(), isEmptyDiffDefault(), resolveLanes(), run(), writeSyntheticOk()

### Community 27 - "Community 27"
Cohesion: 0.2
Nodes (9): extractFdAcceptance(), readFdSummary(), buildPrompt(), dispatcher(), dispatchSubagent(), setDispatcher(), parseSubagentMarkdown(), runSubagent() (+1 more)

### Community 28 - "Community 28"
Cohesion: 0.22
Nodes (10): writeJsonAtomic(), claudeSupportsMaxThinking(), execAsync(), osascriptSpawn(), runStandalone(), templateSha(), codexSupportsBaseSha(), exec() (+2 more)

### Community 29 - "Community 29"
Cohesion: 0.17
Nodes (11): fillAllNoldorMarkers(), fillNoldorMarker(), ensureCleanTreeOnMain(), ensureGhAvailable(), main(), run(), runCheck(), runCliCheck() (+3 more)

### Community 30 - "Community 30"
Cohesion: 0.14
Nodes (7): edgeScrollVelocity(), init(), shouldInsertBefore(), wireAddForms(), wireButtons(), wireDescriptionOverflow(), wireDescriptionToggles()

### Community 31 - "Community 31"
Cohesion: 0.22
Nodes (12): appendJsonl(), applyCycleVerdict(), loadPark(), mapCycle(), parkKey(), readInboxRows(), savePark(), unparkSlug() (+4 more)

### Community 32 - "Community 32"
Cohesion: 0.19
Nodes (10): notify(), dayKeyOf(), interruptibleSleep(), intFlag(), parseWatchArgs(), resolve130(), sleep(), applyCycleToState() (+2 more)

### Community 33 - "Community 33"
Cohesion: 0.28
Nodes (16): buildIdToLabel(), buildNodeCommunityMap(), classifyEdges(), deriveCommunityLabel(), deriveCommunityLabels(), extractConceptsAndRationales(), extractPackages(), formatCrossEdgeLine() (+8 more)

### Community 34 - "Community 34"
Cohesion: 0.21
Nodes (7): groupKillState(), parseWorktrees(), pruneShippedWorktrees(), reapOrphanAgents(), reconcileDeadRun(), reconcileOpenPrs(), writeState()

### Community 35 - "Community 35"
Cohesion: 0.28
Nodes (14): releaseLock(), runDrain(), formatReconcile(), makeReconcileDeps(), reportIsEmpty(), parkAwareSource(), assertConfig(), intFlag() (+6 more)

### Community 36 - "Community 36"
Cohesion: 0.27
Nodes (12): admitsLiteralHyphen(), extractFencedBlocks(), findMessageFlag(), formatFindingHuman(), isCloseFence(), isGitCommitLine(), lineContainsFlag(), lintSnippets() (+4 more)

### Community 37 - "Community 37"
Cohesion: 0.28
Nodes (6): walk(), claudeProjectDirName(), claudeUsage(), codexUsage(), opencodeUsage(), stubUsage()

### Community 38 - "Community 38"
Cohesion: 0.21
Nodes (9): asArray(), docNodeId(), enrichDocNodes(), enrichGraph(), loadDocDir(), loadFds(), main(), referencedPaths() (+1 more)

### Community 39 - "Community 39"
Cohesion: 0.27
Nodes (10): detectCodeLinksDrift(), buildSlugToCodeMap(), collectTaggedCode(), diffProjection(), extractFdTags(), loadCachedCode(), main(), scanRoots() (+2 more)

### Community 40 - "Community 40"
Cohesion: 0.22
Nodes (8): prependToChangelog(), renderChangelogEntry(), renderCommit(), classifyCommit(), classifyCommits(), deriveBumpLevel(), readCommitsSince(), refExists()

### Community 41 - "Community 41"
Cohesion: 0.26
Nodes (5): waitForHttp200(), resolvePort(), probeServer(), runShell(), runSmoke()

### Community 42 - "Community 42"
Cohesion: 0.27
Nodes (8): loadConfig(), resolveReviewProfile(), resolveSessionTtlHours(), main(), escalate(), spawnDeepReview(), writeContext(), main()

### Community 43 - "Community 43"
Cohesion: 0.23
Nodes (13): loadFrameworkPage(), loadFrameworkPages(), loadUserDoc(), loadUserDocs(), rewriteDocLinks(), handleFrameworkIndex(), handleFrameworkPage(), handleUserDoc() (+5 more)

### Community 44 - "Community 44"
Cohesion: 0.19
Nodes (14): loadFeatures(), loadHotZones(), loadVelocity(), loadWipAge(), loadWorktreeHealth(), resolveRenamePath(), tryGit(), handleFeatures() (+6 more)

### Community 45 - "Community 45"
Cohesion: 0.32
Nodes (6): classifyFeature(), classifyPlanOrSpec(), listMarkdownFilenames(), main(), readFileOrEmpty(), auditCrossTreeLinks()

### Community 46 - "Community 46"
Cohesion: 0.28
Nodes (5): aggregate(), main(), parseArgs(), templateShaFor(), inferLaneFromFilename()

### Community 47 - "Community 47"
Cohesion: 0.31
Nodes (8): ensureGardenFresh(), evaluateGardenFreshness(), main(), readGardenReceipt(), resolveGardenScanPaths(), writeGardenReceipt(), autoStampOnCleanDetect(), defaultStamp()

### Community 48 - "Community 48"
Cohesion: 0.33
Nodes (7): acquireLock(), isAlive(), liveLockPid(), binPathFrom(), detachChildArgv(), detachWatch(), stripDetach()

### Community 49 - "Community 49"
Cohesion: 0.27
Nodes (3): detectFdWithoutPlan(), findCreationSha(), hasPlan()

### Community 50 - "Community 50"
Cohesion: 0.31
Nodes (5): prsSinceLastTag(), stripBang(), findPreviousTag(), commit(), git()

### Community 51 - "Community 51"
Cohesion: 0.42
Nodes (8): checkLinks(), extractHeadings(), extractLinks(), fileExists(), main(), slugifyHeading(), stripCodeRegions(), walkMd()

### Community 52 - "Community 52"
Cohesion: 0.4
Nodes (6): appendList(), applyBlock(), buildResourcesBlock(), main(), resolveSpecPath(), syncFile()

### Community 53 - "Community 53"
Cohesion: 0.42
Nodes (6): ensureDashboard(), isDashboardUp(), main(), resolveMainRoot(), sleep(), spawnDetachedServer()

### Community 54 - "Community 54"
Cohesion: 0.43
Nodes (3): partitionBlocks(), slugify(), stageFrameworkDocs()

### Community 55 - "Community 55"
Cohesion: 0.5
Nodes (3): promptSelect(), promptText(), runManual()

### Community 56 - "Community 56"
Cohesion: 0.54
Nodes (6): areaFromPackage(), inferTier(), main(), walkFeaturesDir(), yamlToBacklogBlock(), yamlToFeatureMd()

### Community 57 - "Community 57"
Cohesion: 0.43
Nodes (5): main(), migrateChangelogContent(), migrateFeaturesDir(), parseChangelogSection(), renderSection()

### Community 58 - "Community 58"
Cohesion: 0.39
Nodes (3): noldorCliCommand(), extractJsonLine(), runGardenDetectViaCli()

### Community 59 - "Community 59"
Cohesion: 0.52
Nodes (5): filterCommitsForPage(), listPageSlugs(), loadCommits(), main(), parseScope()

### Community 60 - "Community 60"
Cohesion: 0.48
Nodes (4): buildPrompt(), joinSubjectsDeterministic(), polishSummary(), runAgentPolish()

### Community 61 - "Community 61"
Cohesion: 0.48
Nodes (3): fillAllMarkers(), fillMarkers(), main()

### Community 62 - "Community 62"
Cohesion: 0.52
Nodes (4): printHelp(), dispatch(), isHelpFlag(), main()

### Community 63 - "Community 63"
Cohesion: 0.43
Nodes (6): loadSkill(), loadSkills(), handleSkillPage(), handleSkillsIndex(), renderSkillPage(), renderSkillsIndex()

### Community 64 - "Community 64"
Cohesion: 0.43
Nodes (6): graphReportSection(), loadGraphHealth(), parseDeadExports(), parseGraphReport(), handleGraphHealth(), renderGraphHealth()

### Community 65 - "Community 65"
Cohesion: 0.33
Nodes (4): buildMilestoneGroups(), loadMilestoneGroups(), handleMilestones(), renderMilestones()

### Community 66 - "Community 66"
Cohesion: 0.62
Nodes (5): evaluatePrePush(), main(), pushesMain(), readStdinWithTimeout(), recordReleasePush()

### Community 67 - "Community 67"
Cohesion: 0.67
Nodes (4): diffSkillSets(), loadSkillSlugs(), main(), parseCatalogSlugs()

### Community 68 - "Community 68"
Cohesion: 0.6
Nodes (4): extractLegacyBlock(), findLineStartingWith(), main(), migrateFd()

### Community 69 - "Community 69"
Cohesion: 0.53
Nodes (4): ensureGraphFresh(), latestCommitTs(), commit(), exec()

### Community 70 - "Community 70"
Cohesion: 0.6
Nodes (4): loadExamples(), main(), processTutorialDir(), transcludeMarkers()

### Community 71 - "Community 71"
Cohesion: 0.6
Nodes (4): addGeneratedHeader(), annotateAll(), main(), walkMd()

### Community 72 - "Community 72"
Cohesion: 0.7
Nodes (3): collectFiles(), main(), renamePlanOnlyTier()

### Community 73 - "Community 73"
Cohesion: 0.7
Nodes (3): loadKnownSlugs(), main(), validateFeatureSlugScope()

### Community 74 - "Community 74"
Cohesion: 0.8
Nodes (3): main(), resolveIsShipped(), scoreEntry()

## Knowledge Gaps
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `loadDocRoots()` connect `Community 21` to `Community 0`, `Community 3`, `Community 38`, `Community 9`, `Community 11`, `Community 13`, `Community 15`, `Community 18`, `Community 19`, `Community 22`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Why does `loadConsumerConfig()` connect `Community 5` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 39`, `Community 8`, `Community 10`, `Community 11`, `Community 13`, `Community 47`, `Community 29`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Why does `checkCrGate()` connect `Community 2` to `Community 18`, `Community 29`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Are the 26 inferred relationships involving `loadDocRoots()` (e.g. with `run()` and `listSpecFiles()`) actually correct?**
  _`loadDocRoots()` has 26 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `loadConsumerConfig()` (e.g. with `resolveGardenScanPaths()` and `detectMissingCoTags()`) actually correct?**
  _`loadConsumerConfig()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 14 inferred relationships involving `detectAll()` (e.g. with `detectTierMismatch()` and `detectAllowlistDrift()`) actually correct?**
  _`detectAll()` has 14 INFERRED edges - model-reasoned connections that need verification._
- **Are the 16 inferred relationships involving `main()` (e.g. with `loadConfigSync()` and `assertConfig()`) actually correct?**
  _`main()` has 16 INFERRED edges - model-reasoned connections that need verification._