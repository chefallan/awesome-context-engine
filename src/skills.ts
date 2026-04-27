import Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fetchBestMatchSkill } from "./awesomeskill.js";
import { callGitHubModels } from "./github-copilot.js";
import type { IndexData } from "./indexer.js";

// ─── Project profile ────────────────────────────────────────────────────────

export type ProjectProfile = {
  languages: string[];
  frameworks: string[];
  scripts: Record<string, string>;
  configFiles: string[];
  dependencies: string[];
  hasDocker: boolean;
  hasCI: boolean;
  hasDatabase: boolean;
  hasTests: boolean;
  hasFrontend: boolean;
  hasAuth: boolean;
  hasApi: boolean;
  packageManager: "npm" | "yarn" | "pnpm" | "bun";
  uiLibraries: string[];
  stylingTools: string[];
  stateLibraries: string[];
  authLibraries: string[];
};

export function buildProjectProfile(indexData: IndexData): ProjectProfile {
  const extensions = Object.keys(indexData.byExtension);
  const filePaths = indexData.files.map((f) => f.path.toLowerCase());
  const deps = new Set((indexData.dependencies ?? []).map((d) => d.toLowerCase()));

  const languages = detectLanguages(extensions);
  const frameworks = detectFrameworks(filePaths);
  const configFiles = detectConfigFiles(filePaths);
  const packageManager = detectPackageManager(filePaths);

  const uiLibraries = detectUiLibraries(deps);
  const stylingTools = detectStylingTools(deps, filePaths);
  const stateLibraries = detectStateLibraries(deps);
  const authLibraries = detectAuthLibraries(deps);

  const hasFrontend = frameworks.some((f) => ["Next.js", "Remix", "Nuxt", "Astro", "SvelteKit", "Angular", "Svelte", "React", "Vue"].includes(f));
  const hasAuth = authLibraries.length > 0 || deps.has("passport") || deps.has("lucia");
  const hasApi = frameworks.some((f) => ["NestJS", "Express", "Fastify", "Koa"].includes(f))
    || filePaths.some((f) => f.includes("/api/") || f.includes("/routes/") || f.includes("/controllers/"));

  return {
    languages,
    frameworks,
    scripts: indexData.packageScripts ?? {},
    configFiles,
    dependencies: indexData.dependencies ?? [],
    hasDocker: filePaths.some((f) => f.includes("dockerfile") || f.includes("docker-compose")),
    hasCI: filePaths.some((f) => f.includes(".github/workflows") || f.includes(".gitlab-ci")),
    hasDatabase: frameworks.some((f) => ["Prisma", "Drizzle"].includes(f)) || deps.has("sequelize") || deps.has("typeorm") || deps.has("mongoose"),
    hasTests: filePaths.some((f) => f.includes(".test.") || f.includes(".spec.") || f.includes("__tests__")),
    hasFrontend,
    hasAuth,
    hasApi,
    uiLibraries,
    stylingTools,
    stateLibraries,
    authLibraries,
    packageManager
  };
}

function detectLanguages(extensions: string[]): string[] {
  const map: Record<string, string> = {
    ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript",
    ".py": "Python", ".go": "Go", ".rs": "Rust", ".java": "Java",
    ".rb": "Ruby", ".php": "PHP", ".cs": "C#", ".swift": "Swift", ".kt": "Kotlin"
  };
  return [...new Set(extensions.flatMap((ext) => (map[ext] ? [map[ext]] : [])))];
}

function detectFrameworks(filePaths: string[]): string[] {
  const signals: Array<[string, string]> = [
    ["next.config", "Next.js"], ["vite.config", "Vite"], ["nuxt.config", "Nuxt"],
    ["remix.config", "Remix"], ["svelte.config", "SvelteKit"], ["astro.config", "Astro"],
    ["angular.json", "Angular"], ["vue.config", "Vue"],
    ["tailwind.config", "Tailwind CSS"], ["prisma/schema", "Prisma"],
    ["drizzle.config", "Drizzle"], ["jest.config", "Jest"], ["vitest.config", "Vitest"],
    ["playwright.config", "Playwright"], ["cypress.config", "Cypress"],
    ["turbo.json", "Turborepo"], ["nx.json", "Nx"]
  ];
  return signals.filter(([sig]) => filePaths.some((f) => f.includes(sig))).map(([, name]) => name);
}

function detectConfigFiles(filePaths: string[]): string[] {
  const known = [
    "package.json", "tsconfig.json", "eslint.config", ".eslintrc",
    ".prettierrc", "prettier.config", "dockerfile", "docker-compose",
    ".github/workflows", "turbo.json", "nx.json"
  ];
  return known.filter((cfg) => filePaths.some((f) => f.includes(cfg)));
}

function detectPackageManager(filePaths: string[]): "npm" | "yarn" | "pnpm" | "bun" {
  if (filePaths.some((f) => f.endsWith("bun.lockb"))) return "bun";
  if (filePaths.some((f) => f.endsWith("pnpm-lock.yaml"))) return "pnpm";
  if (filePaths.some((f) => f.endsWith("yarn.lock"))) return "yarn";
  return "npm";
}

