# Graph Report - .  (2026-07-11)

## Corpus Check
- Large corpus: 782 files · ~702,522 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 1905 nodes · 4651 edges · 117 communities (106 shown, 11 thin omitted)
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 490 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Garden  SDD Report|Garden / SDD Report]]
- [[_COMMUNITY_Triage|Triage]]
- [[_COMMUNITY_Git Hooks|Git Hooks]]
- [[_COMMUNITY_Features|Features]]
- [[_COMMUNITY_Worktrees|Worktrees]]
- [[_COMMUNITY_Release Pipeline|Release Pipeline]]
- [[_COMMUNITY_Metrics|Metrics]]
- [[_COMMUNITY_Dashboard|Dashboard]]
- [[_COMMUNITY_Invariants|Invariants]]
- [[_COMMUNITY_Dashboard (2)|Dashboard (2)]]
- [[_COMMUNITY_Dashboard (3)|Dashboard (3)]]
- [[_COMMUNITY_Rules|Rules]]
- [[_COMMUNITY_Code Review|Code Review]]
- [[_COMMUNITY_Autonomous Drain|Autonomous Drain]]
- [[_COMMUNITY_Research Fanout|Research Fanout]]
- [[_COMMUNITY_Prep Pipeline|Prep Pipeline]]
- [[_COMMUNITY_Garden  SDD Report (2)|Garden / SDD Report (2)]]
- [[_COMMUNITY_Milestones|Milestones]]
- [[_COMMUNITY_Dashboard (4)|Dashboard (4)]]
- [[_COMMUNITY_Core Runtime|Core Runtime]]
- [[_COMMUNITY_Autonomous Drain (2)|Autonomous Drain (2)]]
- [[_COMMUNITY_Dashboard (5)|Dashboard (5)]]
- [[_COMMUNITY_Prep Pipeline (2)|Prep Pipeline (2)]]
- [[_COMMUNITY_Code Review (2)|Code Review (2)]]
- [[_COMMUNITY_Code Review (3)|Code Review (3)]]
- [[_COMMUNITY_Code Review (4)|Code Review (4)]]
- [[_COMMUNITY_Code Review (5)|Code Review (5)]]
- [[_COMMUNITY_Dashboard (6)|Dashboard (6)]]
- [[_COMMUNITY_Autonomous Drain (3)|Autonomous Drain (3)]]
- [[_COMMUNITY_Autonomous Drain (4)|Autonomous Drain (4)]]
- [[_COMMUNITY_Core Runtime (2)|Core Runtime (2)]]
- [[_COMMUNITY_Migrations|Migrations]]
- [[_COMMUNITY_Autonomous Drain (5)|Autonomous Drain (5)]]
- [[_COMMUNITY_Graphify Integration|Graphify Integration]]
- [[_COMMUNITY_Prep Pipeline (3)|Prep Pipeline (3)]]
- [[_COMMUNITY_Core Runtime (3)|Core Runtime (3)]]
- [[_COMMUNITY_Graphify Integration (2)|Graphify Integration (2)]]
- [[_COMMUNITY_Release Pipeline (2)|Release Pipeline (2)]]
- [[_COMMUNITY_Release Pipeline (3)|Release Pipeline (3)]]
- [[_COMMUNITY_Release Pipeline (4)|Release Pipeline (4)]]
- [[_COMMUNITY_Templates|Templates]]
- [[_COMMUNITY_Autonomous Drain (6)|Autonomous Drain (6)]]
- [[_COMMUNITY_Core Runtime (4)|Core Runtime (4)]]
- [[_COMMUNITY_Code Review (6)|Code Review (6)]]
- [[_COMMUNITY_Release Pipeline (5)|Release Pipeline (5)]]
- [[_COMMUNITY_Core Runtime (5)|Core Runtime (5)]]
- [[_COMMUNITY_Verify|Verify]]
- [[_COMMUNITY_Code Review (7)|Code Review (7)]]
- [[_COMMUNITY_Core Runtime (6)|Core Runtime (6)]]
- [[_COMMUNITY_Garden  SDD Report (3)|Garden / SDD Report (3)]]
- [[_COMMUNITY_Doc Sync|Doc Sync]]
- [[_COMMUNITY_Dashboard (7)|Dashboard (7)]]
- [[_COMMUNITY_Core Runtime (7)|Core Runtime (7)]]
- [[_COMMUNITY_Garden  SDD Report (4)|Garden / SDD Report (4)]]
- [[_COMMUNITY_Testing|Testing]]
- [[_COMMUNITY_Core Runtime (8)|Core Runtime (8)]]
- [[_COMMUNITY_Code Review (8)|Code Review (8)]]
- [[_COMMUNITY_Autonomous Drain (7)|Autonomous Drain (7)]]
- [[_COMMUNITY_Autonomous Drain (8)|Autonomous Drain (8)]]
- [[_COMMUNITY_Garden  SDD Report (5)|Garden / SDD Report (5)]]
- [[_COMMUNITY_Dashboard (8)|Dashboard (8)]]
- [[_COMMUNITY_Core Runtime (9)|Core Runtime (9)]]
- [[_COMMUNITY_Garden  SDD Report (6)|Garden / SDD Report (6)]]
- [[_COMMUNITY_Docs|Docs]]
- [[_COMMUNITY_Cli|Cli]]
- [[_COMMUNITY_Doc Sync (2)|Doc Sync (2)]]
- [[_COMMUNITY_Garden  SDD Report (7)|Garden / SDD Report (7)]]
- [[_COMMUNITY_Garden  SDD Report (8)|Garden / SDD Report (8)]]
- [[_COMMUNITY_Dashboard (9)|Dashboard (9)]]
- [[_COMMUNITY_Dashboard (10)|Dashboard (10)]]
- [[_COMMUNITY_Features (2)|Features (2)]]
- [[_COMMUNITY_Features (3)|Features (3)]]
- [[_COMMUNITY_Dashboard (11)|Dashboard (11)]]
- [[_COMMUNITY_Code Review (9)|Code Review (9)]]
- [[_COMMUNITY_Core Runtime (10)|Core Runtime (10)]]
- [[_COMMUNITY_Core Runtime (11)|Core Runtime (11)]]
- [[_COMMUNITY_Core Runtime (12)|Core Runtime (12)]]
- [[_COMMUNITY_Release Pipeline (6)|Release Pipeline (6)]]
- [[_COMMUNITY_Release Pipeline (7)|Release Pipeline (7)]]
- [[_COMMUNITY_Dashboard (12)|Dashboard (12)]]
- [[_COMMUNITY_Dashboard (13)|Dashboard (13)]]
- [[_COMMUNITY_Dashboard (14)|Dashboard (14)]]
- [[_COMMUNITY_Git Hooks (2)|Git Hooks (2)]]
- [[_COMMUNITY_Core Runtime (13)|Core Runtime (13)]]
- [[_COMMUNITY_Core Runtime (14)|Core Runtime (14)]]
- [[_COMMUNITY_Core Runtime (15)|Core Runtime (15)]]
- [[_COMMUNITY_Features (4)|Features (4)]]
- [[_COMMUNITY_Core Runtime (16)|Core Runtime (16)]]
- [[_COMMUNITY_Release Pipeline (8)|Release Pipeline (8)]]
- [[_COMMUNITY_Docs (2)|Docs (2)]]
- [[_COMMUNITY_Docs (3)|Docs (3)]]
- [[_COMMUNITY_Dashboard (15)|Dashboard (15)]]
- [[_COMMUNITY_Testing (2)|Testing (2)]]
- [[_COMMUNITY_Prep Pipeline (4)|Prep Pipeline (4)]]
- [[_COMMUNITY_Core Runtime (17)|Core Runtime (17)]]
- [[_COMMUNITY_Core Runtime (18)|Core Runtime (18)]]
- [[_COMMUNITY_Checks|Checks]]
- [[_COMMUNITY_Git Hooks (3)|Git Hooks (3)]]
- [[_COMMUNITY_Core Runtime (19)|Core Runtime (19)]]
- [[_COMMUNITY_Garden  SDD Report (9)|Garden / SDD Report (9)]]
- [[_COMMUNITY_Checks (2)|Checks (2)]]
- [[_COMMUNITY_Release Pipeline (9)|Release Pipeline (9)]]
- [[_COMMUNITY_Worktrees (2)|Worktrees (2)]]
- [[_COMMUNITY_Garden  SDD Report (10)|Garden / SDD Report (10)]]

