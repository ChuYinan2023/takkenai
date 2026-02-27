import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { generateDayTopics } from "@/lib/topic-engine";
import { generateContent, type GeneratedContent } from "@/lib/claude";
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
import type { MotherTopic, Platform } from "@/lib/topic-engine";
import {
  buildFullUrl,
  getKnowledgePointById,
  getPastQuestionById,
  getTools,
  getToolById,
  type ContentAsset,
} from "@/lib/takkenai-data";
import { normalizeAssetLabel } from "@/lib/topic-label";
import {
  getRecommendedArticleType,
  resolveArticleType,
  type ArticleType,
  type AssetType,
} from "@/lib/article-type";
import {
  normalizeNoteViralBrief,
  type NoteViralBrief,
} from "@/lib/note-viral";
import {
  getNoteViralOptionsDateCacheFile,
  NOTE_VIRAL_OPTIONS_LATEST_CACHE_FILE,
  type NoteViralOption,
} from "@/lib/note-viral-options";
import {
  getGeneratedContentFilename,
  resolveContentKey,
} from "@/lib/content-variant";
import {
  getNoteInternalLinkPoolStatus,
  pickRelatedNoteLink,
} from "@/lib/note-internal-link-pool";
import { resolveTopicLabelOverrideByPriority } from "./topic-label-priority";

type RequestBody = {
  date: string;
  platform: Platform;
  siteId?: string;
  language?: string;
  mode?: SkillRunMode;
  contentKey?: "standard" | "note-viral";
  noteViralOptionId?: string;
  takkenaiUrl?: string;
  enableResearch?: boolean;
  reviewRounds?: number;
  articleType?: ArticleType;
  noteViralBrief?: Partial<NoteViralBrief>;
};