function detectUiLibraries(deps: Set<string>): string[] {
  const map: Array<[string, string]> = [
    ["@shadcn/ui", "shadcn/ui"], ["@radix-ui/react-dialog", "Radix UI"],
    ["@mui/material", "MUI"], ["antd", "Ant Design"],
    ["@chakra-ui/react", "Chakra UI"], ["@mantine/core", "Mantine"],
    ["daisyui", "daisyUI"], ["flowbite", "Flowbite"],
    ["@headlessui/react", "Headless UI"], ["@heroicons/react", "Heroicons"],
    ["lucide-react", "Lucide"], ["react-icons", "React Icons"]
  ];
  return map.filter(([pkg]) => deps.has(pkg)).map(([, name]) => name);
}

function detectStylingTools(deps: Set<string>, filePaths: string[]): string[] {
  const tools: string[] = [];
  if (deps.has("tailwindcss") || filePaths.some((f) => f.includes("tailwind.config"))) tools.push("Tailwind CSS");
  if (deps.has("styled-components")) tools.push("styled-components");
  if (deps.has("@emotion/react") || deps.has("@emotion/styled")) tools.push("Emotion");
  if (filePaths.some((f) => f.endsWith(".module.css") || f.endsWith(".module.scss"))) tools.push("CSS Modules");
  if (deps.has("sass") || deps.has("node-sass")) tools.push("Sass");
  if (deps.has("@vanilla-extract/css")) tools.push("vanilla-extract");
  return tools;
}

function detectStateLibraries(deps: Set<string>): string[] {
  const map: Array<[string, string]> = [
    ["zustand", "Zustand"], ["jotai", "Jotai"], ["recoil", "Recoil"],
    ["@reduxjs/toolkit", "Redux Toolkit"], ["redux", "Redux"],
    ["mobx", "MobX"], ["pinia", "Pinia"], ["valtio", "Valtio"],
    ["@tanstack/react-query", "TanStack Query"], ["swr", "SWR"],
    ["xstate", "XState"]
  ];
  return map.filter(([pkg]) => deps.has(pkg)).map(([, name]) => name);
}

function detectAuthLibraries(deps: Set<string>): string[] {
  const map: Array<[string, string]> = [
    ["next-auth", "NextAuth.js"], ["@auth/core", "Auth.js"],
    ["@clerk/nextjs", "Clerk"], ["@clerk/clerk-react", "Clerk"],
    ["@supabase/supabase-js", "Supabase Auth"], ["firebase", "Firebase Auth"],
    ["lucia", "Lucia"], ["better-auth", "Better Auth"],
    ["passport", "Passport.js"], ["jsonwebtoken", "JWT"],
    ["@kinde-oss/kinde-auth-nextjs", "Kinde"]
  ];
  return map.filter(([pkg]) => deps.has(pkg)).map(([, name]) => name);
}

// ─── Skill definitions ───────────────────────────────────────────────────────

type SkillDefinition = {
  name: string;
  title: string;
  description: string;
  triggers: string[];
  detect: (p: ProjectProfile) => boolean;
  fingerprint: (p: ProjectProfile) => string;
  relevantScripts: (p: ProjectProfile) => Record<string, string>;
  template: (p: ProjectProfile) => string;
};

