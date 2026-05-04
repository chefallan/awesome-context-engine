#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { confirm, select } from "@inquirer/prompts";

const execFileAsync = promisify(execFile);

const BUMPS = new Set(["patch", "minor", "major"]);

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function printHelp() {
  console.log(`Repo Release Script

Usage:
  npm run release
  npm run release -- patch
  npm run release -- minor
  npm run release -- major

Options:
  --help   Show this help and exit
`);
}

async function run(command, args, cwd) {
  const isWindowsCmd = process.platform === "win32" && /\.cmd$/i.test(command);
  const effectiveCommand = isWindowsCmd ? "cmd.exe" : command;
  const effectiveArgs = isWindowsCmd ? ["/d", "/s", "/c", command, ...args] : args;
  const { stdout } = await execFileAsync(effectiveCommand, effectiveArgs, { cwd });
  return String(stdout ?? "").trim();
}

function parseSemver(version) {
  const match = String(version).trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function compareSemver(a, b) {
  const av = parseSemver(a);
  const bv = parseSemver(b);
  if (!av || !bv) {
    return 0;
  }

  if (av.major !== bv.major) return av.major > bv.major ? 1 : -1;
  if (av.minor !== bv.minor) return av.minor > bv.minor ? 1 : -1;
  if (av.patch !== bv.patch) return av.patch > bv.patch ? 1 : -1;
  return 0;
}

async function runInteractive(command, args, cwd) {
  const isWindowsCmd = process.platform === "win32" && /\.cmd$/i.test(command);
  const effectiveCommand = isWindowsCmd ? "cmd.exe" : command;
  const effectiveArgs = isWindowsCmd ? ["/d", "/s", "/c", command, ...args] : args;

  await new Promise((resolve, reject) => {
    const child = spawn(effectiveCommand, effectiveArgs, {
      cwd,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed: ${effectiveCommand} ${effectiveArgs.join(" ")}`));
      }
    });
  });
}

async function publishWithBrowserAuth(npmBin, rootDir) {
  // Let npm handle browser authentication exactly as native `npm publish` does.
  await runInteractive(npmBin, ["publish", "--access", "public"], rootDir);
}

async function readPackageInfo(rootDir) {
  const packageJsonPath = path.join(rootDir, "package.json");
  const raw = await fs.readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed.name || !parsed.version) {
    throw new Error("package.json must include both name and version before running release.");
  }

  return { name: parsed.name, version: parsed.version };
}

async function chooseBump(rootDir, args) {
  const fromArg = (args[0] ?? "").toLowerCase();
  if (BUMPS.has(fromArg)) {
    return fromArg;
  }

  return select({
    message: "Choose the version bump for this release",
    choices: [
      { value: "patch", name: "patch", description: "Bug fixes and small improvements" },
      { value: "minor", name: "minor", description: "Backward-compatible features" },
      { value: "major", name: "major", description: "Breaking changes" }
    ],
    default: "patch"
  });
}

async function getPublishedVersion(rootDir, packageName, npmBin) {
  try {
    const published = await run(npmBin, ["view", packageName, "version"], rootDir);
    return published.trim();
  } catch {
    return "";
  }
}

async function waitForPublished(rootDir, packageName, version, npmBin) {
  const versionTag = `${packageName}@${version}`;
  const maxWaitMs = 90_000;
  const pollIntervals = [3_000, 5_000, 5_000, 5_000, 7_000, 10_000, 10_000, 10_000, 15_000, 20_000];
  let elapsed = 0;

  process.stdout.write(`\nWaiting for ${versionTag} to appear on the registry`);

  for (const delay of pollIntervals) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    elapsed += delay;
    process.stdout.write(".");

    try {
      const found = await run(npmBin, ["view", `${packageName}@${version}`, "version"], rootDir);
      if (found.trim() === version) {
        process.stdout.write(` available (${elapsed / 1000}s)\n`);
        return;
      }
    } catch {
      // not yet visible — keep polling
    }

    if (elapsed >= maxWaitMs) {
      break;
    }
  }

  throw new Error(
    `Timed out waiting for ${versionTag} to appear on the npm registry after ${elapsed / 1000}s. ` +
    `Try running the install steps manually once the version propagates.`
  );
}

async function main() {
  const rootDir = process.cwd();
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const bump = await chooseBump(rootDir, args);
  const pkgBefore = await readPackageInfo(rootDir);

  console.log(`Release target: ${pkgBefore.name} (${pkgBefore.version} -> ${bump})`);

  const proceed = await confirm({
    message: "Continue with bump, build, and publish?",
    default: true
  });

  if (!proceed) {
    console.log("Release cancelled.");
    return;
  }

  const npmBin = npmCommand();

  let npmUser = "";
  try {
    npmUser = await run(npmBin, ["whoami"], rootDir);
  } catch {
    // not logged in — prompt for login
  }

  if (!npmUser) {
    console.log("Not logged in to npm. Running npm login...");
    await runInteractive(npmBin, ["login"], rootDir);

    try {
      npmUser = await run(npmBin, ["whoami"], rootDir);
    } catch {
      // still not logged in after login attempt
    }

    if (!npmUser) {
      throw new Error("npm login did not succeed. Please run `npm login` manually and retry.");
    }
  }

  console.log(`Logged in to npm as ${npmUser}.`);

  const publishedVersion = await getPublishedVersion(rootDir, pkgBefore.name, npmBin);
  const localAhead = publishedVersion && compareSemver(pkgBefore.version, publishedVersion) > 0;

  if (!localAhead) {
    await run(npmBin, ["version", bump, "--no-git-tag-version"], rootDir);
  } else {
    console.log(
      `Detected pending local version ${pkgBefore.version} ahead of published ${publishedVersion}; skipping extra bump and continuing publish.`
    );
  }
  await publishWithBrowserAuth(npmBin, rootDir);

  const pkgAfter = await readPackageInfo(rootDir);
  const versionTag = `${pkgAfter.name}@${pkgAfter.version}`;

  await waitForPublished(rootDir, pkgAfter.name, pkgAfter.version, npmBin);

  console.log(`\nUpdating global install to ${versionTag}...`);
  await run(npmBin, ["install", "-g", `${pkgAfter.name}@${pkgAfter.version}`], rootDir);
  console.log("Global install updated.");

  console.log(`\nUpdating project dependency to ${versionTag}...`);
  await run(npmBin, ["install", `${pkgAfter.name}@${pkgAfter.version}`], rootDir);
  console.log("Project dependency updated.");

  console.log(`\n✓ Published ${pkgAfter.name}@${pkgAfter.version}`);
  console.log(`  Global and project installs are on ${pkgAfter.version}.`);
  console.log(`  Commit and push when ready: git add -A && git commit -m "release: ${pkgAfter.version}" && git push`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`release failed: ${message}`);
  process.exit(1);
});
