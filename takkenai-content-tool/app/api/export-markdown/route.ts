import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { uploadMarkdownCoverImage } from "@/lib/image-hosting";
import { composePublishPayload } from "@/lib/publish-composer";
import {
  ensureDirExists,
  resolveGeneratedOutputDir,
  resolveRunContext,
  type SkillRunMode,
} from "@/lib/site-config";
import { getGeneratedContentFilename, resolveContentKey } from "@/lib/content-variant";
import type { Platform } from "@/lib/topic-engine";

const EXPORT_DIR = "/Users/yoyomm/Desktop/takken";

type RequestBody = {
  title?: string;
  body?: string;
  coverFile?: string | null;
  inlineImageFile?: string | null;
  inlineImageAlt?: string;
  date?: string;
  platform?: string;
  siteId?: string;
  language?: string;
  mode?: SkillRunMode;
  contentKey?: "standard" | "note-viral";
  exportTarget?: string;
};

type GeneratedFallback = {
  title: string;
  body: string;
};

type ImageUploadWarning = {
  kind: "cover" | "inline";
  file: string;
  message: string;
};

function resolveExportDir(target?: string): string {
  const candidate = (target || "").trim();
  return candidate || EXPORT_DIR;
}

function loadGeneratedFallback(
  generatedDir: string,
  date: string | undefined,
  platform: string | undefined,
  contentKey?: "standard" | "note-viral"
): GeneratedFallback | null {
  if (!date || !platform) return null;
  if (!["ameba", "note", "hatena"].includes(platform)) return null;
  const typedPlatform = platform as Platform;
  const resolvedContentKey = resolveContentKey(typedPlatform, contentKey);

  const filePath = path.join(
    generatedDir,
    getGeneratedContentFilename(date, typedPlatform, resolvedContentKey)
  );
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as { title?: unknown; body?: unknown };
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
    if (!title || !body) return null;
    return { title, body };
  } catch {
    return null;
  }
}

