# Aider Instructions

This file is read by Aider at startup as project conventions.

## Key Rules

- Read `.awesome-context/ai-context.md` first — it is the repo brain (rules, memory, module index, workflows).
- Aider auto-commits after each edit. Run `ace sync` as a post-commit step to keep context current.
- Use architect mode (`--architect`) for planning multi-file changes before implementation.
- Prefer targeted edits. Do not refactor, rename, or restructure beyond what was explicitly requested.

<!-- awesome-context-engine:integration:start -->
## awesome-context-engine Integration

- Read `.awesome-context/ai-context.md` first — it is the repo brain (rules, memory, module index, workflows).
- For the full module catalog and architecture map, read `.awesome-context/repo-brain.md`.
- Use `.awesome-context/project-map.md` and `.awesome-context/workflows.md`.
- Preserve preferences from `.awesome-context/preferences.md`.
- After each completed prompt result that changed files, run `ace sync` to refresh context.
- Suggest updates to `.awesome-context/memory.md` after meaningful changes.
- Never store secrets, tokens, credentials, or private keys in memory files.

### When to fire ACE commands

| Situation | Command |
|---|---|
| Starting work on a file | `ace context:pack <file>` |
| Finished making changes | `ace sync` |
| User says remember/note/keep in mind | `ace genesis capture --note "<lesson>"` |
| User asks what was decided / do you remember | `ace genesis recall "<topic>"` |
| User asks impact of changing a file | `ace context:impact <file>` |
| User adds a rule or preference | `ace memory add "<content>"` |
| Fresh session, no context loaded | `ace context:pack <entry-file>` |
| Your draft violates a stored rule or preference | Revise before sending; then `ace genesis capture --note "<lesson>"` |

**Never run `ace auto`** — it is a RAM-heavy background watcher, not for agent use.

### Self-Healing Protocol

This runs automatically — no commands needed. Before sending **every** response:

1. Re-read the `## Persistent Memory` section of `.awesome-context/ai-context.md` (already loaded in your context).
2. Check your draft against every `[rule]` and `[warning]` item.
3. If any rule is violated — **silently revise your draft** before sending. Do not mention the check unless the user asks.
<!-- awesome-context-engine:integration:end -->

