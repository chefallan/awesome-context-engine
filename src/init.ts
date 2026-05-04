import { promises as fs } from "node:fs";
import path from "node:path";
import { getContextPaths } from "./templates.js";

type SeedMemoryItem = {
  id: string;
  type: string;
  text: string;
  source: string;
  tags: string[];
  importance: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: null;
  useCount: number;
  expiresAt: null;
};

function makeSeedItems(): SeedMemoryItem[] {
  const now = new Date().toISOString();
  const seed = (id: string, type: string, text: string, tags: string[], importance: number): SeedMemoryItem => ({
    id,
    type,
    text,
    source: "scan",
    tags,
    importance,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    useCount: 0,
    expiresAt: null
  });

  return [
    seed("mem_seed_rule_1", "rule", "Never store secrets, tokens, credentials, or private keys in memory files or generated content.", ["security"], 5),
    seed("mem_seed_rule_2", "rule", "Before sending any response, check the rules and warnings in ai-context.md and revise if any are violated.", ["self-heal", "quality"], 5),
    seed("mem_seed_rule_3", "rule", "Run ace sync after every set of file changes to keep ai-context.md current.", ["workflow"], 4),
    seed("mem_seed_warning_1", "warning", "Stale ai-context.md means the agent is working with outdated rules. Re-run ace sync if context feels wrong.", ["workflow"], 4)
  ];
}

export type InitResult = {
  created: string[];
  skipped: string[];
};

type IntegrationFileSpec = {
  relativePath: string;
  content: string;
  toolKey: string;
};

export type ToolInfo = {
  key: string;
  label: string;
};

export const AVAILABLE_TOOLS: ToolInfo[] = [
  { key: "copilot",          label: "GitHub Copilot (.github/copilot-instructions.md)" },
  { key: "claude",           label: "Claude / Claude Code (CLAUDE.md)" },
  { key: "agents",           label: "OpenAI Agents / Codex (AGENTS.md)" },
  { key: "cursor",           label: "Cursor (.cursor/rules + .cursorrules)" },
  { key: "gemini",           label: "Gemini CLI (GEMINI.md)" },
  { key: "aider",            label: "Aider (AIDER.md)" },
  { key: "opencode",         label: "OpenCode (OPENCODE.md)" },
  { key: "openclaw",         label: "OpenClaw (OPENCLAW.md)" },
  { key: "factory-droid",    label: "Factory Droid (FACTORY_DROID.md)" },
  { key: "trae",             label: "Trae (TRAE.md)" },
  { key: "hermes",           label: "Hermes (HERMES.md)" },
  { key: "kiro",             label: "Kiro (KIRO.md)" },
  { key: "google-antigravity",label: "Google Antigravity (GOOGLE-ANTIGRAVITY.md)" },
  { key: "continue",         label: "Continue (.continue/context.md)" },
  { key: "cline",            label: "Cline (.clinerules)" },
];

