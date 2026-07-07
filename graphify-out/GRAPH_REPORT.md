# Graph Report - src  (2026-07-07)

## Corpus Check
- Large corpus: 551 files · ~288,836 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 1855 nodes · 4560 edges · 120 communities (107 shown, 13 thin omitted)
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 483 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 99|Community 99]]
- [[_COMMUNITY_Community 100|Community 100]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 103|Community 103]]
- [[_COMMUNITY_Community 104|Community 104]]
- [[_COMMUNITY_Community 105|Community 105]]
- [[_COMMUNITY_Community 106|Community 106]]
- [[_COMMUNITY_Community 107|Community 107]]
- [[_COMMUNITY_Community 109|Community 109]]
- [[_COMMUNITY_Community 110|Community 110]]
- [[_COMMUNITY_Community 111|Community 111]]
- [[_COMMUNITY_Community 112|Community 112]]
- [[_COMMUNITY_Community 113|Community 113]]

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
- `main()` --calls--> `compute()`  [INFERRED]
  garden/sdd-report.ts → metrics/compute.ts
- `loadMetricsReport()` --calls--> `compute()`  [INFERRED]
  dashboard/data.ts → metrics/compute.ts
- `recoverIntake()` --calls--> `slugify()`  [INFERRED]
  metrics/facts.ts → utils/slugify.ts
- `main()` --calls--> `installedFrameworkVersion()`  [INFERRED]
  cli/commands/upgrade.ts → migrations/pkg-version.ts
- `main()` --calls--> `loadConfig()`  [INFERRED]
  validate/noldor-config.ts → core/config.ts

## Communities (120 total, 13 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (75): compareSemver(), extractPlanSlug(), extractSpecSlug(), extractSummary(), isInfraFile(), isLinkEnforced(), listPlans(), listSpecs() (+67 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (49): isDirty(), loadConfigTolerant(), main(), parseFrom(), runUpgrade(), loadCategories(), loadConsumerConfig(), loadDevConfig() (+41 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (27): createWorktree(), main(), parseArgs(), bootDevSurfaces(), openEditor(), main(), parseArgs(), upWorktree() (+19 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (29): buildPrompt(), joinSubjectsDeterministic(), polishSummary(), runAgentPolish(), extractUnreleasedSummary(), generateFdChangelogs(), prependChangelogBlock(), renderInitialReleaseBlock() (+21 more)

