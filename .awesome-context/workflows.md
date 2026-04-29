# Workflows

- Repeatable task playbooks (build, test, release, deploy).
- Keep commands short and copy-paste ready.

## Agent Command Triggers

Rules for AI agents: fire these commands based on what is happening in the conversation, not on a schedule.

| Situation | Command to run |
|---|---|
| User asks to work on a specific file | `ace context:pack <file>` — load context before starting |
| You (agent) finish making file changes | `ace sync` — rebuild ai-context.md |
| User says "remember this", "note that", "keep this in mind" | `ace genesis capture --note "<lesson>"` |
| User asks "what did we decide", "do you remember", "what was the pattern" | `ace genesis recall "<topic>"` |
| User asks "what files depend on X" or impact of a change | `ace context:impact <file>` |
| User asks to summarize or explain a file for context | `ace context:explain <file>` |
| User adds a persistent preference or rule | `ace memory add "<content>"` |
| User asks what you remember about the project | `ace memory list` |
| Session starts fresh and no context loaded yet | `ace context:pack <entry-file>` then read the output |

## Rules
- NEVER run `ace auto` — it is a continuous file watcher that consumes RAM. It is not for agent use.
- Run `ace sync` after every set of file changes, not before.
- Run `ace context:pack` at the START of working on a file, not after.
- `ace genesis capture` should store lessons, patterns, and decisions — not raw file content.
- Do not run commands speculatively. Only fire when the situation matches the trigger above.

<!-- awesome-context-engine:scan:start -->
## Auto-Scanned Workflows

- Install dependencies: npm install
- Run locally: npm run dev
- Build: npm run build
- Test: npm run test
- Context maintenance: run `ace context:pack <file>` before focused work, `ace sync` after file changes, and `ace context:refresh` on demand.
<!-- awesome-context-engine:scan:end -->
