import { promises as fs } from "node:fs";
import path from "node:path";
import { indexProject, type IndexData } from "./indexer.js";
import { getContextPaths } from "./templates.js";

export type VisualizationResult = {
  svgPath: string;
  bytes: number;
  generatedAt: string;
};

const SVG_WIDTH = 1600;
const SVG_HEIGHT = 2400;
const PADDING = 40;
const HEADER_HEIGHT = 100;
const COL_WIDTH = (SVG_WIDTH - PADDING * 3) / 2;
const FONT_SIZE = 13;
const LINE_HEIGHT = 20;
const COLOR_PRIMARY = "#0366d6";
const COLOR_SECONDARY = "#6f42c1";
const COLOR_TEXT = "#24292e";
const COLOR_BORDER = "#d1d5da";
const COLOR_BG_LIGHT = "#f6f8fa";

type TreeNode = {
  name: string;
  path: string;
  depth: number;
  children: TreeNode[];
  isFile: boolean;
  isDir: boolean;
};

function buildDirectoryTree(files: Array<{ path: string }>, maxDepth: number = 3): TreeNode | null {
  if (files.length === 0) return null;

  const root: TreeNode = {
    name: ".",
    path: ".",
    depth: 0,
    children: [],
    isFile: false,
    isDir: true
  };

  const nodeMap = new Map<string, TreeNode>();
  nodeMap.set(".", root);

  // Add all unique directories
  const dirs = new Set<string>();
  for (const file of files) {
    const dir = path.dirname(file.path);
    if (dir !== ".") {
      dirs.add(dir);
    }
  }

  // Sort and build tree
  const sortedPaths = Array.from(dirs).sort();
  for (const dir of sortedPaths) {
    const depth = dir.split(/[\\/]/).length;
    if (depth > maxDepth) continue;

    const parent = path.dirname(dir);
    const parentNode = nodeMap.get(parent);
    if (!parentNode) continue;

    const node: TreeNode = {
      name: path.basename(dir),
      path: dir,
      depth,
      children: [],
      isFile: false,
      isDir: true
    };
    nodeMap.set(dir, node);
    parentNode.children.push(node);
  }

  // Add files
  for (const file of files) {
    const depth = file.path.split(/[\\/]/).length;
    if (depth > maxDepth) continue;

    const dir = path.dirname(file.path);
    const parentNode = nodeMap.get(dir);
    if (!parentNode) continue;

    const node: TreeNode = {
      name: path.basename(file.path),
      path: file.path,
      depth,
      children: [],
      isFile: true,
      isDir: false
    };
    parentNode.children.push(node);
  }

  // Sort children
  for (const node of nodeMap.values()) {
    node.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return b.isDir ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }

  return root;
}

