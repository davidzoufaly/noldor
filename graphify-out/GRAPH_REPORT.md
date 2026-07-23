# Graph Report - .  (2026-07-23)

## Corpus Check
- Large corpus: 844 files · ~811,785 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 2044 nodes · 5002 edges · 125 communities (114 shown, 11 thin omitted)
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 534 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_prep|prep]]
- [[_COMMUNITY_worktrees|worktrees]]
- [[_COMMUNITY_hooks|hooks]]
- [[_COMMUNITY_migrations|migrations]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_release|release]]
- [[_COMMUNITY_metrics|metrics]]
- [[_COMMUNITY_dashboard|dashboard]]
- [[_COMMUNITY_dashboard|dashboard]]
- [[_COMMUNITY_dashboard|dashboard]]
- [[_COMMUNITY_cr|cr]]
- [[_COMMUNITY_invariants|invariants]]
- [[_COMMUNITY_rules|rules]]
- [[_COMMUNITY_features|features]]
- [[_COMMUNITY_autonomous__tests__|autonomous/__tests__]]
- [[_COMMUNITY_garden|garden]]
- [[_COMMUNITY_garden|garden]]
- [[_COMMUNITY_autonomous|autonomous]]
- [[_COMMUNITY_milestones|milestones]]
- [[_COMMUNITY_dashboardapi|dashboard/api]]
- [[_COMMUNITY_coreagent-runner|core/agent-runner]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_crlanes|cr/lanes]]
- [[_COMMUNITY_dashboard|dashboard]]
- [[_COMMUNITY_autonomous|autonomous]]
- [[_COMMUNITY_autonomous|autonomous]]
- [[_COMMUNITY_release|release]]
- [[_COMMUNITY_garden|garden]]
- [[_COMMUNITY_dashboard|dashboard]]
- [[_COMMUNITY_coreagent-runner|core/agent-runner]]
- [[_COMMUNITY_crlanes|cr/lanes]]
- [[_COMMUNITY_templates|templates]]
- [[_COMMUNITY_triage|triage]]
- [[_COMMUNITY_dashboard|dashboard]]
- [[_COMMUNITY_dashboardstatic|dashboard/static]]
- [[_COMMUNITY_features|features]]
- [[_COMMUNITY_gardendetectors|garden/detectors]]
- [[_COMMUNITY_cr|cr]]
- [[_COMMUNITY_graphify|graphify]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_utils|utils]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_clones|clones]]
- [[_COMMUNITY_graphify|graphify]]
- [[_COMMUNITY_dashboard|dashboard]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_coreagent-runner|core/agent-runner]]
- [[_COMMUNITY_garden|garden]]
- [[_COMMUNITY_release|release]]
- [[_COMMUNITY_release|release]]
- [[_COMMUNITY_release__tests__|release/__tests__]]
- [[_COMMUNITY_garden|garden]]
- [[_COMMUNITY_templates|templates]]
- [[_COMMUNITY_coreagent-runner|core/agent-runner]]
- [[_COMMUNITY_clones|clones]]
- [[_COMMUNITY_gardendetectors|garden/detectors]]
- [[_COMMUNITY_gardendetectors|garden/detectors]]
- [[_COMMUNITY_sync|sync]]
- [[_COMMUNITY_cr|cr]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_cr|cr]]
- [[_COMMUNITY_testing|testing]]
- [[_COMMUNITY_autonomous|autonomous]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_triage|triage]]
- [[_COMMUNITY_cr|cr]]
- [[_COMMUNITY_dashboardstatic|dashboard/static]]
- [[_COMMUNITY_autonomous|autonomous]]
- [[_COMMUNITY_cr|cr]]
- [[_COMMUNITY_dashboard__tests__|dashboard/__tests__]]
- [[_COMMUNITY_autonomous|autonomous]]
- [[_COMMUNITY_autonomous|autonomous]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_gardendetectors|garden/detectors]]
- [[_COMMUNITY_gardendetectors|garden/detectors]]
- [[_COMMUNITY_crlanes|cr/lanes]]
- [[_COMMUNITY_docs|docs]]
- [[_COMMUNITY_sync|sync]]
- [[_COMMUNITY_cli|cli]]
- [[_COMMUNITY_triage|triage]]
- [[_COMMUNITY_gardendetectors|garden/detectors]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_features|features]]
- [[_COMMUNITY_features|features]]
- [[_COMMUNITY_garden|garden]]
- [[_COMMUNITY_autonomous__tests__|autonomous/__tests__]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_release|release]]
- [[_COMMUNITY_dashboard|dashboard]]
- [[_COMMUNITY_hooks|hooks]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_testing|testing]]
- [[_COMMUNITY_sync|sync]]
- [[_COMMUNITY_gardendetectors|garden/detectors]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_features|features]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_release|release]]
- [[_COMMUNITY_docs|docs]]
- [[_COMMUNITY_docs|docs]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_gardendetectors|garden/detectors]]
- [[_COMMUNITY_checks|checks]]
- [[_COMMUNITY_hooks|hooks]]
- [[_COMMUNITY_core|core]]
- [[_COMMUNITY_triage|triage]]
- [[_COMMUNITY_checks|checks]]
- [[_COMMUNITY_release__tests__|release/__tests__]]
- [[_COMMUNITY_worktrees|worktrees]]
- [[_COMMUNITY_gardendetectors|garden/detectors]]

