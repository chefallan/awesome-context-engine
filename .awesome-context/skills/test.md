---
skill: test
title: Testing
fingerprint: npm run build && node --test test/*.test.mjs|||
generatedAt: 2026-04-29T01:06:21.308Z
locked: false
---

# Testing

## Quick Start
```bash
npm run test
```

## How It Works
- Runner: node --test
- Test files: `**/*.test.*` / `**/*.spec.*` / `__tests__/`

## Watch Out For
- Build first if tests import from `dist/`: `npm run build && npm run test`
- Snapshot files are committed — update with `--updateSnapshot` flag
