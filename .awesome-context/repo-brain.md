# Repo Brain

Generated at: 2026-05-04T22:48:07.830Z

## Cold-Start Instructions

This file is the persistent knowledge base for this repository.
Load this file at the start of any session — you do not need to scan, grep, or explore the repo to understand it.
The Module Catalog below tells you exactly what each source file exports and does.
Use `.awesome-context/ai-context.md` for rules, memory, workflows, and decisions.

## Module Catalog

### src/awesomeskill.ts
- Exports: fetchBestMatchSkill, fetchSkillContent, searchSkillSlugs

### src/benchmark.ts
- Exports: runBenchmarkEval, runTokenBenchmark

### src/context-marks.ts
- Exports: buildContextPack, checkContextMarks, explainContextFile, impactContextMarks, markContextFiles, refreshContextMarks

### src/doctor.ts
- Exports: runDoctor

### src/genesis.ts
- Exports: buildCaptureFromExport, canUseGenesis, getGenesisConfig, getRecallNotes, getRelevantDecisions, learnCapture, learnForget, learnProfile

### src/graph.ts
- Exports: clearAceCache, generateGraphContext, getAceCacheStatus, readGraphData

### src/indexer.ts
- Exports: indexProject

### src/init.ts
- Exports: initProject

### src/memory.ts
- Exports: addMemory, buildMemoryContext, ensureMemoryStore, forgetMemory, getMemoryConfig, listMemory, loadMemoryStore, pruneMemory

### src/redact.ts
- Exports: detectSensitiveMatches, redactSensitive

### src/scan.ts
- Exports: scanRepositoryContext

### src/skills.ts
- Exports: buildProjectProfile, syncSkills

### src/strict-mode.ts
- Exports: getExitCodeForError, isStrictModeViolationError, StrictModeViolationError

### src/sync.ts
- Exports: syncContext

### src/templates.ts
- Exports: CONTEXT_DIR_NAME, getContextPaths, getDefaultIgnoreNames

### src/ui.ts
- Exports: confirmPrompt, error, heading, info, secondary, success, warning

### src/visualize.ts
- Exports: generateSvgVisualization

### src/watcher.ts
- Exports: startAutoMode

## Architecture Data Flow

```
ace sync
  → graph.ts        generateGraphContext  — builds graph.json + cache.json (symbol/import graph)
  → indexer.ts      indexProject          — builds project-map.md + project-index.json
  → context-marks.ts markContextFiles     — writes @ace-dna headers, file-context.json, impact-map.json
  → memory.ts       buildMemoryContext    — loads items.json, guarantees rule/warning items surface
  → sync.ts         renderContext         — compresses all sources into ai-context.md
  → sync.ts         renderRepoBrain       — writes repo-brain.md (this file)
```

## Key Entry Points

- `src/cli.ts` — all `ace` CLI commands
- `src/index.ts` — public Node.js API surface
- `.awesome-context/ai-context.md` — agent context (read this first)
- `.awesome-context/repo-brain.md` — this file (full module map)
- `.awesome-context/memory/items.json` — persistent memory store