### Community 4 - "Community 4"
Cohesion: 0.09
Nodes (28): collectCrEffectiveness(), collectCycleTime(), percentile(), collectDrainReliability(), collectOverridePressure(), releaseWindow(), renderMetricsSection(), reviewSkipCountLine() (+20 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (30): getDocRoot(), getNoldorDir(), getReleaseNotesPath(), getScriptsDir(), getVisionPath(), graphReportSection(), listVersionTags(), loadFdChangelog() (+22 more)

### Community 6 - "Community 6"
Cohesion: 0.1
Nodes (32): getBacklogPath(), getRoadmapPath(), loadActiveMilestone(), loadAgentActivity(), loadGaps(), loadWatchLogTail(), loadWorktreeHealth(), setDocRootsOverride() (+24 more)

### Community 7 - "Community 7"
Cohesion: 0.1
Nodes (25): walkTokens(), escapeHtml(), handleFeatureDetail(), handleVelocity(), handleWipAge(), ageBucket(), plainTextPreview(), renderAddEntryForm() (+17 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (23): parseCliArgs(), filenameSelector(), hashPaths(), isGateLane(), printFindings(), readFeatureMd(), readIfExists(), readSession() (+15 more)

### Community 9 - "Community 9"
Cohesion: 0.11
Nodes (11): runList(), runResolve(), runValidate(), main(), main(), dirStamp(), getRules(), loadRulesFromDir() (+3 more)

### Community 10 - "Community 10"
Cohesion: 0.14
Nodes (24): detectAllowlistDrift(), auditCodexCrOverrides(), auditOverrides(), detectPlanWithoutFd(), planSlug(), detectAll(), detectContradictions(), detectGateCompliance() (+16 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (29): countMatching(), countScriptFiles(), featureSlugsForCodePath(), getFeaturesDir(), getSkillsDir(), loadBacklog(), loadBacklogWithHash(), loadCounts() (+21 more)

### Community 12 - "Community 12"
Cohesion: 0.1
Nodes (9): isDrainEligible(), decideNext(), implementerDispatch(), plansSource(), roadmapSource(), specsSource(), buildDrainGatePrompt(), buildResumeGatePrompt() (+1 more)

### Community 13 - "Community 13"
Cohesion: 0.15
Nodes (16): runWithConcurrency(), gitStatusPorcelain(), intArg(), loadTasks(), main(), parseArgs(), run(), strArg() (+8 more)

### Community 14 - "Community 14"
Cohesion: 0.16
Nodes (17): discoverPrepEntries(), listFdSlugs(), listSpecFiles(), buildDraftPrompt(), renderIndex(), intArg(), main(), parseArgs() (+9 more)

### Community 15 - "Community 15"
Cohesion: 0.14
Nodes (12): detectMilestoneShippedIncomplete(), activateMilestone(), draftMilestone(), listMilestones(), loadMilestoneBySlug(), loadMilestones(), preflightActivate(), readMilestone() (+4 more)

### Community 16 - "Community 16"
Cohesion: 0.23
Nodes (19): atomicWriteFile(), buildRoadmapBlock(), crossSection(), handleAdd(), handleDemote(), handleMove(), handlePromote(), handleRemove() (+11 more)

### Community 17 - "Community 17"
Cohesion: 0.16
Nodes (12): extractTouches(), looksLikePath(), normalizePath(), findEntry(), main(), readFileOrNull(), runSplitCheck(), toResult() (+4 more)

### Community 18 - "Community 18"
Cohesion: 0.17
Nodes (17): ensureCleanTreeOnMain(), git(), cliMain(), envTuning(), isRegistryAuthError(), publishLocal(), readPkgIdentity(), verifyTarball() (+9 more)

### Community 19 - "Community 19"
Cohesion: 0.15
Nodes (15): assertQueueSourceSynced(), assertQueueSourceSyncedAt(), classifyMergeView(), mergePr(), openPrExistsFor(), spawnGate(), syncMainCleanState(), groupKillState() (+7 more)

### Community 20 - "Community 20"
Cohesion: 0.14
Nodes (5): formatInvariantError(), makeInvariants(), runInvariantSafely(), makePublicApiTsdocInvariant(), makeRuleConflictsInvariant()

### Community 21 - "Community 21"
Cohesion: 0.19
Nodes (10): loadAgentsConfig(), checkTemplateSync(), main(), resolveChangedFiles(), parseAgents(), filterTemplatesByAgents(), adoptTemplate(), copyTemplate() (+2 more)

### Community 22 - "Community 22"
Cohesion: 0.2
Nodes (13): basePayload(), commitProse(), buildVerifyPrompt(), dispatcher(), dispatchVerify(), parseVerifyVerdict(), setVerifyDispatcher(), mkFinding() (+5 more)

### Community 23 - "Community 23"
Cohesion: 0.22
Nodes (15): finishRun(), gh(), git(), main(), parseArgs(), preflight(), promoteExitCode(), promoteOne() (+7 more)

### Community 24 - "Community 24"
Cohesion: 0.17
Nodes (12): loadConfigSync(), ensureGhAvailable(), extractLatestReleaseNotes(), resumeRelease(), run(), runCheck(), runCliCheck(), runOptionalCheck() (+4 more)

### Community 25 - "Community 25"
Cohesion: 0.2
Nodes (8): extractFdAcceptance(), readFdSummary(), buildPrompt(), dispatcher(), dispatchSubagent(), setDispatcher(), parseSubagentMarkdown(), runSubagent()

### Community 26 - "Community 26"
Cohesion: 0.19
Nodes (8): amendSubagentReceipt(), parseArgs(), execAsync(), guardLaneOverwrite(), isEmptyDiffDefault(), resolveLanes(), run(), writeSyntheticOk()

### Community 27 - "Community 27"
Cohesion: 0.22
Nodes (10): writeJsonAtomic(), claudeSupportsMaxThinking(), execAsync(), osascriptSpawn(), runStandalone(), templateSha(), codexSupportsBaseSha(), exec() (+2 more)

### Community 28 - "Community 28"
Cohesion: 0.14
Nodes (7): edgeScrollVelocity(), init(), shouldInsertBefore(), wireAddForms(), wireButtons(), wireDescriptionOverflow(), wireDescriptionToggles()

### Community 29 - "Community 29"
Cohesion: 0.22
Nodes (12): appendJsonl(), applyCycleVerdict(), loadPark(), mapCycle(), parkKey(), readInboxRows(), savePark(), unparkSlug() (+4 more)

### Community 30 - "Community 30"
Cohesion: 0.25
Nodes (8): clearSession(), readSession(), setAutonomous(), touchSession(), writeSession(), injectTrailers(), main(), withReleaseSession()

### Community 31 - "Community 31"
Cohesion: 0.19
Nodes (10): notify(), dayKeyOf(), interruptibleSleep(), intFlag(), parseWatchArgs(), resolve130(), sleep(), applyCycleToState() (+2 more)

### Community 32 - "Community 32"
Cohesion: 0.26
Nodes (9): ensureRolloutMarker(), isPostRollout(), readRolloutMarker(), isSessionStale(), enforceReviewReceipt(), getStagedPaths(), logOverride(), runPreCommit() (+1 more)

### Community 33 - "Community 33"
Cohesion: 0.2
Nodes (7): isMicroChoreAllowed(), isReleaseSweepAllowed(), getReleasePackageFiles(), getStagedPaths(), isReleaseAutomationFile(), validateReleaseAutomation(), validateTrailer()

### Community 34 - "Community 34"
Cohesion: 0.28
Nodes (16): buildIdToLabel(), buildNodeCommunityMap(), classifyEdges(), deriveCommunityLabel(), deriveCommunityLabels(), extractConceptsAndRationales(), extractPackages(), formatCrossEdgeLine() (+8 more)

### Community 35 - "Community 35"
Cohesion: 0.3
Nodes (9): demoteStaleBacklog(), createSlugTracker(), mergeDepFields(), parseBacklog(), parseBlockBody(), parseEntries(), parseRefList(), parseRoadmap() (+1 more)

### Community 36 - "Community 36"
Cohesion: 0.26
Nodes (11): composeBody(), composeTitle(), GhPreflightError, mergePrWithFallback(), MergeTimeoutError, openAndAutoMerge(), pollAutoMerge(), PrClosedWithoutMergeError (+3 more)

### Community 37 - "Community 37"
Cohesion: 0.28
Nodes (7): planSpawn(), spawnAgent(), spawnClaude(), buildClaudeArgv(), buildCodexArgv(), buildOpencodeArgv(), buildStubArgv()

### Community 38 - "Community 38"
Cohesion: 0.31
Nodes (14): releaseLock(), runDrain(), formatReconcile(), makeReconcileDeps(), reportIsEmpty(), parkAwareSource(), makePhaseTap(), assertConfig() (+6 more)

### Community 39 - "Community 39"
Cohesion: 0.18
Nodes (5): diffPhases(), detectStale(), repair(), resolveRoadmapConflict(), appendAgentEvent()

### Community 40 - "Community 40"
Cohesion: 0.27
Nodes (12): admitsLiteralHyphen(), extractFencedBlocks(), findMessageFlag(), formatFindingHuman(), isCloseFence(), isGitCommitLine(), lineContainsFlag(), lintSnippets() (+4 more)

### Community 41 - "Community 41"
Cohesion: 0.21
Nodes (9): asArray(), docNodeId(), enrichDocNodes(), enrichGraph(), loadDocDir(), loadFds(), main(), referencedPaths() (+1 more)

### Community 42 - "Community 42"
Cohesion: 0.32
Nodes (11): loadDocRoots(), findMilestoneMatch(), formatEntry(), getSuggestions(), getTopPriorityNext(), isWritePendingDeprecated(), loadInProgressFds(), loadMilestoneGate() (+3 more)

### Community 43 - "Community 43"
Cohesion: 0.27
Nodes (9): appendOverrideLog(), ensureGardenFresh(), evaluateGardenFreshness(), main(), readGardenReceipt(), resolveGardenScanPaths(), writeGardenReceipt(), autoStampOnCleanDetect() (+1 more)

### Community 44 - "Community 44"
Cohesion: 0.22
Nodes (8): prependToChangelog(), renderChangelogEntry(), renderCommit(), classifyCommit(), classifyCommits(), deriveBumpLevel(), readCommitsSince(), refExists()

### Community 45 - "Community 45"
Cohesion: 0.28
Nodes (6): walk(), claudeProjectDirName(), claudeUsage(), codexUsage(), opencodeUsage(), stubUsage()

### Community 46 - "Community 46"
Cohesion: 0.25
Nodes (5): checkRunners(), compareDotted(), referencedRunners(), checkBinaryPrerequisites(), checkConsumerScripts()

### Community 47 - "Community 47"
Cohesion: 0.22
Nodes (7): checkCrGate(), collectNoldorTrailerLines(), formatReason(), commit(), git(), initRepo(), tagBase()

### Community 48 - "Community 48"
Cohesion: 0.29
Nodes (9): detectCodeLinksDrift(), buildSlugToCodeMap(), collectTaggedCode(), diffProjection(), extractFdTags(), loadCachedCode(), main(), updateFeatureMd() (+1 more)

### Community 49 - "Community 49"
Cohesion: 0.25
Nodes (5): aggregate(), main(), parseArgs(), templateShaFor(), inferLaneFromFilename()

### Community 50 - "Community 50"
Cohesion: 0.27
Nodes (8): loadConfig(), resolveReviewProfile(), resolveSessionTtlHours(), main(), escalate(), spawnDeepReview(), writeContext(), main()

### Community 51 - "Community 51"
Cohesion: 0.26
Nodes (5): waitForHttp200(), resolvePort(), probeServer(), runShell(), runSmoke()

### Community 52 - "Community 52"
Cohesion: 0.31
Nodes (10): clearMicroChoreSession(), discoverAddedFiles(), execGit(), loadFdSummary(), nodeSpawn(), normalizeRepoUrl(), parseCrTrailersFromLog(), pickMostRecentByDatePrefix() (+2 more)

### Community 53 - "Community 53"
Cohesion: 0.24
Nodes (8): assertNoInProgressRelease(), clearReleaseState(), readReleaseState(), writeReleaseState(), addBareOrigin(), call(), git(), seedReleaseRepo()

### Community 54 - "Community 54"
Cohesion: 0.23
Nodes (13): loadFrameworkPage(), loadFrameworkPages(), loadUserDoc(), loadUserDocs(), rewriteDocLinks(), handleFrameworkIndex(), handleFrameworkPage(), handleUserDoc() (+5 more)

### Community 55 - "Community 55"
Cohesion: 0.32
Nodes (9): backfillIds(), main(), formatEntryId(), mintEntryIds(), readNext(), resolveEntryRef(), scanBlock(), stampMissingIds() (+1 more)

### Community 56 - "Community 56"
Cohesion: 0.31
Nodes (11): applySiblingTrailer(), buildSiblingTrailerValue(), buildSuggestion(), headHasNoldorPages(), loadKnownSlugs(), loadScaffoldSlugs(), loadStagedFiles(), main() (+3 more)

### Community 57 - "Community 57"
Cohesion: 0.26
Nodes (4): isBootstrapReason(), declaredGateKeys(), detectBootstrapOverrideAudit(), gateForTrailer()

### Community 58 - "Community 58"
Cohesion: 0.21
Nodes (4): collectTargets(), detectFdLinkRot(), isCheckablePath(), detectTierMismatch()

### Community 59 - "Community 59"
Cohesion: 0.33
Nodes (7): acquireLock(), isAlive(), liveLockPid(), binPathFrom(), detachChildArgv(), detachWatch(), stripDetach()

### Community 60 - "Community 60"
Cohesion: 0.27
Nodes (7): loadFeatureRefs(), main(), parseArgv(), pushBlockedByIssues(), pushIdIssues(), pushIssues(), validateTriageInputs()

### Community 61 - "Community 61"
Cohesion: 0.29
Nodes (6): appendToMessage(), detectDroppedTrailers(), formatTrailers(), parseTrailers(), detectTrailerScopeMismatch(), rootCommitShas()

### Community 62 - "Community 62"
Cohesion: 0.32
Nodes (9): flag(), runBootstrapCli(), injectBootstrapOverrides(), resolveIntroducedGate(), gateEntry(), git(), makeRepo(), treesOf() (+1 more)

### Community 63 - "Community 63"
Cohesion: 0.32
Nodes (6): projectDrainState(), readState(), writeState(), collectStatus(), formatStatus(), main()

### Community 64 - "Community 64"
Cohesion: 0.42
Nodes (7): loadAreaCategories(), areaToCategory(), getSectionBody(), liftSpecSections(), replaceSectionBody(), scaffoldFd(), sectionBounds()

### Community 65 - "Community 65"
Cohesion: 0.38
Nodes (9): resolveRunner(), buildLaunchCommand(), escapeShell(), launchTree(), main(), parseWorktrees(), renderPrompt(), resolveAgentInvocation() (+1 more)

### Community 66 - "Community 66"
Cohesion: 0.4
Nodes (6): appendList(), applyBlock(), buildResourcesBlock(), main(), resolveSpecPath(), syncFile()

### Community 67 - "Community 67"
Cohesion: 0.27
Nodes (3): detectFdWithoutPlan(), findCreationSha(), hasPlan()

### Community 68 - "Community 68"
Cohesion: 0.36
Nodes (6): formatResults(), formatViolationLine(), printResults(), runAll(), warningBlock(), runInvariants()

### Community 69 - "Community 69"
Cohesion: 0.42
Nodes (8): checkLinks(), extractHeadings(), extractLinks(), fileExists(), main(), slugifyHeading(), stripCodeRegions(), walkMd()

### Community 70 - "Community 70"
Cohesion: 0.38
Nodes (5): printHelp(), dispatch(), isHelpFlag(), main(), installedFrameworkVersion()

### Community 71 - "Community 71"
Cohesion: 0.33
Nodes (4): filePathFromPayload(), gitToplevel(), isTracked(), runPreEditGuard()

### Community 72 - "Community 72"
Cohesion: 0.5
Nodes (6): extractArtifactLinks(), fixArtifactLink(), indexSrcByBasename(), main(), migrateOne(), rewriteScriptsPaths()

### Community 73 - "Community 73"
Cohesion: 0.36
Nodes (5): renderLayout(), handleReleaseNotes(), renderReleaseNotes(), shell(), shell()

### Community 74 - "Community 74"
Cohesion: 0.42
Nodes (6): ensureDashboard(), isDashboardUp(), main(), resolveMainRoot(), sleep(), spawnDetachedServer()

### Community 75 - "Community 75"
Cohesion: 0.5
Nodes (4): buildMergeCandidates(), formatTable(), main(), readOrEmpty()

### Community 76 - "Community 76"
Cohesion: 0.39
Nodes (4): detectCircularBlockedBy(), findBlockedByCycles(), readOr(), tarjanCycles()

### Community 77 - "Community 77"
Cohesion: 0.5
Nodes (3): promptSelect(), promptText(), runManual()

### Community 78 - "Community 78"
Cohesion: 0.54
Nodes (6): areaFromPackage(), inferTier(), main(), walkFeaturesDir(), yamlToBacklogBlock(), yamlToFeatureMd()

### Community 79 - "Community 79"
Cohesion: 0.43
Nodes (5): main(), migrateChangelogContent(), migrateFeaturesDir(), parseChangelogSection(), renderSection()

### Community 80 - "Community 80"
Cohesion: 0.39
Nodes (3): noldorCliCommand(), extractJsonLine(), runGardenDetectViaCli()

### Community 81 - "Community 81"
Cohesion: 0.46
Nodes (6): emptyRow(), formatRuntime(), poll(), renderInbox(), renderLive(), setCount()

### Community 82 - "Community 82"
Cohesion: 0.57
Nodes (5): filterCommitsForPage(), listPageSlugs(), loadCommits(), main(), parseScope()

### Community 83 - "Community 83"
Cohesion: 0.52
Nodes (4): resolveByGraphAdjacency(), resolveByLinksPlan(), resolveByLinksSpec(), scanFdsForOwner()

### Community 84 - "Community 84"
Cohesion: 0.62
Nodes (4): collectRoutingAccuracy(), sizeSkipsSpec(), sizeToPath(), sizeToTier()

### Community 85 - "Community 85"
Cohesion: 0.48
Nodes (5): collectFeaturesForRelease(), extractChangelogSummary(), extractFirstParagraph(), prependToReleaseNotes(), renderReleaseNotesEntry()

### Community 86 - "Community 86"
Cohesion: 0.48
Nodes (3): fillAllMarkers(), fillMarkers(), main()

### Community 88 - "Community 88"
Cohesion: 0.33
Nodes (4): buildMilestoneGroups(), loadMilestoneGroups(), handleMilestones(), renderMilestones()

### Community 89 - "Community 89"
Cohesion: 0.43
Nodes (6): loadSkill(), loadSkills(), handleSkillPage(), handleSkillsIndex(), renderSkillPage(), renderSkillsIndex()

### Community 90 - "Community 90"
Cohesion: 0.62
Nodes (5): evaluatePrePush(), main(), pushesMain(), readStdinWithTimeout(), recordReleasePush()

### Community 91 - "Community 91"
Cohesion: 0.67
Nodes (4): diffSkillSets(), loadSkillSlugs(), main(), parseCatalogSlugs()

### Community 93 - "Community 93"
Cohesion: 0.6
Nodes (4): extractLegacyBlock(), findLineStartingWith(), main(), migrateFd()

### Community 95 - "Community 95"
Cohesion: 0.53
Nodes (4): ensureGraphFresh(), latestCommitTs(), commit(), exec()

### Community 96 - "Community 96"
Cohesion: 0.6
Nodes (4): loadExamples(), main(), processTutorialDir(), transcludeMarkers()

### Community 97 - "Community 97"
Cohesion: 0.6
Nodes (4): addGeneratedHeader(), annotateAll(), main(), walkMd()

### Community 98 - "Community 98"
Cohesion: 0.6
Nodes (5): applyStubGate(), cannedPath(), main(), retireRoadmapEntry(), slugFromPrompt()

### Community 99 - "Community 99"
Cohesion: 0.53
Nodes (5): countTestCases(), isTestPath(), loadTestPyramid(), handleTestPyramid(), renderTestPyramid()

### Community 100 - "Community 100"
Cohesion: 0.8
Nodes (3): main(), resolveIsShipped(), scoreEntry()

### Community 101 - "Community 101"
Cohesion: 0.7
Nodes (3): collectFiles(), main(), renamePlanOnlyTier()

### Community 102 - "Community 102"
Cohesion: 0.7
Nodes (3): loadKnownSlugs(), main(), validateFeatureSlugScope()

## Knowledge Gaps
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `loadDocRoots()` connect `Community 42` to `Community 0`, `Community 1`, `Community 35`, `Community 5`, `Community 6`, `Community 41`, `Community 10`, `Community 75`, `Community 12`, `Community 11`, `Community 14`, `Community 17`, `Community 83`, `Community 23`, `Community 57`, `Community 62`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **Why does `loadConsumerConfig()` connect `Community 1` to `Community 64`, `Community 0`, `Community 33`, `Community 3`, `Community 99`, `Community 5`, `Community 7`, `Community 43`, `Community 18`, `Community 24`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `parseRoadmap()` connect `Community 35` to `Community 5`, `Community 42`, `Community 75`, `Community 76`, `Community 12`, `Community 14`, `Community 16`, `Community 17`, `Community 55`, `Community 23`, `Community 60`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Are the 30 inferred relationships involving `loadDocRoots()` (e.g. with `run()` and `listSpecFiles()`) actually correct?**
  _`loadDocRoots()` has 30 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `loadConsumerConfig()` (e.g. with `scanRoots()` and `resolveGardenScanPaths()`) actually correct?**
  _`loadConsumerConfig()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 16 inferred relationships involving `detectAll()` (e.g. with `detectTierMismatch()` and `detectAllowlistDrift()`) actually correct?**
  _`detectAll()` has 16 INFERRED edges - model-reasoned connections that need verification._
- **Are the 21 inferred relationships involving `main()` (e.g. with `loadConfigSync()` and `assertConfig()`) actually correct?**
  _`main()` has 21 INFERRED edges - model-reasoned connections that need verification._