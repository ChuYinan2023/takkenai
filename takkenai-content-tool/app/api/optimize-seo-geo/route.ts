import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  optimizeSeoGeoForContent,
  type GeneratedContent,
} from "@/lib/claude";
import {
  getCalendarDay,
  updatePlatformEntry,
} from "@/lib/calendar-engine";
import {
  ensureDirExists,
  resolveGeneratedOutputDir,
  resolveRunContext,
  type SkillRunMode,
} from "@/lib/site-config";
import type { Platform } from "@/lib/topic-engine";
import { resolveArticleType, type ArticleType } from "@/lib/article-type";
import {
  getGeneratedContentFilename,
  resolveContentKey,
} from "@/lib/content-variant";

type RequestBody = {
  date: string;
  platform: Platform;
  siteId?: string;
  language?: string;
  mode?: SkillRunMode;
  contentKey?: "standard" | "note-viral";
  takkenaiUrl?: string;
  articleType?: ArticleType;
  targetSeoScore?: number;
  targetGeoScore?: number;
  targetAiScore?: number;
  targetChatgptSearchScore?: number;
  aiGateMode?: "hard" | "soft";
  evidenceMode?: "auto" | "off";
  maxRounds?: number;
  content?: Partial<GeneratedContent>;
};

function parseDateString(dateStr: string): {
  year: number;
  month: number;
  day: number;
} | null {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: parseInt(match[1], 10),
    month: parseInt(match[2], 10),
    day: parseInt(match[3], 10),
  };
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOverrideTakkenaiUrl(raw?: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (hostname !== "takkenai.jp") return "";
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return `${parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "";
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function deriveTitleFromBody(body: string, fallbackLabel = "不動産実務"): string {
  const text = (body || "").trim();
  if (!text) return `${fallbackLabel}の要点解説`;

  const headingCandidate = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^##+\s+/.test(line))
    ?.replace(/^##+\s+/, "")
    .trim();
  const heading =
    headingCandidate && !/^https?:\/\//i.test(headingCandidate)
      ? headingCandidate
      : "";

  const base = (heading || fallbackLabel || "不動産実務")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/^このテーマ(?:とは|の.*)?$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const normalizedBase = base || "不動産実務";

  if (/ガイド|解説|ポイント/.test(normalizedBase)) {
    return normalizedBase;
  }
  if (normalizedBase.endsWith("とは")) {
    return `${normalizedBase.replace(/とは$/, "").trim()}の要点解説`;
  }
  return `${normalizedBase}の要点解説`;
}

function mergeContent(
  incoming: Partial<GeneratedContent> | undefined,
  fallback: GeneratedContent | null
): GeneratedContent | null {
  const body = toStringValue(incoming?.body ?? fallback?.body);
  if (!body) return null;

  const title =
    toStringValue(incoming?.title ?? fallback?.title) || deriveTitleFromBody(body);

  const takkenaiLink = toStringValue(
    incoming?.takkenaiLink ?? fallback?.takkenaiLink
  );

  return {
    title,
    body,
    titleChinese: toStringValue(incoming?.titleChinese ?? fallback?.titleChinese),
    bodyChinese: toStringValue(incoming?.bodyChinese ?? fallback?.bodyChinese),
    hashtags: toStringArray(incoming?.hashtags ?? fallback?.hashtags),
    imagePrompt: toStringValue(incoming?.imagePrompt ?? fallback?.imagePrompt),
    takkenaiLink,
    seoTitle: toStringValue(incoming?.seoTitle ?? fallback?.seoTitle),
    complianceReport: incoming?.complianceReport ?? fallback?.complianceReport,
    seoGeoReport: incoming?.seoGeoReport ?? fallback?.seoGeoReport,
    meta: incoming?.meta ?? fallback?.meta,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RequestBody;
    const { date, platform } = body;
    const runContext = resolveRunContext({
      siteId: body.siteId,
      language: body.language,
      mode: body.mode,
    });

    if (!date || !platform) {
      return NextResponse.json(
        { error: "date と platform は必須です" },
        { status: 400 }
      );
    }

    if (!["ameba", "note", "hatena"].includes(platform)) {
      return NextResponse.json(
        { error: "無効なプラットフォームです" },
        { status: 400 }
      );
    }

    const generatedDir = resolveGeneratedOutputDir({
      mode: runContext.mode,
      siteId: runContext.siteId,
    });
    const resolvedContentKey = resolveContentKey(platform, body.contentKey);
    const outputPath = path.join(
      generatedDir,
      getGeneratedContentFilename(date, platform, resolvedContentKey)
    );

    let existing: GeneratedContent | null = null;
    if (fs.existsSync(outputPath)) {
      try {
        const raw = fs.readFileSync(outputPath, "utf-8");
        existing = JSON.parse(raw) as GeneratedContent;
      } catch {
        existing = null;
      }
    }

    const mergedBase = mergeContent(body.content, existing);
    if (!mergedBase) {
      return NextResponse.json(
        { error: "最適化対象の本文データが不足しています（body）" },
        { status: 400 }
      );
    }
    const merged: GeneratedContent = { ...mergedBase };

    const parsedDate = parseDateString(date);
    const calendarUrl = parsedDate
      ? getCalendarDay(parsedDate.year, parsedDate.month, parsedDate.day)
          ?.motherTopics?.[platform]?.takkenaiUrl
      : "";
    const requestedRawUrl = (body.takkenaiUrl || "").trim();
    const overrideUrl = normalizeOverrideTakkenaiUrl(requestedRawUrl);
    if (requestedRawUrl && !overrideUrl) {
      return NextResponse.json(
        { error: "takkenaiUrl は takkenai.jp の有効なURLのみ指定できます" },
        { status: 400 }
      );
    }
    const takkenaiUrl = (
      overrideUrl ||
      calendarUrl ||
      merged.takkenaiLink ||
      ""
    ).trim();

    if (!takkenaiUrl) {
      return NextResponse.json(
        { error: "takkenai URL が見つかりません" },
        { status: 400 }
      );
    }

    merged.takkenaiLink = takkenaiUrl;
    if (!toStringValue(merged.title)) {
      merged.title = deriveTitleFromBody(merged.body);
    }
    if (!toStringValue(merged.seoTitle)) {
      merged.seoTitle = merged.title;
    }

    const result = await optimizeSeoGeoForContent(platform, merged, takkenaiUrl, {
      articleType: resolveArticleType(
        body.articleType || merged.meta?.articleType,
        "practical-guide"
      ),
      targetSeoScore: body.targetSeoScore,
      targetGeoScore: body.targetGeoScore,
      targetAiScore: body.targetAiScore,
      targetChatgptSearchScore: body.targetChatgptSearchScore,
      aiGateMode: body.aiGateMode,
      evidenceMode: body.evidenceMode,
      maxRounds: body.maxRounds,
    });
    result.content.meta = {
      ...(result.content.meta || {}),
      siteId: runContext.siteId,
      language: runContext.language,
      skillVersion: runContext.manifest.skillVersion,
      profileVersion: runContext.manifest.profileVersion,
      mode: runContext.mode,
      contentKey: resolvedContentKey,
      articleType:
        result.content.meta?.articleType ||
        resolveArticleType(body.articleType || merged.meta?.articleType, "practical-guide"),
    };

    ensureDirExists(generatedDir);
    fs.writeFileSync(
      outputPath,
      JSON.stringify(result.content, null, 2),
      "utf-8"
    );

    if (
      parsedDate &&
      runContext.mode === "promote" &&
      resolvedContentKey === "standard"
    ) {
      try {
        updatePlatformEntry(parsedDate.year, parsedDate.month, parsedDate.day, platform, {
          status: "generated",
          generatedTitle: result.content.title,
          generatedBody: result.content.body,
          generatedHashtags: result.content.hashtags,
          imagePrompt: result.content.imagePrompt,
          generatedAt: new Date().toISOString(),
          articleType: result.content.meta?.articleType,
        });
      } catch {
        // Non-critical: ignore calendar update failures
      }
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error("SEO/GEO optimization failed:", err);
    const message =
      err instanceof Error ? err.message : "不明なエラーが発生しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
