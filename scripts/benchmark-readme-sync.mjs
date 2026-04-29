#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const LOCAL_START = "<!-- benchmark:local:start -->";
const LOCAL_END = "<!-- benchmark:local:end -->";
const EXTERNAL_START = "<!-- benchmark:external:start -->";
const EXTERNAL_END = "<!-- benchmark:external:end -->";

function runNodeScript(rootDir, scriptFile) {
  const result = spawnSync(process.execPath, [path.join(rootDir, scriptFile)], {
    cwd: rootDir,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    const text = (result.stderr || result.stdout || "").trim();
    throw new Error(`${scriptFile} failed: ${text}`);
  }
}

function replaceBlock(content, startMarker, endMarker, replacement) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);

  if (start < 0 || end < 0 || end < start) {
    throw new Error(`Missing or invalid marker pair: ${startMarker} ... ${endMarker}`);
  }

  const before = content.slice(0, start + startMarker.length);
  const after = content.slice(end);
  return `${before}\n${replacement}\n${after}`;
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function localBlockFromArtifact(localArtifact) {
  return [
    localArtifact.markdownTable,
    "",
    "Notes:",
    "",
    "- This table includes only measured data from real local command output.",
    "- No estimated scenarios are shown.",
    "- Reproduce these rows with `npm run benchmark:real`; source artifact: `.awesome-context/benchmark/real-suite-results.json`.",
    "- Assistant scope is intentionally constrained to `VS Code Copilot Chat`.",
    "- Model labels use GitHub Copilot model options used for these measured runs.",
    "- Official SWE-bench pass-rate style metrics (for example pass@1 or resolve rate) require measured multi-scenario execution and are not claimed here."
  ].join("\n");
}

function externalBlockFromArtifact(externalArtifact) {
  return [
    externalArtifact.markdownTable,
    "",
    "Notes:",
    "",
    "- This table is measured from real runs on shallow-cloned public GitHub repositories in `test/external-repos/`.",
    "- Assistant scope is `VS Code Copilot Chat` only.",
    "- Model labels use GitHub Copilot model options used for these measured runs.",
    "- Reproduce with `npm run benchmark:external`; source artifact: `.awesome-context/benchmark/external-github-results.json`."
  ].join("\n");
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const rootDir = process.cwd();
  const readmePath = path.join(rootDir, "README.md");

  if (!checkOnly) {
    runNodeScript(rootDir, "scripts/benchmark-real-suite.mjs");
    runNodeScript(rootDir, "scripts/benchmark-external-github.mjs");
  }

  const localArtifact = await readJson(path.join(rootDir, ".awesome-context", "benchmark", "real-suite-results.json"));
  const externalArtifact = await readJson(path.join(rootDir, ".awesome-context", "benchmark", "external-github-results.json"));
  const currentReadme = await fs.readFile(readmePath, "utf8");

  let nextReadme = currentReadme;
  nextReadme = replaceBlock(nextReadme, LOCAL_START, LOCAL_END, localBlockFromArtifact(localArtifact));
  nextReadme = replaceBlock(nextReadme, EXTERNAL_START, EXTERNAL_END, externalBlockFromArtifact(externalArtifact));

  if (nextReadme !== currentReadme) {
    if (checkOnly) {
      console.error("README benchmark sections are out of sync. Run: npm run benchmark:readme");
      process.exit(1);
    }

    await fs.writeFile(readmePath, nextReadme, "utf8");
    console.log("Updated README benchmark sections from measured artifacts.");
    return;
  }

  console.log("README benchmark sections already in sync.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