const SKILL_DEFINITIONS: SkillDefinition[] = [
  {
    name: "build",
    title: "Build",
    description: "Compile and bundle this project for production",
    triggers: ["build", "compile", "bundle", "tsc", "transpile", "output to dist"],
    detect: (p) => Boolean(p.scripts["build"] || p.scripts["compile"]),
    fingerprint: (p) => [
      p.scripts["build"] ?? "",
      p.scripts["compile"] ?? "",
      p.scripts["clean"] ?? "",
      ...p.frameworks.filter((f) => ["Vite", "Next.js", "Turborepo", "Nx"].includes(f))
    ].join("|"),
    relevantScripts: (p) => pickScripts(p.scripts, ["build", "compile", "clean", "prebuild", "postbuild"]),
    template: (p) => {
      const pm = p.packageManager;
      const buildCmd = p.scripts["build"] ? runCmd(pm, "build") : "# no build script";
      const cleanCmd = p.scripts["clean"] ? `\n${runCmd(pm, "clean")}  # wipe dist first` : "";
      return [
        `# Build\n`,
        `## Quick Start\n\`\`\`bash\n${buildCmd}\n\`\`\`\n`,
        `## How It Works\n- Runs \`${p.scripts["build"] ?? "build"}\`\n- Output lands in \`dist/\`\n- Stack: ${[...p.languages, ...p.frameworks].join(", ") || "unknown"}\n`,
        cleanCmd ? `## Clean Build\n\`\`\`bash\n${cleanCmd}\n${runCmd(pm, "build")}\n\`\`\`\n` : "",
        `## Watch Out For\n- Run \`${runCmd(pm, "clean")}\` if you see stale artifacts in \`dist/\`\n`
      ].filter(Boolean).join("\n");
    }
  },
  {
    name: "dev",
    title: "Dev Server",
    description: "Start the local development server with hot reload",
    triggers: ["dev server", "start dev", "watch mode", "hot reload", "local server"],
    detect: (p) => Boolean(p.scripts["dev"] || p.scripts["start"]),
    fingerprint: (p) => [p.scripts["dev"] ?? "", p.scripts["start"] ?? "", ...p.frameworks].join("|"),
    relevantScripts: (p) => pickScripts(p.scripts, ["dev", "start", "serve", "watch"]),
    template: (p) => {
      const script = p.scripts["dev"] ? "dev" : "start";
      const cmd = runCmd(p.packageManager, script);
      const port = p.frameworks.includes("Next.js") ? "3000" : p.frameworks.includes("Vite") ? "5173" : "detected at runtime";
      return [
        `# Dev Server\n`,
        `## Quick Start\n\`\`\`bash\n${cmd}\n\`\`\`\n`,
        `## How It Works\n- Runs \`${p.scripts[script]}\`\n- Default port: ${port}\n- Changes hot-reload without restart\n`,
        `## Watch Out For\n- Stop any existing process on the same port before starting\n- Some env vars require a full restart to take effect\n`
      ].join("\n");
    }
  },
  {
    name: "test",
    title: "Testing",
    description: "Run the test suite — unit, integration, and e2e",
    triggers: ["test", "spec", "unit test", "integration test", "e2e", "coverage", "passing tests"],
    detect: (p) => p.hasTests || Boolean(p.scripts["test"] || p.scripts["test:unit"] || p.scripts["test:e2e"]),
    fingerprint: (p) => [
      p.scripts["test"] ?? "",
      p.scripts["test:unit"] ?? "",
      p.scripts["test:e2e"] ?? "",
      p.scripts["test:coverage"] ?? "",
      ...p.frameworks.filter((f) => ["Jest", "Vitest", "Playwright", "Cypress"].includes(f))
    ].join("|"),
    relevantScripts: (p) => pickScripts(p.scripts, ["test", "test:unit", "test:e2e", "test:coverage", "test:watch"]),
    template: (p) => {
      const pm = p.packageManager;
      const testScript = ["test", "test:unit"].find((s) => p.scripts[s]) ?? "test";
      const runners = p.frameworks.filter((f) => ["Jest", "Vitest", "Playwright", "Cypress"].includes(f));
      const variants = Object.keys(p.scripts).filter((k) => k.startsWith("test:") && k !== "test").map((k) => `${runCmd(pm, k)}  # ${k}`);
      return [
        `# Testing\n`,
        `## Quick Start\n\`\`\`bash\n${runCmd(pm, testScript)}\n\`\`\`\n`,
        `## How It Works\n- Runner: ${runners.join(", ") || "node --test"}\n- Test files: \`**/*.test.*\` / \`**/*.spec.*\` / \`__tests__/\`\n`,
        variants.length ? `## Variants\n\`\`\`bash\n${variants.join("\n")}\n\`\`\`\n` : "",
        `## Watch Out For\n- Build first if tests import from \`dist/\`: \`${runCmd(pm, "build")} && ${runCmd(pm, testScript)}\`\n- Snapshot files are committed — update with \`--updateSnapshot\` flag\n`
      ].filter(Boolean).join("\n");
    }
  },
  {
    name: "lint",
    title: "Lint & Format",
    description: "Check and fix code style, formatting, and static analysis",
    triggers: ["lint", "format", "eslint", "prettier", "fix style", "code quality", "type check"],
    detect: (p) => Boolean(p.scripts["lint"] || p.scripts["format"] || p.scripts["typecheck"] || p.configFiles.some((f) => f.includes("eslint") || f.includes("prettier"))),
    fingerprint: (p) => [
      p.scripts["lint"] ?? "",
      p.scripts["format"] ?? "",
      p.scripts["typecheck"] ?? "",
      ...p.configFiles.filter((f) => f.includes("eslint") || f.includes("prettier"))
    ].join("|"),
    relevantScripts: (p) => pickScripts(p.scripts, ["lint", "lint:fix", "format", "format:fix", "typecheck", "type-check"]),
    template: (p) => {
      const pm = p.packageManager;
      const blocks: string[] = [`# Lint & Format\n`];
      if (p.scripts["lint"]) blocks.push(`## Lint\n\`\`\`bash\n${runCmd(pm, "lint")}        # check\n${p.scripts["lint:fix"] ? runCmd(pm, "lint:fix") + "    # auto-fix" : ""}\n\`\`\`\n`);
      if (p.scripts["format"]) blocks.push(`## Format\n\`\`\`bash\n${runCmd(pm, "format")}\n\`\`\`\n`);
      if (p.scripts["typecheck"] || p.scripts["type-check"]) {
        const tc = p.scripts["typecheck"] ? "typecheck" : "type-check";
        blocks.push(`## Type Check\n\`\`\`bash\n${runCmd(pm, tc)}\n\`\`\`\n`);
      }
      blocks.push(`## Watch Out For\n- Run lint before committing — CI will fail on lint errors\n- Prettier and ESLint rules may conflict; check \`.eslintrc\` for prettier integration\n`);
      return blocks.join("\n");
    }
  },
  {
    name: "docker",
    title: "Docker",
    description: "Build images and manage containers for this project",
    triggers: ["docker", "container", "compose", "image", "dockerfile", "dockerize", "run in docker"],
    detect: (p) => p.hasDocker,
    fingerprint: (p) => p.configFiles.filter((f) => f.includes("docker")).join("|"),
    relevantScripts: (p) => pickScripts(p.scripts, ["docker:build", "docker:run", "docker:push", "docker:up", "docker:down"]),
    template: (_p) => [
      `# Docker\n`,
      `## Quick Start\n\`\`\`bash\ndocker-compose up --build   # build + start all services\ndocker-compose down         # stop and remove containers\n\`\`\`\n`,
      `## Build Image Only\n\`\`\`bash\ndocker build -t app .       # build image\ndocker run -p 3000:3000 app # run container\n\`\`\`\n`,
      `## Useful Commands\n\`\`\`bash\ndocker-compose logs -f      # tail logs\ndocker-compose ps           # status\ndocker system prune         # clean up\n\`\`\`\n`,
      `## Watch Out For\n- \`.env\` is not passed to Docker automatically — use \`--env-file .env\` or define in \`docker-compose.yml\`\n- Rebuild image after dependency changes: \`docker-compose up --build\`\n`
    ].join("\n")
  },
  {
    name: "database",
    title: "Database",
    description: "Manage schema, migrations, and seed data",
    triggers: ["database", "migration", "schema", "seed", "db push", "prisma", "drizzle", "migrate"],
    detect: (p) => p.hasDatabase,
    fingerprint: (p) => [
      ...p.frameworks.filter((f) => ["Prisma", "Drizzle"].includes(f)),
      p.scripts["db:migrate"] ?? "",
      p.scripts["db:push"] ?? "",
      p.scripts["db:seed"] ?? ""
    ].join("|"),
    relevantScripts: (p) => pickScripts(p.scripts, ["db:migrate", "db:push", "db:seed", "db:studio", "db:generate", "migrate", "seed"]),
    template: (p) => {
      const hasPrisma = p.frameworks.includes("Prisma");
      const hasDrizzle = p.frameworks.includes("Drizzle");
      const blocks = [`# Database\n`];
      if (hasPrisma) {
        blocks.push(`## Prisma\n\`\`\`bash\nnpx prisma generate        # regenerate client after schema change\nnpx prisma migrate dev     # create + apply migration (dev)\nnpx prisma migrate deploy  # apply migrations (prod)\nnpx prisma db push         # push schema without migration history\nnpx prisma studio          # visual DB browser\n\`\`\`\n`);
        blocks.push(`## Watch Out For\n- Always run \`prisma generate\` after editing \`schema.prisma\`\n- Use \`migrate dev\` in development, \`migrate deploy\` in production\n- \`db push\` does not create migration files — use for prototyping only\n`);
      }
      if (hasDrizzle) {
        blocks.push(`## Drizzle\n\`\`\`bash\nnpx drizzle-kit generate   # generate migration SQL\nnpx drizzle-kit push       # push schema to DB\nnpx drizzle-kit studio     # visual DB browser\n\`\`\`\n`);
        blocks.push(`## Watch Out For\n- Run \`generate\` after any schema change before applying\n- Review generated SQL before pushing to production\n`);
      }
      return blocks.join("\n");
    }
  },
  {
    name: "ci",
    title: "CI / CD",
    description: "Understand and work with the automated pipeline",
    triggers: ["ci", "cd", "pipeline", "workflow", "github actions", "failing pipeline", "what runs in ci"],
    detect: (p) => p.hasCI,
    fingerprint: (p) => p.configFiles.filter((f) => f.includes("workflow") || f.includes("gitlab")).join("|"),
    relevantScripts: (p) => pickScripts(p.scripts, ["build", "test", "lint", "typecheck", "deploy", "release"]),
    template: (p) => {
      const pm = p.packageManager;
      const ciChecks = ["lint", "typecheck", "test", "build"].filter((s) => p.scripts[s]).map((s) => runCmd(pm, s));
      return [
        `# CI / CD\n`,
        `## What CI Runs\nThese are the scripts CI typically executes in order:\n\`\`\`bash\n${ciChecks.join("\n") || "# check .github/workflows/ for exact steps"}\n\`\`\`\n`,
        `## Workflow Location\n- GitHub Actions: \`.github/workflows/\`\n- PRs: lint + test + build\n- Merge to \`main\`: full pipeline + deploy (if configured)\n`,
        `## Reproduce Locally\nRun the same commands CI runs before pushing to catch failures early.\n`,
        `## Watch Out For\n- Secrets (API keys) must be added to GitHub → Settings → Secrets, not hardcoded\n- CI uses a clean environment — if it passes locally but fails in CI, check env var differences\n`
      ].join("\n");
    }
  },
  {
    name: "release",
    title: "Release",
    description: "Cut a versioned release and publish the package",
    triggers: ["release", "publish", "bump version", "npm publish", "tag", "changelog", "ship"],
    detect: (p) => Boolean(p.scripts["release"] || p.scripts["publish"] || p.scripts["prepublishOnly"]),
    fingerprint: (p) => [p.scripts["release"] ?? "", p.scripts["publish"] ?? "", p.scripts["prepublishOnly"] ?? ""].join("|"),
    relevantScripts: (p) => pickScripts(p.scripts, ["release", "publish", "prepublishOnly", "version", "clean", "build"]),
    template: (p) => {
      const pm = p.packageManager;
      const releaseScript = ["release", "publish"].find((s) => p.scripts[s]);
      return [
        `# Release\n`,
        `## Steps\n\`\`\`bash\n${runCmd(pm, "build")}           # ensure clean build\n${releaseScript ? runCmd(pm, releaseScript) + "         # cut the release" : "npm version patch    # bump version\nnpm publish          # publish to registry"}\n\`\`\`\n`,
        `## Pre-release Checklist\n- All tests pass: \`${runCmd(pm, "test")}\`\n- Working tree clean: \`git status\`\n- On the correct branch (usually \`main\`)\n- \`CHANGELOG.md\` updated if maintained\n`,
        `## Watch Out For\n- \`prepublishOnly\` runs automatically before \`npm publish\` — check what it does\n- Bump \`package.json\` version before running the release script if not automated\n- Use \`npm publish --dry-run\` to verify what will be uploaded\n`
      ].join("\n");
    }
  },

  // ── Semantic / intent-driven skills ─────────────────────────────────────────

  {
    name: "frontend",
    title: "Frontend & UI/UX",
    description: "Component patterns, layout conventions, and UI/UX guidelines for this project",
    triggers: ["ui", "ux", "ui/ux", "component", "frontend", "page", "layout", "design", "user interface", "user experience", "responsive", "accessible", "look and feel"],
    detect: (p) => p.hasFrontend,
    fingerprint: (p) => [...p.frameworks, ...p.uiLibraries, ...p.stylingTools].join("|"),
    relevantScripts: (p) => pickScripts(p.scripts, ["dev", "start", "build", "storybook", "lint"]),
    template: (p) => {
      const stack = [...p.uiLibraries, ...p.stylingTools].join(", ") || "custom CSS";
      const fw = p.frameworks.filter((f) => ["Next.js", "Remix", "Nuxt", "Astro", "SvelteKit", "React", "Vue", "Angular", "Svelte"].includes(f)).join(", ");
      return [
        `# Frontend & UI/UX\n`,
        `## Stack\n- Framework: ${fw || "unknown"}\n- UI: ${stack}\n`,
        `## Quick Start\n\`\`\`bash\n${runCmd(p.packageManager, p.scripts["dev"] ? "dev" : "start")}\n\`\`\`\n`,
        `## Component Conventions\n- Co-locate component, styles, and tests in the same folder\n- Prefer composition over large monolithic components\n- Keep presentational components free of data-fetching logic\n`,
        `## Styling\n- Tool: ${p.stylingTools[0] ?? "CSS"}\n${p.stylingTools.includes("Tailwind CSS") ? "- Use utility classes; avoid inline styles\n- Extract repeated patterns into components, not custom CSS classes\n" : "- Keep styles scoped to their component\n"}`,
        `## Watch Out For\n- Accessibility: add \`aria-*\` labels to interactive elements\n- Avoid layout shift — set explicit width/height on images\n- Test responsive breakpoints before shipping a UI change\n`
      ].join("\n");
    }
  },

  {
    name: "styling",
    title: "Styling System",
    description: "How to write, organize, and extend styles in this project",
    triggers: ["style", "css", "tailwind", "theme", "color", "design token", "dark mode", "spacing", "typography", "animation"],
    detect: (p) => p.stylingTools.length > 0,
    fingerprint: (p) => p.stylingTools.join("|"),
    relevantScripts: (_p) => ({}),
    template: (p) => {
      const hasTailwind = p.stylingTools.includes("Tailwind CSS");
      const hasModules = p.stylingTools.includes("CSS Modules");
      const blocks = [`# Styling System\n`, `## Tools in Use\n${p.stylingTools.map((t) => `- ${t}`).join("\n")}\n`];
      if (hasTailwind) {
        blocks.push(`## Tailwind\n- Config: \`tailwind.config.*\`\n- Extend theme in \`theme.extend\`, never override base tokens\n- Use \`cn()\` (clsx/tailwind-merge) to conditionally join classes\n- Purge is automatic in production — only classes in source files survive\n`);
      }
      if (hasModules) {
        blocks.push(`## CSS Modules\n- Files must end in \`.module.css\` / \`.module.scss\`\n- Import as \`import styles from './Component.module.css'\`\n- Class names are locally scoped — no global collision risk\n`);
      }
      blocks.push(`## Watch Out For\n- Don't mix Tailwind utilities and custom CSS on the same element — pick one\n- Dark mode: check whether the project uses \`class\` or \`media\` strategy in Tailwind config\n`);
      return blocks.join("\n");
    }
  },

  {
    name: "components",
    title: "Component Library",
    description: "How to use and extend the UI component library in this project",
    triggers: ["component", "button", "modal", "dialog", "form", "input", "table", "card", "dropdown", "shadcn", "radix", "mui", "chakra", "design system"],
    detect: (p) => p.uiLibraries.length > 0,
    fingerprint: (p) => p.uiLibraries.join("|"),
    relevantScripts: (_p) => ({}),
    template: (p) => {
      const libs = p.uiLibraries.join(", ");
      const hasShadcn = p.uiLibraries.includes("shadcn/ui");
      const hasRadix = p.uiLibraries.includes("Radix UI");
      const blocks = [`# Component Library\n`, `## Libraries\n${p.uiLibraries.map((l) => `- ${l}`).join("\n")}\n`];
      if (hasShadcn) {
        blocks.push(`## shadcn/ui\n- Add a component: \`npx shadcn@latest add <component>\`\n- Components land in \`components/ui/\` — they're owned by you, edit freely\n- Variants are managed via \`class-variance-authority\` (CVA) inside each component file\n`);
      }
      if (hasRadix && !hasShadcn) {
        blocks.push(`## Radix UI\n- Headless primitives — bring your own styles\n- Use \`data-state\` attributes for styling open/closed states\n- Compose with \`asChild\` to avoid extra wrapper DOM nodes\n`);
      }
      blocks.push(`## Watch Out For\n- Don't duplicate ${libs} components with hand-rolled versions — check the library first\n- Keep customisations in wrapper components, not inside library source\n`);
      return blocks.join("\n");
    }
  },

  {
    name: "state-management",
    title: "State Management",
    description: "How state is structured, shared, and updated across this app",
    triggers: ["state", "store", "zustand", "redux", "context", "global state", "reactive", "shared data", "cache", "query"],
    detect: (p) => p.stateLibraries.length > 0,
    fingerprint: (p) => p.stateLibraries.join("|"),
    relevantScripts: (_p) => ({}),
    template: (p) => {
      const hasZustand = p.stateLibraries.includes("Zustand");
      const hasRedux = p.stateLibraries.includes("Redux Toolkit") || p.stateLibraries.includes("Redux");
      const hasQuery = p.stateLibraries.includes("TanStack Query") || p.stateLibraries.includes("SWR");
      const blocks = [`# State Management\n`, `## Libraries\n${p.stateLibraries.map((l) => `- ${l}`).join("\n")}\n`];
      if (hasZustand) blocks.push(`## Zustand\n- Define stores in \`store/\` or alongside the feature they serve\n- Keep stores small and single-purpose\n- Use selectors to avoid unnecessary re-renders: \`useStore((s) => s.field)\`\n`);
      if (hasRedux) blocks.push(`## Redux Toolkit\n- Slices live in \`store/slices/\`\n- Use \`createAsyncThunk\` for async operations\n- Avoid putting derived data in the store — compute it with \`createSelector\`\n`);
      if (hasQuery) blocks.push(`## Server State (${p.stateLibraries.includes("TanStack Query") ? "TanStack Query" : "SWR"})\n- Server data belongs here, not in Zustand/Redux\n- Invalidate queries after mutations to keep UI in sync\n- Use stale-while-revalidate defaults; only override when you have a specific reason\n`);
      blocks.push(`## Watch Out For\n- Don't duplicate server state in client store — let the query library own it\n- Avoid storing derived/computed values in the store\n`);
      return blocks.join("\n");
    }
  },

  {
    name: "auth",
    title: "Authentication & Authorization",
    description: "How auth is implemented, sessions managed, and routes protected",
    triggers: ["auth", "login", "logout", "session", "jwt", "token", "protected route", "sign in", "sign up", "user", "permission", "role", "middleware"],
    detect: (p) => p.hasAuth,
    fingerprint: (p) => p.authLibraries.join("|"),
    relevantScripts: (p) => pickScripts(p.scripts, ["dev", "db:migrate", "db:push"]),
    template: (p) => {
      const hasNextAuth = p.authLibraries.some((l) => ["NextAuth.js", "Auth.js"].includes(l));
      const hasClerk = p.authLibraries.some((l) => l === "Clerk");
      const hasSupabase = p.authLibraries.includes("Supabase Auth");
      const libs = p.authLibraries.join(", ") || "custom auth";
      const blocks = [`# Authentication & Authorization\n`, `## Library\n${p.authLibraries.map((l) => `- ${l}`).join("\n") || "- custom"}\n`];
      if (hasNextAuth) blocks.push(`## NextAuth / Auth.js\n- Config: \`auth.ts\` or \`app/api/auth/[...nextauth]/route.ts\`\n- Session: use \`getServerSession()\` in server components, \`useSession()\` in client\n- Protect routes via middleware in \`middleware.ts\`\n`);
      if (hasClerk) blocks.push(`## Clerk\n- Wrap app in \`<ClerkProvider>\`\n- Protect routes: \`clerkMiddleware()\` in \`middleware.ts\`\n- Use \`currentUser()\` server-side, \`useUser()\` client-side\n`);
      if (hasSupabase) blocks.push(`## Supabase Auth\n- Use \`supabase.auth.signInWithPassword()\` / \`signUp()\`\n- Session is stored in cookies — use SSR client for server components\n- Row-level security (RLS) policies enforce authorization at the DB layer\n`);
      blocks.push(`## Watch Out For\n- Never trust client-side auth checks alone — always verify server-side\n- Rotate secrets (\`AUTH_SECRET\`, \`NEXTAUTH_SECRET\`) if they leak\n- ${libs} sessions expire — handle 401s gracefully in fetch wrappers\n`);
      return blocks.join("\n");
    }
  },

  {
    name: "api",
    title: "API Design & Conventions",
    description: "How API routes are structured, validated, and called in this project",
    triggers: ["api", "endpoint", "route", "rest", "http", "fetch", "request", "response", "server action", "trpc", "graphql", "webhook"],
    detect: (p) => p.hasApi || p.frameworks.some((f) => ["Next.js", "Remix", "NestJS", "Express", "Fastify"].includes(f)),
    fingerprint: (p) => [...p.frameworks, ...p.dependencies.filter((d) => ["trpc", "@trpc/server", "graphql", "apollo-server", "zod", "yup"].includes(d))].join("|"),
    relevantScripts: (p) => pickScripts(p.scripts, ["dev", "start", "build"]),
    template: (p) => {
      const hasNextJs = p.frameworks.includes("Next.js");
      const hasTrpc = p.dependencies.includes("@trpc/server");
      const hasZod = p.dependencies.includes("zod");
      const blocks = [`# API Design & Conventions\n`];
      if (hasNextJs) blocks.push(`## Next.js API Routes\n- App Router: \`app/api/<route>/route.ts\` exports \`GET\`, \`POST\`, etc.\n- Server Actions: \`"use server"\` functions called directly from components\n- Always return \`NextResponse.json()\` with explicit status codes\n`);
      if (hasTrpc) blocks.push(`## tRPC\n- Routers live in \`server/routers/\` — compose into \`appRouter\`\n- Use \`publicProcedure\` / \`protectedProcedure\` for auth gating\n- Client uses the inferred type — never import server code into client bundles\n`);
      if (hasZod) blocks.push(`## Validation (Zod)\n- Define schemas alongside the route that uses them\n- Parse at the boundary: \`schema.parse(req.body)\` before any business logic\n- Use \`.safeParse()\` when you want to return a 400 instead of throwing\n`);
      blocks.push(`## Watch Out For\n- Always validate input — never trust \`req.body\` / query params directly\n- Return consistent error shapes: \`{ error: string, code: string }\`\n- Set \`Cache-Control\` headers explicitly on GET routes that return dynamic data\n`);
      return blocks.join("\n");
    }
  },

  {
    name: "performance",
    title: "Performance",
    description: "How to measure and improve performance in this project",
    triggers: ["performance", "slow", "optimize", "bundle size", "lazy load", "code split", "cache", "lighthouse", "core web vitals", "render", "memory"],
    detect: (p) => p.hasFrontend,
    fingerprint: (p) => p.frameworks.slice(0, 3).join("|"),
    relevantScripts: (p) => pickScripts(p.scripts, ["build", "analyze", "bundle-analyze", "lighthouse"]),
    template: (p) => {
      const hasNext = p.frameworks.includes("Next.js");
      const hasVite = p.frameworks.includes("Vite");
      const blocks = [`# Performance\n`];
      if (hasNext) blocks.push(`## Next.js\n- Use \`next/image\` for all images — handles lazy load, sizing, and format\n- Use \`next/font\` to avoid layout shift from custom fonts\n- Dynamic import heavy components: \`const Comp = dynamic(() => import('./Comp'))\`\n- Check bundle: add \`@next/bundle-analyzer\` and run \`ANALYZE=true ${runCmd(p.packageManager, "build")}\`\n`);
      if (hasVite) blocks.push(`## Vite\n- Code-split with \`import()\` at route boundaries\n- Use \`rollup-plugin-visualizer\` to inspect bundle composition\n- \`vite preview\` serves the prod build locally for realistic profiling\n`);
      blocks.push(`## General\n- Defer non-critical JS with \`loading="lazy"\` / dynamic imports\n- Memoize expensive computations with \`useMemo\` / \`useCallback\` only after profiling\n- Avoid waterfalls: parallel-fetch independent data at the layout level\n`);
      blocks.push(`## Watch Out For\n- Don't optimise before measuring — use browser DevTools Performance tab first\n- \`React.memo\` adds overhead if props change frequently; profile before adding\n`);
      return blocks.join("\n");
    }
  }
];