const CONTEXT_FILES: Array<{ path: (paths: ReturnType<typeof getContextPaths>) => string; content: string }> = [
  {
    path: (paths) => paths.memoryPath,
    content: "# Memory\n\n- Update after meaningful project changes.\n- Keep concise, reusable context for future tasks.\n"
  },
  {
    path: (paths) => paths.workflowsPath,
    content: "# Workflows\n\n- Repeatable task playbooks (build, test, release, deploy).\n- Keep commands short and copy-paste ready.\n\n## Agent Command Triggers\n\nRules for AI agents: fire these commands based on what is happening in the conversation, not on a schedule.\n\n| Situation | Command to run |\n|---|---|\n| User asks to work on a specific file | `ace context:pack <file>` — load context before starting |\n| You (agent) finish making file changes | `ace sync` — rebuild ai-context.md |\n| User says \"remember this\", \"note that\", \"keep this in mind\" | `ace genesis capture --note \"<lesson>\"` |\n| User asks \"what did we decide\", \"do you remember\", \"what was the pattern\" | `ace genesis recall \"<topic>\"` |\n| User asks what files depend on X or impact of a change | `ace context:impact <file>` |\n| User asks to summarize or explain a file for context | `ace context:explain <file>` |\n| User adds a persistent preference or rule | `ace memory add \"<content>\"` |\n| User asks what you remember about the project | `ace memory list` |\n| Session starts fresh and no context loaded yet | `ace context:pack <entry-file>` then read the output |\n| Your draft violates a stored rule or preference | Revise before sending; then `ace genesis capture --note \"<lesson>\"` |\n\n## Self-Healing Protocol (Automatic — No Commands Needed)\n\nBefore sending every response:\n\n1. Re-read the `## Persistent Memory` section of `.awesome-context/ai-context.md` (it is already in your context).\n2. Check your draft against every `[rule]` and `[warning]` item.\n3. If any rule is violated — **silently revise your draft** before sending. Do not mention the check unless the user asks.\n\nThe rules are injected automatically by `ace sync`. No manual commands are required for this check.\n\n## Rules\n- NEVER run `ace auto` — it is a continuous file watcher that consumes RAM. It is not for agent use.\n- Run `ace sync` after every set of file changes, not before.\n- Run `ace context:pack` at the START of working on a file, not after.\n- `ace genesis capture` should store lessons, patterns, and decisions — not raw file content.\n- Do not run commands speculatively. Only fire when the situation matches the trigger above.\n"
  },
  {
    path: (paths) => paths.decisionsPath,
    content: "# Decisions\n\n- Record important technical/product decisions and rationale.\n- Include date and impact.\n"
  },
  {
    path: (paths) => paths.preferencesPath,
    content: "# Preferences\n\n- Team coding preferences, style, and constraints.\n- Preserve these in all generated changes.\n"
  },
  {
    path: (paths) => paths.configPath,
    content:
      '{\n' +
      '  "autoScanOnInit": true,\n' +
      '  "memory": {\n' +
      '    "enabled": true,\n' +
      '    "maxItems": 8,\n' +
      '    "maxTokens": 1200,\n' +
      '    "includeTypes": ["rule", "preference", "decision", "project_state", "fact", "warning", "style"],\n' +
      '    "excludeTypes": [],\n' +
      '    "strictRedaction": true\n' +
        '  },\n' +
        '  "cache": {\n' +
        '    "enabled": true,\n' +
        '    "incremental": true\n' +
        '  },\n' +
        '  "context": {\n' +
        '    "defaultTokenBudget": 4000,\n' +
        '    "maxRelatedFiles": 8\n' +
        '  },\n' +
        '  "learning": {\n' +
        '    "enabled": true,\n' +
        '    "captureByDefault": false,\n' +
        '    "requireApprovalForProfile": true,\n' +
        '    "autoApproveSafeProfile": true,\n' +
        '    "maxExperienceFiles": 500,\n' +
        '    "skillSuggestionThreshold": 3,\n' +
        '    "recallLimit": 8\n' +
      '  },\n' +
      '  "skills": {\n' +
      '    "enabled": false\n' +
      '  }\n' +
      '}\n'
  },
  {
    path: (paths) => paths.aiContextPath,
    content: "# AI Context\n\nGenerated by awesome-context-engine sync.\n"
  },
  {
    path: (paths) => paths.projectMapPath,
    content: "# Project Map\n\nGenerated by awesome-context-engine index.\n"
  },
  {
    path: (paths) => paths.minimalContextPath,
    content: "# Minimal Context\n\nGenerated by awesome-context-engine sync.\n"
  },
  {
    path: (paths) => path.join(paths.contextDir, "memory-index.json"),
    content: "{}\n"
  },
  {
    path: (paths) => path.join(paths.contextDir, "profile.json"),
    content:
      '{\n' +
      '  "version": 1,\n' +
      '  "preferences": {\n' +
      '    "naming": [],\n' +
      '    "coding": [],\n' +
      '    "docs": []\n' +
      '  },\n' +
      '  "projects": {},\n' +
      '  "sources": {}\n' +
      '}\n'
  },
  {
    path: (paths) => path.join(paths.contextDir, "skill-suggestions.json"),
    content: "[]\n"
  }
];

