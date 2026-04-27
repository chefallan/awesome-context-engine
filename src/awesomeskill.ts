import { createInflateRaw } from "node:zlib";
import { Readable } from "node:stream";

const BASE_URL = "https://awesomeskill.ai";
const CDN_URL = "https://cdn.awesomeskill.ai/skills";
const SEARCH_TIMEOUT_MS = 8000;

// ─── Search ──────────────────────────────────────────────────────────────────

export async function searchSkillSlugs(keywords: string[]): Promise<string[]> {
  // Search with each keyword separately and merge results, preserving order
  const seen = new Set<string>();
  const slugs: string[] = [];

  for (const kw of keywords.slice(0, 3)) {
    const url = `${BASE_URL}/search?q=${encodeURIComponent(kw)}`;
    try {
      const res = await fetchWithTimeout(url, SEARCH_TIMEOUT_MS);
      if (!res.ok) continue;
      const html = await res.text();
      for (const slug of parseSlugsfromHtml(html)) {
        if (!seen.has(slug)) {
          seen.add(slug);
          slugs.push(slug);
        }
      }
    } catch {
      // continue to next keyword
    }
  }

  return slugs;
}

function parseSlugsfromHtml(html: string): string[] {
  // Match href="/skill/{slug}" — exact attribute format used by the site
  const matches = [...html.matchAll(/href="\/skill\/([^"]+)"/g)];
  const seen = new Set<string>();
  const slugs: string[] = [];
  for (const m of matches) {
    const slug = m[1];
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      slugs.push(slug);
    }
  }
  return slugs;
}

// ─── ZIP fetch + SKILL.md extraction ─────────────────────────────────────────

export async function fetchSkillContent(slug: string): Promise<string | null> {
  const url = `${CDN_URL}/${slug}/${slug}.zip`;
  try {
    const res = await fetchWithTimeout(url, SEARCH_TIMEOUT_MS);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return await extractFileFromZip(buffer, /SKILL\.md$/i);
  } catch {
    return null;
  }
}

// ZIP reader via Central Directory — correctly handles data-descriptor flag (bit 3).
async function extractFileFromZip(buf: Buffer, target: RegExp): Promise<string | null> {
  // Step 1: find the End of Central Directory record (EOCD) by scanning backward.
  const EOCD_SIG = 0x06054b50;
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return null;

  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const cdSize = buf.readUInt32LE(eocdOffset + 12);

  // Step 2: walk Central Directory entries to find target file.
  const CD_SIG = 0x02014b50;
  let cdPos = cdOffset;
  while (cdPos < cdOffset + cdSize && cdPos + 46 < buf.length) {
    if (buf.readUInt32LE(cdPos) !== CD_SIG) break;

    const compressionMethod = buf.readUInt16LE(cdPos + 10);
    const compressedSize = buf.readUInt32LE(cdPos + 20);
    const fileNameLen = buf.readUInt16LE(cdPos + 28);
    const extraLen = buf.readUInt16LE(cdPos + 30);
    const commentLen = buf.readUInt16LE(cdPos + 32);
    const localHeaderOffset = buf.readUInt32LE(cdPos + 42);
    const fileName = buf.subarray(cdPos + 46, cdPos + 46 + fileNameLen).toString("utf8");

    if (target.test(fileName)) {
      // Step 3: jump to local file header to find the data start.
      const lhFileNameLen = buf.readUInt16LE(localHeaderOffset + 26);
      const lhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lhFileNameLen + lhExtraLen;
      const compressedData = buf.subarray(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) return compressedData.toString("utf8");
      if (compressionMethod === 8) {
        try { return await inflateRawAsync(compressedData); } catch { return null; }
      }
    }

    cdPos += 46 + fileNameLen + extraLen + commentLen;
  }

  return null;
}

function inflateRawAsync(data: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const inflate = createInflateRaw();
    const readable = Readable.from(data);
    readable.pipe(inflate);
    inflate.on("data", (chunk: Buffer) => chunks.push(chunk));
    inflate.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    inflate.on("error", reject);
  });
}

// ─── High-level: find best matching community skill ───────────────────────────

export async function fetchBestMatchSkill(
  skillName: string,
  stackKeywords: string[]
): Promise<string | null> {
  const slugs = await searchSkillSlugs([skillName, ...stackKeywords]);
  if (slugs.length === 0) return null;

  // Try up to 3 slugs in order, return first that yields content
  for (const slug of slugs.slice(0, 3)) {
    const content = await fetchSkillContent(slug);
    if (content && content.length > 100) return content;
  }

  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}