function runCmd(pm: string, script: string): string {
  return pm === "npm" ? `npm run ${script}` : `${pm} ${script}`;
}

function pickScripts(all: Record<string, string>, keys: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of keys) {
    if (all[key]) result[key] = all[key];
  }
  return result;
}

// ─── Skill file I/O ──────────────────────────────────────────────────────────

type SkillMeta = {
  fingerprint: string;
  locked: boolean;
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

function parseSkillMeta(raw: string): SkillMeta {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { fingerprint: "", locked: false };
  const block = match[1];
  const fp = block.match(/^fingerprint:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const locked = /^locked:\s*true$/m.test(block);
  return { fingerprint: fp, locked };
}

function buildSkillFile(def: SkillDefinition, fingerprint: string, body: string): string {
  const now = new Date().toISOString();
  const frontmatter = `---\nskill: ${def.name}\ntitle: ${def.title}\nfingerprint: ${fingerprint}\ngeneratedAt: ${now}\nlocked: false\n---\n\n`;
  return frontmatter + body;
}

// ─── AI generation ───────────────────────────────────────────────────────────

async function generateSkillBodyWithAI(
  def: SkillDefinition,
  profile: ProjectProfile,
  githubToken?: string
): Promise<string | null> {
  const stack = [...profile.languages, ...profile.frameworks].filter(Boolean).join(", ");
  const relevant = def.relevantScripts(profile);
  const scriptLines = Object.entries(relevant).map(([k, v]) => `  ${k}: ${v}`).join("\n");

  // Fetch a community reference skill from awesomeskill.ai (best-effort, non-blocking)
  const communitySkill = await fetchBestMatchSkill(def.name, [...profile.languages, ...profile.frameworks]).catch(() => null);
  const communitySection = communitySkill
    ? `\nCommunity reference skill (adapt and improve for this specific project — do NOT copy verbatim):\n<reference>\n${communitySkill.slice(0, 2000)}\n</reference>\n`
    : "";

  const prompt = `You are writing a developer skill playbook for a specific project.

Skill: ${def.title}
Purpose: ${def.description}
Tech stack: ${stack || "unknown"}
Package manager: ${profile.packageManager}
Relevant scripts (only these, no others):
${scriptLines || "  (none)"}
${communitySection}
Write a concise markdown playbook using EXACTLY these four sections (omit a section if empty):

## Quick Start
One or two bash commands that handle the common case. Use exact script names from the list above.

## How It Works
2-4 bullet points explaining what actually happens under the hood. Stack-specific facts only.

## Variants
Other relevant commands from the scripts list above (skip if none).

## Watch Out For
1-3 project-specific gotchas. NO generic advice like "run npm install" or "make sure node is installed". Only warnings tied to this stack or these scripts.

Rules:
- Use ${profile.packageManager} run syntax for all script invocations
- Do NOT add a top-level # heading (it will be added automatically)
- Do NOT invent scripts that are not in the list above
- Be terse — a developer reading this already knows the basics
- If a community reference was provided, extract the most relevant insights but tailor everything to this project's actual stack and scripts

Respond with JSON only:
{ "body": "<markdown content with the four sections above>" }`;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }]
      });
      const raw = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
      const body = parseAISkillResponse(raw);
      if (body) return body;
    } catch {
      // fall through to Copilot
    }
  }

  if (githubToken) {
    const raw = await callGitHubModels(githubToken, prompt);
    if (raw) return parseAISkillResponse(raw);
  }

  return null;
}

