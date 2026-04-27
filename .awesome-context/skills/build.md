---
skill: build
title: Build
fingerprint: tsc||node -e "require('fs').rmSync('dist',{recursive:true,force:true})"
generatedAt: 2026-04-27T15:53:06.914Z
locked: false
---

# Build

## Quick Start

To build the project for production:

```bash
npm run clean
npm run build
```

## How It Works
- `npm run clean`: Removes the `dist` directory to ensure a fresh build environment.
- `npm run build`: Compiles TypeScript files using the TypeScript compiler (tsc) into JavaScript, outputting them into the `dist` directory.

## Variants

None.

## Watch Out For
- Ensure TypeScript is correctly configured; missing configuration files can lead to build errors.
- If `dist` contains untracked files, consider running `npm run clean` before the build to avoid stale files affecting the build output.