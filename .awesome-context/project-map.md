# Project Map

Generated at: 2026-04-29T02:05:58.490Z

## Repository Snapshot
- Total files: 59
- Total directories: 18
- Truncated scan: no

## Repository Identity
- Root package: awesome-context-engine
- Package description: Drop-in persistent context and memory layer for AI coding tools.
- Workspace packages: 1
- Direct dependencies indexed: 7

## Browse First
- Start with README intent: Portable repo memory for AI coding agents.
- Inspect entrypoint: src/cli.ts
- Inspect entrypoint: src/index.ts
- Inspect config: package.json
- Inspect config: tsconfig.json
- Browse directory: src/ (21 files)
- Browse directory: scripts/ (1 files)
- Browse directory: docs/ (1 files)
- Build command: root#build
- Test command: root#test

## Workspace Packages
- root -> awesome-context-engine: Drop-in persistent context and memory layer for AI coding tools.

## Auxiliary Packages
- none detected

## Folder Tree (max depth 3)

```text
.
├── .continue/
│   └── context.md
├── .github/
│   ├── workflows/
│   │   └── deploy-pages.yml
│   └── copilot-instructions.md
├── .tmp-fresh/
│   ├── .continue/
│   │   └── context.md
│   ├── .github/
│   │   └── copilot-instructions.md
│   ├── .clinerules
│   ├── AGENTS.md
│   └── CLAUDE.md
├── .tmp-fresh2/
│   ├── .continue/
│   │   └── context.md
│   ├── .github/
│   │   └── copilot-instructions.md
│   ├── .vscode/
│   │   └── tasks.json
│   ├── .clinerules
│   ├── AGENTS.md
│   └── CLAUDE.md
├── .tmp-no-context/
├── .vscode/
│   └── tasks.json
├── assets/
│   ├── .gitkeep
│   ├── ai-tools.png
│   ├── auto-mode.png
│   ├── banner.png
│   ├── context-files.png
│   ├── how-it-works.png
│   └── token-optimization.png
├── docs/
│   └── index.html
├── scripts/
│   └── release.mjs
├── src/
│   ├── awesomeskill.ts
│   ├── benchmark.ts
│   ├── cli.ts
│   ├── doctor.ts
│   ├── graph.ts
│   ├── index.ts
│   ├── indexer.ts
│   ├── init.ts
│   ├── memory.ts
│   ├── postinstall.ts
│   ├── redact.ts
│   ├── scan.ts
│   ├── skills.ts
│   ├── strict-mode.ts
│   ├── sync.ts
│   ├── templates.ts
│   ├── ui.ts
│   ├── visualize.ts
│   ├── vscode-task.ts
│   ├── vscodeTask.ts
│   └── watcher.ts
├── test/
│   ├── fixtures/
│   └── memory.test.mjs
├── .clinerules
├── .env
├── .gitattributes
├── .gitignore
├── .npmignore
├── AGENTS.md
├── CLAUDE.md
├── CONTRIBUTING.md
├── LICENSE
├── package-lock.json
├── package.json
├── README.md
└── tsconfig.json
```

## Detected Languages
- TypeScript: 21
- Markdown: 14
- JSON: 5
- JavaScript: 2
- HTML: 1
- YAML: 1

## Detected Frameworks
- none

## Package Scripts
- root#benchmark: node dist/cli.js benchmark
- root#benchmark:docs-check: npm run build && node dist/cli.js benchmark --json --compact
- root#build: tsc
- root#clean: node -e "require('fs').rmSync('dist',{recursive:true,force:true})"
- root#dev: tsc -w -p .
- root#postinstall: node dist/postinstall.js
- root#prepublishOnly: npm run build
- root#release: node scripts/release.mjs
- root#start: node dist/cli.js
- root#test: npm run build && node --test test/*.test.mjs

## Important Config Files
- package.json
- tsconfig.json

## Test Commands
- root#test: npm run build && node --test test/*.test.mjs

## Build Commands
- root#build: tsc

## Entrypoints
- src/cli.ts
- src/index.ts

## Auxiliary Entrypoints
- none detected

## Key Directories
- src/: 21 files
- scripts/: 1 files
- docs/: 1 files
- assets/: 7 files
- .github/: 2 files
- .clinerules/: 1 files
- .continue/: 1 files
- .env/: 1 files

## Auxiliary Paths
- test/: 1 files
- .tmp-fresh2/: 6 files
- .tmp-fresh/: 5 files

## Dependency Highlights
- @anthropic-ai/sdk
- @inquirer/prompts
- @types/node
- awesome-context-engine
- picocolors
- ts-node
- typescript