function parseAISkillResponse(raw: string): string | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { body?: unknown };
    if (typeof parsed.body === "string" && parsed.body.trim()) {
      return parsed.body.trim();
    }
  } catch {
    // fall through
  }
  return null;
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

type SkillAction = "create" | "update" | "skip-locked" | "skip-current";

type SkillPlan = {
  def: SkillDefinition;
  skillPath: string;
  fingerprint: string;
  action: SkillAction;
  existingContent: string | null;
};

async function planSkills(skillsDir: string, profile: ProjectProfile): Promise<SkillPlan[]> {
  const applicable = SKILL_DEFINITIONS.filter((def) => def.detect(profile));

  return Promise.all(
    applicable.map(async (def) => {
      const skillPath = path.join(skillsDir, `${def.name}.md`);
      const fingerprint = def.fingerprint(profile);

      let existingContent: string | null = null;
      try {
        existingContent = await fs.readFile(skillPath, "utf8");
      } catch {
        // not created yet
      }

      let action: SkillAction;
      if (!existingContent) {
        action = "create";
      } else {
        const meta = parseSkillMeta(existingContent);
        if (meta.locked) {
          action = "skip-locked";
        } else if (meta.fingerprint === fingerprint) {
          action = "skip-current";
        } else {
          action = "update";
        }
      }

      return { def, skillPath, fingerprint, action, existingContent };
    })
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

export type SkillSyncOptions = {
  githubToken?: string;
  onPlan?: (plan: { skill: string; action: SkillAction }[]) => void;
};

export type SkillSyncResult = {
  created: string[];
  updated: string[];
  skipped: string[];
};

export async function syncSkills(
  skillsDir: string,
  indexData: IndexData,
  options: SkillSyncOptions = {}
): Promise<SkillSyncResult> {
  await fs.mkdir(skillsDir, { recursive: true });

  const profile = buildProjectProfile(indexData);
  const result: SkillSyncResult = { created: [], updated: [], skipped: [] };

  // Phase 1: plan — decide what needs to happen before touching any files
  const plans = await planSkills(skillsDir, profile);

  // Surface the plan to the caller (e.g. for CLI output)
  options.onPlan?.(plans.map((p) => ({ skill: p.def.name, action: p.action })));

  // Phase 2: execute — only act on skills that need create/update
  const toWrite = plans.filter((p) => p.action === "create" || p.action === "update");

  await Promise.all(
    toWrite.map(async (plan) => {
      const { def, skillPath, fingerprint, action } = plan;

      const aiBody = await generateSkillBodyWithAI(def, profile, options.githubToken);
      const body = aiBody ?? def.template(profile);
      const fileContent = buildSkillFile(def, fingerprint, `# ${def.title}\n\n${body}`);

      await fs.writeFile(skillPath, fileContent, "utf8");

      if (action === "update") {
        result.updated.push(def.name);
      } else {
        result.created.push(def.name);
      }
    })
  );

  // Phase 3: record skips
  for (const plan of plans) {
    if (plan.action === "skip-locked" || plan.action === "skip-current") {
      result.skipped.push(plan.def.name);
    }
  }

  return result;
}