const INTEGRATION_FILES: IntegrationFileSpec[] = [
  {
    toolKey: "copilot",
    relativePath: ".github/copilot-instructions.md",
    content:
      "# GitHub Copilot Instructions\n\n" +
      "These instructions apply to all Copilot Chat and Copilot agent-mode interactions in this workspace.\n\n" +
      "## Key Rules\n\n" +
      "- Read `.awesome-context/ai-context.md` first on every session — it contains active rules, memory, and module index.\n" +
      "- Prefer agent mode for multi-file tasks. Use workspace context before generating code.\n" +
      "- Always read a file before editing it. Never overwrite unfamiliar content.\n" +
      "- Keep changes minimal and targeted — do not refactor beyond what was asked.\n"
  },
  {
    toolKey: "agents",
    relativePath: "AGENTS.md",
    content:
      "# Agent Rules\n\n" +
      "These rules apply to OpenAI Codex CLI and compatible agent runtimes (e.g. OpenAI Responses API agents).\n\n" +
      "## Key Rules\n\n" +
      "- Read `.awesome-context/ai-context.md` first — it is the repo brain (rules, memory, module index, workflows).\n" +
      "- The agent may run shell commands. The `ace` CLI is available — use it for context and memory operations.\n" +
      "- Prefer targeted file edits over full rewrites. Confirm before any destructive shell operation.\n" +
      "- Do not exceed the scope of the task. Ask before adding dependencies or changing project structure.\n"
  },
  {
    toolKey: "claude",
    relativePath: "CLAUDE.md",
    content:
      "# Claude Project Rules\n\n" +
      "This file is loaded automatically by Claude Code at every session start.\n\n" +
      "## Key Rules\n\n" +
      "- Read `.awesome-context/ai-context.md` first — it is the repo brain (rules, memory, module index, workflows).\n" +
      "- The `ace` CLI is available via the Bash tool. Use it for context packing, sync, and memory operations.\n" +
      "- Read files before editing them. Use `@file` references to load specific files into context.\n" +
      "- Keep changes minimal and targeted. Do not refactor, add comments, or restructure beyond what was asked.\n"
  },
  {
    toolKey: "cline",
    relativePath: ".clinerules",
    content:
      "# Cline Rules\n\n" +
      "Cline is an autonomous agent — apply extra care with destructive operations.\n\n" +
      "## Key Rules\n\n" +
      "Read .awesome-context/ai-context.md first on every session.\n" +
      "Always read a file before editing it. Never overwrite unfamiliar content.\n" +
      "Prefer targeted, minimal changes over large rewrites.\n" +
      "Confirm before running commands that delete files, drop data, or push to remote.\n" +
      "Run ace sync after every set of file changes to keep ai-context.md current.\n" +
      "Never store secrets, tokens, credentials, or private keys in memory files.\n"
  },
  {
    toolKey: "continue",
    relativePath: ".continue/context.md",
    content:
      "# Continue Context\n\n" +
      "This file provides persistent project context to the Continue VS Code extension.\n\n" +
      "## Key Rules\n\n" +
      "- Read `.awesome-context/ai-context.md` first — it is the repo brain (rules, memory, module index, workflows).\n" +
      "- Use `@codebase` to search across the repo, or `@file` to load specific files into context.\n" +
      "- Run `ace sync` after every set of file changes to keep context fresh.\n" +
      "- Never store secrets, tokens, credentials, or private keys in memory files.\n"
  },
  {
    toolKey: "gemini",
    relativePath: "GEMINI.md",
    content:
      "# Gemini CLI Instructions\n\n" +
      "This file is loaded by the Gemini CLI as project context on startup.\n\n" +
      "## Key Rules\n\n" +
      "- Read `.awesome-context/ai-context.md` first — it is the repo brain (rules, memory, module index, workflows).\n" +
      "- The `ace` CLI is available in the shell. Use it for context packing, sync, and memory operations.\n" +
      "- Read files before editing them. Keep changes minimal and targeted.\n" +
      "- Run `ace sync` after every set of file changes. Never store secrets in memory files.\n"
  },
  {
    toolKey: "aider",
    relativePath: "AIDER.md",
    content:
      "# Aider Instructions\n\n" +
      "This file is read by Aider at startup as project conventions.\n\n" +
      "## Key Rules\n\n" +
      "- Read `.awesome-context/ai-context.md` first — it is the repo brain (rules, memory, module index, workflows).\n" +
      "- Aider auto-commits after each edit. Run `ace sync` as a post-commit step to keep context current.\n" +
      "- Use architect mode (`--architect`) for planning multi-file changes before implementation.\n" +
      "- Prefer targeted edits. Do not refactor, rename, or restructure beyond what was explicitly requested.\n"
  },
  {
    toolKey: "opencode",
    relativePath: "OPENCODE.md",
    content:
      "# OpenCode Instructions\n\n" +
      "This file is loaded by OpenCode as project rules at session start.\n\n" +
      "## Key Rules\n\n" +
      "- Read `.awesome-context/ai-context.md` first — it is the repo brain (rules, memory, module index, workflows).\n" +
      "- The `ace` CLI is available in the terminal. Use it for context packing, sync, and memory operations.\n" +
      "- Read files before editing them. Keep changes minimal and targeted.\n" +
      "- Run `ace sync` after every set of file changes. Never store secrets in memory files.\n"
  },
  {
    toolKey: "openclaw",
    relativePath: "OPENCLAW.md",
    content:
      "# OpenClaw Instructions\n\n" +
      "This file is loaded by OpenClaw as project rules at session start.\n\n" +
      "## Key Rules\n\n" +
      "- Read `.awesome-context/ai-context.md` first — it is the repo brain (rules, memory, module index, workflows).\n" +
      "- Read files before editing them. Keep changes minimal and targeted.\n" +
      "- Run `ace sync` after every set of file changes. Never store secrets in memory files.\n"
  },
  {
    toolKey: "factory-droid",
    relativePath: "FACTORY_DROID.md",
    content:
      "# Factory Droid Instructions\n\n" +
      "These rules apply when Factory Droid processes issues, pull requests, and automated tasks in this repo.\n\n" +
      "## Key Rules\n\n" +
      "- Read `.awesome-context/ai-context.md` first — it is the repo brain (rules, memory, module index, workflows).\n" +
      "- Scope all changes to the task at hand. Do not touch unrelated files.\n" +
      "- Run `ace sync` after every set of file changes to keep context current.\n" +
      "- Never store secrets, tokens, credentials, or private keys in generated content.\n"
  },
  {
    toolKey: "trae",
    relativePath: "TRAE.md",
    content:
      "# Trae Instructions\n\n" +
      "This file is loaded by Trae IDE as workspace rules at startup.\n\n" +
      "## Key Rules\n\n" +
      "- Read `.awesome-context/ai-context.md` first — it is the repo brain (rules, memory, module index, workflows).\n" +
      "- Use the built-in terminal to run `ace` CLI commands for context and memory operations.\n" +
      "- Read files before editing them. Keep changes minimal and targeted.\n" +
      "- Run `ace sync` after every set of file changes. Never store secrets in memory files.\n"
  },
  {
    toolKey: "hermes",
    relativePath: "HERMES.md",
    content:
      "# Hermes Instructions\n\n" +
      "This file is loaded by Hermes as project rules at session start.\n\n" +
      "## Key Rules\n\n" +
      "- Read `.awesome-context/ai-context.md` first — it is the repo brain (rules, memory, module index, workflows).\n" +
      "- The `ace` CLI is available in the terminal. Use it for context packing, sync, and memory operations.\n" +
      "- Read files before editing them. Keep changes minimal and targeted.\n" +
      "- Run `ace sync` after every set of file changes. Never store secrets in memory files.\n"
  },
  {
    toolKey: "kiro",
    relativePath: "KIRO.md",
    content:
      "# Kiro Instructions\n\n" +
      "This file is loaded by Kiro IDE as workspace rules at startup.\n\n" +
      "## Key Rules\n\n" +
      "- Read `.awesome-context/ai-context.md` first — it is the repo brain (rules, memory, module index, workflows).\n" +
      "- Kiro uses spec-driven development — define features as specs before writing implementation code.\n" +
      "- Use `.kiro/steering/` for additional persistent project context (product overview, tech stack, conventions).\n" +
      "- Run `ace sync` after every set of file changes to keep context fresh.\n" +
      "- Never store secrets, tokens, credentials, or private keys in steering or memory files.\n"
  },
  {
    toolKey: "google-antigravity",
    relativePath: "GOOGLE-ANTIGRAVITY.md",
    content:
      "# Google Antigravity Instructions\n\n" +
      "This file is loaded by Google Antigravity as project rules at session start.\n\n" +
      "## Key Rules\n\n" +
      "- Read `.awesome-context/ai-context.md` first — it is the repo brain (rules, memory, module index, workflows).\n" +
      "- The `ace` CLI is available in the terminal. Use it for context packing, sync, and memory operations.\n" +
      "- Read files before editing them. Keep changes minimal and targeted.\n" +
      "- Run `ace sync` after every set of file changes. Never store secrets in memory files.\n"
  },
  {
    toolKey: "cursor",
    relativePath: ".cursor/rules/awesome-context.mdc",
    content:
      "---\ndescription: awesome-context-engine context and memory rules\nglobs:\nalwaysApply: true\n---\n# awesome-context-engine Rules\n\n- Read .awesome-context/ai-context.md first.\n- Use .awesome-context/project-map.md and .awesome-context/workflows.md.\n- Preserve preferences from .awesome-context/preferences.md.\n- After completing tasks that changed files, run `ace sync` to refresh context.\n- Suggest updates to .awesome-context/memory.md after meaningful changes.\n- Never store secrets, tokens, credentials, or private keys in memory files.\n\n## When to fire ACE commands\n\n| Situation | Command |\n|---|---|\n| Starting work on a file | `ace context:pack <file>` |\n| Finished making changes | `ace sync` |\n| User says remember/note/keep in mind | `ace genesis capture --note \"<lesson>\"` |\n| User asks what was decided / do you remember | `ace genesis recall \"<topic>\"` |\n| User asks impact of changing a file | `ace context:impact <file>` |\n| User adds a rule or preference | `ace memory add \"<content>\"` |\n| Fresh session, no context loaded | `ace context:pack <entry-file>` |\n| Your draft violates a stored rule or preference | Revise before sending; then `ace genesis capture --note \"<lesson>\"` |\n\n**Never run `ace auto`** — it is a RAM-heavy background watcher, not for agent use.\n\n## Self-Healing Protocol (Automatic — No Commands Needed)\n\nBefore sending every response:\n\n1. Re-read the `## Persistent Memory` section of `.awesome-context/ai-context.md` (already loaded in your context).\n2. Check your draft against every `[rule]` and `[warning]` item.\n3. If any rule is violated — **silently revise your draft** before sending. Do not mention the check unless the user asks.\n\nThe rules are injected automatically by `ace sync`. No manual commands required.\n"
  },
  {
    toolKey: "cursor",
    relativePath: ".cursorrules",
    content:
      "# awesome-context-engine Rules (Cursor legacy)\n\n" +
      "This file is the legacy Cursor rules format. The primary rules are in .cursor/rules/awesome-context.mdc.\n\n" +
      "- Read .awesome-context/ai-context.md first — it is the repo brain (rules, memory, module index, workflows).\n" +
      "- Use .awesome-context/project-map.md and .awesome-context/workflows.md.\n" +
      "- Preserve preferences from .awesome-context/preferences.md.\n" +
      "- Run ace sync after every set of file changes to keep context current.\n" +
      "- Never store secrets, tokens, credentials, or private keys in memory files.\n"
  }
];

