# Project Map

Generated at: 2026-04-24T23:28:49.870Z

## Repository Snapshot
- Total files: 36
- Total directories: 12
- Truncated scan: no

## Folder Tree (max depth 3)

```text
.
├── .continue/
│   └── context.md
├── .github/
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
├── src/
│   ├── cli.ts
│   ├── doctor.ts
│   ├── graph.ts
│   ├── indexer.ts
│   ├── init.ts
│   ├── redact.ts
│   ├── sync.ts
│   ├── templates.ts
│   ├── ui.ts
│   ├── vscode-task.ts
│   └── watcher.ts
├── .clinerules
├── .gitattributes
├── .gitignore
├── .gitignroe
├── .npmignore
├── AGENTS.md
├── CLAUDE.md
├── package-lock.json
├── package.json
├── README.md
└── tsconfig.json
```

## Detected Languages
- Markdown: 13
- TypeScript: 11
- JSON: 5

## Detected Frameworks
- none

## Package Scripts
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
