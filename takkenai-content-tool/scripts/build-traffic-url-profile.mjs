import fs from "fs";
import path from "path";

const DEFAULT_INPUT =
  "/Users/yoyomm/Desktop/takken/2026-02-25-GA4-综合分析报告.md";
const DEFAULT_OUTPUT = path.join(
  process.cwd(),
  "data",
  "traffic-url-profile.json"
);

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--input" && argv[i + 1]) {
      args.input = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--output" && argv[i + 1]) {
      args.output = argv[i + 1];
      i += 1;
      continue;
    }
  }
  return args;
}

function canonicalPath(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  let normalized = value.replace(/^https?:\/\/[^/]+/i, "");
  normalized = normalized.split(/[?#]/)[0];
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  normalized = normalized.replace(/\/+$/, "") || "/";
  return normalized.toLowerCase();
}

function parseNumber(raw) {
  const match = String(raw || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function sectionBody(content, title) {
  const start = content.indexOf(title);
  if (start < 0) return "";
  const next = content.indexOf("\n---", start + title.length);
  return content.slice(start, next > start ? next : undefined);
}

function parseMarkdownRows(content, title, mapper) {
  const body = sectionBody(content, title);
  if (!body) return [];
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("| /"))
    .map((line) => {
      const cols = line
        .split("|")
        .map((part) => part.trim())
        .filter(Boolean);
      return mapper(cols);
    })
    .filter(Boolean);
}

function buildLabel(pathValue) {
  const parts = canonicalPath(pathValue).split("/").filter(Boolean);
  const slug = parts[parts.length - 1] || "takkenai";
  return slug
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadExistingLabels(outputPath) {
  if (!fs.existsSync(outputPath)) return new Map();
  try {
    const raw = fs.readFileSync(outputPath, "utf-8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed.items) ? parsed.items : [];
    const map = new Map();
    for (const item of list) {
      const key = canonicalPath(item.path);
      if (!key) continue;
      const label = String(item.labelJa || "").trim();
      if (!label) continue;
      map.set(key, label);
    }
    return map;
  } catch {
    return new Map();
  }
}

function isSupportedPath(pathValue) {
  if (!pathValue.startsWith("/tools/") && !pathValue.startsWith("/takken/")) {
    return false;
  }
  if (
    /^\/(admin|dashboard|auth|settings|plans)\b/.test(pathValue) ||
    /^\/p\//.test(pathValue) ||
    /^\/blog\b/.test(pathValue) ||
    /^\/mock-exam\b/.test(pathValue)
  ) {
    return false;
  }
  if (/^\/takken\/past-questions\/\d{4}-q\d+/.test(pathValue)) {
    return false;
  }
  return true;
}

function computeTier(sortedRows, badPaths) {
  const nonCooldown = sortedRows.filter((row) => !badPaths.has(row.path));
  const highCount = Math.max(1, Math.ceil(nonCooldown.length * 0.4));
  const highSet = new Set(nonCooldown.slice(0, highCount).map((row) => row.path));
  return sortedRows.map((row) => {
    if (badPaths.has(row.path)) return { ...row, tier: "cooldown" };
    return {
      ...row,
      tier: highSet.has(row.path) ? "high" : "explore",
    };
  });
}

function buildWeight(row) {
  const base = Math.max(1, Math.round(row.score / 40));
  if (row.tier === "cooldown") return Math.max(1, Math.round(base * 0.5));
  if (row.tier === "high") return base + 1;
  return base;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.input)) {
    throw new Error(`GA4 report not found: ${args.input}`);
  }

  const content = fs.readFileSync(args.input, "utf-8");
  const existingLabels = loadExistingLabels(args.output);

  const landing = parseMarkdownRows(
    content,
    "## 七、着陆页 TOP 50",
    (cols) => ({
      path: canonicalPath(cols[0]),
      sessions: parseNumber(cols[1]),
      bounceRate: parseNumber(cols[4]),
    })
  );
  const pages = parseMarkdownRows(
    content,
    "## 八、页面浏览 TOP 100",
    (cols) => ({
      path: canonicalPath(cols[0]),
      pv: parseNumber(cols[2]),
    })
  );
  const highBounce = parseMarkdownRows(
    content,
    "## 十六、需优化着陆页",
    (cols) => ({
      path: canonicalPath(cols[0]),
      bounceRate: parseNumber(cols[2]),
    })
  );

  const merged = new Map();
  for (const row of landing) {
    if (!row.path || !isSupportedPath(row.path)) continue;
    const current = merged.get(row.path) || {
      path: row.path,
      sessions: 0,
      pv: 0,
      bounceRate: 0,
    };
    current.sessions = Math.max(current.sessions, row.sessions || 0);
    current.bounceRate = Math.max(current.bounceRate, row.bounceRate || 0);
    merged.set(row.path, current);
  }
  for (const row of pages) {
    if (!row.path || !isSupportedPath(row.path)) continue;
    const current = merged.get(row.path) || {
      path: row.path,
      sessions: 0,
      pv: 0,
      bounceRate: 0,
    };
    current.pv = Math.max(current.pv, row.pv || 0);
    merged.set(row.path, current);
  }
  const badPaths = new Set();
  for (const row of highBounce) {
    if (!row.path || !isSupportedPath(row.path)) continue;
    badPaths.add(row.path);
    const current = merged.get(row.path) || {
      path: row.path,
      sessions: 0,
      pv: 0,
      bounceRate: 0,
    };
    current.bounceRate = Math.max(current.bounceRate, row.bounceRate || 0);
    merged.set(row.path, current);
  }

  const scored = Array.from(merged.values())
    .map((row) => ({
      ...row,
      score: row.sessions * 3 + row.pv,
    }))
    .sort((a, b) => b.score - a.score);

  const withTier = computeTier(scored, badPaths);
  const items = withTier.map((row) => {
    const group = row.path.startsWith("/tools/") ? "tool" : "takken";
    return {
      path: row.path,
      labelJa: existingLabels.get(row.path) || buildLabel(row.path),
      group,
      tier: row.tier,
      weight: buildWeight(row),
      sourceScore: row.score,
      bounceRate: row.bounceRate > 0 ? row.bounceRate : undefined,
    };
  });

  const profile = {
    version: `ga4-auto-${new Date().toISOString().slice(0, 10)}`,
    generatedAt: new Date().toISOString(),
    strategy: {
      highShare: 0.7,
      exploreShare: 0.3,
    },
    items,
  };

  const outDir = path.dirname(args.output);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(profile, null, 2)}\n`, "utf-8");

  const summary = {
    output: args.output,
    total: items.length,
    high: items.filter((item) => item.tier === "high").length,
    explore: items.filter((item) => item.tier === "explore").length,
    cooldown: items.filter((item) => item.tier === "cooldown").length,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main();