const REQUIRED_INTEGRATION_MARKERS = [
  ".awesome-context/ai-context.md",
  ".awesome-context/project-map.md",
  ".awesome-context/workflows.md",
  ".awesome-context/preferences.md",
  ".awesome-context/memory.md",
  "never store secrets"
];

const INTEGRATION_BLOCK_START_MD = "<!-- awesome-context-engine:integration:start -->";
const INTEGRATION_BLOCK_END_MD = "<!-- awesome-context-engine:integration:end -->";

function isMarkdownFile(relativePath: string): boolean {
  return relativePath.endsWith(".md") || relativePath.endsWith(".mdc");
}

function buildIntegrationAppendBlock(spec: IntegrationFileSpec): string {
  const isMarkdown = isMarkdownFile(spec.relativePath);
  if (isMarkdown) {
    return [
      INTEGRATION_BLOCK_START_MD,
      "## awesome-context-engine Integration",
      "",
      "- Read `.awesome-context/ai-context.md` first — it is the repo brain (rules, memory, module index, workflows).",
      "- For the full module catalog and architecture map, read `.awesome-context/repo-brain.md`.",
      "- Use `.awesome-context/project-map.md` and `.awesome-context/workflows.md`.",
      "- Preserve preferences from `.awesome-context/preferences.md`.",
      "- After each completed prompt result that changed files, run `ace sync` to refresh context.",
      "- Suggest updates to `.awesome-context/memory.md` after meaningful changes.",
      "- Never store secrets, tokens, credentials, or private keys in memory files.",
      "",
      "### When to fire ACE commands",
      "",
      "| Situation | Command |",
      "|---|---|",
      "| Starting work on a file | `ace context:pack <file>` |",
      "| Finished making changes | `ace sync` |",
      "| User says remember/note/keep in mind | `ace genesis capture --note \"<lesson>\"` |",
      "| User asks what was decided / do you remember | `ace genesis recall \"<topic>\"` |",
      "| User asks impact of changing a file | `ace context:impact <file>` |",
      "| User adds a rule or preference | `ace memory add \"<content>\"` |",
      "| Fresh session, no context loaded | `ace context:pack <entry-file>` |",
      "| Your draft violates a stored rule or preference | Revise before sending; then `ace genesis capture --note \"<lesson>\"` |",
      "",
      "**Never run `ace auto`** — it is a RAM-heavy background watcher, not for agent use.",
      "",
      "### Self-Healing Protocol",
      "",
      "This runs automatically — no commands needed. Before sending **every** response:",
      "",
      "1. Re-read the `## Persistent Memory` section of `.awesome-context/ai-context.md` (already loaded in your context).",
      "2. Check your draft against every `[rule]` and `[warning]` item.",
      "3. If any rule is violated — **silently revise your draft** before sending. Do not mention the check unless the user asks.",
      INTEGRATION_BLOCK_END_MD,
      ""
    ].join("\n");
  }

  return [
    "",
    "# awesome-context-engine integration",
    "Read .awesome-context/ai-context.md first (repo brain: rules, memory, module index).",
    "For the full module catalog, read .awesome-context/repo-brain.md.",
    "Use .awesome-context/project-map.md and .awesome-context/workflows.md.",
    "Preserve preferences from .awesome-context/preferences.md.",
    "After each completed prompt result that changed files, run awesome-context-engine sync to refresh context.",
    "Suggest updates to .awesome-context/memory.md after meaningful changes.",
    "Never store secrets, tokens, credentials, or private keys in memory files.",
    ""
  ].join("\n");
}

