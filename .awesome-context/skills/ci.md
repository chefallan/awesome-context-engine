---
skill: ci
title: CI / CD
fingerprint: .github/workflows
generatedAt: 2026-04-27T14:15:51.881Z
locked: false
---

# CI / CD

## Quick Start
```bash
npm run build
npm run test
```

## How It Works
- `npm run build` uses TypeScript Compiler (`tsc`) to transpile TypeScript files into JavaScript.
- `npm run test` executes Node.js' built-in testing module to run tests defined in the project.
- `npm run release` triggers a custom script to handle project release processes, defined in `scripts/release.mjs`.

## Variants
```bash
npm run release
```

## Watch Out For
- Ensure TypeScript configuration (`tsconfig.json`) is correctly set up before running the build.
- Node.js test module may not provide full compatibility with all testing libraries; verify compatibility before using.
- The release script may require specific environment variables to be set for proper execution.