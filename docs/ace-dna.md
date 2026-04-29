# ACE DNA

ACE DNA is the compact file-level context layer in Awesome Context Engine.

It works alongside repo-level context in `.awesome-context/`.

## What It Adds

- small `@ace-dna` headers on supported source files
- machine-readable metadata in `.awesome-context/file-context.json`
- dependency graph in `.awesome-context/graph.json`
- impact graph in `.awesome-context/impact-map.json`
- minimal task-oriented context packs

## When To Use It

Use ACE DNA when:

- agents need quick local context near code
- you want fast impact checks before edits
- CI should detect stale or malformed context headers

Skip ACE DNA when:

- repository-level context is enough
- file-level headers would add noise to tiny one-file scripts

## Token Tradeoffs

ACE DNA is designed to reduce net token usage by:

- keeping headers short and deterministic
- moving deep context into `.awesome-context/` JSON/Markdown files
- limiting related/consumed lists via command options

If headers become noisy, reduce scope with `--include`/`--exclude` and lower `--max-related`.

## Repo Memory vs ACE DNA

Repo memory (`memory.md`, `decisions.md`, `workflows.md`, `preferences.md`) stores global and durable project knowledge.

ACE DNA stores local, file-specific operational context:

- what a file provides
- who consumes it
- local constraints
- nearby related files

Use both together for best results.

## CI Safety

Recommended CI checks:

```bash
ace graph
ace context:check --ci
```

Guidelines:

- run `ace context:refresh` before check when code changes
- fail CI only in `--ci` mode for actionable errors
- keep headers deterministic and small
- never store secrets or environment values in generated context
