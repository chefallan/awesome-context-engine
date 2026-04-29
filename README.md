# awesome-context-engine

Portable repo memory for AI coding agents.

[![npm version](https://img.shields.io/npm/v/awesome-context-engine.svg)](https://www.npmjs.com/package/awesome-context-engine)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![node >=18](https://img.shields.io/badge/node-%3E%3D18-339933.svg)](https://nodejs.org/)

[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)

awesome-context-engine keeps repository context current for AI coding tools by combining persistent memory, fast indexing, compact sync output, and optional automatic updates.

![awesome-context-engine banner](https://raw.githubusercontent.com/chefallan/awesome-context-engine/main/assets/banner.png)

## Table of Contents

- [Install](#install)
- [Platform Compatibility](#platform-compatibility)
- [Quick Commands](#quick-commands)
- [Example: Repository Baseline Scan](#example-repository-baseline-scan)
- [What It Solves](#what-it-solves)
- [Features](#features)
- [Commands](#commands)
- [Persistent Memory](#persistent-memory)
- [Memory Config](#memory-config)
- [Library API](#library-api)
- [Flags](#flags)
- [How It Works](#how-it-works)
- [.awesome-context Structure](#awesome-context-structure)
- [Auto Mode](#auto-mode)
- [Example: CI Health Check](#example-ci-health-check)
- [Example: Strict Security Mode](#example-strict-security-mode)
- [Example: A/B Token Savings Measurement](#example-ab-token-savings-measurement)
- [Interpreting Results](#interpreting-results)
- [Latest Measured Result (This Repository)](#latest-measured-result-this-repository)
- [Token Optimization](#token-optimization)
- [Works With AI Tools](#works-with-ai-tools)
- [Safety](#safety)
- [Philosophy](#philosophy)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Support](#support)
- [Credits](#credits)
- [License](#license)

## Install

```bash
npx awesome-context-engine
```

First run is interactive and explicit. The CLI asks before writing files.

After install, the compact command is `ace`.
The legacy command `awesome-context-engine` still works.

## Platform Compatibility

awesome-context-engine is designed to run on:

- macOS
- Ubuntu/Linux
- Windows

Compatibility notes:

- Requires Node.js 18 or later
- Uses Node APIs and npm scripts that work across major operating systems
- Auto mode falls back gracefully when recursive file watching is not available on a platform

## Quick Commands

```bash
ace init
ace scan
ace index
ace sync
ace auto
ace doctor
ace benchmark
ace memory add --type preference --text "Use clear markdown docs"
ace memory list
ace memory search --query "markdown docs"
ace memory prune
ace memory summarize
ace memory forget --id mem_123
```

## What It Solves

Modern AI coding flows often fail on continuity.
Knowledge from previous sessions gets lost, context becomes stale after code changes, and prompts grow noisy.

awesome-context-engine solves this by:

- maintaining structured project memory in `.awesome-context`
- keeping context files updated through index and sync workflows
- supporting automatic refresh on workspace activity
- generating compact context to improve token efficiency

## Features

- Persistent repository memory under `.awesome-context`
- Automatic context updates with optional `auto` mode
- Repository baseline scanning with `scan` for existing codebases
- Token optimization via deduped, prioritized, minimal context generation
- Safe integration files for Copilot, Claude, Cline, Continue, Cursor, and Codex
- Health checks through `doctor` with text or JSON output
- End Of Day (EOD) reporting from git history with executive summary and JSON output

## Commands

| Command | Purpose |
| --- | --- |
| `ace init` | Initialize context files and AI integration files |
| `ace scan` | Scan existing repository and baseline memory/workflows/decisions/preferences |
| `ace index` | Update `.awesome-context/project-map.md` |
| `ace sync` | Regenerate `.awesome-context/ai-context.md` |
| `ace auto` | Start watcher mode (index -> sync on change) |
| `ace doctor` | Validate setup health |
| `ace benchmark` | Estimate token savings from compact context |
| `ace memory add` | Add a persistent memory item |
| `ace memory list` | List persistent memory items |
| `ace memory search` | Search and rank relevant memory |
| `ace memory prune` | Remove duplicates, expired, and low-value memory |
| `ace memory summarize` | Compress older memory into durable summaries |
| `ace memory forget` | Remove memory by id or query |
| `ace help` | Show command help |

## Persistent Memory

`Persistent Memory` extends the existing `.awesome-context` workflow and does not replace it.

- local project storage only
- relevance-based retrieval for current tasks
- dedupe and token-budgeted memory injection
- optional summary-first injection to reduce history noise
- secret redaction before write

### Memory Commands

```bash
ace memory add --type preference --text "Use markdown tables for API docs"
ace memory list
ace memory search --query "API documentation"
ace memory prune
ace memory summarize
ace memory forget --id mem_123
```

### Memory Types

- `rule`
- `preference`
- `decision`
- `project_state`
- `fact`
- `warning`
- `style`
- `note`

### Storage Layout

```text
.awesome-context/
  memory/
    items.json
    summaries.json
    index.json
```

### Memory Item Schema

```json
{
  "id": "mem_...",
  "type": "rule | preference | decision | project_state | fact | warning | style | note",
  "text": "...",
  "source": "manual | scan | chat | doc | command | import",
  "tags": ["docs", "api"],
  "importance": 1,
  "createdAt": "...",
  "updatedAt": "...",
  "lastUsedAt": null,
  "useCount": 0,
  "expiresAt": null
}
```

## Memory Config

Memory config is loaded from `.awesome-context/config.json`.

```json
{
  "memory": {
    "enabled": true,
    "maxItems": 8,
    "maxTokens": 1200,
    "includeTypes": ["rule", "preference", "decision", "project_state", "fact", "warning", "style"],
    "excludeTypes": [],
    "strictRedaction": true
  }
}
```

`sync` now optionally injects relevant memory sections:

- `## Persistent Memory`
- `## Memory Decisions`
- `## Current Project State`
- `## Excluded Memory`

## Library API

```ts
import {
  addMemory,
  listMemory,
  searchMemory,
  forgetMemory,
  pruneMemory,
  summarizeMemory,
  buildMemoryContext
} from "awesome-context-engine";
```

Example:

```ts
await addMemory(process.cwd(), {
  type: "preference",
  text: "Use markdown tables for API docs",
  tags: ["docs", "api"],
  source: "manual"
});

const relevant = await searchMemory(process.cwd(), { query: "API docs" });
```

### Migration Safety

- Existing `.awesome-context/*.md` files are preserved.
- New memory files are created only when missing.
- Existing commands and workflows remain backward compatible.

## Flags

| Flag | Purpose |
| --- | --- |
| `--yes`, `-y` | Skip prompts and use defaults |
| `--verbose` | Show detailed output |
| `--json` | Output `doctor` results as JSON |
| `--compact` | Emit compact single-line JSON (with `--json`) |
| `--strict` | Fail sync when secret-like content is detected before redaction |
| `--dry-run` | Preview `scan` baseline results without writing files |

## How It Works

![How It Works](https://raw.githubusercontent.com/chefallan/awesome-context-engine/main/assets/how-it-works.png)

1. Initialize repository memory and integration files with `init`.
2. Scan existing repository context with `scan` (this is also run automatically by `init`).
3. Index and baseline memory/workflows/decisions/preferences from repository signals.
4. Sync compact AI context from memory, map, workflows, and graph signals.
5. Optionally run `auto` to continuously refresh context after repository changes.

## `.awesome-context` Structure

![Context Files](https://raw.githubusercontent.com/chefallan/awesome-context-engine/main/assets/context-files.png)

```text
.awesome-context/
  ai-context.md
  minimal-context.md
  graph.json
  project-map.md
  project-index.json
  config.json
  memory.md
  workflows.md
  decisions.md
  preferences.md
  memory/
    items.json
    summaries.json
    index.json
  skills/
```

## Auto Mode

![Auto Mode](https://raw.githubusercontent.com/chefallan/awesome-context-engine/main/assets/auto-mode.png)

Run auto mode directly:

```bash
ace auto
```

`init` now also runs an automatic baseline scan, so existing repositories immediately get starter context in
`.awesome-context/memory.md`, `.awesome-context/workflows.md`, `.awesome-context/decisions.md`, and `.awesome-context/preferences.md`.

When `auto` is running, it performs an initial `index + sync`, then re-runs on repository changes and editable context files (`memory.md`, `preferences.md`, `decisions.md`, `workflows.md`).

## Example: CI Health Check

```bash
ace doctor --json --compact
```

## Example: Repository Baseline Scan

```bash
ace scan
ace scan --dry-run --verbose
```

Use this for existing repositories to automatically capture what the repo is about and generate baseline context files before daily `auto` updates.
Use `--dry-run` to preview what would be updated without changing any files.

## Example: Interactive Release Flow

```bash
npm run release
npm run release -- patch
npm run release -- minor
npm run release -- major
```

The release flow is a repo-only script (`package.json`), not a public CLI command. It asks whether the bump should be `patch`, `minor`, or `major` when no bump argument is provided, then performs the full sequence automatically:
publish to public npm, update installed versions, create a release commit, and push to GitHub.

## Example: Strict Security Mode

```bash
ace sync --strict
```

If strict mode detects secret-like content before redaction, the command exits with code `2`.
Use this in CI to distinguish policy failures from generic runtime errors.

## Example: A/B Token Savings Measurement

Run the benchmark after syncing context:

```bash
ace sync
ace benchmark
```

JSON output for CI dashboards:

```bash
ace benchmark --json --compact
```

NPM script shortcuts:

```bash
npm run benchmark
npm run benchmark:docs-check
```

- `benchmark`: quick human-readable benchmark output
- `benchmark:docs-check`: rebuilds and prints compact JSON output for release/docs updates

What it compares:

- Baseline: raw context source files (`memory.md`, `preferences.md`, `decisions.md`, `workflows.md`, `project-map.md`, `minimal-context.md`)
- Optimized: generated `.awesome-context/ai-context.md`

How estimates are calculated:

- Estimated tokens are computed with a model-agnostic heuristic: `chars / 4`
- Use results as relative A/B guidance, not exact billing numbers for a specific model

### Interpreting Results

| Savings % | Interpretation | Suggested Next Step |
| --- | --- | --- |
| `< 15%` | Low gain | Review noisy sections in memory files and run `sync` again |
| `15% - 35%` | Good gain | Keep current workflow and re-check after major repo changes |
| `> 35%` | Strong gain | Use `benchmark --json --compact` in CI/reporting to track trend |

### Latest Measured Result (This Repository)

From `ace benchmark --json --compact`:

- Baseline estimated tokens: `852`
- Optimized estimated tokens: `477`
- Estimated tokens saved: `375`
- Estimated savings: `44.01%`

This run is a snapshot and will change as repository content changes.

## Token Optimization

![Token Optimization](https://raw.githubusercontent.com/chefallan/awesome-context-engine/main/assets/token-optimization.png)

The sync pipeline improves context quality per token by combining:

- line extraction and scoring
- deduplication and noise filtering
- section limits for high-signal summaries
- minimal graph-based context for code-local relevance

## Works With AI Tools

![AI Tools](https://raw.githubusercontent.com/chefallan/awesome-context-engine/main/assets/ai-tools.png)

- Claude
- Cline
- Continue
- Cursor
- Codex

## Safety

- Core memory files are not overwritten once created
- Existing VS Code tasks are merged instead of replaced
- Integration files are safely appended when required guidance is missing
- Generated context goes through secret redaction logic
- Everything runs locally in your repository

## Philosophy

The project favors explicit, composable workflows over hidden automation.

- keep memory in the repo
- keep behavior inspectable
- keep context small and useful

## Roadmap

- richer doctor diagnostics and remediation hints
- stronger monorepo context selection
- optional CI checks for context freshness
- schema validation for generated artifacts

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow and pull request guidelines.

## Support

- GitHub Issues for bugs and feature requests
- GitHub Discussions for usage questions and ideas

## Credits

- Commit message standard inspired by [wgtechlabs/clean-commit](https://github.com/wgtechlabs/clean-commit)
- Credits to [@wgtechlabs](https://github.com/wgtechlabs) and [@warengonzaga](https://github.com/warengonzaga)

## License

MIT. See [LICENSE](LICENSE).