type MotherTopicSerialized = {
  assetType: string;
  assetId: string;
  phase: string;
  phaseLabel: string;
  takkenaiUrl: string;
  topicLabelOverride?: string;
  urlSelectionMode?: "asset" | "url-direct";
  urlTier?: "high" | "explore" | "cooldown";
  secondaryAssetType?: string;
  secondaryAssetId?: string;
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

function resolveAsset(type: string, id?: string): ContentAsset | undefined {
  if (!id) return undefined;
  if (type === "knowledge-point") {
    const found = getKnowledgePointById(id);
    if (found) return { type: "knowledge-point", data: found };
    return undefined;
  }
  if (type === "tool") {
    const found = getToolById(id);
    if (found) return { type: "tool", data: found };
    return undefined;
  }
  if (type === "past-question") {
    const found = getPastQuestionById(id);
    if (found) return { type: "past-question", data: found };
    return undefined;
  }
  return undefined;
}

function resolveMotherTopicFromCalendar(
  serialized: MotherTopicSerialized
): MotherTopic | null {
  const asset = resolveAsset(serialized.assetType, serialized.assetId);
  if (!asset) return null;

  const secondaryAsset = serialized.secondaryAssetType
    ? resolveAsset(serialized.secondaryAssetType, serialized.secondaryAssetId)
    : undefined;

  return {
    asset,
    phase: serialized.phase as MotherTopic["phase"],
    phaseLabel: serialized.phaseLabel,
    date: "",
    takkenaiUrl: serialized.takkenaiUrl,
    topicLabelOverride: String(serialized.topicLabelOverride || "").trim() || undefined,
    urlSelectionMode: serialized.urlSelectionMode,
    urlTier: serialized.urlTier,
    ...(secondaryAsset ? { secondaryAsset } : {}),
  };
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

function inferAssetTypeFromUrl(
  url: string,
  fallback: MotherTopic["asset"]["type"]
): "knowledge-point" | "tool" | "past-question" {
  const normalized = url.toLowerCase();
  if (normalized.includes("/tools/")) return "tool";
  if (normalized.includes("/takken/")) return "knowledge-point";
  return fallback;
}

type ViralUrlRule = {
  path: string;
  pattern: RegExp;
};

const NOTE_VIRAL_URL_RULES: ViralUrlRule[] = [
  { path: "/tools/video-generator/", pattern: /(動画|video|youtube|tiktok|ショート|リール|台本|script)/i },
  { path: "/tools/sns-generator/", pattern: /(sns|インスタ|instagram|x\b|twitter|line|投稿|集客)/i },
  { path: "/tools/chirashi-generator/", pattern: /(チラシ|flyer|leaflet|広告文)/i },
  { path: "/tools/catchcopy-generator/", pattern: /(キャッチコピー|見出し|タイトル案|headline)/i },
  { path: "/tools/email-template/", pattern: /(メール|email|dm|返信文|案内文)/i },
  { path: "/tools/openhouse-generator/", pattern: /(オープンハウス|内見|見学会)/i },
  { path: "/tools/property-lp-generator/", pattern: /(lp\b|ランディング|cv|訴求|ページ構成)/i },
  { path: "/tools/satei/", pattern: /(査定|相場|価格査定|売却価格)/i },
  { path: "/tools/chinryo-souba/", pattern: /(賃料|家賃|rent|空室率)/i },
  { path: "/tools/loan/", pattern: /(ローン|融資|返済|金利|住宅ローン|借入)/i },
  { path: "/tools/hourei-search/", pattern: /(法令|規制|コンプラ|ガイドライン|条例)/i },
  { path: "/tools/shorui-checker/", pattern: /(書類|チェックリスト|記載漏れ|添付)/i },
  { path: "/tools/faq-database/", pattern: /(faq|質問対応|q&a|問い合わせ)/i },
  { path: "/tools/inheritance-tax/", pattern: /(相続税|相続対策)/i },
  { path: "/tools/gift-tax-simulator/", pattern: /(贈与税|贈与)/i },
];

function sanitizeViralTopicLabel(raw: string | undefined): string {
  return String(raw || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function resolveViralDrivenTakkenaiUrl(
  option: NoteViralOption | null,
  fallbackUrl: string
): string {
  if (!option) return fallbackUrl;
  const signal = `${option.title} ${option.hotReason} ${option.viralPattern} ${option.fitReason}`.trim();
  if (!signal) return fallbackUrl;

  for (const rule of NOTE_VIRAL_URL_RULES) {
    if (rule.pattern.test(signal)) {
      return buildFullUrl(rule.path);
    }
  }

  const tokens = (signal.toLowerCase().match(/[a-z0-9-]{3,}/g) || []).filter(
    (token, index, list) => list.indexOf(token) === index
  );
  if (tokens.length === 0) return fallbackUrl;

  const tools = getTools();
  let bestMatchUrl = fallbackUrl;
  let bestScore = 0;
  for (const tool of tools) {
    const haystack = `${tool.slug} ${tool.name}`.toLowerCase();
    const score = tokens.reduce((sum, token) => {
      if (!haystack.includes(token)) return sum;
      return sum + Math.min(3, token.length);
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      bestMatchUrl = buildFullUrl(tool.takkenaiUrl);
    }
  }
  return bestScore >= 6 ? bestMatchUrl : fallbackUrl;
}

function loadNoteViralOptionFromCache(
  generatedDir: string,
  date: string,
  optionId: string
): NoteViralOption | null {
  const normalizedId = (optionId || "").trim();
  if (!normalizedId) return null;

  const candidateFiles = [
    getNoteViralOptionsDateCacheFile(date),
    NOTE_VIRAL_OPTIONS_LATEST_CACHE_FILE,
  ];

  for (const fileName of candidateFiles) {
    const filePath = path.join(generatedDir, fileName);
    if (!fs.existsSync(filePath)) continue;
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as { options?: NoteViralOption[] };
      const matched = Array.isArray(parsed.options)
        ? parsed.options.find((item) => item?.id === normalizedId)
        : undefined;
      if (matched) return matched;
    } catch {
      // ignore broken cache file
    }
  }
  return null;
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

    // Check that OPENROUTER_API_KEY is configured
    if (!process.env.OPENROUTER_API_KEY) {
      return NextResponse.json(
        {
          error:
            "OPENROUTER_API_KEY が設定されていません。.env.local で設定してください。",
        },
        { status: 401 }
      );
    }

    // Base fallback (deterministic from date)
    const dayTopics = generateDayTopics(date);
    let motherTopic = dayTopics.motherTopics[platform];
    const resolvedContentKey = resolveContentKey(platform, body.contentKey);

    // Prefer calendar's current topic so displayed pending themes and generation always match.
    const parsed = parseDateString(date);
    if (parsed) {
      const calendarDay = getCalendarDay(parsed.year, parsed.month, parsed.day);
      const serialized = calendarDay?.motherTopics?.[platform] as
        | MotherTopicSerialized
        | undefined;
      if (serialized) {
        const fromCalendar = resolveMotherTopicFromCalendar(serialized);
        if (fromCalendar) {
          motherTopic = {
            ...fromCalendar,
            date,
          };
        }
      }
    }

    const requestedRawUrl = (body.takkenaiUrl || "").trim();
    const requestedOverrideUrl = normalizeOverrideTakkenaiUrl(requestedRawUrl);
    if (requestedRawUrl && !requestedOverrideUrl) {
      return NextResponse.json(
        { error: "takkenaiUrl は takkenai.jp の有効なURLのみ指定できます" },
        { status: 400 }
      );
    }
    let takkenaiUrl = requestedOverrideUrl || motherTopic.takkenaiUrl;
    const enableResearch =
      typeof body.enableResearch === "boolean" ? body.enableResearch : true;
    const reviewRounds =
      typeof body.reviewRounds === "number" && Number.isFinite(body.reviewRounds)
        ? Math.max(0, Math.min(3, Math.floor(body.reviewRounds)))
        : platform === "note"
          ? 1
          : 0;
    const userOverrideTopicLabel = requestedOverrideUrl
      ? normalizeAssetLabel(
          requestedOverrideUrl,
          inferAssetTypeFromUrl(requestedOverrideUrl, motherTopic.asset.type),
          requestedOverrideUrl
        )
      : undefined;
    const resolvedArticleType = resolveArticleType(
      body.articleType,
      getRecommendedArticleType(
        platform,
        motherTopic.asset.type as AssetType
      )
    );
    const articleTypeForGeneration =
      platform === "note" && resolvedContentKey === "note-viral"
        ? undefined
        : resolvedArticleType;
    const generatedDir = resolveGeneratedOutputDir({
      mode: runContext.mode,
      siteId: runContext.siteId,
    });
    let noteViralOption: NoteViralOption | null = null;
    if (platform === "note" && resolvedContentKey === "note-viral") {
      const optionId = String(body.noteViralOptionId || "").trim();
      if (!optionId) {
        return NextResponse.json(
          { error: "note-viral 生成には noteViralOptionId が必要です" },
          { status: 400 }
        );
      }
      noteViralOption = loadNoteViralOptionFromCache(generatedDir, date, optionId);
      if (!noteViralOption) {
        return NextResponse.json(
          {
            error:
              "選択した爆款候选が見つかりません。爆款ページで候选を更新してから再実行してください。",
          },
          { status: 400 }
        );
      }
    }
    const noteViralBrief =
      platform === "note"
        ? normalizeNoteViralBrief(
            resolvedContentKey === "note-viral"
              ? {
                  enabled: true,
                  sourceUrl: noteViralOption?.sourceUrl,
                  sourceAccount: noteViralOption?.sourceAccount,
                  viralPattern: noteViralOption?.viralPattern,
                  sourceTitle: noteViralOption?.title,
                  hotReason: noteViralOption?.hotReason,
                  fitReason: noteViralOption?.fitReason,
                }
              : body.noteViralBrief
          )
        : undefined;
    if (platform === "note" && resolvedContentKey === "note-viral" && !noteViralBrief) {
      return NextResponse.json(
        { error: "選択した爆款候选の情報が不正です（URL/账号/要素が不足）" },
        { status: 400 }
      );
    }
    if (
      platform === "note" &&
      resolvedContentKey === "note-viral" &&
      !requestedOverrideUrl
    ) {
      takkenaiUrl = resolveViralDrivenTakkenaiUrl(noteViralOption, takkenaiUrl);
    }
    const noteViralTopicLabel =
      platform === "note" && resolvedContentKey === "note-viral" && !requestedOverrideUrl
        ? sanitizeViralTopicLabel(noteViralOption?.title) ||
          sanitizeViralTopicLabel(noteViralOption?.hotReason)
        : undefined;
    const topicLabelOverride = resolveTopicLabelOverrideByPriority({
      userOverrideLabel: userOverrideTopicLabel,
      noteViralLabel: noteViralTopicLabel,
      motherTopicLabel: motherTopic.topicLabelOverride,
    });
    const noteInternalStatus =
      platform === "note" && resolvedContentKey === "standard"
        ? getNoteInternalLinkPoolStatus()
        : null;
    const relatedNoteLink =
      platform === "note" &&
      resolvedContentKey === "standard" &&
      noteInternalStatus?.enabled
        ? pickRelatedNoteLink({
            date,
            currentContentKey: resolvedContentKey,
            currentTitle: topicLabelOverride || "",
            currentTakkenaiUrl: takkenaiUrl,
            generatedDir,
            cooldownDays: 7,
          })
        : null;

    const baseGenerateOptions = {
      // Default to latest-web-enriched writing; caller can explicitly disable.
      enableResearch,
      reviewRounds,
      allowAutoSanitize: true,
      topicLabelOverride,
      articleType: articleTypeForGeneration,
      noteViralMode: platform === "note" && resolvedContentKey === "note-viral",
      ...(platform === "note" && resolvedContentKey === "standard"
        ? {
            relatedNoteUrl: relatedNoteLink?.url,
            relatedNoteTitle: relatedNoteLink?.title,
            relatedNoteAllowedAccounts: noteInternalStatus?.allowedAccounts || [],
          }
        : {}),
      ...(noteViralBrief ? { noteViralBrief } : {}),
    };

    const shouldRetryGenerate = (message: string): boolean =>
      /OpenRouter timeout|timed out|fetch failed|network|最終品質チェック失敗/i.test(
        message
      );

    let generatedContent: GeneratedContent | null = null;
    const maxGenerateAttempts = 2;
    for (let attempt = 1; attempt <= maxGenerateAttempts; attempt++) {
      try {
        generatedContent = await generateContent(
          platform,
          {
            ...motherTopic,
            takkenaiUrl,
          },
          takkenaiUrl,
          {
            ...baseGenerateOptions,
            ...(attempt > 1
              ? platform === "note"
                ? {
                    enableResearch: false,
                    reviewRounds: Math.max(reviewRounds, 2),
                  }
                : {
                    reviewRounds: Math.max(reviewRounds, 1),
                  }
              : {}),
          }
        );
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const hasNext = attempt < maxGenerateAttempts;
        if (!hasNext || !shouldRetryGenerate(message)) {
          throw error;
        }
        console.warn(
          `[${platform}] generate auto-retry (${attempt}/${maxGenerateAttempts}) due to: ${message}`
        );
      }
    }
    if (!generatedContent) {
      throw new Error("コンテンツ生成に失敗しました（再試行後も失敗）");
    }
    generatedContent.meta = {
      ...(generatedContent.meta || {}),
      siteId: runContext.siteId,
      language: runContext.language,
      skillVersion: runContext.manifest.skillVersion,
      profileVersion: runContext.manifest.profileVersion,
      mode: runContext.mode,
      contentKey: resolvedContentKey,
      ...(articleTypeForGeneration
        ? {
            articleType:
              generatedContent.meta?.articleType || articleTypeForGeneration,
          }
        : {}),
      ...(platform === "note"
        ? {
            noteEntryMode:
              resolvedContentKey === "note-viral" || noteViralBrief
                ? "viral"
                : "standard",
            noteViralOptionId:
              resolvedContentKey === "note-viral"
                ? String(body.noteViralOptionId || "").trim()
                : undefined,
            noteViralSourceType:
              resolvedContentKey === "note-viral"
                ? noteViralOption?.sourceType
                : undefined,
            noteViralSourceUrl: noteViralBrief?.sourceUrl,
            noteViralSourceAccount: noteViralBrief?.sourceAccount,
            relatedNoteUrl:
              resolvedContentKey === "standard"
                ? relatedNoteLink?.url ||
                  generatedContent.meta?.relatedNoteUrl
                : undefined,
            relatedNoteAccount:
              resolvedContentKey === "standard"
                ? relatedNoteLink?.account ||
                  generatedContent.meta?.relatedNoteAccount
                : undefined,
            relatedNoteInserted:
              resolvedContentKey === "standard"
                ? generatedContent.meta?.relatedNoteInserted
                : undefined,
          }
        : {}),
    };

    // Save to file
    ensureDirExists(generatedDir);

    const outputPath = path.join(
      generatedDir,
      getGeneratedContentFilename(date, platform, resolvedContentKey)
    );
    fs.writeFileSync(
      outputPath,
      JSON.stringify(generatedContent, null, 2),
      "utf-8"
    );

    // Update calendar status
    if (parsed && runContext.mode === "promote" && resolvedContentKey === "standard") {
      try {
        updatePlatformEntry(
          parsed.year,
          parsed.month,
          parsed.day,
          platform,
          {
            status: "generated",
            generatedTitle: generatedContent.title,
            generatedBody: generatedContent.body,
            generatedHashtags: generatedContent.hashtags,
            imagePrompt: generatedContent.imagePrompt,
            generatedAt: new Date().toISOString(),
            articleType:
              generatedContent.meta?.articleType || resolvedArticleType,
          }
        );
      } catch {
        // Non-critical: ignore calendar update failures
      }
    }

    return NextResponse.json(generatedContent);
  } catch (err: unknown) {
    console.error("Content generation failed:", err);
    const message =
      err instanceof Error ? err.message : "不明なエラーが発生しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