## God Nodes (most connected - your core abstractions)
1. `loadDocRoots()` - 50 edges
2. `loadConsumerConfig()` - 33 edges
3. `detectAll()` - 26 edges
4. `main()` - 26 edges
5. `parseBacklog()` - 24 edges
6. `escapeHtml()` - 19 edges
7. `readRolloutMarker()` - 18 edges
8. `spawnAgent()` - 18 edges
9. `collectGaps()` - 18 edges
10. `main()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `parseAgents()` --calls--> `loadAgentsConfig()`  [INFERRED]
  src/cli/commands/init.ts → src/core/agent-runner/registry.ts
- `main()` --calls--> `withReleaseSession()`  [INFERRED]
  src/release/index.ts → src/release/release-session.ts
- `main()` --calls--> `compute()`  [INFERRED]
  src/garden/sdd-report.ts → src/metrics/compute.ts
- `loadMetricsReport()` --calls--> `compute()`  [INFERRED]
  src/dashboard/data.ts → src/metrics/compute.ts
- `recoverIntake()` --calls--> `slugify()`  [INFERRED]
  src/metrics/facts.ts → src/utils/slugify.ts

## Communities (117 total, 11 thin omitted)

### Community 0 - "Garden / SDD Report"
Cohesion: 0.05
Nodes (75): compareSemver(), extractPlanSlug(), extractSpecSlug(), extractSummary(), isInfraFile(), isLinkEnforced(), listPlans(), listSpecs() (+67 more)

### Community 1 - "Triage"
Cohesion: 0.05
Nodes (55): findMilestoneMatch(), formatEntry(), getSuggestions(), getTopPriorityNext(), isWritePendingDeprecated(), loadInProgressFds(), loadMilestoneGate(), main() (+47 more)

### Community 2 - "Git Hooks"
Cohesion: 0.05
Nodes (41): isMicroChoreAllowed(), isReleaseSweepAllowed(), appendOverrideLog(), ensureRolloutMarker(), isPostRollout(), readRolloutMarker(), clearSession(), isSessionStale() (+33 more)

### Community 3 - "Features"
Cohesion: 0.06
Nodes (48): isDirty(), loadConfigTolerant(), main(), parseFrom(), runUpgrade(), loadCategories(), loadConsumerConfig(), loadDevConfig() (+40 more)

### Community 4 - "Worktrees"
Cohesion: 0.07
Nodes (35): createWorktree(), main(), parseArgs(), bootDevSurfaces(), buildLaunchCommand(), escapeShell(), launchTree(), main() (+27 more)

### Community 5 - "Release Pipeline"
Cohesion: 0.08
Nodes (31): prsSinceLastTag(), buildPrompt(), joinSubjectsDeterministic(), polishSummary(), runAgentPolish(), extractUnreleasedSummary(), generateFdChangelogs(), prependChangelogBlock() (+23 more)

### Community 6 - "Metrics"
Cohesion: 0.09
Nodes (29): collectCrEffectiveness(), collectCycleTime(), percentile(), collectDrainReliability(), collectOverridePressure(), releaseWindow(), renderMetricsSection(), reviewSkipCountLine() (+21 more)

### Community 7 - "Dashboard"
Cohesion: 0.1
Nodes (31): getBacklogPath(), getRoadmapPath(), loadAgentActivity(), loadGaps(), loadMetricsReport(), loadWatchLogTail(), loadWorktreeHealth(), setDocRootsOverride() (+23 more)

### Community 8 - "Invariants"
Cohesion: 0.09
Nodes (12): formatResults(), formatViolationLine(), printResults(), runAll(), warningBlock(), makeBoundariesInvariant(), formatInvariantError(), makeInvariants() (+4 more)

### Community 9 - "Dashboard (2)"
Cohesion: 0.1
Nodes (27): countMatching(), countScriptFiles(), getDocRoot(), getFeaturesDir(), getNoldorDir(), getReleaseNotesPath(), getScriptsDir(), getSkillsDir() (+19 more)

### Community 10 - "Dashboard (3)"
Cohesion: 0.11
Nodes (21): walkTokens(), escapeHtml(), handleFeatureDetail(), ageBucket(), plainTextPreview(), renderAddEntryForm(), renderAgents(), renderBacklog() (+13 more)

### Community 11 - "Rules"
Cohesion: 0.11
Nodes (11): runList(), runResolve(), runValidate(), main(), main(), dirStamp(), getRules(), loadRulesFromDir() (+3 more)

### Community 12 - "Code Review"
Cohesion: 0.13
Nodes (19): parseCliArgs(), filenameSelector(), hashPaths(), isGateLane(), printFindings(), readFeatureMd(), readIfExists(), readSession() (+11 more)

### Community 13 - "Autonomous Drain"
Cohesion: 0.1
Nodes (10): resolveRunner(), isDrainEligible(), decideNext(), implementerDispatch(), plansSource(), roadmapSource(), specsSource(), buildDrainGatePrompt() (+2 more)

### Community 14 - "Research Fanout"
Cohesion: 0.15
Nodes (16): runWithConcurrency(), gitStatusPorcelain(), intArg(), loadTasks(), main(), parseArgs(), run(), strArg() (+8 more)

### Community 15 - "Prep Pipeline"
Cohesion: 0.16
Nodes (17): discoverPrepEntries(), listFdSlugs(), listSpecFiles(), buildDraftPrompt(), renderIndex(), intArg(), main(), parseArgs() (+9 more)

### Community 16 - "Garden / SDD Report (2)"
Cohesion: 0.14
Nodes (18): detectAllowlistDrift(), detectPlanWithoutFd(), planSlug(), detectTierMismatch(), detectAll(), detectContradictions(), detectGateCompliance(), detectInvariants() (+10 more)

### Community 17 - "Milestones"
Cohesion: 0.14
Nodes (12): detectMilestoneShippedIncomplete(), activateMilestone(), draftMilestone(), listMilestones(), loadMilestoneBySlug(), loadMilestones(), preflightActivate(), readMilestone() (+4 more)

### Community 18 - "Dashboard (4)"
Cohesion: 0.23
Nodes (19): atomicWriteFile(), buildRoadmapBlock(), crossSection(), handleAdd(), handleDemote(), handleMove(), handlePromote(), handleRemove() (+11 more)

### Community 19 - "Core Runtime"
Cohesion: 0.17
Nodes (12): extractArtifactLinks(), fixArtifactLink(), indexSrcByBasename(), main(), migrateOne(), rewriteScriptsPaths(), walk(), claudeProjectDirName() (+4 more)

### Community 20 - "Autonomous Drain (2)"
Cohesion: 0.15
Nodes (15): assertQueueSourceSynced(), assertQueueSourceSyncedAt(), classifyMergeView(), mergedPrExistsFor(), mergePr(), openPrExistsFor(), spawnGate(), syncMainCleanState() (+7 more)

### Community 21 - "Dashboard (5)"
Cohesion: 0.15
Nodes (19): featureSlugsForCodePath(), loadBacklog(), loadBacklogWithHash(), loadHotZones(), loadRoadmapWithHash(), loadVelocity(), parseBacklogFromString(), parseRoadmap() (+11 more)

### Community 22 - "Prep Pipeline (2)"
Cohesion: 0.22
Nodes (15): finishRun(), gh(), git(), main(), parseArgs(), preflight(), promoteExitCode(), promoteOne() (+7 more)

### Community 23 - "Code Review (2)"
Cohesion: 0.2
Nodes (13): basePayload(), commitProse(), buildVerifyPrompt(), dispatcher(), dispatchVerify(), parseVerifyVerdict(), setVerifyDispatcher(), mkFinding() (+5 more)

### Community 24 - "Code Review (3)"
Cohesion: 0.19
Nodes (8): amendSubagentReceipt(), parseArgs(), execAsync(), guardLaneOverwrite(), isEmptyDiffDefault(), resolveLanes(), run(), writeSyntheticOk()

### Community 25 - "Code Review (4)"
Cohesion: 0.22
Nodes (8): promptSelect(), promptText(), writeJsonAtomic(), codexSupportsBaseSha(), exec(), extractLaneJson(), runCodex(), runManual()

### Community 26 - "Code Review (5)"
Cohesion: 0.2
Nodes (8): extractFdAcceptance(), readFdSummary(), buildPrompt(), dispatcher(), dispatchSubagent(), setDispatcher(), parseSubagentMarkdown(), runSubagent()

### Community 27 - "Dashboard (6)"
Cohesion: 0.14
Nodes (7): edgeScrollVelocity(), init(), shouldInsertBefore(), wireAddForms(), wireButtons(), wireDescriptionOverflow(), wireDescriptionToggles()

### Community 28 - "Autonomous Drain (3)"
Cohesion: 0.18
Nodes (11): groupKillState(), notify(), dayKeyOf(), interruptibleSleep(), intFlag(), parseWatchArgs(), resolve130(), sleep() (+3 more)

### Community 29 - "Autonomous Drain (4)"
Cohesion: 0.22
Nodes (12): appendJsonl(), applyCycleVerdict(), loadPark(), mapCycle(), parkKey(), readInboxRows(), savePark(), unparkSlug() (+4 more)

### Community 30 - "Core Runtime (2)"
Cohesion: 0.25
Nodes (12): checkRedundantDelivery(), composeBody(), composeTitle(), GhPreflightError, mergePrWithFallback(), MergeTimeoutError, openAndAutoMerge(), pollAutoMerge() (+4 more)

### Community 31 - "Migrations"
Cohesion: 0.2
Nodes (8): parseAgents(), ensureGitignoreBlock(), computeSteps(), isNoldorVendoredSkill(), syncFiles(), templatesUnder(), adoptTemplate(), copyTemplate()

### Community 32 - "Autonomous Drain (5)"
Cohesion: 0.18
Nodes (6): diffPhases(), makePhaseTap(), detectStale(), repair(), resolveRoadmapConflict(), appendAgentEvent()

### Community 33 - "Graphify Integration"
Cohesion: 0.28
Nodes (16): buildIdToLabel(), buildNodeCommunityMap(), classifyEdges(), deriveCommunityLabel(), deriveCommunityLabels(), extractConceptsAndRationales(), extractPackages(), formatCrossEdgeLine() (+8 more)

### Community 34 - "Prep Pipeline (3)"
Cohesion: 0.28
Nodes (10): loadAreaCategories(), extractTouches(), looksLikePath(), normalizePath(), areaToCategory(), getSectionBody(), liftSpecSections(), replaceSectionBody() (+2 more)

### Community 35 - "Core Runtime (3)"
Cohesion: 0.28
Nodes (11): formatEmit(), main(), parseWaitArgs(), UsageError, evalPredicate(), getPath(), parsePredicate(), PredicateParseError (+3 more)

### Community 36 - "Graphify Integration (2)"
Cohesion: 0.19
Nodes (10): planSlugFromFilename(), asArray(), docNodeId(), enrichDocNodes(), enrichGraph(), loadDocDir(), loadFds(), main() (+2 more)

### Community 37 - "Release Pipeline (2)"
Cohesion: 0.2
Nodes (9): fillAllNoldorMarkers(), fillNoldorMarker(), ensureGhAvailable(), main(), run(), runCheck(), runCliCheck(), runOptionalCheck() (+1 more)

### Community 38 - "Release Pipeline (3)"
Cohesion: 0.22
Nodes (10): assertNoInProgressRelease(), extractLatestReleaseNotes(), resumeRelease(), clearReleaseState(), readReleaseState(), writeReleaseState(), addBareOrigin(), call() (+2 more)

### Community 39 - "Release Pipeline (4)"
Cohesion: 0.24
Nodes (10): ensureCleanTreeOnMain(), git(), awaitPublish(), cliMain(), envTuning(), isRegistryAuthError(), isVersionOnRegistry(), publishLocal() (+2 more)

### Community 40 - "Templates"
Cohesion: 0.27
Nodes (7): loadAgentsConfig(), checkTemplateSync(), main(), resolveChangedFiles(), filterTemplatesByAgents(), computeDrift(), templateFiles()

### Community 41 - "Autonomous Drain (6)"
Cohesion: 0.31
Nodes (14): releaseLock(), runDrain(), formatReconcile(), makeReconcileDeps(), reportIsEmpty(), parkAwareSource(), assertConfig(), intFlag() (+6 more)

### Community 42 - "Core Runtime (4)"
Cohesion: 0.27
Nodes (12): admitsLiteralHyphen(), extractFencedBlocks(), findMessageFlag(), formatFindingHuman(), isCloseFence(), isGitCommitLine(), lineContainsFlag(), lintSnippets() (+4 more)

### Community 43 - "Code Review (6)"
Cohesion: 0.27
Nodes (9): claudeSupportsMaxThinking(), execAsync(), osascriptSpawn(), runStandalone(), templateSha(), main(), escalate(), spawnDeepReview() (+1 more)

### Community 44 - "Release Pipeline (5)"
Cohesion: 0.22
Nodes (8): prependToChangelog(), renderChangelogEntry(), renderCommit(), classifyCommit(), classifyCommits(), deriveBumpLevel(), readCommitsSince(), refExists()

### Community 45 - "Core Runtime (5)"
Cohesion: 0.22
Nodes (6): checkRunners(), compareDotted(), referencedRunners(), checkBinaryPrerequisites(), checkConsumerScripts(), makeDefaultProbe()

### Community 46 - "Verify"
Cohesion: 0.26
Nodes (5): waitForHttp200(), resolvePort(), probeServer(), runShell(), runSmoke()

### Community 47 - "Code Review (7)"
Cohesion: 0.25
Nodes (5): aggregate(), main(), parseArgs(), templateShaFor(), inferLaneFromFilename()

### Community 48 - "Core Runtime (6)"
Cohesion: 0.31
Nodes (10): clearMicroChoreSession(), discoverAddedFiles(), execGit(), loadFdSummary(), nodeSpawn(), normalizeRepoUrl(), parseCrTrailersFromLog(), pickMostRecentByDatePrefix() (+2 more)

### Community 49 - "Garden / SDD Report (3)"
Cohesion: 0.24
Nodes (5): isBootstrapReason(), declaredGateKeys(), detectBootstrapOverrideAudit(), gateForTrailer(), auditCodexCrOverrides()

### Community 50 - "Doc Sync"
Cohesion: 0.29
Nodes (9): detectCodeLinksDrift(), buildSlugToCodeMap(), collectTaggedCode(), diffProjection(), extractFdTags(), loadCachedCode(), main(), updateFeatureMd() (+1 more)

### Community 51 - "Dashboard (7)"
Cohesion: 0.23
Nodes (13): loadFrameworkPage(), loadFrameworkPages(), loadUserDoc(), loadUserDocs(), rewriteDocLinks(), handleFrameworkIndex(), handleFrameworkPage(), handleUserDoc() (+5 more)

### Community 52 - "Core Runtime (7)"
Cohesion: 0.31
Nodes (6): planSpawn(), spawnAgent(), spawnClaude(), buildClaudeArgv(), buildOpencodeArgv(), buildStubArgv()

### Community 53 - "Garden / SDD Report (4)"
Cohesion: 0.31
Nodes (8): ensureGardenFresh(), evaluateGardenFreshness(), main(), readGardenReceipt(), resolveGardenScanPaths(), writeGardenReceipt(), autoStampOnCleanDetect(), defaultStamp()

### Community 54 - "Testing"
Cohesion: 0.29
Nodes (9): verifyTarball(), buildConsumerFixture(), CONSUMER_CONFIG(), ROADMAP(), installFrameworkTarball(), repoRoot(), runConsumerCli(), runContractChecks() (+1 more)

### Community 55 - "Core Runtime (8)"
Cohesion: 0.31
Nodes (11): applySiblingTrailer(), buildSiblingTrailerValue(), buildSuggestion(), headHasNoldorPages(), loadKnownSlugs(), loadScaffoldSlugs(), loadStagedFiles(), main() (+3 more)

### Community 56 - "Code Review (8)"
Cohesion: 0.32
Nodes (9): flag(), runBootstrapCli(), injectBootstrapOverrides(), resolveIntroducedGate(), gateEntry(), git(), makeRepo(), treesOf() (+1 more)

### Community 57 - "Autonomous Drain (7)"
Cohesion: 0.32
Nodes (6): projectDrainState(), readState(), writeState(), collectStatus(), formatStatus(), main()

### Community 58 - "Autonomous Drain (8)"
Cohesion: 0.35
Nodes (7): acquireLock(), isAlive(), liveLockPid(), binPathFrom(), detachChildArgv(), detachWatch(), stripDetach()

### Community 59 - "Garden / SDD Report (5)"
Cohesion: 0.42
Nodes (8): loadDocRoots(), detectStalePlans(), detectStaleSpecs(), loadFeatureBySlug(), resolveByGraphAdjacency(), resolveByLinksPlan(), resolveByLinksSpec(), scanFdsForOwner()

### Community 60 - "Dashboard (8)"
Cohesion: 0.22
Nodes (11): loadActiveMilestone(), loadFeatures(), loadVision(), loadWipAge(), handleFeatures(), handleOverview(), handleVision(), handleWipAge() (+3 more)

### Community 61 - "Core Runtime (9)"
Cohesion: 0.4
Nodes (5): defaultRunner(), main(), resolveOxfmt(), decideFmtGuard(), isNoTargetFailure()

### Community 62 - "Garden / SDD Report (6)"
Cohesion: 0.27
Nodes (3): detectFdWithoutPlan(), findCreationSha(), hasPlan()

### Community 63 - "Docs"
Cohesion: 0.42
Nodes (8): checkLinks(), extractHeadings(), extractLinks(), fileExists(), main(), slugifyHeading(), stripCodeRegions(), walkMd()

### Community 64 - "Cli"
Cohesion: 0.38
Nodes (5): printHelp(), dispatch(), isHelpFlag(), main(), installedFrameworkVersion()

### Community 65 - "Doc Sync (2)"
Cohesion: 0.4
Nodes (6): appendList(), applyBlock(), buildResourcesBlock(), main(), resolveSpecPath(), syncFile()

### Community 66 - "Garden / SDD Report (7)"
Cohesion: 0.31
Nodes (3): collectTargets(), detectFdLinkRot(), isCheckablePath()

### Community 67 - "Garden / SDD Report (8)"
Cohesion: 0.33
Nodes (4): noldorCliCommand(), loadSddGaps(), extractJsonLine(), runGardenDetectViaCli()

### Community 68 - "Dashboard (9)"
Cohesion: 0.36
Nodes (5): renderLayout(), handleReleaseNotes(), renderReleaseNotes(), shell(), shell()

### Community 69 - "Dashboard (10)"
Cohesion: 0.42
Nodes (6): ensureDashboard(), isDashboardUp(), main(), resolveMainRoot(), sleep(), spawnDetachedServer()

### Community 70 - "Features (2)"
Cohesion: 0.54
Nodes (6): areaFromPackage(), inferTier(), main(), walkFeaturesDir(), yamlToBacklogBlock(), yamlToFeatureMd()

### Community 71 - "Features (3)"
Cohesion: 0.43
Nodes (5): main(), migrateChangelogContent(), migrateFeaturesDir(), parseChangelogSection(), renderSection()

### Community 72 - "Dashboard (11)"
Cohesion: 0.46
Nodes (6): emptyRow(), formatRuntime(), poll(), renderInbox(), renderLive(), setCount()

### Community 73 - "Code Review (9)"
Cohesion: 0.46
Nodes (5): formatArtifactPrompt(), formatPrompt(), runCodex(), synthBlocker(), buildCodexArgv()

### Community 74 - "Core Runtime (10)"
Cohesion: 0.62
Nodes (4): collectRoutingAccuracy(), sizeSkipsSpec(), sizeToPath(), sizeToTier()

### Community 75 - "Core Runtime (11)"
Cohesion: 0.57
Nodes (5): filterCommitsForPage(), listPageSlugs(), loadCommits(), main(), parseScope()

### Community 76 - "Core Runtime (12)"
Cohesion: 0.52
Nodes (4): loadConfig(), resolveReviewProfile(), resolveSessionTtlHours(), main()

### Community 77 - "Release Pipeline (6)"
Cohesion: 0.48
Nodes (3): fillAllMarkers(), fillMarkers(), main()

### Community 78 - "Release Pipeline (7)"
Cohesion: 0.48
Nodes (5): collectFeaturesForRelease(), extractChangelogSummary(), extractFirstParagraph(), prependToReleaseNotes(), renderReleaseNotesEntry()

### Community 79 - "Dashboard (12)"
Cohesion: 0.33
Nodes (4): buildMilestoneGroups(), loadMilestoneGroups(), handleMilestones(), renderMilestones()

### Community 80 - "Dashboard (13)"
Cohesion: 0.43
Nodes (6): graphReportSection(), loadGraphHealth(), parseDeadExports(), parseGraphReport(), handleGraphHealth(), renderGraphHealth()

### Community 81 - "Dashboard (14)"
Cohesion: 0.43
Nodes (6): loadSkill(), loadSkills(), handleSkillPage(), handleSkillsIndex(), renderSkillPage(), renderSkillsIndex()

### Community 82 - "Git Hooks (2)"
Cohesion: 0.62
Nodes (5): evaluatePrePush(), main(), pushesMain(), readStdinWithTimeout(), recordReleasePush()

### Community 84 - "Core Runtime (14)"
Cohesion: 0.67
Nodes (4): diffSkillSets(), loadSkillSlugs(), main(), parseCatalogSlugs()

### Community 86 - "Features (4)"
Cohesion: 0.6
Nodes (4): extractLegacyBlock(), findLineStartingWith(), main(), migrateFd()

### Community 88 - "Release Pipeline (8)"
Cohesion: 0.53
Nodes (4): ensureGraphFresh(), latestCommitTs(), commit(), exec()

### Community 89 - "Docs (2)"
Cohesion: 0.6
Nodes (4): addGeneratedHeader(), annotateAll(), main(), walkMd()

### Community 90 - "Docs (3)"
Cohesion: 0.6
Nodes (4): loadExamples(), main(), processTutorialDir(), transcludeMarkers()

### Community 91 - "Dashboard (15)"
Cohesion: 0.53
Nodes (5): countTestCases(), isTestPath(), loadTestPyramid(), handleTestPyramid(), renderTestPyramid()

### Community 92 - "Testing (2)"
Cohesion: 0.6
Nodes (5): applyStubGate(), cannedPath(), main(), retireRoadmapEntry(), slugFromPrompt()

### Community 94 - "Core Runtime (17)"
Cohesion: 0.7
Nodes (3): collectFiles(), main(), renamePlanOnlyTier()

### Community 95 - "Core Runtime (18)"
Cohesion: 0.7
Nodes (3): collectFiles(), main(), prefixSkills()

### Community 96 - "Checks"
Cohesion: 0.7
Nodes (3): loadKnownSlugs(), main(), validateFeatureSlugScope()

## Knowledge Gaps
- **1 isolated node(s):** `UsageError`
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `loadDocRoots()` connect `Garden / SDD Report (5)` to `Garden / SDD Report`, `Triage`, `Features`, `Graphify Integration (2)`, `Dashboard`, `Dashboard (2)`, `Autonomous Drain`, `Prep Pipeline`, `Garden / SDD Report (2)`, `Garden / SDD Report (3)`, `Prep Pipeline (2)`, `Code Review (8)`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Why does `loadConsumerConfig()` connect `Features` to `Garden / SDD Report`, `Prep Pipeline (3)`, `Git Hooks`, `Release Pipeline (2)`, `Invariants`, `Dashboard (2)`, `Dashboard (3)`, `Garden / SDD Report (4)`, `Testing`, `Dashboard (15)`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `parseRoadmap()` connect `Triage` to `Dashboard (2)`, `Autonomous Drain`, `Prep Pipeline`, `Dashboard (4)`, `Prep Pipeline (2)`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Are the 30 inferred relationships involving `loadDocRoots()` (e.g. with `run()` and `listSpecFiles()`) actually correct?**
  _`loadDocRoots()` has 30 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `loadConsumerConfig()` (e.g. with `scanRoots()` and `resolveGardenScanPaths()`) actually correct?**
  _`loadConsumerConfig()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 16 inferred relationships involving `detectAll()` (e.g. with `detectTierMismatch()` and `detectAllowlistDrift()`) actually correct?**
  _`detectAll()` has 16 INFERRED edges - model-reasoned connections that need verification._
- **Are the 21 inferred relationships involving `main()` (e.g. with `loadConfigSync()` and `assertConfig()`) actually correct?**
  _`main()` has 21 INFERRED edges - model-reasoned connections that need verification._