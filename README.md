# awesome-context-engine

Portable repo memory and context optimization for AI coding agents.

[![npm version](https://img.shields.io/npm/v/awesome-context-engine.svg)](https://www.npmjs.com/package/awesome-context-engine)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![node >=18](https://img.shields.io/badge/node-%3E%3D18-339933.svg)](https://nodejs.org/)

awesome-context-engine keeps AI sessions focused by generating compact, relevant context from your repository state, decisions, and memory.

## Why Use It

- Reduce prompt noise and token waste
- Keep project context fresh after code changes
- Persist team and project memory in-repo
- Improve consistency across AI coding assistants

## Install

```bash
npx awesome-context-engine
```

Shorthand command after install:

```bash
ace <command>
```

## Quick Start (2 Minutes)

```bash
ace init
ace context:pack src/cli.ts
ace sync
ace doctor
```

What this does:

- `init`: bootstrap `.awesome-context` and integration instructions
- `context:pack <file>`: produce focused context for one coding task
- `sync`: rebuild compact `ai-context.md` after changes
- `doctor`: validate setup and detect issues early

## Why Context Optimization Matters

This project uses a SWE-bench-like comparison format: identical task intent, compared with and without awesome-context-engine context optimization.

Run commands:

```bash
ace benchmark --json --compact
ace benchmark:eval --json --compact
npm run benchmark:real
npm run benchmark:external
```

### SWE-Like Benchmark Table (Measured)

<!-- benchmark:local:start -->
| Scenario | Model | Assistant | Context Size | Repo / Task Type | Without ACE Tokens | With ACE Tokens | Reduction | Data Source |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |
| api-bugfix-triage | GPT-5 | VS Code Copilot Chat | large | TypeScript CLI core / command routing | 19488 | 341 | 98.25% | measured local suite (src/cli.ts) |
| auth-refactor | Claude Sonnet 4 | VS Code Copilot Chat | medium | Learning profile logic / approval flow | 13587 | 386 | 97.16% | measured local suite (src/genesis.ts) |
| ui-regression-fix | Gemini 2.5 Pro | VS Code Copilot Chat | medium | CLI UI rendering / formatting behavior | 6705 | 361 | 94.62% | measured local suite (src/ui.ts) |
| release-pipeline-edit | o3 | VS Code Copilot Chat | small | Release automation script updates | 7021 | 354 | 94.96% | measured local suite (scripts/release.mjs) |
| docs-code-alignment | GPT-4.1 | VS Code Copilot Chat | small | Documentation and command alignment | 2566 | 335 | 86.94% | measured local suite (README.md) |

Notes:

- This table includes only measured data from real local command output.
- No estimated scenarios are shown.
- Reproduce these rows with `npm run benchmark:real`; source artifact: `.awesome-context/benchmark/real-suite-results.json`.
- Assistant scope is intentionally constrained to `VS Code Copilot Chat`.
- Model labels use GitHub Copilot model options used for these measured runs.
- Official SWE-bench pass-rate style metrics (for example pass@1 or resolve rate) require measured multi-scenario execution and are not claimed here.
<!-- benchmark:local:end -->

### External GitHub Benchmark Table (Measured)

<!-- benchmark:external:start -->
| Scenario | Repository | Commit | Model | Assistant | Context Size | Without ACE Tokens | With ACE Tokens | Reduction | Data Source |
| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |
| chalk-core | chalk/chalk | aa06bb5 | GPT-5 | VS Code Copilot Chat | small | 1828 | 850 | 53.5% | measured external GitHub run |
| ky-http-client | sindresorhus/ky | e0fcf78 | Claude Sonnet 4 | VS Code Copilot Chat | medium | 2166 | 837 | 61.36% | measured external GitHub run |
| axios-networking | axios/axios | 9fcdf48 | Gemini 2.5 Pro | VS Code Copilot Chat | large | 4255 | 830 | 80.49% | measured external GitHub run |

Notes:

- This table is measured from real runs on shallow-cloned public GitHub repositories in `test/external-repos/`.
- Assistant scope is `VS Code Copilot Chat` only.
- Model labels use GitHub Copilot model options used for these measured runs.
- Reproduce with `npm run benchmark:external`; source artifact: `.awesome-context/benchmark/external-github-results.json`.
<!-- benchmark:external:end -->

## Core Commands

Daily workflow:

```bash
ace context:pack <file>   # before focused coding
# ...make changes...
ace sync                  # after changes
```

Setup and maintenance:

```bash
ace init                  # first-run bootstrap
ace scan                  # baseline existing repository context
ace index                 # refresh project map only
ace graph                 # regenerate dependency graph
ace benchmark             # compare raw vs optimized context token estimates
ace benchmark:eval        # run SWE-bench-inspired eval harness
npm run benchmark:eval:prepare   # generate measured-run template JSONL
npm run benchmark:eval:validate -- --input .awesome-context/benchmark/measured-runs.template.jsonl
npm run benchmark:eval:apply -- --input .awesome-context/benchmark/measured-runs.template.jsonl
ace doctor                # health checks
```

Context commands:

```bash
ace context:pack <file>
ace context:impact <file>
ace context:refresh
ace context:check
ace context:explain <file>
```

Memory commands:

```bash
ace memory add --type preference --text "Use concise docs"
ace memory search --query "docs"
ace memory summarize
ace memory prune
```

Learning commands (ACE Genesis):

```bash
ace learn:capture --file exports/session.txt --summary "fixed flaky tests"
ace learn:recall "flaky tests"
ace learn:suggest
ace learn:skill
ace learn:reflect
ace learn:profile
```

## Skills: Repo-Derived vs Learning-Derived

- Repo-derived skills are generated by `sync` only when `skills.enabled=true` in `.awesome-context/config.json`.
- Default is `skills.enabled=false`.
- Learning-derived skill drafts are created by Genesis under `.awesome-context/skills/drafts/`.

## Works With

Claude Code, Codex, OpenCode, Cursor, Gemini CLI, GitHub Copilot CLI, VS Code Copilot Chat, Aider, OpenClaw, Factory Droid, Trae, Hermes, Kiro, Google Antigravity, Cline, Continue.

## Safety

- Runs locally in your repository
- Redacts secret-like content before memory/context persistence
- Strict mode available: `ace sync --strict`
- Benchmark output is estimate-based, not billing-exact

## Benchmark Methodology

Run local A/B comparison:

```bash
ace sync
ace benchmark
ace benchmark --json --compact
ace benchmark:eval --json --compact
npm run benchmark:eval:prepare
```

Comparison model:

- Baseline: raw source context files
- Optimized: generated `.awesome-context/ai-context.md`
- Token estimate heuristic: `chars / 4` (model-agnostic estimate)
- Scenario scaling: baseline/optimized tokens scaled across model/assistant/context-size/task profiles
- Cost estimates: approximate input-token cost by model class (estimates, not billing guarantees)

Eval harness artifacts:

- Scenario manifest: `.awesome-context/benchmark/eval-scenarios.json`
- Results output: `.awesome-context/benchmark/eval-results.json`
- Measured run template: `.awesome-context/benchmark/measured-runs.template.jsonl`

To convert estimated rows into measured rows, populate `measured` fields per scenario in the manifest (tokens, optional costs, relevance scores, success rates).

Scripted measured workflow:

1. `npm run benchmark:eval:prepare`
2. Fill `.awesome-context/benchmark/measured-runs.template.jsonl` with real runs (one JSON object per line)
3. `npm run benchmark:eval:validate -- --input .awesome-context/benchmark/measured-runs.template.jsonl`
4. `npm run benchmark:eval:apply -- --input .awesome-context/benchmark/measured-runs.template.jsonl`
5. Inspect `.awesome-context/benchmark/eval-results.json`

Validation notes:

- `validate` checks schema/ranges and warns if a scenario is missing Claude or GPT rows.
- Add `--strict-coverage true` to fail validation on coverage warnings.

## Project Layout

```text
.awesome-context/
  ai-context.md
  project-map.md
  minimal-context.md
  graph.json
  cache.json
  memory/
  skills/
```

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
