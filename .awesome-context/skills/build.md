---
skill: build
title: Build
fingerprint: tsc||node -e "require('fs').rmSync('dist',{recursive:true,force:true})"
generatedAt: 2026-04-27T15:23:41.333Z
locked: false
---

# Build

## Quick Start

```bash
npm run clean
npm run build
```

## How It Works
- The `npm run clean` command removes the `dist` directory, ensuring a fresh build environment.
- The `npm run build` command invokes TypeScript's compiler (`tsc`) to compile and bundle the project into the `dist` folder as per defined TypeScript configurations.

## Variants

- None

## Watch Out For
- Ensure your TypeScript configurations are correctly set up before building to avoid compilation errors.
- If you modify TypeScript files directly without cleaning, you may run into issues with stale code in the `dist` directory.