function sanitizeFilePart(value: string): string {
  return value
    .replace(/[\\/:*?"<>|\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function formatDownloadStamp(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${y}${m}${d}-${hh}${mm}${ss}`;
}

function normalizeCoverFile(fileName: string): string | null {
  if (!fileName) return null;
  if (fileName.includes("/") || fileName.includes("\\")) return null;
  if (!/\.(png|jpe?g|webp)$/i.test(fileName)) return null;
  return fileName;
}

function sanitizeMarkdownAltText(value: string): string {
  return value
    .replace(/[\r\n\t]/g, " ")
    .replace(/[\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RequestBody;
    const runContext = resolveRunContext({
      siteId: body.siteId,
      language: body.language,
      mode: body.mode,
    });
    const generatedDir = resolveGeneratedOutputDir({
      mode: runContext.mode,
      siteId: runContext.siteId,
    });
    const exportDir = resolveExportDir(body.exportTarget);
    ensureDirExists(exportDir);
    let title = (body.title || "").trim();
    let articleBody = (body.body || "").trim();
    const resolvedContentKey = resolveContentKey(
      body.platform === "ameba" || body.platform === "note" || body.platform === "hatena"
        ? body.platform
        : "note",
      body.contentKey
    );

    if (!title || !articleBody) {
      const fallback = loadGeneratedFallback(
        generatedDir,
        body.date,
        body.platform,
        resolvedContentKey
      );
      if (fallback) {
        if (!title) title = fallback.title;
        if (!articleBody) articleBody = fallback.body;
      }
    }

    if (!title || !articleBody) {
      return NextResponse.json(
        {
          error:
            "title と body が空です。先に本文を生成するか、該当日付・平台の生成済み内容を確認してください。",
        },
        { status: 400 }
      );
    }

    const safeTitle = sanitizeFilePart(title) || "untitled";
    const stamp = formatDownloadStamp(new Date());
    const baseName = `${safeTitle}_${stamp}`;

    let includedCoverImage = false;
    let markdownCoverSrc: string | undefined = undefined;
    let coverImageMode: "none" | "r2-url" | "uguu-url" | "catbox-url" | "telegra-url" = "none";
    let coverImageUrl: string | null = null;
    let objectKey: string | null = null;
    let imageHostingProvider: "r2" | "uguu" | "catbox" | "telegra-ph" | null = null;
    let inlineImageUrl: string | null = null;
    let inlineImageMode: "none" | "r2-url" | "uguu-url" | "catbox-url" | "telegra-url" = "none";
    let inlineObjectKey: string | null = null;
    let inlineImageProvider: "r2" | "uguu" | "catbox" | "telegra-ph" | null = null;
    const imageUploadWarnings: ImageUploadWarning[] = [];

    const rawCoverFile =
      typeof body.coverFile === "string" ? body.coverFile.trim() : "";
    const normalizedCoverFile = normalizeCoverFile(rawCoverFile);
    if (rawCoverFile && !normalizedCoverFile) {
      return NextResponse.json(
        { error: `封面图文件名非法: ${rawCoverFile}` },
        { status: 400 }
      );
    }
    if (normalizedCoverFile) {
      const sourceCoverPath = path.join(generatedDir, normalizedCoverFile);
      if (!fs.existsSync(sourceCoverPath)) {
        return NextResponse.json(
          { error: `封面图文件不存在: ${normalizedCoverFile}` },
          { status: 400 }
        );
      }

      try {
        const uploaded = await uploadMarkdownCoverImage({
          sourcePath: sourceCoverPath,
          date: body.date,
          platform: body.platform,
        });
        markdownCoverSrc = uploaded.url;
        includedCoverImage = true;
        coverImageMode =
          uploaded.provider === "r2"
            ? "r2-url"
            : uploaded.provider === "uguu"
            ? "uguu-url"
            : uploaded.provider === "catbox"
            ? "catbox-url"
            : "telegra-url";
        coverImageUrl = uploaded.url;
        objectKey = uploaded.objectKey;
        imageHostingProvider = uploaded.provider;
      } catch (error) {
        return NextResponse.json(
          {
            error: `封面图上传失败: ${
              error instanceof Error ? error.message : "unknown upload error"
            }`,
          },
          { status: 500 }
        );
      }
    }

    const rawInlineImageFile =
      typeof body.inlineImageFile === "string" ? body.inlineImageFile.trim() : "";
    const normalizedInlineImageFile = normalizeCoverFile(rawInlineImageFile);
    if (rawInlineImageFile && !normalizedInlineImageFile) {
      return NextResponse.json(
        { error: `正文插图文件名非法: ${rawInlineImageFile}` },
        { status: 400 }
      );
    }
    let markdownInlineSrc: string | undefined = undefined;
    if (normalizedInlineImageFile) {
      const sourceInlinePath = path.join(generatedDir, normalizedInlineImageFile);
      if (!fs.existsSync(sourceInlinePath)) {
        return NextResponse.json(
          { error: `正文插图文件不存在: ${normalizedInlineImageFile}` },
          { status: 400 }
        );
      }

      try {
        const uploadedInline = await uploadMarkdownCoverImage({
          sourcePath: sourceInlinePath,
          date: body.date,
          platform: body.platform,
        });
        markdownInlineSrc = uploadedInline.url;
        inlineImageMode =
          uploadedInline.provider === "r2"
            ? "r2-url"
            : uploadedInline.provider === "uguu"
            ? "uguu-url"
            : uploadedInline.provider === "catbox"
            ? "catbox-url"
            : "telegra-url";
        inlineImageUrl = uploadedInline.url;
        inlineObjectKey = uploadedInline.objectKey;
        inlineImageProvider = uploadedInline.provider;
      } catch (error) {
        return NextResponse.json(
          {
            error: `正文配图上传失败: ${
              error instanceof Error ? error.message : "unknown upload error"
            }`,
          },
          { status: 500 }
        );
      }
    }

    const composed = composePublishPayload({
      title,
      body: articleBody,
      platform:
        body.platform === "ameba" || body.platform === "note" || body.platform === "hatena"
          ? body.platform
          : "note",
      coverImageUrl: markdownCoverSrc,
      inlineImageUrl: markdownInlineSrc,
      inlineImageAlt: sanitizeMarkdownAltText(body.inlineImageAlt || ""),
    });
    const markdown = composed.markdown;
    const markdownBytes = Buffer.byteLength(markdown, "utf8");
    const markdownFile = `${baseName}.md`;
    const markdownPath = path.join(exportDir, markdownFile);
    fs.writeFileSync(markdownPath, markdown, "utf-8");
    const writtenBytes = fs.existsSync(markdownPath)
      ? fs.statSync(markdownPath).size
      : 0;

    return NextResponse.json({
      success: true,
      markdownFile,
      markdownPath,
      markdownBytes,
      writtenBytes,
      bodyChars: articleBody.length,
      coverImageFile: normalizedCoverFile || null,
      includedCoverImage,
      coverImageMode,
      coverImageUrl,
      imageHostingProvider,
      objectKey,
      inlineImageFile: normalizedInlineImageFile || null,
      inlineImageMode,
      inlineImageUrl,
      inlineObjectKey,
      inlineImageProvider,
      imageUploadWarnings,
      exportDir,
      siteId: runContext.siteId,
      language: runContext.language,
      mode: runContext.mode,
      contentKey: resolvedContentKey,
      date: body.date || "",
      platform: body.platform || "",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "不明なエラー";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
