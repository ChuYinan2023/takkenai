#!/usr/bin/env node

import fs from "fs";
import path from "path";
import * as imageHosting from "../lib/image-hosting.ts";

const GENERATED_DIR = path.join(process.cwd(), "data", "generated");
const IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/;
const META_REGEX = /<!--\s*takken-export-meta:\s*({[\s\S]*?})\s*-->/;
const uploadMarkdownCoverImage =
  imageHosting.uploadMarkdownCoverImage ||
  imageHosting.default?.uploadMarkdownCoverImage;

function parseArgs(argv) {
  const files = [];
  let reportPath = "";

  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item === "--report") {
      reportPath = argv[i + 1] || "";
      i += 1;
      continue;
    }
    files.push(item);
  }

  return { files, reportPath };
}

function normalizeDate(input) {
  const value = (input || "").trim();
  const m = value.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (!m) return "";
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function inferDateFromFileName(filePath) {
  const base = path.basename(filePath);
  const m = base.match(/_(\d{8})-\d{6}\.md$/);
  if (!m) return "";
  return normalizeDate(m[1]);
}

function inferPlatformFromText(text) {
  const m = text.match(/utm_source=(ameba|note|hatena)/i);
  return m ? m[1].toLowerCase() : "";
}

function parseMeta(text) {
  const m = text.match(META_REGEX);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function extractImage(text) {
  const m = text.match(IMAGE_REGEX);
  if (!m) return null;
  return { alt: m[1], src: m[2], fullMatch: m[0] };
}

function needsRepair(src) {
  if (!src) return false;
  return /tmpfiles\.org/i.test(src) || /^data:image\//i.test(src);
}

function extractFileNameFromImageSrc(src) {
  if (!src || /^data:image\//i.test(src)) return "";
  try {
    const u = new URL(src);
    const part = u.pathname.split("/").pop() || "";
    return decodeURIComponent(part);
  } catch {
    return "";
  }
}

function isImageFile(name) {
  return /\.(png|jpe?g|webp)$/i.test(name);
}

function resolveCoverFromDatePlatform(date, platform) {
  if (!date || !platform) return "";
  if (!fs.existsSync(GENERATED_DIR)) return "";
  const prefix = `${date}-${platform}-cover`;
  const candidates = fs
    .readdirSync(GENERATED_DIR)
    .filter((file) => file.startsWith(prefix))
    .filter((file) => isImageFile(file))
    .map((file) => ({
      file,
      abs: path.join(GENERATED_DIR, file),
      mtime: fs.statSync(path.join(GENERATED_DIR, file)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.abs || "";
}

function resolveCoverPath(filePath, text, imageSrc) {
  const meta = parseMeta(text);

  const coverFromMeta = meta?.coverFile;
  if (typeof coverFromMeta === "string" && isImageFile(coverFromMeta)) {
    const abs = path.join(GENERATED_DIR, coverFromMeta);
    if (fs.existsSync(abs)) return abs;
  }

  const nameFromUrl = extractFileNameFromImageSrc(imageSrc);
  if (nameFromUrl && isImageFile(nameFromUrl)) {
    const abs = path.join(GENERATED_DIR, nameFromUrl);
    if (fs.existsSync(abs)) return abs;
  }

  const date =
    normalizeDate(meta?.date || "") || inferDateFromFileName(filePath) || "";
  const platform = (meta?.platform || "").trim() || inferPlatformFromText(text);
  return resolveCoverFromDatePlatform(date, platform);
}

function upsertMetaComment(text, metaObj) {
  const comment = `<!-- takken-export-meta: ${JSON.stringify(metaObj)} -->`;
  if (META_REGEX.test(text)) {
    return text.replace(META_REGEX, comment);
  }
  return `${comment}\n\n${text}`;
}

async function repairOne(filePath) {
  const absFilePath = path.resolve(filePath);
  if (!fs.existsSync(absFilePath)) {
    return { file: absFilePath, status: "failed", reason: "文件不存在" };
  }

  const text = fs.readFileSync(absFilePath, "utf-8");
  const image = extractImage(text);
  if (!image) {
    return { file: absFilePath, status: "failed", reason: "未找到 Markdown 图片行" };
  }

  if (!needsRepair(image.src)) {
    return { file: absFilePath, status: "skipped", reason: "图片链接已是稳定 URL" };
  }

  const coverPath = resolveCoverPath(absFilePath, text, image.src);
  if (!coverPath) {
    return { file: absFilePath, status: "failed", reason: "无法定位本地封面图文件" };
  }

  const normalizedDate = inferDateFromFileName(absFilePath);
  const platform = inferPlatformFromText(text) || "manual";
  const uploaded = await uploadMarkdownCoverImage({
    sourcePath: coverPath,
    date: normalizedDate || undefined,
    platform,
  });

  const newImageLine = `![${image.alt}](${uploaded.url})`;
  const replaced = text.replace(IMAGE_REGEX, newImageLine);
  const meta = {
    coverFile: path.basename(coverPath),
    provider: "r2",
    objectKey: uploaded.objectKey,
    publicUrl: uploaded.url,
    exportedAt: new Date().toISOString(),
    date: normalizedDate || "",
    platform,
  };
  const finalText = upsertMetaComment(replaced, meta);
  fs.writeFileSync(absFilePath, finalText, "utf-8");

  return {
    file: absFilePath,
    status: "repaired",
    publicUrl: uploaded.url,
    objectKey: uploaded.objectKey,
    coverFile: path.basename(coverPath),
  };
}

async function main() {
  if (typeof uploadMarkdownCoverImage !== "function") {
    throw new Error("uploadMarkdownCoverImage is not available");
  }

  const { files, reportPath } = parseArgs(process.argv.slice(2));
  if (files.length === 0) {
    console.error(
      "Usage: node --import tsx scripts/repair-markdown-images.mjs [--report report.json] <file1.md> <file2.md> ..."
    );
    process.exit(1);
  }

  const results = [];
  for (const file of files) {
    try {
      const result = await repairOne(file);
      results.push(result);
      if (result.status === "repaired") {
        console.log(`[repaired] ${result.file}`);
        console.log(`  -> ${result.publicUrl}`);
      } else {
        console.log(`[${result.status}] ${result.file}: ${result.reason}`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const failed = { file: path.resolve(file), status: "failed", reason };
      results.push(failed);
      console.log(`[failed] ${failed.file}: ${failed.reason}`);
    }
  }

  if (reportPath) {
    const reportAbs = path.resolve(reportPath);
    fs.writeFileSync(reportAbs, JSON.stringify(results, null, 2), "utf-8");
    console.log(`report written: ${reportAbs}`);
  }

  const failedCount = results.filter((item) => item.status === "failed").length;
  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
