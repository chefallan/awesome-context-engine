# awesome-context-engine

Portable repo memory and AI context optimization for any AI coding tool.

[![npm version](https://img.shields.io/npm/v/awesome-context-engine.svg)](https://www.npmjs.com/package/awesome-context-engine)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![node >=18](https://img.shields.io/badge/node-%3E%3D18-339933.svg)](https://nodejs.org/)

`ace` keeps AI coding sessions focused by generating compact, relevant context from your repo — cutting token usage by up to 98% without losing the information that matters.

---

## Install

```bash
npm install -g awesome-context-engine
```

Or run without installing:

```bash
npx awesome-context-engine
```

---

## Quick Start

```bash
ace init              # bootstrap .awesome-context/ and pick your AI tools
ace context:pack <file>       # load focused context before a coding task
# ...make your changes...
ace sync              # rebuild ai-context.md after changes
```

`ace init` will prompt you to select which AI tools you use (GitHub Copilot, Claude, Cursor, Gemini, Aider, Cline, etc.) and create the right integration file for each one.

To add more tools later:

```bash
ace init:add          # interactive picker
ace init:add --tools gemini,kiro   # or specify directly
```

---

## How It Works

On `ace sync`, the engine reads your repo state and writes `.awesome-context/ai-context.md` — a compact summary containing active rules, memory, module index, and workflows. Every integration file (CLAUDE.md, copilot-instructions.md, AGENTS.md, etc.) points the AI tool at this file first.

Instead of sending thousands of tokens of raw source to the AI, you send one focused file.

---

## Benchmark Results

Token reduction measured on real local and external repos.

### Local Repo (this project)

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

### External GitHub Repos

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

Reproduce benchmarks:

```bash
npm run benchmark:real
npm run benchmark:external
```

---

## Core Commands

```bash
ace init                    # first-run setup, choose AI tools
ace init:add                # add more AI tool integrations later
ace context:pack <file>     # focused context before coding
ace sync                    # rebuild context after changes
ace scan                    # re-baseline repo context
ace doctor                  # health check
```

Memory:

```bash
ace memory add --type preference --text "Always use TypeScript"
ace memory search --query "typescript"
ace memory list
```

Learning (Genesis):

```bash
ace learn:capture --note "lesson learned"
ace learn:recall "topic"
```

---

## Supported AI Tools

Works with: **GitHub Copilot**, **Claude / Claude Code**, **OpenAI Codex / Agents**, **Cursor**, **Gemini CLI**, **Aider**, **OpenCode**, **Cline**, **Continue**, **Trae**, **Kiro**, **Hermes**, **Factory Droid**, **OpenClaw**, **Google Antigravity**.

---

## Safety

- Runs entirely locally — no data leaves your machine
- Automatically redacts secrets, tokens, API keys, and private keys before writing to memory or context files
- `ace sync --strict` exits non-zero on any detected issue

---

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).

