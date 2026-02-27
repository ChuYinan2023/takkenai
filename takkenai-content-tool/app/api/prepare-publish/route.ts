import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { uploadMarkdownCoverImage } from "@/lib/image-hosting";
import {
  composeBodyPublishPayload,
  composePublishPayload,
} from "@/lib/publish-composer";
import {
  resolveGeneratedOutputDir,
  resolveRunContext,
  type SkillRunMode,
} from "@/lib/site-config";
import type { Platform } from "@/lib/topic-engine";
import { getGeneratedContentFilename, resolveContentKey } from "@/lib/content-variant";

type RequestBody = {
  title?: string;
  body?: string;
  coverFile?: string | null;
  inlineImageFile?: string | null;
  inlineImageAlt?: string;
  scope?: "full" | "body";
  date?: string;
  platform?: Platform;
  siteId?: string;
  language?: string;
  mode?: SkillRunMode;
  contentKey?: "standard" | "note-viral";
};

type GeneratedFallback = {
  title: string;
  body: string;
};

function normalizeImageFile(fileName: string): string | null {
  if (!fileName) return null;
  if (fileName.includes("/") || fileName.includes("\\")) return null;
  if (!/\.(png|jpe?g|webp)$/i.test(fileName)) return null;
  return fileName;
}

function loadGeneratedFallback(
  generatedDir: string,
  date: string | undefined,
  platform: Platform | undefined,
  contentKey: "standard" | "note-viral"
): GeneratedFallback | null {
  if (!date || !platform) return null;
  const resolvedContentKey = resolveContentKey(platform, contentKey);
  const filePath = path.join(
    generatedDir,
    getGeneratedContentFilename(date, platform, resolvedContentKey)
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

async function uploadIfPresent(params: {
  generatedDir: string;
  date?: string;
  platform?: Platform;
  file?: string | null;
}) {
  const normalized = normalizeImageFile((params.file || "").trim());
  if (!normalized) {
    if ((params.file || "").trim()) {
      throw new Error(`画像ファイル名が不正です: ${params.file}`);
    }
    return null;
  }

  const sourcePath = path.join(params.generatedDir, normalized);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`画像ファイルが存在しません: ${normalized}`);
  }

  return uploadMarkdownCoverImage({
    sourcePath,
    date: params.date,
    platform: params.platform,
  });
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
    const safePlatform: Platform =
      body.platform === "ameba" || body.platform === "note" || body.platform === "hatena"
        ? body.platform
        : "note";
    const resolvedContentKey = resolveContentKey(safePlatform, body.contentKey);

    let title = (body.title || "").trim();
    let articleBody = (body.body || "").trim();
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

    if (!body.platform || !["ameba", "note", "hatena"].includes(body.platform)) {
      return NextResponse.json({ error: "platform が不正です" }, { status: 400 });
    }

    const coverUpload = await uploadIfPresent({
      generatedDir,
      date: body.date,
      platform: body.platform,
      file: body.coverFile || null,
    });

    const inlineUpload = await uploadIfPresent({
      generatedDir,
      date: body.date,
      platform: body.platform,
      file: body.inlineImageFile || null,
    });

    const composed = composePublishPayload({
      title,
      body: articleBody,
      platform: body.platform,
      coverImageUrl: coverUpload?.url,
      inlineImageUrl: inlineUpload?.url,
      inlineImageAlt: body.inlineImageAlt || undefined,
    });
    const bodyComposed = composeBodyPublishPayload({
      title,
      body: articleBody,
      platform: body.platform,
      inlineImageUrl: inlineUpload?.url,
      inlineImageAlt: body.inlineImageAlt || undefined,
    });
    const scope = body.scope === "body" ? "body" : "full";
    const selected = scope === "body" ? bodyComposed : composed;

    return NextResponse.json({
      success: true,
      title,
      scope,
      markdown: selected.markdown,
      plainText: selected.plainText,
      html: selected.html,
      bodyMarkdown: bodyComposed.markdown,
      bodyPlainText: bodyComposed.plainText,
      bodyHtml: bodyComposed.html,
      coverImageUrl: coverUpload?.url || null,
      inlineImageUrl: inlineUpload?.url || null,
      imageHostingProvider: coverUpload?.provider || inlineUpload?.provider || null,
      siteId: runContext.siteId,
      language: runContext.language,
      mode: runContext.mode,
      contentKey: resolvedContentKey,
      date: body.date || "",
      platform: body.platform,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "不明なエラー";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
