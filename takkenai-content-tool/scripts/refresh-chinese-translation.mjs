#!/usr/bin/env node

import fs from "fs";
import path from "path";
import * as claudeModule from "../lib/claude.ts";

const ensureFinalJapaneseChineseConsistency =
  claudeModule.ensureFinalJapaneseChineseConsistency ||
  claudeModule.default?.ensureFinalJapaneseChineseConsistency;
const validateFinalJapaneseChineseConsistency =
  claudeModule.validateFinalJapaneseChineseConsistency ||
  claudeModule.default?.validateFinalJapaneseChineseConsistency;

const VALID_PLATFORMS = new Set(["ameba", "note", "hatena"]);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf-8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || process.env[key] != null) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function parseArgs(argv) {
  const args = { date: "", platform: "" };
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item === "--date") {
      args.date = (argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (item === "--platform") {
      args.platform = (argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
  }
  return args;
}

function countHeadings(text) {
  return (String(text || "").match(/^##+\s+.+$/gm) || []).length;
}

function formatStats(content) {
  return {
    jpChars: String(content?.body || "").length,
    zhChars: String(content?.bodyChinese || "").length,
    jpHeadings: countHeadings(content?.body || ""),
    zhHeadings: countHeadings(content?.bodyChinese || ""),
  };
}

async function main() {
  if (
    typeof ensureFinalJapaneseChineseConsistency !== "function" ||
    typeof validateFinalJapaneseChineseConsistency !== "function"
  ) {
    throw new Error(
      "Translation helpers are unavailable from lib/claude.ts (ensureFinalJapaneseChineseConsistency / validateFinalJapaneseChineseConsistency)"
    );
  }

  loadEnvFile(path.join(process.cwd(), ".env.local"));
  loadEnvFile(path.join(process.cwd(), ".env"));

  const args = parseArgs(process.argv.slice(2));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date) || !VALID_PLATFORMS.has(args.platform)) {
    console.error(
      'Usage: node --import tsx scripts/refresh-chinese-translation.mjs --date YYYY-MM-DD --platform ameba|note|hatena'
    );
    process.exit(1);
  }

  const targetPath = path.join(
    process.cwd(),
    "data",
    "generated",
    `${args.date}-${args.platform}.json`
  );
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Target file not found: ${targetPath}`);
  }

  const before = JSON.parse(fs.readFileSync(targetPath, "utf-8"));
  const beforeStats = formatStats(before);

  const refreshed = await ensureFinalJapaneseChineseConsistency(args.platform, before);
  const finalIssues = validateFinalJapaneseChineseConsistency(refreshed);
  if (finalIssues.length > 0) {
    throw new Error(`refresh failed: ${finalIssues.join(" / ")}`);
  }

  fs.writeFileSync(targetPath, `${JSON.stringify(refreshed, null, 2)}\n`, "utf-8");
  const afterStats = formatStats(refreshed);

  console.log("refresh passed");
  console.log(`file: ${targetPath}`);
  console.log(
    `headings jp ${beforeStats.jpHeadings} -> ${afterStats.jpHeadings}, zh ${beforeStats.zhHeadings} -> ${afterStats.zhHeadings}`
  );
  console.log(
    `chars jp ${beforeStats.jpChars} -> ${afterStats.jpChars}, zh ${beforeStats.zhChars} -> ${afterStats.zhChars}`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
