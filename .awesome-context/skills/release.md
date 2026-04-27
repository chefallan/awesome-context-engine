---
skill: release
title: Release
fingerprint: node scripts/release.mjs||npm run build
generatedAt: 2026-04-27T14:15:52.205Z
locked: false
---

# Release

## Quick Start

```bash
npm run release
```

## How It Works
- The `npm run release` command executes `scripts/release.mjs` for versioning and packaging.
- Prior to publishing, `npm run prepublishOnly` triggers the `npm run build` script, compiling TypeScript to JavaScript.
- The `clean` script can be run to remove the `dist` folder before a fresh build, if needed.

## Variants

- `npm run clean`
- `npm run build`

## Watch Out For
- Ensure that the TypeScript compiler (`tsc`) is correctly configured to avoid build errors.
- Running `npm run clean` will delete the entire `dist` directory, so use it cautiously.