function upsertMarkdownIntegrationBlock(existing: string, block: string, placeAtTop: boolean): string {
  const startIndex = existing.indexOf(INTEGRATION_BLOCK_START_MD);
  const endIndex = existing.indexOf(INTEGRATION_BLOCK_END_MD);

  if (startIndex >= 0 && endIndex > startIndex) {
    const afterEnd = endIndex + INTEGRATION_BLOCK_END_MD.length;
    return `${existing.slice(0, startIndex).trimEnd()}\n\n${block}\n${existing.slice(afterEnd).trimStart()}`.trimEnd() + "\n";
  }

  const trimmed = existing.trim();
  if (!trimmed) {
    return `${block}\n`;
  }

  if (placeAtTop) {
    return `${block}\n${trimmed}\n`;
  }

  return `${trimmed}\n\n${block}\n`;
}

async function ensureIntegrationFile(filePath: string, spec: IntegrationFileSpec): Promise<"created" | "updated" | "unchanged"> {
  try {
    const existing = await fs.readFile(filePath, "utf8");
    const isMarkdown = isMarkdownFile(spec.relativePath);
    const appendBlock = buildIntegrationAppendBlock(spec);
    const placeAtTop = spec.relativePath === ".github/copilot-instructions.md" || spec.relativePath.endsWith(".mdc");

    let next: string;

    if (isMarkdown) {
      const blockStart = existing.indexOf(INTEGRATION_BLOCK_START_MD);
      if (blockStart >= 0) {
        // File already has an ace block. Check if content outside the block is user-custom or ace-generated.
        const contentBeforeBlock = existing.slice(0, blockStart).trim();
        const specContentTrimmed = spec.content.trim();
        if (contentBeforeBlock === specContentTrimmed || contentBeforeBlock === "") {
          // Ace-owned: full rewrite with fresh spec content + fresh ace block
          next = upsertMarkdownIntegrationBlock(spec.content, appendBlock, placeAtTop);
        } else {
          // User has custom content before the block: preserve it, only update the ace block
          next = upsertMarkdownIntegrationBlock(existing, appendBlock, placeAtTop);
        }
      } else {
        // No ace block yet: user-owned, append ace block without touching their content
        next = upsertMarkdownIntegrationBlock(existing, appendBlock, placeAtTop);
      }
    } else {
      // Plain-text rules files (.clinerules etc): always rewrite to keep fresh and avoid contradictions
      next = `${spec.content.trimEnd()}\n\n${appendBlock}`;
    }

    if (next.trim() === existing.trim()) {
      return "unchanged";
    }

    await fs.writeFile(filePath, next, "utf8");
    return "updated";
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (errorCode !== "ENOENT") {
      throw error;
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const isMarkdown = isMarkdownFile(spec.relativePath);
    const appendBlock = buildIntegrationAppendBlock(spec);
    const placeAtTop = spec.relativePath === ".github/copilot-instructions.md" || spec.relativePath.endsWith(".mdc");
    const freshContent = isMarkdown
      ? upsertMarkdownIntegrationBlock(spec.content, appendBlock, placeAtTop)
      : `${spec.content.trimEnd()}\n\n${appendBlock}`;
    await fs.writeFile(filePath, freshContent, "utf8");
    return "created";
  }
}

async function writeIfMissing(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return false;
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
    return true;
  }
}