## God Nodes (most connected - your core abstractions)
1. `loadDocRoots()` - 52 edges
2. `loadConsumerConfig()` - 33 edges
3. `detectAll()` - 28 edges
4. `escapeHtml()` - 28 edges
5. `main()` - 26 edges
6. `parseBacklog()` - 25 edges
7. `main()` - 21 edges
8. `spawnAgent()` - 19 edges
9. `collectGaps()` - 18 edges
10. `main()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `withReleaseSession()`  [INFERRED]
  src/release/index.ts → src/release/release-session.ts
- `walkTokens()` --calls--> `escapeHtml()`  [INFERRED]
  src/dashboard/data.ts → src/dashboard/layout.ts
- `main()` --calls--> `compute()`  [INFERRED]
  src/garden/sdd-report.ts → src/metrics/compute.ts
- `loadMetricsReport()` --calls--> `compute()`  [INFERRED]
  src/dashboard/data.ts → src/metrics/compute.ts
- `recoverIntake()` --calls--> `slugify()`  [INFERRED]
  src/metrics/facts.ts → src/utils/slugify.ts

## Communities (125 total, 11 thin omitted)

### Community 0 - "prep"
Cohesion: 0.05
Nodes (61): collectRoutingAccuracy(), runWithConcurrency(), loadAreaCategories(), gitStatusPorcelain(), sizeSkipsSpec(), sizeToPath(), sizeToTier(), areaToCategory() (+53 more)

### Community 1 - "worktrees"
Cohesion: 0.05
Nodes (40): waitForHttp200(), resolvePort(), probeServer(), runShell(), runSmoke(), createWorktree(), main(), parseArgs() (+32 more)

### Community 2 - "hooks"
Cohesion: 0.06
Nodes (35): isMicroChoreAllowed(), isReleaseSweepAllowed(), ensureRolloutMarker(), isPostRollout(), readRolloutMarker(), rolloutMarkerExists(), isSessionStale(), appendToMessage() (+27 more)

### Community 3 - "migrations"
Cohesion: 0.07
Nodes (29): isDirty(), loadConfigTolerant(), main(), parseFrom(), runUpgrade(), loadCategories(), loadConsumerConfig(), loadDevConfig() (+21 more)

### Community 4 - "core"
Cohesion: 0.07
Nodes (34): checkRedundantDelivery(), ChecksFailedError, ChecksPendingTimeoutError, clearMicroChoreSession(), discoverAddedFiles(), execGit(), loadFdSummary(), loadVerifyEvidence() (+26 more)

### Community 5 - "release"
Cohesion: 0.08
Nodes (32): prsSinceLastTag(), buildPrompt(), joinSubjectsDeterministic(), polishSummary(), runAgentPolish(), extractUnreleasedSummary(), generateFdChangelogs(), prependChangelogBlock() (+24 more)

### Community 6 - "metrics"
Cohesion: 0.09
Nodes (29): collectCrEffectiveness(), collectCycleTime(), percentile(), collectDrainReliability(), collectOverridePressure(), releaseWindow(), renderMetricsSection(), reviewSkipCountLine() (+21 more)

### Community 7 - "dashboard"
Cohesion: 0.08
Nodes (37): countScriptFiles(), countTestCases(), getDocRoot(), getFeaturesDir(), getNoldorDir(), getReleaseNotesPath(), getScriptsDir(), getSkillsDir() (+29 more)

### Community 8 - "dashboard"
Cohesion: 0.09
Nodes (41): getBacklogPath(), getRoadmapPath(), loadActiveMilestone(), loadBlockedByGraph(), loadFeatures(), loadHotZones(), loadMetricsReport(), loadVelocity() (+33 more)

### Community 9 - "dashboard"
Cohesion: 0.1
Nodes (30): escapeHtml(), ageBucket(), barTable(), formatAgentDuration(), genericMetricBody(), isRecord(), metricEmpty(), numberMap() (+22 more)

### Community 10 - "cr"
Cohesion: 0.1
Nodes (26): parseCliArgs(), filenameSelector(), hashPaths(), isGateLane(), printFindings(), readFeatureMd(), readIfExists(), readRules() (+18 more)

### Community 11 - "invariants"
Cohesion: 0.09
Nodes (12): formatResults(), formatViolationLine(), printResults(), runAll(), warningBlock(), makeBoundariesInvariant(), formatInvariantError(), makeInvariants() (+4 more)

### Community 12 - "rules"
Cohesion: 0.11
Nodes (11): runList(), runResolve(), runValidate(), main(), main(), dirStamp(), getRules(), loadRulesFromDir() (+3 more)

### Community 13 - "features"
Cohesion: 0.13
Nodes (25): collectTestFiles(), extractCodePackages(), main(), normalizeDeclaredPackage(), validateDocFeatureSlugs(), validateDocTagPresence(), validateFiles(), validateMilestoneRef() (+17 more)

### Community 14 - "autonomous/__tests__"
Cohesion: 0.1
Nodes (10): resolveRunner(), isDrainEligible(), decideNext(), implementerDispatch(), plansSource(), roadmapSource(), specsSource(), buildDrainGatePrompt() (+2 more)

### Community 15 - "garden"
Cohesion: 0.15
Nodes (21): compareSemver(), extractPlanSlug(), isInfraFile(), isLinkEnforced(), collectGaps(), detectCodeOrphans(), detectDoneFeaturesMissingCode(), detectDoneFeaturesMissingIntroduced() (+13 more)

### Community 16 - "garden"
Cohesion: 0.15
Nodes (18): detectMigrationCoverage(), evaluateCoverage(), auditOverrides(), detectTierMismatch(), detectAll(), detectContradictions(), detectGateCompliance(), detectInvariants() (+10 more)

### Community 17 - "autonomous"
Cohesion: 0.15
Nodes (17): assertQueueSourceSynced(), assertQueueSourceSyncedAt(), classifyMergeView(), mergedPrExistsFor(), mergePr(), openPrExistsFor(), spawnGate(), syncMainCleanState() (+9 more)

### Community 18 - "milestones"
Cohesion: 0.14
Nodes (12): detectMilestoneShippedIncomplete(), activateMilestone(), draftMilestone(), listMilestones(), loadMilestoneBySlug(), loadMilestones(), preflightActivate(), readMilestone() (+4 more)

### Community 19 - "dashboard/api"
Cohesion: 0.23
Nodes (19): atomicWriteFile(), buildRoadmapBlock(), crossSection(), handleAdd(), handleDemote(), handleMove(), handlePromote(), handleRemove() (+11 more)

### Community 20 - "core/agent-runner"
Cohesion: 0.17
Nodes (12): extractArtifactLinks(), fixArtifactLink(), indexSrcByBasename(), main(), migrateOne(), rewriteScriptsPaths(), walk(), claudeProjectDirName() (+4 more)

### Community 21 - "core"
Cohesion: 0.16
Nodes (12): extractTouches(), looksLikePath(), normalizePath(), findEntry(), main(), readFileOrNull(), runSplitCheck(), toResult() (+4 more)

### Community 22 - "cr/lanes"
Cohesion: 0.18
Nodes (14): parseArgs(), basePayload(), commitProse(), buildVerifyPrompt(), dispatcher(), dispatchVerify(), parseVerifyVerdict(), setVerifyDispatcher() (+6 more)

### Community 23 - "dashboard"
Cohesion: 0.14
Nodes (19): loadFrameworkPage(), loadFrameworkPages(), loadSkill(), loadSkills(), loadUserDoc(), loadUserDocs(), rewriteDocLinks(), setDocRootsOverride() (+11 more)

### Community 24 - "autonomous"
Cohesion: 0.17
Nodes (14): appendJsonl(), applyCycleVerdict(), loadPark(), mapCycle(), parkKey(), readInboxRows(), savePark(), unparkSlug() (+6 more)

### Community 25 - "autonomous"
Cohesion: 0.2
Nodes (19): runDrain(), formatReconcile(), makeReconcileDeps(), reportIsEmpty(), parkAwareSource(), notify(), assertConfig(), main() (+11 more)

### Community 26 - "release"
Cohesion: 0.16
Nodes (14): fillAllNoldorMarkers(), fillNoldorMarker(), ensureGhAvailable(), extractLatestReleaseNotes(), main(), run(), runCheck(), runCliCheck() (+6 more)

### Community 27 - "garden"
Cohesion: 0.22
Nodes (13): main(), proposeCandidates(), rankCandidates(), buildFileToFdsMap(), getCommunityOwners(), getFdOwnersForFile(), getImportOwnersForTest(), isIgnoredFreshnessPath() (+5 more)

### Community 28 - "dashboard"
Cohesion: 0.16
Nodes (18): countMatching(), featureSlugsForCodePath(), loadBacklog(), loadBacklogWithHash(), loadCounts(), loadGaps(), loadRoadmapWithHash(), parseBacklogFromString() (+10 more)

### Community 29 - "core/agent-runner"
Cohesion: 0.23
Nodes (7): parseOpencodeEvents(), opencodeWantsJson(), planSpawn(), buildClaudeArgv(), buildCodexArgv(), buildOpencodeArgv(), buildStubArgv()

### Community 30 - "cr/lanes"
Cohesion: 0.2
Nodes (8): extractFdAcceptance(), readFdSummary(), buildPrompt(), dispatcher(), dispatchSubagent(), setDispatcher(), parseSubagentMarkdown(), runSubagent()

### Community 31 - "templates"
Cohesion: 0.22
Nodes (8): ensureGitignoreBlock(), computeSteps(), isNoldorVendoredSkill(), syncFiles(), templatesUnder(), adoptTemplate(), copyTemplate(), templateFiles()

### Community 32 - "triage"
Cohesion: 0.23
Nodes (12): backfillIds(), main(), formatEntryId(), mintEntryIds(), readNext(), resolveEntryRef(), scanBlock(), stampMissingIds() (+4 more)

### Community 33 - "dashboard"
Cohesion: 0.21
Nodes (9): ensureDashboard(), isDashboardUp(), main(), resolveMainRoot(), sleep(), spawnDetachedServer(), healthUrl(), resolveBindHost() (+1 more)

### Community 34 - "dashboard/static"
Cohesion: 0.14
Nodes (6): edgeScrollVelocity(), init(), shouldInsertBefore(), wireButtons(), wireDescriptionOverflow(), wireDescriptionToggles()

### Community 35 - "features"
Cohesion: 0.26
Nodes (11): applyProposal(), backupFeatures(), collectCandidateFiles(), extractSummary(), generateProposal(), main(), parseLlmResponse(), parseProposal() (+3 more)

### Community 36 - "garden/detectors"
Cohesion: 0.26
Nodes (11): flattenManifest(), diffCatalogSrcs(), main(), manifestSrcSet(), parseCatalogSrcs(), buildCommandRegistry(), commandTokens(), detectFdCommandRot() (+3 more)

### Community 37 - "cr"
Cohesion: 0.21
Nodes (8): amendSubagentReceipt(), execAsync(), guardLaneOverwrite(), isEmptyDiffDefault(), resolveLanes(), run(), sinkCandidatePaths(), writeSyntheticOk()

### Community 38 - "graphify"
Cohesion: 0.28
Nodes (16): buildIdToLabel(), buildNodeCommunityMap(), classifyEdges(), deriveCommunityLabel(), deriveCommunityLabels(), extractConceptsAndRationales(), extractPackages(), formatCrossEdgeLine() (+8 more)

### Community 39 - "core"
Cohesion: 0.28
Nodes (11): formatEmit(), main(), parseWaitArgs(), UsageError, evalPredicate(), getPath(), parsePredicate(), PredicateParseError (+3 more)

### Community 40 - "utils"
Cohesion: 0.3
Nodes (9): demoteStaleBacklog(), createSlugTracker(), mergeDepFields(), parseBacklog(), parseBlockBody(), parseEntries(), parseRefList(), parseRoadmap() (+1 more)

### Community 41 - "core"
Cohesion: 0.23
Nodes (12): extractSummary(), listPlans(), listSpecs(), loadSddFeatures(), readTextFiles(), walkRepo(), loadSddInput(), insertFdTag() (+4 more)

### Community 42 - "clones"
Cohesion: 0.24
Nodes (10): loadCorpus(), parseClonesArgs(), renderSummary(), runClones(), UsageError, actualPackageNames(), scanRoots(), walkCodeFiles() (+2 more)

### Community 43 - "graphify"
Cohesion: 0.19
Nodes (10): planSlugFromFilename(), asArray(), docNodeId(), enrichDocNodes(), enrichGraph(), loadDocDir(), loadFds(), main() (+2 more)

### Community 44 - "dashboard"
Cohesion: 0.18
Nodes (14): loadAgentActivity(), loadDrainObservation(), loadWatchLogTail(), handleAgents(), handleAgentsLog(), handleApiAgents(), drainStatusLine(), renderAgents() (+6 more)

### Community 45 - "core"
Cohesion: 0.27
Nodes (12): admitsLiteralHyphen(), extractFencedBlocks(), findMessageFlag(), formatFindingHuman(), isCloseFence(), isGitCommitLine(), lineContainsFlag(), lintSnippets() (+4 more)

### Community 46 - "core/agent-runner"
Cohesion: 0.14
Nodes (4): spawnAgent(), spawnClaude(), FakeChild, FakeChild

### Community 47 - "garden"
Cohesion: 0.29
Nodes (10): loadDocRoots(), resolveDesignSubdir(), detectStalePlans(), detectStaleSpecs(), loadFeatureBySlug(), specSlugFromFilename(), resolveByGraphAdjacency(), resolveByLinksPlan() (+2 more)

### Community 48 - "release"
Cohesion: 0.22
Nodes (8): prependToChangelog(), renderChangelogEntry(), renderCommit(), classifyCommit(), classifyCommits(), deriveBumpLevel(), readCommitsSince(), refExists()

### Community 49 - "release"
Cohesion: 0.26
Nodes (9): ensureCleanTreeOnMain(), git(), awaitPublish(), cliMain(), envTuning(), isVersionOnRegistry(), publishLocal(), readPkgIdentity() (+1 more)

### Community 50 - "release/__tests__"
Cohesion: 0.24
Nodes (9): assertNoInProgressRelease(), resumeRelease(), clearReleaseState(), readReleaseState(), writeReleaseState(), addBareOrigin(), call(), git() (+1 more)

### Community 51 - "garden"
Cohesion: 0.27
Nodes (9): appendOverrideLog(), ensureGardenFresh(), evaluateGardenFreshness(), main(), readGardenReceipt(), resolveGardenScanPaths(), writeGardenReceipt(), autoStampOnCleanDetect() (+1 more)

### Community 52 - "templates"
Cohesion: 0.24
Nodes (7): loadAgentsConfig(), checkTemplateSync(), main(), resolveChangedFiles(), parseAgents(), filterTemplatesByAgents(), computeDrift()

### Community 53 - "core/agent-runner"
Cohesion: 0.27
Nodes (6): checkRunners(), compareDotted(), referencedRunners(), checkBinaryPrerequisites(), checkConsumerScripts(), makeDefaultProbe()

### Community 54 - "clones"
Cohesion: 0.22
Nodes (6): detectClones(), overlaps(), isDigit(), isIdentPart(), isIdentStart(), tokenize()

### Community 55 - "garden/detectors"
Cohesion: 0.21
Nodes (9): auditOverrideTrailers(), auditReleasePushes(), classifyOverrideTrailer(), commitIsReleaseShaped(), commitOnlyTouchesReport(), matchesExpectedOverride(), buildGateComplianceSection(), commitTouchingPaths() (+1 more)

### Community 56 - "garden/detectors"
Cohesion: 0.24
Nodes (5): isBootstrapReason(), declaredGateKeys(), detectBootstrapOverrideAudit(), gateForTrailer(), auditCodexCrOverrides()

### Community 57 - "sync"
Cohesion: 0.29
Nodes (9): detectCodeLinksDrift(), buildSlugToCodeMap(), collectTaggedCode(), diffProjection(), extractFdTags(), loadCachedCode(), main(), updateFeatureMd() (+1 more)

### Community 58 - "cr"
Cohesion: 0.27
Nodes (8): loadConfig(), resolveReviewProfile(), resolveSessionTtlHours(), main(), escalate(), spawnDeepReview(), writeContext(), main()

### Community 59 - "core"
Cohesion: 0.31
Nodes (11): applySiblingTrailer(), buildSiblingTrailerValue(), buildSuggestion(), headHasNoldorPages(), loadKnownSlugs(), loadScaffoldSlugs(), loadStagedFiles(), main() (+3 more)

### Community 60 - "cr"
Cohesion: 0.26
Nodes (5): aggregate(), main(), parseArgs(), templateShaFor(), inferLaneFromFilename()

### Community 61 - "testing"
Cohesion: 0.29
Nodes (9): verifyTarball(), buildConsumerFixture(), CONSUMER_CONFIG(), ROADMAP(), installFrameworkTarball(), repoRoot(), runConsumerCli(), runContractChecks() (+1 more)

### Community 62 - "autonomous"
Cohesion: 0.32
Nodes (8): acquireLock(), isAlive(), liveLockPid(), releaseLock(), binPathFrom(), detachChildArgv(), detachWatch(), stripDetach()

### Community 63 - "core"
Cohesion: 0.39
Nodes (10): findMilestoneMatch(), formatEntry(), getSuggestions(), getTopPriorityNext(), isWritePendingDeprecated(), loadInProgressFds(), loadMilestoneGate(), main() (+2 more)

### Community 64 - "triage"
Cohesion: 0.27
Nodes (7): loadFeatureRefs(), main(), parseArgv(), pushBlockedByIssues(), pushIdIssues(), pushIssues(), validateTriageInputs()

### Community 65 - "cr"
Cohesion: 0.32
Nodes (9): flag(), runBootstrapCli(), injectBootstrapOverrides(), resolveIntroducedGate(), gateEntry(), git(), makeRepo(), treesOf() (+1 more)

### Community 66 - "dashboard/static"
Cohesion: 0.35
Nodes (10): drainStatusText(), emptyRow(), formatRuntime(), patchDrain(), poll(), renderDrainInFlight(), renderDrainParked(), renderInbox() (+2 more)

### Community 67 - "autonomous"
Cohesion: 0.32
Nodes (6): projectDrainState(), readState(), writeState(), collectStatus(), formatStatus(), main()

### Community 68 - "cr"
Cohesion: 0.36
Nodes (6): writeJsonAtomic(), claudeSupportsMaxThinking(), execAsync(), osascriptSpawn(), runStandalone(), templateSha()

### Community 69 - "dashboard/__tests__"
Cohesion: 0.33
Nodes (6): renderLayout(), repoDisplayName(), handleReleaseNotes(), renderReleaseNotes(), shell(), shell()

### Community 70 - "autonomous"
Cohesion: 0.25
Nodes (5): detectStale(), makeRoadmapConflictResolver(), repair(), resolveRoadmapConflict(), spawnRunner()

### Community 71 - "autonomous"
Cohesion: 0.29
Nodes (6): diffPhases(), makePhaseTap(), appendAgentEvent(), rotateIfNeeded(), row(), seedOversize()

### Community 72 - "core"
Cohesion: 0.4
Nodes (5): defaultRunner(), main(), resolveOxfmt(), decideFmtGuard(), isNoTargetFailure()

### Community 73 - "garden/detectors"
Cohesion: 0.33
Nodes (6): buildBlockedByGraph(), detectCircularBlockedBy(), findBlockedByCycles(), findCyclesInBuild(), readOr(), tarjanCycles()

### Community 74 - "garden/detectors"
Cohesion: 0.27
Nodes (3): detectFdWithoutPlan(), findCreationSha(), hasPlan()

### Community 75 - "cr/lanes"
Cohesion: 0.36
Nodes (4): codexSupportsBaseSha(), exec(), extractLaneJson(), runCodex()

### Community 76 - "docs"
Cohesion: 0.42
Nodes (8): checkLinks(), extractHeadings(), extractLinks(), fileExists(), main(), slugifyHeading(), stripCodeRegions(), walkMd()

### Community 77 - "sync"
Cohesion: 0.4
Nodes (6): appendList(), applyBlock(), buildResourcesBlock(), main(), resolveSpecPath(), syncFile()

### Community 78 - "cli"
Cohesion: 0.42
Nodes (5): printHelp(), dispatch(), isHelpFlag(), main(), installedFrameworkVersion()

### Community 79 - "triage"
Cohesion: 0.5
Nodes (4): buildMergeCandidates(), formatTable(), main(), readOrEmpty()

### Community 80 - "garden/detectors"
Cohesion: 0.43
Nodes (5): checkCommands(), checkPaths(), collectSkillMd(), detectSkillCodeDrift(), inlineCodeSpans()

### Community 81 - "core"
Cohesion: 0.5
Nodes (3): promptSelect(), promptText(), runManual()

### Community 82 - "features"
Cohesion: 0.54
Nodes (6): areaFromPackage(), inferTier(), main(), walkFeaturesDir(), yamlToBacklogBlock(), yamlToFeatureMd()

### Community 83 - "features"
Cohesion: 0.43
Nodes (5): main(), migrateChangelogContent(), migrateFeaturesDir(), parseChangelogSection(), renderSection()

### Community 84 - "garden"
Cohesion: 0.39
Nodes (3): noldorCliCommand(), extractJsonLine(), runGardenDetectViaCli()

### Community 86 - "core"
Cohesion: 0.57
Nodes (5): filterCommitsForPage(), listPageSlugs(), loadCommits(), main(), parseScope()

### Community 87 - "release"
Cohesion: 0.48
Nodes (3): fillAllMarkers(), fillMarkers(), main()

### Community 88 - "dashboard"
Cohesion: 0.33
Nodes (4): buildMilestoneGroups(), loadMilestoneGroups(), handleMilestones(), renderMilestones()

### Community 89 - "hooks"
Cohesion: 0.62
Nodes (5): evaluatePrePush(), main(), pushesMain(), readStdinWithTimeout(), recordReleasePush()

### Community 90 - "core"
Cohesion: 0.67
Nodes (4): diffSkillSets(), loadSkillSlugs(), main(), parseCatalogSlugs()

### Community 91 - "testing"
Cohesion: 0.6
Nodes (5): applyStubGate(), cannedPath(), main(), retireRoadmapEntry(), slugFromPrompt()

### Community 92 - "sync"
Cohesion: 0.67
Nodes (4): extractSpecSlug(), collectTaggedSpecs(), main(), updateFeatureMd()

### Community 93 - "garden/detectors"
Cohesion: 0.53
Nodes (3): collectTargets(), detectFdLinkRot(), isCheckablePath()

### Community 95 - "features"
Cohesion: 0.6
Nodes (4): extractLegacyBlock(), findLineStartingWith(), main(), migrateFd()

### Community 97 - "release"
Cohesion: 0.53
Nodes (4): ensureGraphFresh(), latestCommitTs(), commit(), exec()

### Community 98 - "docs"
Cohesion: 0.6
Nodes (4): loadExamples(), main(), processTutorialDir(), transcludeMarkers()

### Community 99 - "docs"
Cohesion: 0.6
Nodes (4): addGeneratedHeader(), annotateAll(), main(), walkMd()

### Community 100 - "core"
Cohesion: 0.7
Nodes (3): collectFiles(), main(), renamePlanOnlyTier()

### Community 101 - "core"
Cohesion: 0.7
Nodes (3): collectFiles(), main(), prefixSkills()

### Community 103 - "checks"
Cohesion: 0.7
Nodes (3): loadKnownSlugs(), main(), validateFeatureSlugScope()

## Knowledge Gaps
- **2 isolated node(s):** `UsageError`, `UsageError`
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `loadDocRoots()` connect `garden` to `prep`, `cr`, `dashboard`, `utils`, `core`, `triage`, `graphify`, `dashboard`, `features`, `autonomous/__tests__`, `garden`, `garden`, `triage`, `core`, `garden/detectors`, `garden`, `core`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Why does `loadConsumerConfig()` connect `migrations` to `prep`, `hooks`, `features`, `dashboard`, `dashboard`, `clones`, `invariants`, `features`, `garden`, `garden`, `release`, `garden`, `testing`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Why does `parseBacklog()` connect `utils` to `triage`, `triage`, `dashboard`, `garden/detectors`, `core`, `autonomous/__tests__`, `garden`, `garden`, `triage`, `dashboard/api`, `core`, `dashboard`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Are the 31 inferred relationships involving `loadDocRoots()` (e.g. with `run()` and `listSpecFiles()`) actually correct?**
  _`loadDocRoots()` has 31 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `loadConsumerConfig()` (e.g. with `scanRoots()` and `resolveGardenScanPaths()`) actually correct?**
  _`loadConsumerConfig()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 18 inferred relationships involving `detectAll()` (e.g. with `detectTierMismatch()` and `detectAllowlistDrift()`) actually correct?**
  _`detectAll()` has 18 INFERRED edges - model-reasoned connections that need verification._
- **Are the 23 inferred relationships involving `escapeHtml()` (e.g. with `walkTokens()` and `renderChipRow()`) actually correct?**
  _`escapeHtml()` has 23 INFERRED edges - model-reasoned connections that need verification._