function renderTreeNode(
  node: TreeNode,
  yPos: number,
  indent: number,
  maxDepth: number,
  nodes: Array<{ x: number; y: number; text: string; isDir: boolean; isFile: boolean }>
): number {
  if (node.depth > maxDepth) return yPos;

  const x = PADDING + PADDING + indent * 15;
  const text = node.isDir ? `📁 ${node.name}` : `📄 ${node.name}`;

  nodes.push({ x, y: yPos, text, isDir: node.isDir, isFile: node.isFile });
  yPos += LINE_HEIGHT;

  for (const child of node.children) {
    yPos = renderTreeNode(child, yPos, indent + 1, maxDepth, nodes);
  }

  return yPos;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function generateSvgVisualization(rootDir: string): Promise<VisualizationResult> {
  const indexResult = await indexProject(rootDir, { writeJson: true, writeMarkdown: false });
  const data = indexResult.data;

  const contextPaths = getContextPaths(rootDir);
  const svgPath = path.join(contextPaths.contextDir, "project-map.svg");

  // Start building SVG
  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${SVG_WIDTH}" height="${SVG_HEIGHT}" xmlns="http://www.w3.org/2000/svg" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: ${FONT_SIZE}px;">
  <defs>
    <style type="text/css">
      .header-title { font-size: 28px; font-weight: 700; fill: ${COLOR_PRIMARY}; }
      .section-title { font-size: 16px; font-weight: 600; fill: ${COLOR_PRIMARY}; margin-top: 12px; }
      .text-normal { fill: ${COLOR_TEXT}; font-size: ${FONT_SIZE}px; }
      .text-secondary { fill: #6a737d; font-size: ${FONT_SIZE}px; }
      .text-small { fill: #6a737d; font-size: 12px; }
      .tree-item { font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; font-size: 12px; fill: ${COLOR_TEXT}; }
      .rect-border { fill: none; stroke: ${COLOR_BORDER}; stroke-width: 1; }
      .rect-bg { fill: ${COLOR_BG_LIGHT}; stroke: ${COLOR_BORDER}; stroke-width: 1; }
    </style>
  </defs>

  <!-- Background -->
  <rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="white"/>

  <!-- Header -->
  <rect x="${PADDING}" y="${PADDING}" width="${SVG_WIDTH - PADDING * 2}" height="${HEADER_HEIGHT - 20}" rx="8" class="rect-bg"/>
  <text x="${PADDING + 20}" y="${PADDING + 45}" class="header-title">Repository Map</text>
  <text x="${PADDING + 20}" y="${PADDING + 65}" class="text-secondary">${escapeHtml(path.basename(rootDir))} • ${data.totalFiles} files • ${data.totalDirectories} directories</text>

  <!-- Left Column: Directory Tree -->
  <g>
    <text x="${PADDING + 20}" y="${HEADER_HEIGHT + PADDING + 25}" class="section-title">📁 Directory Structure</text>
`;

  const treeNodes: Array<{ x: number; y: number; text: string; isDir: boolean; isFile: boolean }> = [];
  const rootNode = buildDirectoryTree(data.files.slice(0, 100), 3); // Limit to top 100 for readability
  if (rootNode) {
    renderTreeNode(rootNode, HEADER_HEIGHT + PADDING + 50, 0, 3, treeNodes);
  }

  let treeY = HEADER_HEIGHT + PADDING + 50;
  for (const node of treeNodes) {
    svg += `  <text x="${node.x}" y="${treeY}" class="tree-item">${escapeHtml(node.text)}</text>\n`;
    treeY += LINE_HEIGHT;
  }

  // Right Column: Package Structure
  svg += `
    <text x="${PADDING + COL_WIDTH + PADDING + 20}" y="${HEADER_HEIGHT + PADDING + 25}" class="section-title">📦 Packages ${escapeHtml("&")} Entrypoints</text>
`;

  let rightY = HEADER_HEIGHT + PADDING + 50;
  const maxItems = 15;
  const configs = data.files
    .filter(
      (f) =>
        f.path.endsWith("package.json") ||
        f.path.endsWith("tsconfig.json") ||
        f.path.endsWith(".config.js") ||
        f.path.endsWith(".config.ts")
    )
    .slice(0, maxItems);

  for (const config of configs) {
    svg += `  <text x="${PADDING + COL_WIDTH + PADDING + 20}" y="${rightY}" class="tree-item">${escapeHtml(path.basename(config.path))}</text>\n`;
    svg += `  <text x="${PADDING + COL_WIDTH + PADDING + 180}" y="${rightY}" class="text-small">${escapeHtml(path.dirname(config.path) || ".")}</text>\n`;
    rightY += LINE_HEIGHT;
  }

  // Language & Framework Summary
  svg += `
    <text x="${PADDING + 20}" y="${treeY + 40}" class="section-title">🔧 Tech Stack</text>
`;

  let techY = treeY + 65;
  const languages = Object.entries(data.byExtension)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  for (const [ext, count] of languages) {
    const extDisplay = ext === "[no-ext]" ? "No Extension" : ext;
    svg += `  <text x="${PADDING + 20}" y="${techY}" class="text-normal">${escapeHtml(extDisplay)}</text>\n`;
    svg += `  <text x="${PADDING + 150}" y="${techY}" class="text-secondary">${count} files</text>\n`;
    techY += LINE_HEIGHT;
  }

  // File Statistics
  svg += `
    <text x="${PADDING + COL_WIDTH + PADDING + 20}" y="${rightY + 40}" class="section-title">📊 Statistics</text>
`;

  let statsY = rightY + 65;
  const statsData = [
    { label: "Total Files", value: data.totalFiles.toString() },
    { label: "Total Directories", value: data.totalDirectories.toString() },
    {
      label: "Total Size",
      value: (data.files.reduce((sum, f) => sum + f.bytes, 0) / 1024 / 1024).toFixed(2) + " MB"
    },
    { label: "Generated", value: new Date(data.generatedAt).toLocaleDateString() }
  ];

  for (const stat of statsData) {
    svg += `  <text x="${PADDING + COL_WIDTH + PADDING + 20}" y="${statsY}" class="text-normal">${escapeHtml(stat.label)}</text>\n`;
    svg += `  <text x="${PADDING + COL_WIDTH + PADDING + 280}" y="${statsY}" class="text-secondary">${escapeHtml(stat.value)}</text>\n`;
    statsY += LINE_HEIGHT;
  }

  svg += `
</g>

  <!-- Footer -->
  <text x="${PADDING + 20}" y="${SVG_HEIGHT - 20}" class="text-small">Generated by awesome-context-engine • ${new Date().toISOString().split("T")[0]}</text>
</svg>`;

  // Write SVG file
  await fs.writeFile(svgPath, svg, "utf8");
  const fileStats = await fs.stat(svgPath);

  return {
    svgPath,
    bytes: fileStats.size,
    generatedAt: new Date().toISOString()
  };
}
