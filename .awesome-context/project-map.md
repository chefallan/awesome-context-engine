# Project Map

Generated at: 2026-04-27T15:28:22.606Z

## Repository Snapshot
- Total files: 75
- Total directories: 38
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
├── scripts/
│   └── release.mjs
├── src/
│   ├── awesomeskill.ts
│   ├── benchmark.ts
│   ├── cli.ts
│   ├── commit-message.ts
│   ├── doctor.ts
│   ├── eod-report.ts
│   ├── github-copilot.ts
│   ├── graph.ts
│   ├── indexer.ts
│   ├── init.ts
│   ├── postinstall.ts
│   ├── redact.ts
│   ├── scan.ts
│   ├── skills.ts
│   ├── strict-mode.ts
│   ├── sync.ts
│   ├── templates.ts
│   ├── ui.ts
│   ├── vscode-task.ts
│   ├── vscodeTask.ts
│   └── watcher.ts
├── test/
│   ├── fixtures/
│   │   └── commit-msg/
│   └── commit-msg.test.mjs
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
- TypeScript: 26
- Markdown: 17
- JSON: 13
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
- root#test: npm run build && node --test test/commit-msg.test.mjs
- test/fixtures/commit-msg/workspace-script-focus/base#build: tsc
- test/fixtures/commit-msg/workspace-script-focus/workspace#build: tsc
- test/fixtures/commit-msg/workspace-script-focus/workspace#test: node --test

## Important Config Files
- package.json
- tsconfig.json

## Test Commands
- root#test: npm run build && node --test test/commit-msg.test.mjs
- test/fixtures/commit-msg/workspace-script-focus/base#build: tsc
- test/fixtures/commit-msg/workspace-script-focus/workspace#build: tsc
- test/fixtures/commit-msg/workspace-script-focus/workspace#test: node --test

## Build Commands
- root#build: tsc
- test/fixtures/commit-msg/workspace-script-focus/base#build: tsc
- test/fixtures/commit-msg/workspace-script-focus/workspace#build: tsc

## Entrypoints
- src/cli.ts
- test/fixtures/commit-msg/no-commits-initial/workspace/src/index.ts
- test/fixtures/commit-msg/workspace-command-focus/base/src/cli.ts
- test/fixtures/commit-msg/workspace-command-focus/workspace/src/cli.ts
