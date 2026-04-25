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
- [Special Commands](#special-commands)
- [Example: Repository Baseline Scan](#example-repository-baseline-scan)
- [What It Solves](#what-it-solves)
- [Features](#features)
- [Commands](#commands)
- [Flags](#flags)
- [How It Works](#how-it-works)
- [.awesome-context Structure](#awesome-context-structure)
- [Auto Mode](#auto-mode)
- [Example: CI Health Check](#example-ci-health-check)
- [Example: Clean Commit Message Generation](#example-clean-commit-message-generation)
- [Example: End Of Day (EOD) Report](#example-end-of-day-eod-report)
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

## Platform Compatibility

awesome-context-engine is designed to run on:

- macOS
- Ubuntu/Linux
- Windows

Compatibility notes:

- Requires Node.js 18 or later
- Uses Node APIs and npm scripts that work across major operating systems
- Auto mode falls back gracefully when recursive file watching is not available on a platform
- VS Code auto-task integration works with the standard `npx` command on all supported systems

## Quick Commands

```bash
npx awesome-context-engine init
npx awesome-context-engine scan
npx awesome-context-engine index
npx awesome-context-engine sync
npx awesome-context-engine auto
npx awesome-context-engine doctor
npx awesome-context-engine benchmark
```

## Special Commands

> [!IMPORTANT]
> **Special Feature Commands**
> Use these when you need communication-ready outputs from repository history for changelogs, and end-of-day reporting.

```bash
npx awesome-context-engine commit-msg
npx awesome-context-engine commit-msg --breaking
npx awesome-context-engine eod-report 2026-04-24
npx awesome-context-engine eod-report 2026-04-24 --json --compact
```

- `commit-msg`: Suggests Clean Commit title/body from current repository changes.
- `eod-report <date>`: Generates an End Of Day report with executive summary, delivery stats, and detailed outcomes.

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
- Automatic context updates with `auto` mode and optional VS Code startup task
- Repository baseline scanning with `scan` for existing codebases
- Token optimization via deduped, prioritized, minimal context generation
- Safe integration files for Copilot, Claude, Cline, Continue, Cursor, and Codex
- Health checks through `doctor` with text or JSON output
- End Of Day (EOD) reporting from git history with executive summary and JSON output

## Commands

| Command | Purpose |
| --- | --- |
| `awesome-context-engine init` | Initialize context files and AI integration files |
| `awesome-context-engine scan` | Scan existing repository and baseline memory/workflows/decisions/preferences |
| `awesome-context-engine index` | Update `.awesome-context/project-map.md` |
| `awesome-context-engine sync` | Regenerate `.awesome-context/ai-context.md` |
| `awesome-context-engine auto` | Start watcher mode (index -> sync on change) |
| `awesome-context-engine doctor` | Validate setup health |
| `awesome-context-engine benchmark` | Estimate token savings from compact context |
| `awesome-context-engine help` | Show command help |

## Flags

| Flag | Purpose |
| --- | --- |
| `--yes`, `-y` | Skip prompts and use defaults |
| `--no-vscode-task` | Do not create/update VS Code auto task |
| `--verbose` | Show detailed output |
| `--json` | Output `doctor` results as JSON |
| `--compact` | Emit compact single-line JSON (with `--json`) |
| `--strict` | Fail sync when secret-like content is detected before redaction |
| `--breaking` | Add Clean Commit `!` marker for `commit-msg` when type supports breaking changes |
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
  memory.md
  workflows.md
  decisions.md
  preferences.md
  skills/
```

## Auto Mode

![Auto Mode](https://raw.githubusercontent.com/chefallan/awesome-context-engine/main/assets/auto-mode.png)

Run auto mode directly:

```bash
npx awesome-context-engine auto
```

During `init`, the project can also install a VS Code task (`runOn: folderOpen`) so context refresh starts automatically when the workspace opens.

`init` now also runs an automatic baseline scan, so existing repositories immediately get starter context in
`.awesome-context/memory.md`, `.awesome-context/workflows.md`, `.awesome-context/decisions.md`, and `.awesome-context/preferences.md`.

When `auto` is running, it performs an initial `index + sync`, then re-runs on repository changes and editable context files (`memory.md`, `preferences.md`, `decisions.md`, `workflows.md`).

After this task is installed, you do not need to manually run `auto` every time you reopen VS Code.
One-time setup: allow automatic tasks in this workspace via **Tasks: Manage Automatic Tasks in Folder** and set to **Allow Automatic Tasks**.

## Example: CI Health Check

```bash
npx awesome-context-engine doctor --json --compact
```

## Example: Repository Baseline Scan

```bash
npx awesome-context-engine scan
npx awesome-context-engine scan --dry-run --verbose
```

Use this for existing repositories to automatically capture what the repo is about and generate baseline context files before daily `auto` updates.
Use `--dry-run` to preview what would be updated without changing any files.

## Example: Clean Commit Message Generation

```bash
npx awesome-context-engine commit-msg
npx awesome-context-engine commit-msg --breaking
```

Use `--breaking` only when the change introduces an incompatible behavior or API change for users.
The marker `!` is applied only for supported Clean Commit types: `new`, `update`, `remove`, and `security`.

## Example: End Of Day (EOD) Report

```bash
npx awesome-context-engine eod-report 2026-04-24
npx awesome-context-engine eod-report 2026-04-24 --json --compact
```

By default, `eod-report` returns a bullet-list summary of commits for that date.

## Example: Strict Security Mode

```bash
npx awesome-context-engine sync --strict
```

If strict mode detects secret-like content before redaction, the command exits with code `2`.
Use this in CI to distinguish policy failures from generic runtime errors.

## Example: A/B Token Savings Measurement

Run the benchmark after syncing context:

```bash
npx awesome-context-engine sync
npx awesome-context-engine benchmark
```

JSON output for CI dashboards:

```bash
npx awesome-context-engine benchmark --json --compact
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

From `npx awesome-context-engine benchmark --json --compact`:

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

- GitHub Copilot
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