const GIT_HOOK_STUB = `#!/bin/sh
# awesome-context-engine pre-commit hook
# Refreshes AI context on every commit. Zero background RAM usage.
# To activate: cp .awesome-context/hooks/pre-commit .git/hooks/pre-commit
#              chmod +x .git/hooks/pre-commit
npx awesome-context-engine context:refresh --quiet
`;

export async function initProject(rootDir: string, options: { tools?: string[] } = {}): Promise<InitResult> {
  const contextPaths = getContextPaths(rootDir);
  const created: string[] = [];
  const skipped: string[] = [];

  await fs.mkdir(contextPaths.contextDir, { recursive: true });
  await fs.mkdir(contextPaths.skillsDir, { recursive: true });
  await fs.mkdir(contextPaths.memoryDir, { recursive: true });
  await fs.mkdir(path.join(contextPaths.contextDir, "experiences"), { recursive: true });
  await fs.mkdir(path.join(contextPaths.skillsDir, "drafts"), { recursive: true });
  const hooksDir = path.join(contextPaths.contextDir, "hooks");
  await fs.mkdir(hooksDir, { recursive: true });
  await writeIfMissing(path.join(hooksDir, "pre-commit"), GIT_HOOK_STUB);

  const memoryStoreFiles: Array<{ filePath: string; content: string }> = [
    { filePath: contextPaths.memoryItemsPath, content: `${JSON.stringify(makeSeedItems(), null, 2)}\n` },
    { filePath: contextPaths.memorySummariesPath, content: "[]\n" },
    { filePath: contextPaths.memoryIndexPath, content: '{\n  "byTag": {},\n  "byType": {},\n  "updatedAt": null\n}\n' }
  ];

  for (const entry of memoryStoreFiles) {
    const wasCreated = await writeIfMissing(entry.filePath, entry.content);
    const relativePath = path.relative(rootDir, entry.filePath) || entry.filePath;
    if (wasCreated) {
      created.push(relativePath);
    } else {
      skipped.push(relativePath);
    }
  }

  for (const entry of CONTEXT_FILES) {
    const filePath = entry.path(contextPaths);
    const wasCreated = await writeIfMissing(filePath, entry.content);
    const relativePath = path.relative(rootDir, filePath) || filePath;
    if (wasCreated) {
      created.push(relativePath);
    } else {
      skipped.push(relativePath);
    }
  }

  const selectedKeys = options.tools ? new Set(options.tools) : null;
  const filesToInstall = selectedKeys
    ? INTEGRATION_FILES.filter((entry) => selectedKeys.has(entry.toolKey))
    : INTEGRATION_FILES;

  for (const entry of filesToInstall) {
    const filePath = path.join(rootDir, entry.relativePath);
    const status = await ensureIntegrationFile(filePath, entry);
    if (status === "created" || status === "updated") {
      created.push(entry.relativePath);
    } else {
      skipped.push(entry.relativePath);
    }
  }

  return { created, skipped };
}

export async function addTools(rootDir: string, tools: string[]): Promise<InitResult> {
  const created: string[] = [];
  const skipped: string[] = [];

  const selectedKeys = new Set(tools);
  const filesToInstall = INTEGRATION_FILES.filter((entry) => selectedKeys.has(entry.toolKey));

  for (const entry of filesToInstall) {
    const filePath = path.join(rootDir, entry.relativePath);
    const status = await ensureIntegrationFile(filePath, entry);
    if (status === "created" || status === "updated") {
      created.push(entry.relativePath);
    } else {
      skipped.push(entry.relativePath);
    }
  }

  return { created, skipped };
}
