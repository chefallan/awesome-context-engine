# Project Map

Generated at: 2026-04-25T01:31:51.192Z

## Repository Snapshot
- Total files: 50
- Total directories: 15
- Truncated scan: no

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
├── src/
│   ├── benchmark.ts
│   ├── cli.ts
│   ├── commit-message.ts
│   ├── doctor.ts
│   ├── graph.ts
│   ├── indexer.ts
│   ├── init.ts
│   ├── redact.ts
│   ├── strict-mode.ts
│   ├── sync.ts
│   ├── templates.ts
│   ├── ui.ts
│   ├── vscode-task.ts
│   ├── vscodeTask.ts
│   └── watcher.ts
├── .clinerules
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
- TypeScript: 15
- Markdown: 14
- JSON: 5
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
- root#prepublishOnly: npm run build
- root#start: node dist/cli.js

## Important Config Files
- package.json
- tsconfig.json

## Test Commands
- none detected

## Build Commands
- root#build: tsc

## Entrypoints
- src/cli.ts
