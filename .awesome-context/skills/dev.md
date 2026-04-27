---
skill: dev
title: Dev Server
fingerprint: tsc -w -p .|node dist/cli.js
generatedAt: 2026-04-27T14:15:52.310Z
locked: false
---

# Dev Server

## Quick Start

```bash
npm run dev
npm run start
```

## How It Works
- `npm run dev` starts TypeScript's compiler in watch mode, allowing for real-time updates.
- Changes in TypeScript files trigger recompilation, outputting compiled JavaScript to the `dist` directory.
- `npm run start` executes the generated `cli.js` file using Node.js.

## Variants

None.

## Watch Out For
- Ensure the TypeScript configuration in `tsconfig.json` is correctly set up to output to the expected `dist` folder.
- If `cli.js` doesn't run as expected, check for compilation errors during `npm run dev`.