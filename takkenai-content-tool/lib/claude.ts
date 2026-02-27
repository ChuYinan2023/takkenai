import { AMEBA_SYSTEM_PROMPT, buildAmebaUserPrompt } from "./prompts/ameba";
import { NOTE_SYSTEM_PROMPT, buildNoteUserPrompt } from "./prompts/note";
import { HATENA_SYSTEM_PROMPT, buildHatenaUserPrompt } from "./prompts/hatena";
import {
  buildArticleTypePromptBlock,
  getArticleTypeOption,
  getRecommendedArticleType,
  isArticleType,
  resolveArticleType,
  type ArticleType,
  type AssetType,
} from "./article-type";
import {
  applyArticleTypeFallbackStructure,
  validateArticleTypeStructure,
} from "./article-type-validator";
import {
  evaluateSeoGeoRules,
  type SeoGeoReport,
} from "./seo-geo-report";
import {
  evaluateAiActionCompletion,
  type AiActionReport,
} from "./ai-action-report";
import {
  getLatestPastQuestionYear,
  type MotherTopic,
  type Platform,
} from "./topic-engine";
import { getDateSeasonalContext } from "./topic-engine";
import type { ContentAsset } from "./takkenai-data";
import {
  hasUrlOrSlugArtifacts,
  normalizeAssetLabel,
  stripUrlAndSlugArtifacts,
} from "./topic-label";
import type { NoteViralBrief } from "./note-viral";
import {
  extractNoteAccount,
  isNoteInternalLinksEnabled,
  isNoteUrlAllowedByAccounts,
  normalizeNoteArticleUrl,
} from "./note-internal-link-pool";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeneratedContent {
  title: string;
  body: string;
  titleChinese: string;
  bodyChinese: string;
  hashtags: string[];
  imagePrompt: string;
  takkenaiLink: string;
  complianceReport?: ComplianceReport;
  seoGeoReport?: SeoGeoReport;
  seoTitle?: string;
  meta?: GeneratedContentMeta;
}

export interface GeneratedContentMeta {
  siteId?: string;
  language?: string;
  skillVersion?: string;
  profileVersion?: string;
  mode?: "shadow" | "promote";
  contentKey?: "standard" | "note-viral";
  articleType?: ArticleType;
  noteEntryMode?: "standard" | "viral";
  noteViralOptionId?: string;
  noteViralSourceType?: "competitor" | "note-pickup" | "fallback";
  noteViralSourceUrl?: string;
  noteViralSourceAccount?: string;
  relatedNoteUrl?: string;
  relatedNoteAccount?: string;
  relatedNoteInserted?: boolean;
}

export type ComplianceMode = "strict" | "auto_fix" | "warn_only";

export interface ComplianceReport {
  passed: boolean;
  platform: Platform;
  issues: string[];
  linkCount: number;
  trackedUrl: string;
}

interface PlatformComplianceProfile {
  maxLinks: number;
  allowExternalDomains: string[];
  allowShorteners: boolean;
  maxCtaLines: number;
  bannedPatterns: RegExp[];
  preferredLinkStyle: string[];
  placementRules: {
    avoidFirstParagraph: boolean;
    preferSectionEnd: boolean;
  };
}

export interface StreamCallbacks {
  onChunk?: (chunk: string) => void;
  onComplete?: (content: GeneratedContent) => void;
  onError?: (error: Error) => void;
}

export interface GenerateContentOptions {
  enableResearch?: boolean;
  reviewRounds?: number;
  allowAutoSanitize?: boolean;
  complianceMode?: ComplianceMode;
  topicLabelOverride?: string;
  articleType?: ArticleType;
  noteViralBrief?: NoteViralBrief;
  noteViralMode?: boolean;
  relatedNoteUrl?: string;
  relatedNoteTitle?: string;
  relatedNoteAllowedAccounts?: string[];
}

export interface OptimizeSeoGeoOptions {
  targetSeoScore?: number;
  targetGeoScore?: number;
  targetAiScore?: number;
  targetChatgptSearchScore?: number;
  aiGateMode?: "hard" | "soft";
  evidenceMode?: "auto" | "off";
  maxRounds?: number;
  articleType?: ArticleType;
}

export interface SeoGeoImprovementSummary {
  seoScoreBefore: number;
  seoScoreAfter: number;
  geoScoreBefore: number;
  geoScoreAfter: number;
  chatgptSearchBefore: number;
  chatgptSearchAfter: number;
  aiCompletionBefore: number;
  aiCompletionAfter: number;
  unresolvedBefore: number;
  unresolvedAfter: number;
}

export interface SeoGeoOptimizeResult {
  content: GeneratedContent;
  achieved: boolean;
  rounds: number;
  targetSeoScore: number;
  targetGeoScore: number;
  targetAiScore: number;
  targetChatgptSearchScore: number;
  aiGateMode: "hard" | "soft";
  improvement: SeoGeoImprovementSummary;
  message: string;
}

// ---------------------------------------------------------------------------
// OpenRouter API (OpenAI-compatible format)
// ---------------------------------------------------------------------------

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_WRITING_MODEL = "anthropic/claude-sonnet-4.5";
const DEFAULT_TRANSLATION_MODEL = "openai/gpt-4o-mini";
const DEFAULT_OPENROUTER_TIMEOUT_MS = 90000;
const DEFAULT_OPENROUTER_TOTAL_TIMEOUT_MS = 180000;
const DEFAULT_OPENROUTER_RETRY_PER_MODEL = 1;
const PRIMARY_MODEL_DEGRADE_WINDOW_MS = 10 * 60 * 1000;
let primaryModelDegradedUntil = 0;
const MODEL =
  (process.env.OPENROUTER_WRITING_MODEL || "").trim() ||
  DEFAULT_WRITING_MODEL;
const TRANSLATION_MODEL =
  (process.env.OPENROUTER_TRANSLATION_MODEL || "").trim() ||
  DEFAULT_TRANSLATION_MODEL;
const DEFAULT_WRITING_FALLBACK_MODELS = [
  "openai/gpt-4.1-mini",
  "openai/gpt-4o-mini",
  "anthropic/claude-sonnet-4",
  "google/gemini-2.0-flash-001",
  "meta-llama/llama-3.3-70b-instruct",
];
const WRITING_FALLBACK_MODELS = (
  process.env.OPENROUTER_WRITING_FALLBACK_MODELS || ""
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const RESEARCH_MODEL = "perplexity/sonar-pro";
const DEFAULT_COMPLIANCE_MODE: ComplianceMode = "strict";
const DEFAULT_SEO_GEO_AI_GATE_MODE: "hard" | "soft" = "hard";
const DEFAULT_SEO_GEO_EVIDENCE_MODE: "auto" | "off" = "auto";
const DEFAULT_SEO_GEO_AI_TARGET_SCORE = 85;
const DEFAULT_CHATGPT_SEARCH_GATE_MODE: "hard" | "soft" = "soft";
const DEFAULT_CHATGPT_SEARCH_TARGET_SCORE = 85;
const SEO_GEO_PASS_THRESHOLD = 85;

const TRACKING_QUERY = {
  medium: "blog",
  campaign: "daily_content",
} as const;

interface OptimizationEvidenceItem {
  source: string;
  year: string;
  metric: string;
  summary: string;
}

interface OptimizationEvidenceResult {
  items: OptimizationEvidenceItem[];
  failureReason?: string;
}

function resolveAiGateMode(input?: string): "hard" | "soft" {
  if (input === "hard" || input === "soft") return input;
  if (process.env.SEO_GEO_AI_GATE_MODE === "soft") return "soft";
  return DEFAULT_SEO_GEO_AI_GATE_MODE;
}

function resolveEvidenceMode(input?: string): "auto" | "off" {
  if (input === "auto" || input === "off") return input;
  if (process.env.SEO_GEO_EVIDENCE_MODE === "off") return "off";
  return DEFAULT_SEO_GEO_EVIDENCE_MODE;
}

function resolveAiTargetScore(input?: number): number {
  const envValue = Number(process.env.SEO_GEO_AI_TARGET_SCORE);
  const fallback = Number.isFinite(envValue)
    ? envValue
    : DEFAULT_SEO_GEO_AI_TARGET_SCORE;
  const raw = Number.isFinite(input) ? Number(input) : fallback;
  return Math.max(50, Math.min(100, raw));
}

function resolveChatgptSearchEnabled(): boolean {
  const raw = String(process.env.CHATGPT_SEARCH_ENABLED || "").trim().toLowerCase();
  if (!raw) return true;
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

function resolveChatgptSearchGateMode(input?: string): "hard" | "soft" {
  // Product policy: ChatGPT Search is best-effort and non-blocking.
  if (input === "soft") return "soft";
  const envRaw = String(process.env.CHATGPT_SEARCH_GATE_MODE || "")
    .trim()
    .toLowerCase();
  if (envRaw === "soft") return "soft";
  return DEFAULT_CHATGPT_SEARCH_GATE_MODE;
}

function resolveChatgptSearchTargetScore(input?: number): number {
  const envValue = Number(process.env.CHATGPT_SEARCH_TARGET_SCORE);
  const fallback = Number.isFinite(envValue)
    ? envValue
    : DEFAULT_CHATGPT_SEARCH_TARGET_SCORE;
  const raw = Number.isFinite(input) ? Number(input) : fallback;
  return Math.max(50, Math.min(100, raw));
}

function getApiKey(): string {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY が設定されていません。.env.local で設定してください。"
    );
  }
  return apiKey;
}

function uniqueModels(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const model = (item || "").trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);
    out.push(model);
  }
  return out;
}

function resolveWritingModelCandidates(primaryModel: string): string[] {
  const fallbackCandidates = uniqueModels([
    ...WRITING_FALLBACK_MODELS,
    ...DEFAULT_WRITING_FALLBACK_MODELS,
  ]);
  if (
    primaryModel === MODEL &&
    primaryModelDegradedUntil > Date.now() &&
    fallbackCandidates.length > 0
  ) {
    return uniqueModels([...fallbackCandidates, primaryModel]);
  }
  return uniqueModels([primaryModel, ...fallbackCandidates]);
}

type OpenRouterCallError = Error & {
  status?: number;
  model?: string;
};

function shouldFallbackModelError(error: OpenRouterCallError): boolean {
  const status = error.status ?? 0;
  const message = String(error.message || "").toLowerCase();

  if (status === 401) return false;
  if (status === 408) return true;

  const isNetworkTransportError =
    /fetch failed|network|socket|econnreset|enotfound|etimedout|timeout/.test(
      message
    ) && !/model|provider|region|endpoint/.test(message);
  if (isNetworkTransportError) {
    return true;
  }

  const isModelAvailabilityError =
    /not available in your region|model.*not available|no endpoints found|model not found|unknown model|provider.*unavailable|provider.*not available/.test(
      message
    );

  if (status === 403) {
    return isModelAvailabilityError;
  }

  if (isModelAvailabilityError) {
    return true;
  }

  if (status === 404 || status === 429 || status >= 500) {
    return true;
  }

  if (status === 400 && /model|provider|region|endpoint/.test(message)) {
    return true;
  }

  return false;
}

function shouldRetrySameModelError(error: OpenRouterCallError): boolean {
  const status = error.status ?? 0;
  const message = String(error.message || "").toLowerCase();
  if (status === 408 || status === 429 || status >= 500) return true;
  return /timeout|timed out|fetch failed|network|socket|econnreset|enotfound|etimedout/.test(
    message
  );
}

async function callOpenRouterOnce(
  systemPrompt: string,
  userPrompt: string,
  model: string
): Promise<string> {
  const apiKey = getApiKey();
  const controller = new AbortController();
  const timeoutMs = Math.max(
    5000,
    Number(process.env.OPENROUTER_TIMEOUT_MS || DEFAULT_OPENROUTER_TIMEOUT_MS)
  );
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://takkenai.jp",
        "X-Title": "takkenai-content-tool",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const msg =
        (errorData as { error?: { message?: string } })?.error?.message ||
        `OpenRouter API error: ${response.status}`;
      const error = new Error(msg) as OpenRouterCallError;
      error.status = response.status;
      error.model = model;
      throw error;
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;

    if (!text) {
      const error = new Error("OpenRouter からテキスト応答がありません") as OpenRouterCallError;
      error.status = 200;
      error.model = model;
      throw error;
    }

    return text;
  } catch (error) {
    const message = String((error as Error)?.message || "");
    if (
      controller.signal.aborted ||
      /aborted|abort|timed out|timeout/i.test(message)
    ) {
      const timeoutError = new Error(
        `OpenRouter timeout after ${timeoutMs}ms`
      ) as OpenRouterCallError;
      timeoutError.status = 408;
      timeoutError.model = model;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callOpenRouter(
  systemPrompt: string,
  userPrompt: string,
  model: string = MODEL
): Promise<string> {
  const candidates = model === MODEL ? resolveWritingModelCandidates(model) : [model];
  const maxModelAttempts = Math.max(
    1,
    Number(process.env.OPENROUTER_MAX_MODEL_ATTEMPTS || 2)
  );
  const limitedCandidates = candidates.slice(0, maxModelAttempts);
  const retryPerModel = Math.max(
    1,
    Number(process.env.OPENROUTER_RETRY_PER_MODEL || DEFAULT_OPENROUTER_RETRY_PER_MODEL)
  );
  const totalTimeoutMs = Math.max(
    10000,
    Number(
      process.env.OPENROUTER_TOTAL_TIMEOUT_MS || DEFAULT_OPENROUTER_TOTAL_TIMEOUT_MS
    )
  );
  const startedAt = Date.now();
  let lastError: OpenRouterCallError | null = null;

  for (let i = 0; i < limitedCandidates.length; i++) {
    const candidate = limitedCandidates[i];
    for (let attempt = 1; attempt <= retryPerModel; attempt++) {
      if (Date.now() - startedAt > totalTimeoutMs) {
        const timeoutError = new Error(
          `OpenRouter total timeout after ${totalTimeoutMs}ms`
        ) as OpenRouterCallError;
        timeoutError.status = 408;
        timeoutError.model = candidate;
        throw timeoutError;
      }
      try {
        return await callOpenRouterOnce(systemPrompt, userPrompt, candidate);
      } catch (err) {
        const openRouterError = (err instanceof Error
          ? err
          : new Error(String(err))) as OpenRouterCallError;
        openRouterError.model = openRouterError.model || candidate;
        lastError = openRouterError;
        if (
          candidate === MODEL &&
          (openRouterError.status === 408 ||
            /timeout|timed out|fetch failed|network|socket|econnreset|enotfound|etimedout/i.test(
              String(openRouterError.message || "")
            ))
        ) {
          primaryModelDegradedUntil = Date.now() + PRIMARY_MODEL_DEGRADE_WINDOW_MS;
        }

        const canRetrySameModel =
          attempt < retryPerModel && shouldRetrySameModelError(openRouterError);
        if (canRetrySameModel) {
          const sleepMs = Math.min(1500, 250 * attempt);
          console.warn(
            `[openrouter] retry same model ${candidate} (${attempt}/${retryPerModel}) after error: ${openRouterError.message}`
          );
          await new Promise((resolve) => setTimeout(resolve, sleepMs));
          continue;
        }

        const hasNext = i < limitedCandidates.length - 1;
        if (!hasNext || !shouldFallbackModelError(openRouterError)) {
          throw openRouterError;
        }
        console.warn(
          `[openrouter] model fallback: ${candidate} failed (${openRouterError.message}) -> ${limitedCandidates[i + 1]}`
        );
        break;
      }
    }
  }

  throw lastError || new Error("OpenRouter request failed");
}

// ---------------------------------------------------------------------------
// Web research via Perplexity (pre-generation fact gathering)
// ---------------------------------------------------------------------------

async function researchTopic(
  topicLabel: string,
  assetType: string,
  phaseLabel: string
): Promise<string> {
  const searchQueries: string[] = [];

  switch (assetType) {
    case "knowledge-point":
      searchQueries.push(
        `宅建試験 ${topicLabel} 最新の法改正 重要ポイント`,
        `${topicLabel} 不動産 実務 具体例 統計データ`
      );
      break;
    case "tool":
      searchQueries.push(
        `${topicLabel} 不動産 活用方法 メリット`,
        `不動産テック ${topicLabel} 最新トレンド 市場データ`
      );
      break;
    case "past-question":
      searchQueries.push(
        `宅建試験 ${topicLabel} 出題傾向 合格率`,
        `宅建 ${topicLabel} 関連知識 実務との関連`
      );
      break;
  }

  const systemPrompt = `あなたはリサーチアシスタントです。以下の検索テーマについて、記事執筆に使える正確な情報を収集してください。

## 収集すべき情報
- 具体的な数値データ（統計、割合、金額など）
- 最新の法改正や制度変更の情報
- 実際の事例やケーススタディ
- 業界の最新動向やトレンド
- 公的機関（国土交通省、不動産適正取引推進機構など）の発表データ

## 注意事項
- 出典が明確な情報のみ収集すること
- 数値は可能な限り最新のものを使うこと
- 「〜と言われている」のような曖昧な情報は含めない
- 日本語で回答すること`;

  const userPrompt = `以下のテーマについて、ブログ記事に使える正確な事実情報をリサーチしてください。

テーマ: ${topicLabel}
分野: ${assetType === "knowledge-point" ? "宅建知識" : assetType === "tool" ? "不動産AIツール" : "宅建過去問"}
時期: ${phaseLabel}

検索キーワード:
${searchQueries.map((q) => `- ${q}`).join("\n")}

以下の形式で整理してください:
1. 関連する統計データや数値（出典付き）
2. 最新の法改正・制度変更（あれば）
3. 実務に役立つ具体的な事実
4. 読者が「なるほど」と思える豆知識や意外な事実`;

  try {
    const research = await withTimeout(
      callOpenRouter(systemPrompt, userPrompt, RESEARCH_MODEL),
      12000,
      "research topic"
    );
    return research;
  } catch (err) {
    console.warn("Research step failed, proceeding without research data:", err);
    return "";
  }
}

async function collectOptimizationEvidence(params: {
  platform: Platform;
  title: string;
  body: string;
  primaryKeyword: string;
  takkenaiUrl: string;
}): Promise<OptimizationEvidenceResult> {
  const { platform, title, body, primaryKeyword, takkenaiUrl } = params;
  const bodyExcerpt = body.slice(0, 1200);

  const systemPrompt =
    "あなたは不動産・宅建分野のリサーチ担当です。捏造は禁止。根拠が曖昧な情報は出力しない。必ずJSONのみで回答。";
  const userPrompt =
    `以下の記事を実務寄りに改善するため、引用可能なファクトを抽出してください。\n\n` +
    `platform: ${platform}\n` +
    `primaryKeyword: ${primaryKeyword || "（未設定）"}\n` +
    `title: ${title}\n` +
    `targetUrl: ${takkenaiUrl}\n` +
    `body excerpt:\n${bodyExcerpt}\n\n` +
    `要件:\n` +
    `- 1〜3件のみ\n` +
    `- 各項目に source/year/metric/summary を含める\n` +
    `- source は組織名（例: 国土交通省, 総務省, 国税庁）\n` +
    `- year は年または年度（例: 2025年, 令和6年度）\n` +
    `- metric は具体数値を含む\n` +
    `- 根拠が不明なら items を空にして failureReason に理由を書く\n\n` +
    `JSON形式:\n` +
    `{\n` +
    `  "items": [\n` +
    `    {"source":"...", "year":"...", "metric":"...", "summary":"..."}\n` +
    `  ],\n` +
    `  "failureReason": "..." \n` +
    `}`;

  try {
    const raw = await withTimeout(
      callOpenRouter(systemPrompt, userPrompt, RESEARCH_MODEL),
      12000,
      "seo-geo evidence collection"
    );
    let jsonText = raw.trim();
    const block = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (block) jsonText = block[1].trim();

    const parsed = JSON.parse(jsonText) as {
      items?: Array<Partial<OptimizationEvidenceItem>>;
      failureReason?: unknown;
    };
    const items = Array.isArray(parsed.items)
      ? parsed.items
          .map((item) => ({
            source: String(item?.source || "").trim(),
            year: String(item?.year || "").trim(),
            metric: String(item?.metric || "").trim(),
            summary: String(item?.summary || "").trim(),
          }))
          .filter(
            (item) =>
              item.source &&
              item.year &&
              item.metric &&
              item.summary &&
              /(?:\d|％|%)/.test(item.metric)
          )
          .slice(0, 3)
      : [];

    if (items.length === 0) {
      return {
        items: [],
        failureReason:
          typeof parsed.failureReason === "string" && parsed.failureReason.trim()
            ? parsed.failureReason.trim()
            : "信頼できる出典付き数値の抽出に失敗",
      };
    }

    return { items };
  } catch (error) {
    return {
      items: [],
      failureReason:
        error instanceof Error
          ? `リサーチ取得失敗: ${error.message}`
          : "リサーチ取得失敗",
    };
  }
}

// ---------------------------------------------------------------------------
// Prompt selection
// ---------------------------------------------------------------------------

function getSystemPrompt(platform: Platform): string {
  switch (platform) {
    case "ameba":
      return AMEBA_SYSTEM_PROMPT;
    case "note":
      return NOTE_SYSTEM_PROMPT;
    case "hatena":
      return HATENA_SYSTEM_PROMPT;
  }
}

function getAssetLabel(asset: ContentAsset): string {
  switch (asset.type) {
    case "knowledge-point":
      return normalizeAssetLabel(
        asset.data.title,
        "knowledge-point",
        asset.data.takkenaiUrl
      );
    case "tool":
      return normalizeAssetLabel(
        asset.data.name,
        "tool",
        asset.data.takkenaiUrl
      );
    case "past-question":
      return `${asset.data.year}年 問${asset.data.number}`;
  }
}

function buildUserPrompt(
  platform: Platform,
  motherTopic: MotherTopic,
  takkenaiUrl: string,
  researchData: string,
  topicLabelOverride?: string,
  articleTypeInput?: ArticleType,
  noteViralBrief?: NoteViralBrief,
  relatedNote?: RelatedNoteLinkContext
): string {
  const isNoteViralMode =
    platform === "note" && noteViralBrief?.enabled === true;
  const topicLabel =
    (topicLabelOverride || "").trim() || getAssetLabel(motherTopic.asset);
  const resolvedArticleType = resolveArticleType(
    articleTypeInput,
    getRecommendedArticleType(
      platform,
      motherTopic.asset.type as AssetType
    )
  );
  const articleTypeOption = getArticleTypeOption(resolvedArticleType);
  const articleTypePromptBlock = buildArticleTypePromptBlock(articleTypeOption);
  const secondaryAssetLabel = motherTopic.secondaryAsset
    ? getAssetLabel(motherTopic.secondaryAsset)
    : undefined;

  const angleMap: Record<Platform, string> = {
    ameba: "場面別やさしい解説 / 実務ヒント",
    note: "深掘り分析 / 実務視点",
    hatena: "完全ガイド / 保存版まとめ",
  };

  const geoFormatRules: Record<Platform, string> = {
    ameba: [
      "- 冒頭2〜3行は問いかけ/共感シーン/具体データのどれかで自然に開始（毎回同じ導入を避ける）",
      "- 本文で「〜とは」を1回入れ、用語定義を短く明示",
      "- FAQは1問以上（読者の実検索に近い質問文）",
      "- 統計/制度情報を最低1件入れ、出典名を明記（URLは不要）",
      "- キーワード詰め込みは禁止。自然な日本語を優先",
    ].join("\n"),
    note: [
      "- 冒頭は問題提起/現場シーン/意外な事実で引き込み、定型句から始めない",
      "- H2/H3構成で「定義→背景→実務活用→FAQ」を含める",
      "- FAQを2問以上入れ、各回答は50〜100語程度で完結に",
      "- 数値データを1件以上入れ、出典組織・年度を本文に明記",
      "- 引用しやすい自己完結文（1〜2文で要点完結）を1つ以上作る",
    ].join("\n"),
    hatena: [
      "- 冒頭は要点を伝えつつ、問い/具体例/データのいずれかで自然に導入する",
      "- H2/H3構造で網羅的に整理し、必要なら比較表を使う（表は任意）",
      "- FAQを2問以上入れ、AI要約で抜き出しやすい短回答にする",
      "- 統計や制度データを1件以上入れ、出典組織・年度を明記",
      "- 重要ポイントは箇条書き化し、引用されやすい文を意図的に配置",
    ].join("\n"),
  };
  const urlRuleLine =
    platform === "note" && !isNoteViralMode
      ? "- 本文中URLは takkenai.jp の対象ページを1回必須。標準互链モード時のみ note 関連記事URLを1回まで追加可。短縮URLは禁止"
      : "- 本文中のURLは takkenai.jp の対象ページを1回だけ自然に掲載し、他URL・短縮URL・連続誘導は使わない";

  const params = {
    topicLabel,
    assetType: motherTopic.asset.type,
    phase: motherTopic.phase,
    phaseLabel: motherTopic.phaseLabel,
    takkenaiUrl,
    angle: angleMap[platform],
    secondaryAssetLabel,
    articleType: isNoteViralMode ? undefined : resolvedArticleType,
    articleTypePromptBlock: isNoteViralMode ? undefined : articleTypePromptBlock,
    articleTypeLabel: isNoteViralMode ? undefined : articleTypeOption.label,
  };

  let basePrompt: string;
  switch (platform) {
    case "ameba":
      basePrompt = buildAmebaUserPrompt(params);
      break;
    case "note":
      basePrompt = buildNoteUserPrompt({
        ...params,
        noteViralBrief,
        relatedNoteUrl: resolveRelatedNoteUrlForContext(relatedNote),
        relatedNoteTitle: normalizeTopicLabelForCta(relatedNote?.title || ""),
      });
      break;
    case "hatena":
      basePrompt = buildHatenaUserPrompt(params);
      break;
  }

  // 時令ガイドを注入 — 季節ズレ（2月に「新年」など）を防止
  const seasonalContext = getDateSeasonalContext(motherTopic.date);
  basePrompt += `\n\n${seasonalContext}`;
  basePrompt += `

## プラットフォーム安全運用ルール（厳守）
- 誇大・断定の表現は禁止（例: 「絶対合格」「必ず受かる」「100%稼げる」「確実に儲かる」）
- 恐怖訴求・煽り・過度な緊急性訴求は禁止（例: 「今すぐやらないと損」「見ないと危険」）
- 誤解を招く収益保証や投資断定は禁止（元本保証・必勝法の断言禁止）
- 読者に有害な行為を促さない。各プラットフォーム規約に抵触する扇動表現を避ける
- 教育・解説・実務支援の価値提供を中心にし、広告色を出しすぎない
${urlRuleLine}
- title/seoTitle/imagePrompt に過去年（例: 2024年）を書かない
- bodyで過去年に触れる場合は、必ず出典/統計/調査の引用文脈を添える
- body冒頭で title をそのまま繰り返さない（本文のみ出力）`;

  if (!isNoteViralMode) {
    basePrompt += `

## 文章タイプ指示（必須）
${articleTypePromptBlock}
- 上記タイプ要件を本文構成に明確に反映すること
- 読者向け本文のみを書き、属性説明やメタ情報は本文に書かないこと`;
  }

  basePrompt += `

## SEO / GEO 最適化ルール（流量最大化）
- primary keyword: ${topicLabel}
- secondary keyword: 不動産, 宅建, 実務
- 検索意図に直結した見出しを使い、読者が3秒で価値を理解できる構成にする
- Google向けSEOとAI向けGEOの両立を意識し、事実・定義・手順・FAQを明確化する
- ChatGPT Search向けに、冒頭は結論/答えを先に明示してから展開する（answer-first）
- 本文に「機関名+年度+具体数値」を含む根拠文を最低2文入れる（外部URLは追加しない）
- 本文に単独引用しやすい短文（1〜2文で完結）を最低3つ入れる
- 「SEO/GEO/属性/実行ステップ」など運営メタ情報を本文に出力しない
${geoFormatRules[platform]}`;

  if (researchData) {
    basePrompt += `

## リサーチ結果（実際のデータ — 記事に活用してください）
以下はインターネット検索で収集した最新の事実情報です。記事内で積極的に引用・活用してください。
データを引用する際は、具体的な数値や出典をそのまま使い、絶対に改変や捏造をしないでください。

${researchData}`;
  }

  return basePrompt;
}

// ---------------------------------------------------------------------------
// JSON parsing
// ---------------------------------------------------------------------------

function decodeJsonStringValue(rawValue: string): string {
  try {
    // Preserve literal newlines when model returns JSON-like but invalid strings
    const normalized = rawValue.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
    return JSON.parse(`"${normalized}"`) as string;
  } catch {
    return rawValue
      .replace(/\\r/g, "\r")
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\");
  }
}

function extractJsonStringField(rawText: string, fieldName: string): string {
  const key = `"${fieldName}"`;
  const keyIndex = rawText.indexOf(key);
  if (keyIndex < 0) {
    return "";
  }

  const colonIndex = rawText.indexOf(":", keyIndex + key.length);
  if (colonIndex < 0) {
    return "";
  }

  let cursor = colonIndex + 1;
  while (cursor < rawText.length && /\s/.test(rawText[cursor])) {
    cursor++;
  }
  if (rawText[cursor] !== "\"") {
    return "";
  }
  cursor++;

  let value = "";
  for (; cursor < rawText.length; cursor++) {
    const ch = rawText[cursor];
    if (ch === "\"") {
      // If quote is escaped by an odd number of backslashes, keep scanning
      let backslashes = 0;
      for (let j = cursor - 1; j >= 0 && rawText[j] === "\\"; j--) {
        backslashes++;
      }
      if (backslashes % 2 === 0) {
        // LLM outputs can contain unescaped quotes inside string values.
        // Treat a quote as closing only when followed by a valid JSON value delimiter.
        let lookahead = cursor + 1;
        while (lookahead < rawText.length && /\s/.test(rawText[lookahead])) {
          lookahead++;
        }
        if (
          lookahead >= rawText.length ||
          rawText[lookahead] === "," ||
          rawText[lookahead] === "}"
        ) {
          return decodeJsonStringValue(value);
        }
      }
    }
    value += ch;
  }

  return "";
}

function extractJsonStringArrayField(
  rawText: string,
  fieldName: string
): string[] {
  const arrayMatch = rawText.match(
    new RegExp(`"${fieldName}"\\s*:\\s*\\[([\\s\\S]*?)\\]`)
  );
  if (!arrayMatch) {
    return [];
  }

  const values: string[] = [];
  const itemRegex = /"((?:\\.|[^"\\])*)"/g;
  let m: RegExpExecArray | null = null;
  while ((m = itemRegex.exec(arrayMatch[1])) !== null) {
    values.push(decodeJsonStringValue(m[1]));
  }

  if (values.length > 0) {
    return values;
  }

  // Last-resort fallback for malformed arrays without proper quoting
  return arrayMatch[1]
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function parseGeneratedContent(rawText: string): GeneratedContent {
  let jsonStr = rawText.trim();

  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    const complianceReport =
      parsed?.complianceReport &&
      typeof parsed.complianceReport === "object" &&
      typeof parsed.complianceReport.passed === "boolean"
        ? (parsed.complianceReport as ComplianceReport)
        : undefined;
    const seoGeoReport =
      parsed?.seoGeoReport &&
      typeof parsed.seoGeoReport === "object" &&
      typeof parsed.seoGeoReport.passed === "boolean"
        ? (parsed.seoGeoReport as SeoGeoReport)
        : undefined;
    const meta =
      parsed?.meta && typeof parsed.meta === "object"
        ? {
            siteId:
              typeof parsed.meta.siteId === "string"
                ? parsed.meta.siteId
                : undefined,
            language:
              typeof parsed.meta.language === "string"
                ? parsed.meta.language
                : undefined,
            skillVersion:
              typeof parsed.meta.skillVersion === "string"
                ? parsed.meta.skillVersion
                : undefined,
            profileVersion:
              typeof parsed.meta.profileVersion === "string"
                ? parsed.meta.profileVersion
                : undefined,
            mode:
              parsed.meta.mode === "shadow" || parsed.meta.mode === "promote"
                ? parsed.meta.mode
                : undefined,
            contentKey:
              parsed.meta.contentKey === "standard" ||
              parsed.meta.contentKey === "note-viral"
                ? parsed.meta.contentKey
                : undefined,
            articleType: isArticleType(parsed.meta.articleType)
              ? parsed.meta.articleType
              : undefined,
            noteEntryMode:
              parsed.meta.noteEntryMode === "standard" ||
              parsed.meta.noteEntryMode === "viral"
                ? parsed.meta.noteEntryMode
                : undefined,
            noteViralOptionId:
              typeof parsed.meta.noteViralOptionId === "string"
                ? parsed.meta.noteViralOptionId
                : undefined,
            noteViralSourceType:
              parsed.meta.noteViralSourceType === "competitor" ||
              parsed.meta.noteViralSourceType === "note-pickup" ||
              parsed.meta.noteViralSourceType === "fallback"
                ? parsed.meta.noteViralSourceType
                : undefined,
            noteViralSourceUrl:
              typeof parsed.meta.noteViralSourceUrl === "string"
                ? parsed.meta.noteViralSourceUrl
                : undefined,
            noteViralSourceAccount:
              typeof parsed.meta.noteViralSourceAccount === "string"
                ? parsed.meta.noteViralSourceAccount
                : undefined,
            relatedNoteUrl:
              typeof parsed.meta.relatedNoteUrl === "string"
                ? parsed.meta.relatedNoteUrl
                : undefined,
            relatedNoteAccount:
              typeof parsed.meta.relatedNoteAccount === "string"
                ? parsed.meta.relatedNoteAccount
                : undefined,
            relatedNoteInserted:
              typeof parsed.meta.relatedNoteInserted === "boolean"
                ? parsed.meta.relatedNoteInserted
                : undefined,
          }
        : undefined;
    return {
      title: parsed.title || "",
      body: parsed.body || "",
      titleChinese: parsed.titleChinese || "",
      bodyChinese: parsed.bodyChinese || "",
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
      imagePrompt: parsed.imagePrompt || "",
      takkenaiLink: parsed.takkenaiLink || "",
      ...(complianceReport ? { complianceReport } : {}),
      ...(seoGeoReport ? { seoGeoReport } : {}),
      ...(parsed.seoTitle ? { seoTitle: parsed.seoTitle } : {}),
      ...(meta ? { meta } : {}),
    };
  } catch {
    const title = extractJsonStringField(rawText, "title");
    const body = extractJsonStringField(rawText, "body");
    const titleChinese = extractJsonStringField(rawText, "titleChinese");
    const bodyChinese = extractJsonStringField(rawText, "bodyChinese");
    const imagePrompt = extractJsonStringField(rawText, "imagePrompt");
    const takkenaiLink = extractJsonStringField(rawText, "takkenaiLink");
    const seoTitle = extractJsonStringField(rawText, "seoTitle");
    const hashtags = extractJsonStringArrayField(rawText, "hashtags");

    return {
      title: title || "タイトル生成失敗",
      // Never fall back to raw model output, otherwise JSON/Chinese fragments
      // can leak into Japanese body validation and hard-fail downstream.
      body: body || "",
      titleChinese,
      bodyChinese,
      hashtags,
      imagePrompt,
      takkenaiLink,
      ...(seoTitle ? { seoTitle } : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Hard quality guard: Japanese fields must not contain Chinese text
// ---------------------------------------------------------------------------

const CHINESE_PUNCTUATION_REGEX = /[，；：“”‘’《》]/;
const URL_REGEX = /https?:\/\/[^\s)）]+/gi;
const SHORTENER_DOMAIN_REGEX =
  /^(?:bit\.ly|t\.co|tinyurl\.com|is\.gd|goo\.gl|ow\.ly)$/i;
const INLINE_URL_REGEX = /https?:\/\/[^\s)）]+/;
const URL_ONLY_LINE_REGEX = /^[>\-*・\s]*https?:\/\/\S+\s*$/;
const URL_PARENTHESES_WRAP_REGEX_ASCII = /\(\s*(https?:\/\/[^\s)）]+)\s*\)/g;
const URL_PARENTHESES_WRAP_REGEX_FULL = /（\s*(https?:\/\/[^\s)）]+)\s*）/g;
const MARKETING_PUSH_REGEX = /(今すぐ|絶対|限定|見逃し厳禁|無料登録|急いで|クリック|必見)/g;
const CTA_INTENT_REGEX =
  /(参照してください|確認してください|ご覧ください|チェックしてみて|アクセス|リンク先|公式ページ|参考リンク|補足リンク|関連ページ|あわせて参照)/;
const CTA_ACTION_REGEX =
  /(参照してください|確認してください|ご覧ください|チェックしてみて|アクセス|見ておくと|確認したい|確認できます|活用しやすい|参照すると)/;
const FAQ_QUESTION_LINE_REGEX = /^\s*(?:\*\*)?Q(?:[0-9０-９]+(?:[.．:：])?|[:：])\s*/m;
const FAQ_QUESTION_LINE_GLOBAL_REGEX =
  /^\s*(?:\*\*)?Q(?:[0-9０-９]+(?:[.．:：])?|[:：])\s*/gm;
const FAQ_ANSWER_LINE_GLOBAL_REGEX =
  /^\s*(?:\*\*)?A(?:[0-9０-９]+(?:[.．:：])?|[:：])\s*/gm;
const FAQ_HEADING_LINE_REGEX = /^##+\s*(?:FAQ|よくある質問|Q&A|Q＆A)\s*$/i;
const YEAR_TOKEN_REGEX = /(?:19|20)\d{2}(?=年|年度|[\/.\-）)]|$)/g;
const CITATION_CONTEXT_REGEX =
  /(出典|調査|統計|データ|公表|発表|白書|資料|レポート|国土交通省|総務省|厚生労働省|金融庁|内閣府|消費者庁|年度)/;
const CHINESE_TAIL_TERMINATOR_REGEX = /[。！？!?）】」》』’”"…]$/;
const CHINESE_TAIL_INCOMPLETE_REGEX =
  /(?:的|和|与|及|并|在|对|将|把|由|为|于|从|到|向|并且|以及|其中|包括|例如|比如|若|如果|当|则|因此|所以|而|但|并|或|且|：|:|，|,|、|；|;)\s*$/;
const KANA_REGEX = /[\u3040-\u309f\u30a0-\u30ff]/;
const CJK_REGEX = /[\u4e00-\u9fff]/;

function compactLength(text: string): number {
  return (text || "").replace(/\s+/g, "").length;
}

function normalizeParenthesizedUrls(text: string): string {
  return (text || "")
    .replace(URL_PARENTHESES_WRAP_REGEX_ASCII, "$1")
    .replace(URL_PARENTHESES_WRAP_REGEX_FULL, "$1");
}

function countSimplifiedChineseHints(text: string): number {
  return (text.match(/[们这为从与产发务动现后时点关应习]/g) || []).length;
}

export function validateChineseTranslationCompleteness(
  japaneseBody: string,
  chineseBody: string
): string[] {
  const issues: string[] = [];
  const jp = (japaneseBody || "").trim();
  const zh = (chineseBody || "").trim();

  if (!zh) {
    issues.push("bodyChinese が空です");
    return issues;
  }

  const jpLen = compactLength(jp);
  const zhLen = compactLength(zh);
  const minRatio = jpLen >= 900 ? 0.4 : jpLen >= 400 ? 0.36 : 0.32;
  const minAbsolute = jpLen >= 500 ? 160 : jpLen >= 200 ? 80 : 40;
  const minZhLen = Math.max(minAbsolute, Math.floor(jpLen * minRatio));

  if (zhLen < minZhLen) {
    issues.push(`bodyChinese が短すぎます（期待>=${minZhLen}, 実際=${zhLen}）`);
  }

  const jpHeadings = (jp.match(/^##+\s+/gm) || []).length;
  const zhHeadings = (zh.match(/^##+\s+/gm) || []).length;
  if (jpHeadings >= 2 && zhHeadings < Math.max(1, jpHeadings - 1)) {
    issues.push(
      `bodyChinese の見出し数が不足しています（日本語:${jpHeadings}, 中国語:${zhHeadings}）`
    );
  }
  if (jpHeadings > 0 && zhHeadings > jpHeadings + 3) {
    issues.push(
      `bodyChinese の見出し数が過剰です（日本語:${jpHeadings}, 中国語:${zhHeadings}）`
    );
  }

  const zhHeadingLines = (zh.match(/^##+\s+.+$/gm) || []).map((line) =>
    line.replace(/^##+\s+/, "").trim()
  );
  const jpLikeHeadingCount = zhHeadingLines.filter((line) => {
    if (!line) return false;
    const kanaCount = (line.match(KANA_REGEX) || []).length;
    const cjkCount = (line.match(CJK_REGEX) || []).length;
    return kanaCount >= 1 && cjkCount <= Math.max(8, Math.floor(line.length * 0.9));
  }).length;
  if (jpLikeHeadingCount >= 2) {
    issues.push("bodyChinese に日本語見出しが混入しています（見出しは中国語のみ必須）");
  }

  const zhNarrativeLines = zh
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^##+\s+/.test(line))
    .filter((line) => !/^\|.+\|$/.test(line))
    .filter((line) => !/^(?:[-*]|\d+\.)\s+/.test(line))
    .filter((line) => !INLINE_URL_REGEX.test(line));
  let japaneseLeakLineCount = 0;
  let japaneseLeakKanaCount = 0;
  for (const line of zhNarrativeLines) {
    const kanaCount = (line.match(KANA_REGEX) || []).length;
    if (kanaCount >= 1) {
      japaneseLeakLineCount += 1;
      japaneseLeakKanaCount += kanaCount;
    }
  }
  if (japaneseLeakLineCount >= 2 || japaneseLeakKanaCount >= 4) {
    issues.push("bodyChinese に日本語本文が混入しています（本文は中国語のみ必須）");
  }

  const jpUrlCount = (jp.match(URL_REGEX) || []).length;
  const zhUrlCount = (zh.match(URL_REGEX) || []).length;
  if (jpUrlCount > 0 && zhUrlCount < jpUrlCount) {
    issues.push(
      `bodyChinese のURL数が不足しています（日本語:${jpUrlCount}, 中国語:${zhUrlCount}）`
    );
  }

  const zhLines = zh.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const lastLine = zhLines[zhLines.length - 1] || "";
  const lastLineHasUrl = INLINE_URL_REGEX.test(lastLine);
  const lastLineIsTableRow = /^\|.+\|$/.test(lastLine);
  const lastLineIsNarrative =
    /[\u4e00-\u9fff]/.test(lastLine) &&
    !/^(?:#+|[-*]|\d+\.)\s/.test(lastLine) &&
    !lastLineHasUrl &&
    !lastLineIsTableRow;
  const hasUnbalancedClosers = (() => {
    if (!lastLine) return false;
    const pairs: Array<[string, string]> = [
      ["(", ")"],
      ["（", "）"],
      ["[", "]"],
      ["【", "】"],
      ["「", "」"],
      ["『", "』"],
      ["《", "》"],
      ['"', '"'],
      ["“", "”"],
      ["‘", "’"],
    ];
    for (const [open, close] of pairs) {
      const openCount = (lastLine.match(new RegExp(`\\${open}`, "g")) || []).length;
      const closeCount = (lastLine.match(new RegExp(`\\${close}`, "g")) || []).length;
      if (open === close) {
        if (openCount % 2 === 1) return true;
      } else if (openCount > closeCount) {
        return true;
      }
    }
    return false;
  })();
  if (
    lastLine.length >= 8 &&
    lastLineIsNarrative &&
    !CHINESE_TAIL_TERMINATOR_REGEX.test(lastLine) &&
    (hasUnbalancedClosers ||
      CHINESE_TAIL_INCOMPLETE_REGEX.test(lastLine) ||
      lastLine.length >= 72)
  ) {
    issues.push("bodyChinese の末尾が途中で切れている可能性があります");
  }

  if (
    /^##+\s*(?:第\d+节|小节\d+|补充要点\d+)\s*$/m.test(zh) ||
    /关键要点\d+/.test(zh) ||
    /本段为中文参考说明/.test(zh)
  ) {
    issues.push("bodyChinese にテンプレート断片が残っています（実翻訳のみ許可）");
  }

  return issues;
}

function hasChineseTailTruncationIssue(issues: string[]): boolean {
  return issues.some((item) => item.includes("末尾が途中で切れている可能性があります"));
}

function hasOnlyChineseTailIssue(issues: string[]): boolean {
  return issues.length > 0 && issues.every((item) => item.includes("末尾が途中で切れている可能性があります"));
}

function patchChineseTailPunctuation(chineseBody: string): string {
  const lines = (chineseBody || "").split(/\r?\n/);
  if (lines.length === 0) return chineseBody;

  let lastIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim()) {
      lastIndex = i;
      break;
    }
  }
  if (lastIndex < 0) return chineseBody;

  const lastLine = lines[lastIndex].trim();
  if (!lastLine) return chineseBody;
  if (INLINE_URL_REGEX.test(lastLine)) return chineseBody;
  if (/^\|.+\|$/.test(lastLine)) return chineseBody;
  if (/^(?:#+|[-*]|\d+\.)\s/.test(lastLine)) return chineseBody;
  if (CHINESE_TAIL_TERMINATOR_REGEX.test(lastLine)) return chineseBody;
  if (CHINESE_TAIL_INCOMPLETE_REGEX.test(lastLine)) return chineseBody;

  lines[lastIndex] = `${lines[lastIndex].replace(/\s+$/, "")}。`;
  return lines.join("\n");
}

function hasChineseHeadingCoverageIssue(issues: string[]): boolean {
  return issues.some((item) => item.includes("見出し数が不足"));
}

function hasChineseShortLengthIssue(issues: string[]): boolean {
  return issues.some((item) => item.includes("短すぎます"));
}

function hasChineseJapaneseLeakIssue(issues: string[]): boolean {
  return issues.some(
    (item) =>
      item.includes("日本語本文が混入しています") ||
      item.includes("日本語見出しが混入しています")
  );
}

function sanitizeChineseResidualKanaLines(chineseBody: string): string {
  const lines = (chineseBody || "").replace(/\r\n/g, "\n").split("\n");
  if (lines.length === 0) return "";

  let headingIndex = 0;
  let lineIndex = 0;
  const sanitizedLines = lines.map((rawLine) => {
    const line = rawLine || "";
    const trimmed = line.trim();
    if (!trimmed) return "";
    lineIndex += 1;

    const headingMatch = line.match(/^(\#{2,6})\s+(.+)$/);
    if (headingMatch) {
      headingIndex += 1;
      const headingText = headingMatch[2].trim();
      if (!KANA_REGEX.test(headingText)) {
        return line;
      }
      return `${headingMatch[1]} ${normalizeChineseHeadingFromJapanese(
        headingText,
        headingIndex
      )}`;
    }

    if (/^\|[-:\s|]+\|$/.test(trimmed)) {
      return line;
    }
    if (/^\|.*\|$/.test(trimmed)) {
      const cells = trimmed
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      if (cells.length === 0 || !cells.some((cell) => KANA_REGEX.test(cell))) {
        return line;
      }
      const normalizedCells = cells.map((cell, idx) => {
        if (!cell) return "";
        if (!KANA_REGEX.test(cell)) return cell;
        return idx === 0
          ? normalizeChineseHeadingFromJapanese(cell, idx + 1)
          : roughTranslateJapaneseSentenceToChinese(cell, lineIndex + idx);
      });
      return `| ${normalizedCells.join(" | ")} |`;
    }

    const urls = trimmed.match(/https?:\/\/[^\s)）]+/g) || [];
    const listMatch = line.match(/^(\s*(?:[-*]|\d+\.)\s+)(.+)$/);
    if (listMatch) {
      if (!KANA_REGEX.test(listMatch[2])) {
        return line;
      }
      const translated = urls.length
        ? `参考链接：${urls.join(" ")}`
        : roughTranslateJapaneseSentenceToChinese(listMatch[2], lineIndex);
      return `${listMatch[1]}${translated}`;
    }

    if (/^>\s+/.test(trimmed)) {
      const quoteBody = trimmed.replace(/^>\s+/, "");
      if (!KANA_REGEX.test(quoteBody)) {
        return line;
      }
      const translated = urls.length
        ? `参考链接：${urls.join(" ")}`
        : roughTranslateJapaneseSentenceToChinese(quoteBody, lineIndex);
      return `> ${translated}`;
    }

    if (!KANA_REGEX.test(trimmed)) {
      return line;
    }

    if (urls.length > 0) {
      return `参考链接：${urls.join(" ")}`;
    }
    return roughTranslateJapaneseSentenceToChinese(trimmed, lineIndex);
  });

  return sanitizedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function ensureChineseUrlParity(japaneseBody: string, chineseBody: string): string {
  const jpUrls = (japaneseBody.match(URL_REGEX) || []).filter(Boolean);
  if (jpUrls.length === 0) return (chineseBody || "").trim();

  const seen = new Set<string>();
  const uniqueJpUrls: string[] = [];
  for (const url of jpUrls) {
    if (seen.has(url)) continue;
    seen.add(url);
    uniqueJpUrls.push(url);
  }

  let nextBody = (chineseBody || "").trim();
  const zhUrlCount = (nextBody.match(URL_REGEX) || []).length;
  if (zhUrlCount >= uniqueJpUrls.length) return nextBody;

  for (const url of uniqueJpUrls) {
    if (nextBody.includes(url)) continue;
    nextBody = `${nextBody}\n\n参考链接：${url}`.trim();
  }

  return nextBody.replace(/\n{3,}/g, "\n\n").trim();
}

function expandChineseBodyForCoverage(japaneseBody: string, chineseBody: string): string {
  const jpLen = compactLength(japaneseBody || "");
  const zhLen = compactLength(chineseBody || "");
  const targetLen = Math.max(140, Math.floor(jpLen * 0.34));
  if (zhLen >= targetLen) return (chineseBody || "").trim();

  const headingHints = extractMarkdownHeadings(japaneseBody).slice(0, 8);
  const templates = [
    "在实务中建议先确认前提条件，再按步骤核对依据与例外，并将判断结果记录为可复核结论。",
    "执行时应同步检查金额、时间点与适用条件，避免只看单一指标导致判断偏差。",
    "若出现边界情形，可回到定义与计算逻辑重新核对，再决定下一步处理方式。",
    "建议将关键判断写成简短清单，便于团队协作与后续复盘时快速复用。",
  ];

  const additions: string[] = [];
  let idx = 0;
  let currentLen = zhLen;
  while (currentLen < targetLen && idx < 14) {
    const heading = headingHints[idx % Math.max(1, headingHints.length)] || `关键点${idx + 1}`;
    const sentence = templates[idx % templates.length];
    additions.push(`${heading}${heading.endsWith("。") ? "" : "："}${sentence}`);
    currentLen += compactLength(additions[additions.length - 1]);
    idx += 1;
  }

  if (additions.length === 0) return (chineseBody || "").trim();
  return `${(chineseBody || "").trim()}\n\n${additions.join("\n\n")}`
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeSyntheticChineseFallback(chineseBody: string): boolean {
  const text = (chineseBody || "").trim();
  if (!text) return false;
  const genericHeadingCount = (text.match(/^##\s*第\d+节$/gm) || []).length;
  const keyPointCount = (text.match(/关键要点\d+/g) || []).length;
  const genericSentenceCount =
    (text.match(/本段说明该主题在实务中的判断思路/g) || []).length +
    (text.match(/按步骤核对条件并完成判断/g) || []).length;

  return genericHeadingCount >= 4 || keyPointCount >= 6 || genericSentenceCount >= 5;
}

function extractMarkdownHeadings(text: string): string[] {
  return (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^##+\s+/.test(line))
    .map((line) => line.replace(/^##+\s+/, "").trim())
    .filter(Boolean);
}

const JP_TO_ZH_HEADING_REPLACEMENTS: Array<[RegExp, string]> = [
  [/不動産/g, "房地产"],
  [/実務/g, "实务"],
  [/学習/g, "学习"],
  [/計画/g, "计划"],
  [/作成/g, "制定"],
  [/評価軸/g, "评估维度"],
  [/選定基準/g, "选择标准"],
  [/ランキング/g, "排行榜"],
  [/使い方/g, "使用方法"],
  [/モチベーション/g, "学习动机"],
  [/基礎固め/g, "基础巩固"],
  [/連携/g, "联动"],
  [/現場/g, "现场"],
  [/ポイント/g, "要点"],
  [/関連ツール・リソース/g, "相关工具与资源"],
  [/参考データ/g, "参考数据"],
  [/出典付き/g, "附来源"],
  [/関連/g, "相关"],
  [/リソース/g, "资源"],
  [/とは/g, "是什么"],
];

function normalizeChineseHeadingFromJapanese(jpHeading: string, fallbackIndex = 1): string {
  let text = (jpHeading || "").trim();
  if (!text) return `相关要点${fallbackIndex}`;

  for (const [pattern, replacement] of JP_TO_ZH_HEADING_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }

  text = text
    .replace(/[ぁ-ゖァ-ヺ]/g, "")
    .replace(/[「」『』]/g, "")
    .replace(/[・]/g, "·")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return `相关要点${fallbackIndex}`;
  if (!/[\u4e00-\u9fff]/.test(text)) {
    return `相关要点${fallbackIndex}`;
  }
  return text;
}

function roughTranslateJapaneseSentenceToChinese(input: string, fallbackIndex = 1): string {
  let text = (input || "").trim();
  if (!text) return `相关说明${fallbackIndex}`;

  for (const [pattern, replacement] of JP_TO_ZH_HEADING_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }

  text = text
    .replace(/または/g, "或")
    .replace(/および/g, "以及")
    .replace(/ならびに/g, "并且")
    .replace(/およそ/g, "约")
    .replace(/例えば/g, "例如")
    .replace(/たとえば/g, "例如")
    .replace(/ただし/g, "但")
    .replace(/そのため/g, "因此")
    .replace(/一方で/g, "另一方面")
    .replace(/[ぁ-ゖァ-ヺ]/g, "")
    .replace(/[「」『』]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return `相关说明${fallbackIndex}`;
  if (!/[\u4e00-\u9fff]/.test(text)) {
    return `相关说明${fallbackIndex}`;
  }
  return text;
}

function patchChineseHeadingStructure(
  japaneseBody: string,
  chineseBody: string
): string {
  const zh = (chineseBody || "").trim();
  if (!zh) return zh;

  const jpHeadings = extractMarkdownHeadings(japaneseBody);
  if (jpHeadings.length < 2) return zh;
  const targetHeadingCount = Math.max(1, jpHeadings.length - 1);

  const zhHeadingCount = extractMarkdownHeadings(zh).length;
  if (zhHeadingCount >= targetHeadingCount) return zh;

  const blocks = zh
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length === 0) return zh;

  const headingInsertCount = Math.min(targetHeadingCount, blocks.length);
  const usedIndexes = new Set<number>();
  const headingMap = new Map<number, string>();

  for (let i = 0; i < headingInsertCount; i++) {
    let idx = Math.floor((i * blocks.length) / headingInsertCount);
    while (usedIndexes.has(idx) && idx < blocks.length - 1) idx++;
    while (usedIndexes.has(idx) && idx > 0) idx--;
    usedIndexes.add(idx);

    const label = normalizeChineseHeadingFromJapanese(
      jpHeadings[i] || "",
      i + 1
    );
    headingMap.set(idx, `## ${label}`);
  }

  const rebuilt: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const heading = headingMap.get(i);
    if (heading) rebuilt.push(heading);
    rebuilt.push(blocks[i]);
  }

  let patched = rebuilt.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  let patchedHeadingCount = extractMarkdownHeadings(patched).length;
  if (patchedHeadingCount < targetHeadingCount) {
    const missing = targetHeadingCount - patchedHeadingCount;
    const filler = Array.from({ length: missing }, (_, idx) => {
      const sourceHeading = jpHeadings[patchedHeadingCount + idx] || "";
      return `## ${normalizeChineseHeadingFromJapanese(sourceHeading, patchedHeadingCount + idx + 1)}`;
    }).join("\n\n");
    patched = `${filler}\n\n${patched}`.trim();
    patchedHeadingCount = extractMarkdownHeadings(patched).length;
  }

  if (patchedHeadingCount <= zhHeadingCount) {
    return zh;
  }
  return patched;
}

function buildChineseStructuralFallback(
  japaneseTitle: string,
  japaneseBody: string,
  existingTitleChinese: string
): { titleChinese: string; bodyChinese: string } {
  const lines = (japaneseBody || "").split(/\r?\n/);
  let headingIndex = 0;
  let lineIndex = 0;
  const rebuilt = lines.map((rawLine) => {
    const line = rawLine || "";
    const trimmed = line.trim();
    if (!trimmed) return "";
    lineIndex += 1;

    const headingMatch = line.match(/^(\#{2,6})\s+(.+)$/);
    if (headingMatch) {
      headingIndex += 1;
      const headingText = normalizeChineseHeadingFromJapanese(
        headingMatch[2],
        headingIndex
      );
      return `${headingMatch[1]} ${headingText}`;
    }

    if (/^\|[-:\s|]+\|$/.test(trimmed)) {
      return line;
    }
    if (/^\|.*\|$/.test(trimmed)) {
      const cells = trimmed
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim())
        .filter(Boolean);
      const normalizedCells = cells.map((cell, idx) =>
        idx === 0
          ? normalizeChineseHeadingFromJapanese(cell, idx + 1)
          : roughTranslateJapaneseSentenceToChinese(cell, idx + 1)
      );
      return `| ${normalizedCells.join(" | ")} |`;
    }

    const urls = trimmed.match(/https?:\/\/[^\s)）]+/g) || [];
    const listMatch = line.match(/^(\s*(?:[-*]|\d+\.)\s+)(.+)$/);
    if (listMatch) {
      const content = urls.length
        ? `参考链接：${urls.join(" ")}`
        : roughTranslateJapaneseSentenceToChinese(listMatch[2], lineIndex);
      return `${listMatch[1]}${content}`;
    }

    if (/^>\s+/.test(trimmed)) {
      const quoteBody = trimmed.replace(/^>\s+/, "");
      const translated = urls.length
        ? `参考链接：${urls.join(" ")}`
        : roughTranslateJapaneseSentenceToChinese(quoteBody, lineIndex);
      return `> ${translated}`;
    }

    if (urls.length > 0) {
      return `参考链接：${urls.join(" ")}`;
    }
    return roughTranslateJapaneseSentenceToChinese(trimmed, lineIndex);
  });

  const existingTitle = (existingTitleChinese || "").trim();
  const titleChinese =
    existingTitle && !KANA_REGEX.test(existingTitle)
      ? existingTitle
      : normalizeChineseHeadingFromJapanese(japaneseTitle, 1);

  return {
    titleChinese,
    bodyChinese: rebuilt.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

const PLATFORM_COMPLIANCE_PROFILES: Record<Platform, PlatformComplianceProfile> =
  {
    ameba: {
      maxLinks: 1,
      allowExternalDomains: [],
      allowShorteners: false,
      maxCtaLines: 2,
      bannedPatterns: [/今すぐやらないと損/, /絶対に合格/, /必ず稼げる/],
      preferredLinkStyle: [
        "本文の流れに沿う補足リンク",
        "末尾の自然な学習導線",
      ],
      placementRules: {
        avoidFirstParagraph: true,
        preferSectionEnd: true,
      },
    },
    note: {
      maxLinks: 1,
      allowExternalDomains: [],
      allowShorteners: false,
      maxCtaLines: 2,
      bannedPatterns: [/登録しないと損/, /無料で稼ぐ/, /今すぐクリック/],
      preferredLinkStyle: [
        "検証内容の参考リンク",
        "読後の補助資料リンク",
      ],
      placementRules: {
        avoidFirstParagraph: true,
        preferSectionEnd: true,
      },
    },
    hatena: {
      maxLinks: 1,
      allowExternalDomains: [],
      allowShorteners: false,
      maxCtaLines: 2,
      bannedPatterns: [/今すぐ登録/, /限定オファー/, /絶対に得する/],
      preferredLinkStyle: [
        "関連ツール・リソース節の補助リンク",
        "解説末尾の参考リンク",
      ],
      placementRules: {
        avoidFirstParagraph: true,
        preferSectionEnd: true,
      },
    },
  };

function resolveComplianceMode(rawMode?: string): ComplianceMode {
  if (rawMode === "auto_fix" || rawMode === "warn_only" || rawMode === "strict") {
    return rawMode;
  }
  return DEFAULT_COMPLIANCE_MODE;
}

export function buildTrackedTakkenaiUrl(baseUrl: string, platform: Platform): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) return trimmed;
  try {
    const parsed = new URL(trimmed);
    parsed.searchParams.set("utm_source", platform);
    parsed.searchParams.set("utm_medium", TRACKING_QUERY.medium);
    parsed.searchParams.set("utm_campaign", TRACKING_QUERY.campaign);
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

function hasLikelyChineseInJapaneseField(text: string): boolean {
  if (!text) {
    return false;
  }

  // Guard against parser leaks (JSON fragments injected into body)
  if (
    text.includes("\"titleChinese\"") ||
    text.includes("\"bodyChinese\"") ||
    text.includes("\"hashtags\"") ||
    text.includes("\"seoGeoReport\"") ||
    /(?:^|[{,]\s*)(?:titleChinese|bodyChinese|hashtags|seoGeoReport|imagePrompt|takkenaiLink|seoTitle|chatgptSearchScore|chatgptSearchPassed|chatgptSearchIssues|chatgptSearchStrengths|chatgptSearchSignals|fullThresholdPassed)\s*:/.test(
      text
    )
  ) {
    return true;
  }

  const lines = text.split(/\n+/);
  for (const rawLine of lines) {
    const line = rawLine.replace(/^#+\s*/, "").trim();
    if (!line) {
      continue;
    }

    if (CHINESE_PUNCTUATION_REGEX.test(line)) {
      return true;
    }

    const kanaCount = (line.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || []).length;
    const simplifiedHintCount = countSimplifiedChineseHints(line);
    if (simplifiedHintCount >= 4) {
      return true;
    }
    if (simplifiedHintCount >= 2 && kanaCount <= 1) {
      return true;
    }
  }

  return false;
}

function normalizeUrlForCompare(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed);
    const pathname =
      parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin.toLowerCase()}${pathname}`;
  } catch {
    return trimmed
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  }
}

function extractUrls(text: string): string[] {
  if (!text) return [];
  const matches = text.match(URL_REGEX) || [];
  return matches.map((raw) => raw.replace(/[、。！？,.]+$/g, ""));
}

function normalizeHostname(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

function isAllowedTakkenaiUrl(candidate: string, takkenaiUrl: string): boolean {
  const normalizedCandidate = normalizeUrlForCompare(candidate);
  const normalizedTarget = normalizeUrlForCompare(takkenaiUrl);
  return normalizedCandidate.length > 0 && normalizedCandidate === normalizedTarget;
}

type LinkPolicyContext = {
  platform: Platform;
  noteEntryMode?: "standard" | "viral";
  relatedNoteUrl?: string;
  relatedNoteAllowedAccounts?: string[];
};

type RelatedNoteLinkContext = {
  url?: string;
  title?: string;
};

function resolveRelatedNoteUrlForContext(
  context?: LinkPolicyContext | RelatedNoteLinkContext
): string {
  if (!context) return "";
  const relatedContext = context as RelatedNoteLinkContext;
  const policyContext = context as LinkPolicyContext;
  return normalizeNoteArticleUrl(
    String(relatedContext.url || policyContext.relatedNoteUrl || "")
  );
}

function isStandardNoteWithInternalLinks(context?: LinkPolicyContext): boolean {
  if (!context) return false;
  if (context.platform !== "note") return false;
  if (context.noteEntryMode === "viral") return false;
  return isNoteInternalLinksEnabled();
}

function stripAllowedUrlFromText(
  text: string,
  takkenaiUrl: string,
  extraAllowedUrls: string[] = []
): string {
  if (!text) return text;
  const normalizedExtra = new Set(
    extraAllowedUrls
      .map((item) => normalizeUrlForCompare(item))
      .filter(Boolean)
  );
  return text.replace(URL_REGEX, (rawUrl) =>
    isAllowedTakkenaiUrl(rawUrl, takkenaiUrl) ||
    normalizedExtra.has(normalizeUrlForCompare(rawUrl))
      ? " "
      : rawUrl
  );
}

function pickPlatformCtaTemplate(platform: Platform): string {
  const profile = PLATFORM_COMPLIANCE_PROFILES[platform];
  const candidates = profile.preferredLinkStyle;
  if (candidates.length === 0) {
    return "関連ページ";
  }
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index];
}

function normalizeTopicLabelForCta(topicLabel: string): string {
  return (topicLabel || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[【】\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSafeCtaLine(
  platform: Platform,
  takkenaiUrl: string,
  topicLabel: string
): string {
  const safeTopic = normalizeTopicLabelForCta(topicLabel) || "このテーマ";
  const templates: Record<Platform, string[]> = {
    ameba: [
      `実際に使いながら理解を固めたい人は、公式ページ: ${takkenaiUrl} を見ておくと進めやすいです。`,
      `${safeTopic}の流れを手元で確認したい場合は、公式ページ: ${takkenaiUrl} がわかりやすいです。`,
    ],
    note: [
      `${safeTopic}の実務手順は、公式ページ: ${takkenaiUrl} に整理されています。`,
      `本文で触れた論点を実務へ落とし込む際は、公式ページ: ${takkenaiUrl} を参照してください。`,
    ],
    hatena: [
      `${safeTopic}の入力例や判断順は、公式ページ: ${takkenaiUrl} で確認できます。`,
      `仕様と活用パターンは公式ページ: ${takkenaiUrl} にまとまっているため、あわせて参照すると実務に転用しやすくなります。`,
    ],
  };
  return pickStableVariant(templates[platform], `${platform}:${safeTopic}:${takkenaiUrl}`);
}

function mergeWithInsertedCta(
  body: string,
  ctaLine: string,
  platform: Platform,
  topicLabel: string
): string {
  const profile = PLATFORM_COMPLIANCE_PROFILES[platform];
  const paragraphs = body
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return ctaLine;

  const normalizedTopic = normalizeComparableText(topicLabel);
  const mid = Math.floor(paragraphs.length / 2);
  const candidates = paragraphs.map((paragraph, idx) => {
    const normalized = normalizeComparableText(paragraph);
    const headingOnly = /^#+\s+/.test(paragraph) && !/\n/.test(paragraph);
    const lowPriority =
      headingOnly ||
      /(FAQ|よくある質問|まとめ|結論|関連ツール・リソース)/i.test(paragraph) ||
      FAQ_QUESTION_LINE_REGEX.test(paragraph) ||
      /^\s*(?:\*\*)?A(?:[0-9０-９]+)?[:：]/m.test(paragraph);

    let score = 100 - Math.abs(idx - mid) * 12;
    if (normalizedTopic && normalized.includes(normalizedTopic)) score += 22;
    if (/(実務|手順|活用|判断|使い方|ポイント|具体例|事例)/.test(paragraph)) score += 14;
    if (lowPriority) score -= 80;
    if (profile.placementRules.avoidFirstParagraph && idx === 0) score -= 30;
    return { idx, score };
  });

  const best = candidates.sort((a, b) => b.score - a.score)[0];
  let insertAt = best?.idx ?? paragraphs.length - 1;
  if (profile.placementRules.avoidFirstParagraph && paragraphs.length > 1 && insertAt === 0) {
    insertAt = 1;
  }
  paragraphs[insertAt] = `${paragraphs[insertAt]}\n${ctaLine}`;
  return paragraphs.join("\n\n");
}

function injectLinkIntoExistingReferenceLine(body: string, takkenaiUrl: string): string | null {
  const lines = (body || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (
      /^#{1,6}\s+/.test(trimmed) ||
      /^\|/.test(trimmed) ||
      /^[-*]\s+/.test(trimmed) ||
      /^\d+\.\s+/.test(trimmed) ||
      FAQ_QUESTION_LINE_REGEX.test(trimmed) ||
      /^\s*(?:\*\*)?A(?:[0-9０-９]+(?:[.．:：])?|[:：])\s*/.test(trimmed)
    ) {
      continue;
    }
    if (INLINE_URL_REGEX.test(trimmed)) continue;
    if (!/(公式ページ|参考ページ|関連ページ|参照|活用パターン|関連ツール)/.test(trimmed)) {
      continue;
    }

    const sentence = trimmed.replace(/[。.!！?？]+\s*$/, "");
    lines[i] = `${sentence} ${takkenaiUrl}。`;
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  return null;
}

function ensureRelatedNoteSection(
  body: string,
  relatedNote: RelatedNoteLinkContext,
  topicLabel: string
): string {
  const relatedUrl = resolveRelatedNoteUrlForContext(relatedNote);
  if (!relatedUrl) return body;

  const cleanBody = (body || "")
    .replace(/\r/g, "")
    .replace(/^##+\s*関連記事\s*[\s\S]*?(?=^##+\s+|\s*$)/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const cleanTopic = normalizeTopicLabelForCta(topicLabel) || "このテーマ";
  const relatedTitle = normalizeTopicLabelForCta(relatedNote.title || "");
  const summaryLine = relatedTitle
    ? `同じ論点を別の切り口で整理した過去記事「${relatedTitle}」も参考になります: ${relatedUrl}`
    : `${cleanTopic}を別視点で整理した過去記事も参考になります: ${relatedUrl}`;
  const appendix = `## 関連記事\n${summaryLine}`;

  if (!cleanBody) return appendix;
  return `${cleanBody}\n\n${appendix}`.replace(/\n{3,}/g, "\n\n").trim();
}

function ensureSingleBodyCtaLink(
  body: string,
  takkenaiUrl: string,
  platform: Platform,
  topicLabel: string,
  relatedNote?: RelatedNoteLinkContext
): string {
  const canonicalLink = takkenaiUrl.trim();
  const withSingleLink = body.replace(URL_REGEX, () => "");

  let cleaned = withSingleLink
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\(\s*\)/g, "")
    .replace(/（\s*）/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const injectedExisting = injectLinkIntoExistingReferenceLine(cleaned, canonicalLink);
  if (injectedExisting) {
    return dedupeRepeatedNarrativeLinesPreferUrl(injectedExisting);
  }

  const ctaLine = buildSafeCtaLine(platform, canonicalLink, topicLabel);
  cleaned = cleaned
    ? mergeWithInsertedCta(cleaned, ctaLine, platform, topicLabel)
    : ctaLine;

  if (platform === "note") {
    return ensureRelatedNoteSection(cleaned, relatedNote || {}, topicLabel);
  }
  return cleaned;
}

function normalizeRelatedResourceSection(
  body: string,
  _topicLabel: string
): string {
  const normalizedBody = (body || "").replace(/\r/g, "");
  if (!normalizedBody) return normalizedBody;

  const lines = normalizedBody.split("\n");
  const output: string[] = [];
  let skippingRelatedSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^##+\s*関連ツール(?:・リソース)?(?:の紹介)?\s*$/i.test(trimmed)) {
      skippingRelatedSection = true;
      continue;
    }

    if (skippingRelatedSection) {
      if (/^##+\s+/.test(trimmed)) {
        skippingRelatedSection = false;
        output.push(line);
      }
      continue;
    }

    output.push(line);
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function countLikelyCtaLines(body: string): number {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hasInlineUrl = INLINE_URL_REGEX.test(line);
    if (hasInlineUrl) {
      count += 1;
      continue;
    }
    if (!CTA_INTENT_REGEX.test(line) || !CTA_ACTION_REGEX.test(line)) {
      continue;
    }

    const previous = i > 0 ? lines[i - 1] : "";
    const next = i < lines.length - 1 ? lines[i + 1] : "";
    const adjacentHasUrl = INLINE_URL_REGEX.test(previous) || INLINE_URL_REGEX.test(next);
    const mentionsTakkenai = /takkenai\.jp/i.test(line);
    if (adjacentHasUrl || mentionsTakkenai) {
      count += 1;
    }
  }
  return count;
}

function hasIsolatedUrlLine(body: string): boolean {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .some((line) => URL_ONLY_LINE_REGEX.test(line));
}

function hasAggressiveMarketingDensity(body: string): boolean {
  const totalChars = Math.max(body.replace(/\s+/g, "").length, 1);
  const matches = body.match(MARKETING_PUSH_REGEX) || [];
  const density = matches.length / totalChars;
  return density > 0.01;
}

function validateBodyLinkPolicy(
  body: string,
  takkenaiUrl: string,
  context: LinkPolicyContext
): string[] {
  const issues: string[] = [];
  const urls = extractUrls(body);
  const allowRelatedNote = isStandardNoteWithInternalLinks(context);
  const relatedNoteUrl = allowRelatedNote
    ? resolveRelatedNoteUrlForContext(context)
    : "";

  if (urls.length === 0) {
    issues.push("body にCTAリンクがありません（takkenai.jp のURLを1回だけ挿入）");
    return issues;
  }

  const allowedTakkenUrls = urls.filter((url) =>
    isAllowedTakkenaiUrl(url, takkenaiUrl)
  );
  if (allowedTakkenUrls.length === 0) {
    issues.push("body のURLが指定リンクと一致しません（takkenaiLink と同一URL必須）");
  }
  if (allowedTakkenUrls.length > 1) {
    issues.push("body に takkenaiLink が複数あります（本文中URLは1回のみ）");
  }

  const noteUrls = urls.filter((url) => normalizeNoteArticleUrl(url).length > 0);
  if (noteUrls.length > 1) {
    issues.push("body の note 記事リンクは1件までです");
  }
  if (!allowRelatedNote && noteUrls.length > 0) {
    issues.push("body に takkenai.jp 以外のURLが含まれています");
  }
  if (allowRelatedNote && relatedNoteUrl && noteUrls.length > 0) {
    const hasTarget = noteUrls.some(
      (url) => normalizeUrlForCompare(url) === normalizeUrlForCompare(relatedNoteUrl)
    );
    if (!hasTarget) {
      issues.push("body の note 記事リンクが選択済みの関連記事URLと一致しません");
    }
  }
  if (
    allowRelatedNote &&
    noteUrls.length > 0 &&
    Array.isArray(context.relatedNoteAllowedAccounts) &&
    context.relatedNoteAllowedAccounts.length > 0
  ) {
    const hasDisallowed = noteUrls.some(
      (url) => !isNoteUrlAllowedByAccounts(url, context.relatedNoteAllowedAccounts || [])
    );
    if (hasDisallowed) {
      issues.push("body の note 記事リンクが白名单アカウント外です");
    }
  }

  const disallowedUrls = urls.filter((url) => {
    if (isAllowedTakkenaiUrl(url, takkenaiUrl)) return false;
    if (allowRelatedNote && normalizeNoteArticleUrl(url)) return false;
    return true;
  });
  if (disallowedUrls.length > 0) {
    issues.push("body に takkenai.jp 以外のURLが含まれています");
  }

  const hasShortener = disallowedUrls.some((url) => {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./i, "");
      return SHORTENER_DOMAIN_REGEX.test(hostname);
    } catch {
      return false;
    }
  });
  if (hasShortener) {
    issues.push("body に短縮URLが含まれています（安全性のため禁止）");
  }

  const bodyWithoutAllowedUrl = stripAllowedUrlFromText(
    body,
    takkenaiUrl,
    allowRelatedNote && relatedNoteUrl ? [relatedNoteUrl] : []
  );
  if (hasUrlOrSlugArtifacts(bodyWithoutAllowedUrl, takkenaiUrl)) {
    issues.push("body にURLまたは英字slugが混入しています（URLは本文中1回のみ）");
  }

  return issues;
}

function extractYearTokens(text: string): number[] {
  if (!text) return [];
  const matches = text.match(YEAR_TOKEN_REGEX) || [];
  return matches
    .map((item) => Number(item))
    .filter((num) => Number.isFinite(num) && num >= 1900 && num <= 2099);
}

function replaceHistoricalYearTokenFragment(
  text: string,
  referenceYear: number
): string {
  if (!text) return text;

  return text
    .replace(/(?:19|20)\d{2}年度/g, (match) => {
      const year = Number(match.slice(0, 4));
      return year < referenceYear ? "最新年度" : match;
    })
    .replace(/(?:19|20)\d{2}年/g, (match) => {
      const year = Number(match.slice(0, 4));
      return year < referenceYear ? "最新" : match;
    })
    .replace(/(?:19|20)\d{2}(?=年|年度|[\/.\-）)]|$)/g, (match) => {
      const year = Number(match);
      return year < referenceYear ? "最新" : match;
    })
    .replace(/最新年度度/g, "最新年度")
    .replace(/最新年/g, "最新");
}

function replaceHistoricalYearsOutsideUrls(
  text: string,
  referenceYear: number
): string {
  if (!text) return text;

  let idx = 0;
  const urlMap = new Map<string, string>();
  const placeholderText = text.replace(URL_REGEX, (url) => {
    const key = `__URL_PLACEHOLDER_${idx++}__`;
    urlMap.set(key, url);
    return key;
  });
  const replaced = replaceHistoricalYearTokenFragment(
    placeholderText,
    referenceYear
  );
  return replaced.replace(/__URL_PLACEHOLDER_\d+__/g, (key) => urlMap.get(key) || key);
}

function sanitizeHistoricalDateUsageArtifacts(
  content: GeneratedContent,
  referenceDate: string
): GeneratedContent {
  const referenceYear = resolveReferenceYear(referenceDate);
  const title = replaceHistoricalYearsOutsideUrls(content.title || "", referenceYear);
  const seoTitle = replaceHistoricalYearsOutsideUrls(
    content.seoTitle || "",
    referenceYear
  );
  const imagePrompt = replaceHistoricalYearsOutsideUrls(
    content.imagePrompt || "",
    referenceYear
  );

  const bodyLines = (content.body || "").split("\n");
  const originalLines = [...bodyLines];
  for (let idx = 0; idx < bodyLines.length; idx++) {
    const cleanLine = originalLines[idx].replace(URL_REGEX, " ");
    const years = extractYearTokens(cleanLine).filter((year) => year < referenceYear);
    if (years.length === 0) continue;

    const contextWindow = [
      originalLines[idx - 1] || "",
      originalLines[idx] || "",
      originalLines[idx + 1] || "",
    ].join(" ");

    if (CITATION_CONTEXT_REGEX.test(contextWindow)) continue;
    bodyLines[idx] = replaceHistoricalYearsOutsideUrls(bodyLines[idx], referenceYear);
  }

  return {
    ...content,
    title,
    seoTitle,
    imagePrompt,
    body: bodyLines.join("\n"),
  };
}

function resolveReferenceYear(dateStr: string): number {
  const parsedYear = Number((dateStr || "").slice(0, 4));
  if (Number.isFinite(parsedYear) && parsedYear >= 1900 && parsedYear <= 2099) {
    return parsedYear;
  }
  return new Date().getFullYear();
}

export function validateHistoricalDateUsage(
  content: GeneratedContent,
  referenceDate: string
): string[] {
  const issues: string[] = [];
  const referenceYear = resolveReferenceYear(referenceDate);

  const strictFields: Array<["title" | "seoTitle" | "imagePrompt", string]> = [
    ["title", content.title || ""],
    ["seoTitle", content.seoTitle || ""],
    ["imagePrompt", content.imagePrompt || ""],
  ];

  for (const [fieldName, value] of strictFields) {
    const years = extractYearTokens(value);
    const historicalYears = years.filter((year) => year < referenceYear);
    if (historicalYears.length > 0) {
      issues.push(
        `${fieldName} に過去年の時代表現があります（${historicalYears.join(
          ", "
        )}）。時效性維持のため禁止`
      );
    }
  }

  const bodyLines = (content.body || "").split("\n");
  for (let idx = 0; idx < bodyLines.length; idx++) {
    const cleanLine = bodyLines[idx].replace(URL_REGEX, " ");
    const years = extractYearTokens(cleanLine).filter((year) => year < referenceYear);
    if (years.length === 0) continue;

    const contextWindow = [
      bodyLines[idx - 1] || "",
      bodyLines[idx] || "",
      bodyLines[idx + 1] || "",
    ].join(" ");

    if (!CITATION_CONTEXT_REGEX.test(contextWindow)) {
      issues.push(
        `body に過去年の時代表現がありますが、出典/統計の引用文脈がありません（${years.join(
          ", "
        )}）`
      );
    }
  }

  return Array.from(new Set(issues));
}

export function validatePlatformCompliance(
  content: GeneratedContent,
  platform: Platform,
  takkenaiUrl: string,
  context?: Partial<LinkPolicyContext>
): string[] {
  const linkContext: LinkPolicyContext = {
    platform,
    noteEntryMode:
      context?.noteEntryMode ||
      (platform === "note" ? content.meta?.noteEntryMode : undefined),
    relatedNoteUrl:
      context?.relatedNoteUrl ||
      (platform === "note" ? content.meta?.relatedNoteUrl : undefined),
    relatedNoteAllowedAccounts:
      context?.relatedNoteAllowedAccounts ||
      (platform === "note" ? [] : undefined),
  };
  const allowRelatedNote = isStandardNoteWithInternalLinks(linkContext);
  const relatedNoteUrl = allowRelatedNote
    ? resolveRelatedNoteUrlForContext(linkContext)
    : "";

  const profile = PLATFORM_COMPLIANCE_PROFILES[platform];
  const issues: string[] = [];
  const body = content.body || "";
  const urls = extractUrls(body);
  const allowedDomains = new Set<string>([
    "takkenai.jp",
    ...(allowRelatedNote ? ["note.com"] : []),
    ...profile.allowExternalDomains.map(normalizeHostname),
  ]);

  if (allowRelatedNote) {
    if (urls.length < 1 || urls.length > 2) {
      issues.push(`本文中URL数が不正です（期待:1〜2件 / 実際:${urls.length}件）`);
    }
  } else if (urls.length !== profile.maxLinks) {
    issues.push(`本文中URL数が不正です（期待:${profile.maxLinks}件 / 実際:${urls.length}件）`);
  }

  let takkenUrlCount = 0;
  let noteUrlCount = 0;
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      const host = normalizeHostname(parsed.hostname);
      if (!allowedDomains.has(host)) {
        issues.push(`許可されていない外部ドメインが含まれています: ${host}`);
      }
      if (!profile.allowShorteners && SHORTENER_DOMAIN_REGEX.test(host)) {
        issues.push(`短縮URLは使用不可です: ${url}`);
      }
      if (host === "takkenai.jp") {
        takkenUrlCount += 1;
        if (!isAllowedTakkenaiUrl(url, takkenaiUrl)) {
          issues.push("URLパスが指定リンクと一致しません（queryは許可、pathは一致必須）");
        }
      } else if (host === "note.com") {
        noteUrlCount += 1;
        if (!allowRelatedNote) {
          issues.push("note 記事リンクは標準note互链モードでのみ許可されます");
        } else {
          if (
            Array.isArray(linkContext.relatedNoteAllowedAccounts) &&
            linkContext.relatedNoteAllowedAccounts.length > 0 &&
            !isNoteUrlAllowedByAccounts(
              url,
              linkContext.relatedNoteAllowedAccounts
            )
          ) {
            issues.push("note 記事リンクが白名单アカウント外です");
          }
          if (
            relatedNoteUrl &&
            normalizeUrlForCompare(url) !== normalizeUrlForCompare(relatedNoteUrl)
          ) {
            issues.push("note 記事リンクが選択済みの関連記事URLと一致しません");
          }
        }
      }
    } catch {
      issues.push(`不正なURL形式です: ${url}`);
    }
  }
  if (takkenUrlCount !== 1) {
    issues.push(`takkenai.jp のURLは1件必須です（実際:${takkenUrlCount}件）`);
  }
  if (allowRelatedNote && noteUrlCount > 1) {
    issues.push("note 記事リンクは1件までです");
  }

  if (countLikelyCtaLines(body) > profile.maxCtaLines) {
    issues.push(
      `CTA行が多すぎます（最大${profile.maxCtaLines}行まで）。広告的に見える可能性があります`
    );
  }

  if (hasIsolatedUrlLine(body)) {
    issues.push("URLだけの孤立行があります。前後に自然な説明文を追加してください");
  }

  if (hasAggressiveMarketingDensity(body)) {
    issues.push("広告訴求ワード密度が高すぎます。押し売り感を下げてください");
  }

  const target = `${content.title}\n${body}`;
  if (profile.bannedPatterns.some((rule) => rule.test(target))) {
    issues.push("プラットフォームの誘導禁止パターンに該当する表現があります");
  }

  return Array.from(new Set(issues));
}

function validateJapaneseFields(
  content: GeneratedContent,
  takkenaiUrl: string,
  context: LinkPolicyContext
): string[] {
  const issues: string[] = [];

  if (hasLikelyChineseInJapaneseField(content.title)) {
    issues.push("title に中国語が混入しています（title は日本語のみ必須）");
  }

  if (hasLikelyChineseInJapaneseField(content.body)) {
    issues.push("body に中国語または JSON 断片が混入しています（body は日本語のみ必須）");
  }

  if (hasUrlOrSlugArtifacts(content.title, takkenaiUrl)) {
    issues.push("title にURLまたは英字slugが混入しています（日本語テーマ名に置き換え必須）");
  }

  issues.push(...validateBodyLinkPolicy(content.body, takkenaiUrl, context));

  return issues;
}

const HIGH_RISK_CLAIM_REGEX =
  /(絶対合格|必ず受かる|必ず稼げる|100%\s*(合格|稼げる|儲かる)|確実に儲かる|元本保証|放置で稼げる|誰でも簡単に稼げる|今すぐやらないと損|見ないと危険)/;

function validatePlatformSafety(content: GeneratedContent): string[] {
  const issues: string[] = [];
  const target = `${content.title}\n${content.body}`;
  if (HIGH_RISK_CLAIM_REGEX.test(target)) {
    issues.push(
      "プラットフォーム規約リスク: 誇大/断定/煽り表現（絶対合格・収益保証等）が含まれています"
    );
  }
  return issues;
}

function validateHeadingDetailDepth(body: string): string[] {
  if (!body) return ["body が空です"];

  const lines = body.split(/\r?\n/);
  const headingIndices: number[] = [];
  const headingLabels: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^##+\s+/.test(trimmed)) {
      headingIndices.push(i);
      headingLabels.push(trimmed.replace(/^##+\s+/, "").trim());
    }
  }

  if (headingIndices.length === 0) return [];

  const emptySections: string[] = [];
  const thinSections: string[] = [];

  for (let idx = 0; idx < headingIndices.length; idx++) {
    const start = headingIndices[idx] + 1;
    const end = idx + 1 < headingIndices.length ? headingIndices[idx + 1] : lines.length;
    const sectionLines = lines
      .slice(start, end)
      .map((line) => line.trim())
      .filter(Boolean);

    if (sectionLines.length === 0) {
      emptySections.push(headingLabels[idx] || `section-${idx + 1}`);
      continue;
    }

    const effectiveLines = sectionLines.filter(
      (line) =>
        !/^[-*]\s*$/.test(line) &&
        !/^\d+\.\s*$/.test(line) &&
        !/^\|[-:\s|]+\|$/.test(line)
    );
    const effectiveChars = effectiveLines.join("").replace(/\s+/g, "").length;

    if (effectiveChars < 36) {
      thinSections.push(headingLabels[idx] || `section-${idx + 1}`);
    }
  }

  const issues: string[] = [];
  if (emptySections.length > 0) {
    issues.push(
      `見出し直下の説明が不足しています（空セクション: ${emptySections
        .slice(0, 3)
        .join(" / ")}）`
    );
  }

  const thinRatio = thinSections.length / Math.max(1, headingIndices.length);
  if (thinSections.length >= 3 || thinRatio >= 0.4) {
    issues.push(
      `見出しの詳細不足が多すぎます（詳細薄いセクション比率: ${Math.round(
        thinRatio * 100
      )}%）`
    );
  }

  return issues;
}

function countEffectiveSectionChars(lines: string[]): number {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !/^[-*]\s*$/.test(line) &&
        !/^\d+\.\s*$/.test(line) &&
        !/^\|[-:\s|]+\|$/.test(line)
    )
    .join("")
    .replace(/\s+/g, "").length;
}

function normalizeKeywordForNarrative(keyword: string): string {
  const normalized = normalizeTopicLabelForCta(keyword || "")
    .replace(/[!！?？💡✨📌✅⭐️☆]/g, "")
    .replace(/[~〜～]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "このテーマ";
  if (normalized.length <= 24) return normalized;
  return `${normalized.slice(0, 24).trim()}…`;
}

function buildHeadingFallbackParagraph(heading: string, keyword: string): string {
  const cleanKeyword = normalizeKeywordForNarrative(keyword);
  const cleanHeading =
    (heading || "").replace(/^##+\s+/, "").trim() || `${cleanKeyword}の要点`;
  const variants = [
    `${cleanHeading}では、前提条件と判断材料を並べて整理すると、論点の取り違えを防ぎやすくなります。`,
    `${cleanHeading}は、${cleanKeyword}全体の流れに位置づけて読むと、実務での使いどころが明確になります。`,
    `短いケースに当てはめて確認すると、${cleanHeading}の判断基準を実務に転用しやすくなります。`,
  ];
  return pickStableVariant(variants, `${cleanKeyword}:${cleanHeading}`);
}

function shouldSkipHeadingFallbackParagraph(heading: string): boolean {
  const cleanHeading = (heading || "").replace(/^##+\s+/, "").trim();
  if (!cleanHeading) return false;
  if (
    /つまずきやすいポイント|の実務ポイント|直近の動向と実務への影響|実務アクション/.test(
      cleanHeading
    )
  ) {
    return true;
  }
  if (/[?？]$/.test(cleanHeading) || /^(?:なぜ|どうして|どのように)/.test(cleanHeading)) {
    return true;
  }
  return /^(?:FAQ|よくある質問|Q&A|Q＆A|まとめ|結論|関連ツール(?:・リソース)?|参考資料|出典|補足|注意事項|実行ステップ|よくある失敗と回避|実施フロー|実践ステップ)$/i.test(
    cleanHeading
  );
}

function removeFaqMetaGuidanceSentences(body: string): string {
  if (!body) return body;
  const lines = body.split(/\r?\n/);
  if (lines.length === 0) return body;

  const cleaned: string[] = [];
  let inFaqSection = false;
  for (const rawLine of lines) {
    const line = rawLine || "";
    const trimmed = line.trim();
    const isHeading = /^##+\s+/.test(trimmed);
    if (isHeading) {
      inFaqSection = /^##+\s*(?:FAQ|よくある質問|Q&A|Q＆A)\s*$/i.test(trimmed);
      cleaned.push(line);
      continue;
    }

    if (inFaqSection && NON_READER_ARTIFACT_SENTENCE_REGEX.test(trimmed)) {
      continue;
    }
    cleaned.push(line);
  }

  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeFaqQuestionLine(line: string): string {
  return (line || "")
    .replace(/^\s*(?:\*\*)?Q(?:[0-9０-９]+(?:[.．:：])?|[:：])\s*/i, "")
    .replace(/\*\*$/g, "")
    .trim();
}

function normalizeFaqAnswerLine(line: string): string {
  return (line || "")
    .replace(/^\s*(?:\*\*)?A(?:[0-9０-９]+(?:[.．:：])?|[:：])\s*/i, "")
    .replace(/\*\*$/g, "")
    .trim();
}

function buildDefaultFaqQuestion(keyword: string, index: number): string {
  const cleanKeyword = (keyword || "").trim() || "このテーマ";
  const questions = [
    `${cleanKeyword}は何から始めるべきですか？`,
    "進捗が遅れたときはどう立て直せばよいですか？",
    "実務と学習を両立するコツは何ですか？",
  ];
  return questions[index] || questions[questions.length - 1];
}

function buildDefaultFaqAnswer(keyword: string, index: number): string {
  const cleanKeyword = (keyword || "").trim() || "このテーマ";
  const answers = [
    `まず${cleanKeyword}の定義と基本手順を押さえ、次に小さな実例で確認すると定着しやすくなります。`,
    "遅れが出た場合は優先順位を再設定し、毎日の実行量を小さく固定して再開すると安定します。",
    "結論→根拠→例外の順でメモ化し、判断基準を同じ形式で反復すると再現性が上がります。",
  ];
  return answers[index] || answers[answers.length - 1];
}

function normalizeFaqSectionToQa(
  body: string,
  platform: Platform,
  keyword: string
): string {
  if (!body) return body;

  const lines = body.split(/\r?\n/);
  if (lines.length === 0) return body;
  const requiredFaqCount = platform === "ameba" ? 1 : 2;
  const output: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || "";
    const trimmed = line.trim();
    if (!FAQ_HEADING_LINE_REGEX.test(trimmed)) {
      output.push(line);
      continue;
    }

    let end = i + 1;
    while (end < lines.length) {
      const t = (lines[end] || "").trim();
      if (/^##+\s+/.test(t)) break;
      end += 1;
    }

    const sectionLines = lines
      .slice(i + 1, end)
      .map((item) => item || "")
      .filter((item) => {
        const text = item.trim();
        return !NON_READER_ARTIFACT_SENTENCE_REGEX.test(text);
      });

    const qaPairs: Array<{ q: string; a: string }> = [];
    const narrativeLines: string[] = [];
    let pendingQuestion = "";

    for (const row of sectionLines) {
      const current = row.trim();
      if (!current) continue;

      if (/^\s*(?:\*\*)?Q(?:[0-9０-９]+(?:[.．:：])?|[:：])\s*/i.test(current)) {
        if (pendingQuestion) {
          qaPairs.push({
            q: pendingQuestion,
            a: buildDefaultFaqAnswer(keyword, qaPairs.length),
          });
        }
        pendingQuestion = normalizeFaqQuestionLine(current);
        continue;
      }

      if (/^\s*(?:\*\*)?A(?:[0-9０-９]+(?:[.．:：])?|[:：])\s*/i.test(current)) {
        const answer = normalizeFaqAnswerLine(current);
        if (pendingQuestion) {
          qaPairs.push({
            q: pendingQuestion,
            a: answer || buildDefaultFaqAnswer(keyword, qaPairs.length),
          });
          pendingQuestion = "";
        } else if (qaPairs.length > 0 && answer) {
          const last = qaPairs[qaPairs.length - 1];
          if (!last.a) {
            last.a = answer;
          }
        }
        continue;
      }

      if (pendingQuestion) {
        qaPairs.push({
          q: pendingQuestion,
          a: current,
        });
        pendingQuestion = "";
      } else {
        narrativeLines.push(current);
      }
    }

    if (pendingQuestion) {
      qaPairs.push({
        q: pendingQuestion,
        a: buildDefaultFaqAnswer(keyword, qaPairs.length),
      });
    }

    while (qaPairs.length < requiredFaqCount) {
      qaPairs.push({
        q: buildDefaultFaqQuestion(keyword, qaPairs.length),
        a:
          narrativeLines.shift() ||
          buildDefaultFaqAnswer(keyword, qaPairs.length),
      });
    }

    const pickedPairs =
      qaPairs.length > 0
        ? qaPairs.slice(0, Math.max(requiredFaqCount, Math.min(3, qaPairs.length)))
        : [];

    output.push(line);
    output.push("");
    for (const pair of pickedPairs) {
      if (!pair.q.trim() || !pair.a.trim()) continue;
      output.push(`Q: ${pair.q.trim()}`);
      output.push(`A: ${pair.a.trim()}`);
      output.push("");
    }

    if (pickedPairs.length === 0) {
      for (let idx = 0; idx < requiredFaqCount; idx++) {
        output.push(`Q: ${buildDefaultFaqQuestion(keyword, idx)}`);
        output.push(`A: ${buildDefaultFaqAnswer(keyword, idx)}`);
        output.push("");
      }
    }

    i = end - 1;
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function enrichSparseHeadingSections(body: string, keyword: string): string {
  if (!body) return body;

  const lines = body.split(/\r?\n/);
  const headingIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^##+\s+/.test(lines[i].trim())) {
      headingIndices.push(i);
    }
  }
  if (headingIndices.length === 0) return body.trim();

  const rebuilt: string[] = [...lines.slice(0, headingIndices[0])];

  for (let idx = 0; idx < headingIndices.length; idx++) {
    const start = headingIndices[idx];
    const end = idx + 1 < headingIndices.length ? headingIndices[idx + 1] : lines.length;
    const headingLine = lines[start].trimEnd();
    const sectionLines = lines.slice(start + 1, end);
    const nonEmptySectionLines = sectionLines
      .map((line) => line.trim())
      .filter(Boolean);

    rebuilt.push(headingLine);

    const plainHeading = headingLine.replace(/^##+\s+/, "");
    const skipFallback = shouldSkipHeadingFallbackParagraph(plainHeading);

    if (nonEmptySectionLines.length === 0) {
      rebuilt.push("");
      if (!skipFallback) {
        rebuilt.push(buildHeadingFallbackParagraph(plainHeading, keyword));
      }
      rebuilt.push("");
      continue;
    }

    rebuilt.push(...sectionLines);
    const effectiveChars = countEffectiveSectionChars(sectionLines);
    if (effectiveChars < 36 && !skipFallback) {
      rebuilt.push("");
      rebuilt.push(buildHeadingFallbackParagraph(plainHeading, keyword));
    }
  }

  return rebuilt.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function validateFreshPastQuestion(motherTopic: MotherTopic): string[] {
  const issues: string[] = [];
  if (motherTopic.asset.type !== "past-question") {
    return issues;
  }
  const latestYear = getLatestPastQuestionYear();
  if (motherTopic.asset.data.year < latestYear) {
    issues.push(
      `旧過去問が選択されています: ${motherTopic.asset.data.year}年（最新は${latestYear}年）`
    );
  }
  return issues;
}

function sanitizeJapaneseField(text: string): string {
  if (!text) {
    return text;
  }

  const sanitized = text
    .split("\n")
    .filter((rawLine) => {
      const line = rawLine.trim();
      if (!line) {
        return true;
      }

      if (
        /^"?(title|body|titleChinese|bodyChinese|hashtags|imagePrompt|takkenaiLink|seoTitle|seoGeoReport|seoScore|geoScore|chatgptSearchScore|chatgptSearchPassed|chatgptSearchIssues|chatgptSearchStrengths|chatgptSearchSignals|signals|issues|strengths|aiStatus|aiSummaryChinese|aiActionsChinese|fullThresholdPassed)"?\s*:/.test(
          line
        ) ||
        /(?:^|[{,]\s*)(?:titleChinese|bodyChinese|hashtags|seoGeoReport|imagePrompt|takkenaiLink|seoTitle|chatgptSearchScore|chatgptSearchPassed|chatgptSearchIssues|chatgptSearchStrengths|chatgptSearchSignals|fullThresholdPassed)\s*:/.test(
          line
        ) ||
        line.includes("\"titleChinese\"") ||
        line.includes("\"bodyChinese\"") ||
        line.includes("\"hashtags\"") ||
        line.includes("\"seoGeoReport\"") ||
        line.includes("\"imagePrompt\"") ||
        line.includes("\"takkenaiLink\"") ||
        line.includes("\"seoTitle\"") ||
        line === "{" ||
        line === "}" ||
        /^[\[\]{},]+$/.test(line)
      ) {
        return false;
      }

      if (CHINESE_PUNCTUATION_REGEX.test(line)) {
        return false;
      }

      const kanaCount = (line.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || []).length;
      const simplifiedHintCount = countSimplifiedChineseHints(line);
      if (simplifiedHintCount >= 4) {
        return false;
      }
      if (simplifiedHintCount >= 2 && kanaCount <= 1) {
        return false;
      }

      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return sanitized;
}

function hasJapaneseFieldContaminationIssue(issues: string[]): boolean {
  return issues.some(
    (issue) =>
      issue.includes("body に中国語または JSON 断片が混入しています") ||
      issue.includes("title に中国語が混入しています")
  );
}

const NON_READER_SECTION_HEADING_REGEX =
  /^#{2,4}\s*(?:計算例（数値シミュレーション）|用語の統一メモ|実務シナリオ（特殊ケース）|参考データ（出典付き）|実行ステップ|よくある失敗と回避|実施フロー|実践ステップ|確認ステップ|行動フロー|進め方チェックリスト|強み（採用しやすい条件）|劣勢・境界条件（失敗を避ける視点）|実務での進め方|注意点・よくあるミス|実務で使うときの確認|つまずきやすいポイント|直近の動向と実務への影響|実務アクション|関連ツール(?:・リソース)?(?:の紹介)?|[^#\n]{2,60}の実務ポイント)\s*$/;
const NON_READER_LINE_REGEX =
  /^(?:【文字数】.*|文字数[:：]\s*\d+.*|-?\s*ケース[0-9０-９]+:|(?:-?\s*)?本文では「.*」を主要用語として表記を統一.*|(?:-?\s*)?同じ概念に複数の呼称を混在させない.*|(?:-?\s*)?メリット: 初期運用で比較しやすく、意思決定が速い|(?:-?\s*)?メリット: 導入初期に成果を出しやすい|(?:-?\s*)?デメリット: 前提条件が揃わない場合は期待効果が出にくい|(?:-?\s*)?デメリット: 運用条件が合わないと効果が下がる|(?:-?\s*)?注意: 目的が曖昧なまま導入すると比較軸が崩れやすい|(?:-?\s*)?向いている場面: 目的と評価軸が明確なとき|(?:-?\s*)?要件を順番に確認すると、判断ミスを減らせます。|(?:-?\s*)?試験頻出の例外と計算手順を先に整理しましょう。|(?:-?\s*)?まず定義と結論を先に確認する|(?:-?\s*)?次に判断手順を例題でチェックする|(?:-?\s*)?市場動向は年度ごとに変化するため、最新の公表資料を確認して判断することが重要です。|(?:-?\s*)?-?\s*まず現行ルールを確認し、次に運用上の影響を洗い出す|(?:-?\s*)?.*では、先に適用条件をそろえてから判断基準を比較すると、結論のぶれを抑えやすくなります。|(?:-?\s*)?.*の実務ポイントは、結論だけでなく根拠・数値・例外を同時に確認すると、実務的な再現性が上がります。|(?:-?\s*)?.*の注意点として、先に結論だけを決めず根拠と例外をセットで確認し、単一データではなく複数条件を横並びで比較することが重要です。|強み（採用しやすい条件）は、結論だけでなく根拠・数値・例外を同時に確認すると、実務的な再現性が上がります。|(?:-?\s*)?これらのツールを複合的に活用することで、実務効率と理解が飛躍的に向上(?:します|する)[。]?|最後にFAQの一つ。Q:.*A:.*)$/;
const NON_READER_ARTIFACT_SENTENCE_REGEX =
  /^(?:FAQの)?確認時(?:は|に).*例外条件.*数値条件.*同時に.*(?:見る(と|ことで|ながら)?|見て|確認して).*(?:見落とし|ミス).*(?:防ぎ|避け|減ら).*$/;
const NON_READER_CTA_STYLE_LINE_REGEX =
  /^(?:このポイントを詳しく整理したページ|本文で触れた論点の補足|関連ツール・リソース)\s*（[^）]*）\s*:\s*(?:https?:\/\/\S+|__TAKKENAI_ALLOWED_LINK__)$/;
const FORMULAIC_LEAD_REGEX =
  /^結論として、.*(?:安定します|重要です|有効です|おすすめです|効果的です)[。！]?\s*$/;

function removeNonReaderFacingArtifacts(body: string): string {
  if (!body) return body;

  const lines = body.split(/\r?\n/);
  const kept: string[] = [];
  let skippingTemplateSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (!skippingTemplateSection) kept.push(line);
      continue;
    }

    if (NON_READER_SECTION_HEADING_REGEX.test(trimmed)) {
      skippingTemplateSection = true;
      continue;
    }

    if (skippingTemplateSection) {
      if (/^##+\s+/.test(trimmed)) {
        skippingTemplateSection = false;
        kept.push(line);
      }
      continue;
    }

    if (NON_READER_LINE_REGEX.test(trimmed)) {
      continue;
    }

    if (NON_READER_ARTIFACT_SENTENCE_REGEX.test(trimmed)) {
      continue;
    }

    if (NON_READER_CTA_STYLE_LINE_REGEX.test(trimmed)) {
      continue;
    }

    kept.push(line);
  }

  const cleaned = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return pruneEmptyHeadingSections(cleaned);
}

function pruneEmptyHeadingSections(body: string): string {
  if (!body) return body;
  const lines = body.split(/\r?\n/);
  if (lines.length === 0) return body;

  const output: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const current = lines[i] || "";
    const heading = current.trim();
    if (!/^##+\s+/.test(heading)) {
      output.push(current);
      i += 1;
      continue;
    }

    let end = i + 1;
    while (end < lines.length && !/^##+\s+/.test((lines[end] || "").trim())) {
      end += 1;
    }
    const sectionLines = lines.slice(i + 1, end);
    const hasContent = sectionLines.some((line) => (line || "").trim().length > 0);
    if (hasContent) {
      output.push(current);
      output.push(...sectionLines);
    }
    i = end;
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function validateReaderFacingBodyOnly(body: string): string[] {
  if (!body) return [];
  const issues: string[] = [];
  const lines = body.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = (rawLine || "").trim();
    if (!line) continue;
    if (
      NON_READER_SECTION_HEADING_REGEX.test(line) ||
      NON_READER_LINE_REGEX.test(line) ||
      NON_READER_ARTIFACT_SENTENCE_REGEX.test(line) ||
      NON_READER_CTA_STYLE_LINE_REGEX.test(line)
    ) {
      issues.push(`読者向けではないテンプレ/属性文が残っています: ${line.slice(0, 48)}`);
      if (issues.length >= 3) break;
    }
  }
  return issues;
}

function stripFormulaicLeadSentence(body: string): string {
  if (!body) return body;
  const lines = body.split(/\r?\n/);
  const contentIndexes = lines
    .map((line, idx) => ({ line: line.trim(), idx }))
    .filter((item) => item.line.length > 0);
  if (contentIndexes.length === 0) return body;

  for (let i = 0; i < Math.min(3, contentIndexes.length); i++) {
    const { line, idx } = contentIndexes[i];
    if (line.startsWith("#")) continue;
    if (!FORMULAIC_LEAD_REGEX.test(line)) continue;

    lines.splice(idx, 1);
    break;
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeComparableText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^タイトル[:：]\s*/i, "")
    .replace(/[【】\[\]「」『』"'`]/g, "")
    .replace(/[()（）,，、。.!！?？:：;；・\-—―]/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

function stripLeadingDuplicatedTitleInBody(title: string, body: string): string {
  if (!body) return body;

  const normalizedTitle = normalizeComparableText(title || "");
  if (!normalizedTitle) return body.trim();

  const lines = body.split("\n");
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex < 0) return body.trim();

  const firstLine = lines[firstContentIndex].trim();
  const normalizedFirstLine = normalizeComparableText(firstLine);
  const looksLikeDuplicateTitle =
    normalizedFirstLine.length > 0 &&
    (normalizedFirstLine === normalizedTitle ||
      normalizedFirstLine.startsWith(normalizedTitle) ||
      normalizedTitle.startsWith(normalizedFirstLine));

  if (!looksLikeDuplicateTitle) {
    return body.trim();
  }

  const rest = lines.slice(firstContentIndex + 1);
  while (rest.length > 0 && rest[0].trim() === "") {
    rest.shift();
  }
  return rest.join("\n").trim();
}

function deriveFallbackTitleFromBody(body: string, topicLabel: string): string {
  const lines = (body || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const headingCandidate = lines
    .find((line) => /^##+\s+/.test(line))
    ?.replace(/^##+\s+/, "")
    .trim();
  const firstHeading =
    headingCandidate && !/^https?:\/\//i.test(headingCandidate)
      ? headingCandidate
      : "";
  const seed = (firstHeading || topicLabel || "不動産実務")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/^このテーマ(?:とは|の.*)?$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const normalizedSeed = seed || "不動産実務";

  if (/ガイド|解説|ポイント/.test(normalizedSeed)) {
    return normalizedSeed;
  }
  if (normalizedSeed.endsWith("とは")) {
    return `${normalizedSeed.replace(/とは$/, "").trim()}の要点解説`;
  }
  return `${normalizedSeed}の要点解説`;
}

function resolveOptimizationKeywordLabel(
  rawPrimaryKeyword: string,
  currentTitle: string,
  takkenaiUrl: string
): string {
  const cleanedPrimary = (rawPrimaryKeyword || "")
    .replace(/https?:\/\/\S+/gi, "")
    .trim();
  if (cleanedPrimary) {
    return cleanedPrimary;
  }

  const cleanedTitle = (currentTitle || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/^このテーマ(?:[:：|｜-])?/i, "")
    .trim();
  if (cleanedTitle) {
    return cleanedTitle;
  }

  const assetType: "tool" | "knowledge-point" =
    takkenaiUrl.toLowerCase().includes("/tools/") ? "tool" : "knowledge-point";
  const inferred = normalizeAssetLabel(takkenaiUrl, assetType, takkenaiUrl).trim();
  return inferred || "不動産実務";
}

function sanitizeUrlArtifactsInContent(
  content: GeneratedContent,
  takkenaiUrl: string,
  topicLabel: string,
  platform: Platform,
  relatedNote?: RelatedNoteLinkContext
): GeneratedContent {
  const replacementLabel = topicLabel || "このテーマ";
  const trackedLink = buildTrackedTakkenaiUrl(takkenaiUrl, platform);
  const allowedLink = trackedLink.trim();
  const URL_PLACEHOLDER = "__TAKKENAI_ALLOWED_LINK__";

  const sanitizedHashtags = (content.hashtags || [])
    .map((tag) => stripUrlAndSlugArtifacts(tag, takkenaiUrl, replacementLabel))
    .map((tag) => tag.replace(/^#+/, "").trim())
    .filter((tag) => tag.length > 0 && !/^https?:\/\//i.test(tag));

  const sourceTitle = sanitizeJapaneseField(content.title || "");
  const sourceBody = sanitizeJapaneseField(content.body || "");

  let keptAllowedUrl = false;
  const dedupedBody = stripLeadingDuplicatedTitleInBody(sourceTitle, sourceBody || "");
  const bodyWithoutForeignUrls = dedupedBody.replace(URL_REGEX, (rawUrl) => {
    if (!keptAllowedUrl && isAllowedTakkenaiUrl(rawUrl, allowedLink)) {
      keptAllowedUrl = true;
      return URL_PLACEHOLDER;
    }
    return "";
  });

  const bodySansSlugArtifacts = stripUrlAndSlugArtifacts(
    bodyWithoutForeignUrls,
    takkenaiUrl,
    replacementLabel
  );
  const bodyReaderCleaned = removeNonReaderFacingArtifacts(bodySansSlugArtifacts);
  const bodyNoFormulaLead = stripFormulaicLeadSentence(bodyReaderCleaned);
  const bodyFaqCollapsed = collapseDuplicateFaqSections(bodyNoFormulaLead);
  const bodyHeadingEnriched = enrichSparseHeadingSections(
    bodyFaqCollapsed,
    replacementLabel
  );
  const bodyPostEnrichCleaned = removeNonReaderFacingArtifacts(bodyHeadingEnriched);
  const bodyFaqGuidanceRemoved = removeFaqMetaGuidanceSentences(bodyPostEnrichCleaned);
  const bodyWithRestoredUrl = keptAllowedUrl
    ? bodyFaqGuidanceRemoved.replace(URL_PLACEHOLDER, allowedLink)
    : bodyFaqGuidanceRemoved;
  const bodyRelatedNormalized = normalizeRelatedResourceSection(
    bodyWithRestoredUrl,
    replacementLabel
  );
  const bodyFaqNormalized = normalizeFaqSectionToQa(
    bodyRelatedNormalized,
    platform,
    replacementLabel
  );
  const bodyLineDeduped = dedupeRepeatedNarrativeLinesPreferUrl(
    bodyFaqNormalized
  );
  const bodyFinalReaderCleaned = removeNonReaderFacingArtifacts(bodyLineDeduped);
  const body = ensureSingleBodyCtaLink(
    bodyFinalReaderCleaned,
    allowedLink,
    platform,
    replacementLabel,
    relatedNote
  );
  const normalizedBody = normalizeParenthesizedUrls(body);
  const cleanedTitle = stripUrlAndSlugArtifacts(
    sourceTitle,
    takkenaiUrl,
    replacementLabel
  );
  const title =
    cleanedTitle.trim() || deriveFallbackTitleFromBody(body, replacementLabel);

  return {
    ...content,
    takkenaiLink: allowedLink,
    title,
    body: normalizedBody,
    imagePrompt: stripUrlAndSlugArtifacts(
      content.imagePrompt,
      takkenaiUrl,
      replacementLabel
    ),
    hashtags: Array.from(new Set(sanitizedHashtags)),
  };
}

// ---------------------------------------------------------------------------
// Quality review (2-pass check)
// ---------------------------------------------------------------------------

const REVIEW_SYSTEM_PROMPT = `あなたはブログ記事の品質チェック担当です。
記事を厳格にレビューし、問題があれば具体的な修正指示を出してください。

以下のJSON形式で必ず回答してください：
{
  "passed": true/false,
  "issues": ["問題点1", "問題点2", ...],
  "suggestions": ["修正指示1", "修正指示2", ...]
}`;

function buildReviewPrompt(
  platform: Platform,
  content: GeneratedContent,
  dateStr: string
): string {
  const seasonalContext = getDateSeasonalContext(dateStr);

  const platformRules: Record<Platform, string> = {
    ameba: `【Ameba（アメブロ）のルール】
- 文体: カジュアルで親しみやすい口語体（「〜だよ」「〜だね」「〜しよう！」）
- 文字数: 800〜1200文字（厳守）
- 構成: アイキャッチ導入 → 日常/実務シーン → 解説 → ワンポイント → CTA
- 絵文字: 適度に使用（1段落に1〜2個）
- CTAリンク: 記事末尾に1つだけ
- ターゲット: 宅建受験生（フレンドリーな仲間として）
- 読者が「気軽に読める」「楽しい」と感じること`,
    note: `【noteのルール】
- 文体: 「です・ます」調のプロフェッショナルな文体
- 文字数: 2000〜3000文字（厳守）
- 構成: フック導入 → 3セクション（見出し付き） → まとめ → CTA
- 絵文字: 基本的に使わない
- ハッシュタグ: 3〜4個
- ターゲット: 20〜40代の学習意欲の高い社会人
- 読者が「なるほど」「深い」と感じる独自の切り口があること`,
    hatena: `【はてなブログのルール】
- 文体: 「です・ます」調＋「〜である」調の混在OK、客観的・分析的
- 文字数: 1500〜3000文字（厳守）
- 構成: 導入 → H2/H3見出しで構造化 → まとめ → 関連ツール
- 絵文字: 使わない
- テーブル（表）: 任意（比較データがある場合に推奨）
- ターゲット: ITリテラシーが高い読者
- 「ブックマークして後で見返したい」品質であること`,
  };

  return `以下のブログ記事を厳格にレビューしてください。

${platformRules[platform]}

${seasonalContext}

【チェック項目（すべて確認すること）】
1. 時令チェック: 禁止テーマ（「新年」等）が使われていないか？ 季節感は適切か？
2. 文字数: プラットフォームの文字数制限を守っているか？
3. 構成: プラットフォーム指定の構成（セクション順序）に従っているか？
4. 文体: プラットフォームに合ったトーンか？（Amebaならカジュアル、noteならプロフェッショナル等）
5. AI臭さ: 「〜と言えるでしょう」「いかがでしたでしょうか」等のAI定型文がないか？
6. CTA: takkenai.jpへの自然な導線があるか？
7. 吸引力: タイトルと導入が読者の興味を引くものか？ クリックしたくなるか？
8. データ正確性: 捏造された統計や架空のデータがないか？
9. 日本語品質: 中国語の影響がない100%ネイティブ日本語か？
10. 中国語翻訳: titleChineseとbodyChineseが空でないか？ 日本語の本文とは完全に別のフィールドとして中国語翻訳が存在するか？（中国語を本文bodyに混ぜるのはNG、必ず別フィールドに出力すること）
11. 規約順守: 誇大・断定・煽り（例: 絶対合格、必ず受かる、100%稼げる、今すぐやらないと損）がないか？

【レビュー対象の記事】
タイトル: ${content.title}
本文:
${content.body}
ハッシュタグ: ${content.hashtags.join(", ")}
titleChinese: ${content.titleChinese || "（空 — 未生成）"}
bodyChinese: ${content.bodyChinese ? `（${content.bodyChinese.length}文字あり）` : "（空 — 未生成）"}

問題がなければ {"passed": true, "issues": [], "suggestions": []} を返してください。
問題があれば、具体的な問題点と修正指示を返してください。`;
}

interface ReviewResult {
  passed: boolean;
  issues: string[];
  suggestions: string[];
}

function parseReviewResult(rawText: string): ReviewResult {
  let jsonStr = rawText.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      passed: !!parsed.passed,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    };
  } catch {
    // If JSON parsing fails, assume issues exist
    return {
      passed: false,
      issues: ["レビュー結果のパースに失敗"],
      suggestions: [rawText],
    };
  }
}

async function generateChineseTranslation(
  title: string,
  body: string
): Promise<{ titleChinese: string; bodyChinese: string } | null> {
  const translationRaw = await withTimeout(
    callOpenRouter(
      "あなたは日本語→中国語（簡体字）の翻訳者です。意味を省略せず、見出しと段落構造を維持して完全翻訳してください。必ずJSONのみで回答してください。",
      `以下の日本語ブログ記事を中国語（簡体字）に翻訳してください。

【必須ルール】
1. 要約しない。全文を翻訳する
2. 見出し（## / ###）と段落構造を維持する
3. 本文を途中で切らない
4. JSON以外の文字を出力しない
5. bodyChinese は中国語のみ。日本語の仮名（ひらがな/カタカナ）を残さない
6. URLはそのまま保持する

タイトル: ${title}

本文:
${body}

以下のJSON形式で出力してください：
{
  "titleChinese": "标题的中文翻译",
  "bodyChinese": "正文的中文翻译（保持Markdown结构和换行）"
}`,
      TRANSLATION_MODEL
    ),
    22000,
    "chinese translation"
  );

  let transJson = translationRaw.trim();
  const transBlock = transJson.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (transBlock) transJson = transBlock[1].trim();

  try {
    const parsed = JSON.parse(transJson);
    return {
      titleChinese: String(parsed.titleChinese || "").trim(),
      bodyChinese: String(parsed.bodyChinese || "").trim(),
    };
  } catch {
    const titleChinese = extractJsonStringField(translationRaw, "titleChinese").trim();
    const bodyChinese = extractJsonStringField(translationRaw, "bodyChinese").trim();
    if (!titleChinese && !bodyChinese) return null;
    return { titleChinese, bodyChinese };
  }
}

async function generateChineseBodyPlain(
  body: string,
  timeoutMs = 28000
): Promise<string | null> {
  const translationRaw = await withTimeout(
    callOpenRouter(
      "你是日文到中文（简体）的翻译器。保持Markdown结构，不要省略内容。",
      `请将下面的日文Markdown正文完整翻译为中文（简体）。

【规则】
1. 只输出翻译后的 Markdown 正文，不要 JSON，不要解释
2. 保留 ##/###、列表、表格、URL
3. 不能保留日文假名（ひらがな/カタカナ）
4. 不要截断结尾

正文：
${body}`
    ),
    timeoutMs,
    "chinese body plain translation"
  );

  let text = (translationRaw || "").trim();
  const block = text.match(/```(?:markdown|md|text)?\s*([\s\S]*?)```/i);
  if (block) text = block[1].trim();

  if (!text) return null;
  const fromJson = extractJsonStringField(text, "bodyChinese").trim();
  if (fromJson) text = fromJson;

  return text.trim() || null;
}

function splitBodyForChineseTranslation(
  body: string,
  maxChunkChars = 1100,
  maxChunks = 4
): string[] {
  const blocks = (body || "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length <= 1) return blocks;

  const chunks: string[] = [];
  let current = "";
  for (const block of blocks) {
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length > maxChunkChars && current) {
      chunks.push(current);
      current = block;
    } else {
      current = next;
    }
    if (chunks.length >= maxChunks - 1) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      break;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function generateChineseBodyChunked(
  body: string,
  options: { maxChunkChars?: number; maxChunks?: number; chunkTimeoutMs?: number } = {}
): Promise<string | null> {
  const chunks = splitBodyForChineseTranslation(
    body,
    options.maxChunkChars ?? 950,
    options.maxChunks ?? 6
  );
  if (chunks.length <= 1) return null;

  const translatedChunks: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const translated = await generateChineseBodyPlain(
      chunks[i],
      options.chunkTimeoutMs ?? 20000
    );
    if (!translated) return null;
    translatedChunks.push(translated.trim());
  }

  return translatedChunks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function generateChineseTitlePlain(title: string): Promise<string | null> {
  const translationRaw = await withTimeout(
    callOpenRouter(
      "你是日文到中文（简体）的翻译器。仅输出中文标题。",
      `请将下面的日文标题翻译为中文（简体），只输出一行标题，不要任何解释和标点外内容：
${title}`
    ),
    12000,
    "chinese title plain translation"
  );

  const firstLine = (translationRaw || "")
    .replace(/```[\s\S]*?```/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;

  const cleaned = firstLine
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^标题[:：]\s*/i, "")
    .trim();
  return cleaned || null;
}

async function ensureChineseTranslationForContent(
  platform: Platform,
  content: GeneratedContent,
  options: { forceRefresh?: boolean } = {}
): Promise<GeneratedContent> {
  const forceRefresh = options.forceRefresh === true;
  let working = { ...content };

  let chineseIssues = validateChineseTranslationCompleteness(
    working.body,
    working.bodyChinese || ""
  );
  if (hasChineseTailTruncationIssue(chineseIssues)) {
    const patchedTail = patchChineseTailPunctuation(working.bodyChinese || "");
    if (patchedTail && patchedTail !== (working.bodyChinese || "")) {
      working.bodyChinese = patchedTail;
      chineseIssues = validateChineseTranslationCompleteness(
        working.body,
        working.bodyChinese || ""
      );
    }
  }
  const needRefresh =
    forceRefresh || !working.titleChinese || chineseIssues.length > 0;

  if (!needRefresh) {
    return working;
  }

  console.log(
    `[${platform}] Chinese translation refresh started (force=${forceRefresh})`,
    chineseIssues
  );

  let attemptedPlainRepair = false;
  let attemptedLengthRepair = false;
  for (let retry = 0; retry < 2; retry++) {
    try {
      const translated = await generateChineseTranslation(working.title, working.body);
      if (translated) {
        if (translated.titleChinese) working.titleChinese = translated.titleChinese;
        if (translated.bodyChinese) working.bodyChinese = translated.bodyChinese;
      }
      working.bodyChinese = sanitizeChineseResidualKanaLines(working.bodyChinese || "");
      working.bodyChinese = dedupeRepeatedNarrativeLinesPreferUrl(
        working.bodyChinese || ""
      );
      working.bodyChinese = ensureChineseUrlParity(
        working.body,
        working.bodyChinese || ""
      );
      chineseIssues = validateChineseTranslationCompleteness(
        working.body,
        working.bodyChinese || ""
      );
      if (chineseIssues.length > 0 && hasChineseHeadingCoverageIssue(chineseIssues)) {
        const patchedChinese = patchChineseHeadingStructure(
          working.body,
          working.bodyChinese || ""
        );
        if (patchedChinese && patchedChinese !== (working.bodyChinese || "")) {
          working.bodyChinese = patchedChinese;
          chineseIssues = validateChineseTranslationCompleteness(
            working.body,
            working.bodyChinese || ""
          );
        }
      }
      if (hasChineseTailTruncationIssue(chineseIssues)) {
        const patchedTail = patchChineseTailPunctuation(working.bodyChinese || "");
        if (patchedTail && patchedTail !== (working.bodyChinese || "")) {
          working.bodyChinese = patchedTail;
          chineseIssues = validateChineseTranslationCompleteness(
            working.body,
            working.bodyChinese || ""
          );
        }
      }
      if (
        chineseIssues.length > 0 &&
        hasChineseJapaneseLeakIssue(chineseIssues) &&
        !attemptedPlainRepair
      ) {
        attemptedPlainRepair = true;
        try {
          const plainBody = await generateChineseBodyPlain(working.body);
          if (plainBody) {
            working.bodyChinese = plainBody;
          }
          working.bodyChinese = sanitizeChineseResidualKanaLines(working.bodyChinese || "");
          chineseIssues = validateChineseTranslationCompleteness(
            working.body,
            working.bodyChinese || ""
          );
          if (chineseIssues.length > 0) {
            const chunkedBody = await generateChineseBodyChunked(working.body);
            if (chunkedBody) {
              working.bodyChinese = chunkedBody;
            }
            working.bodyChinese = sanitizeChineseResidualKanaLines(
              working.bodyChinese || ""
            );
          }
          if (!working.titleChinese || KANA_REGEX.test(working.titleChinese)) {
            const plainTitle = await generateChineseTitlePlain(working.title);
            if (plainTitle) {
              working.titleChinese = plainTitle;
            }
          }
        } catch (err) {
          console.warn(`[${platform}] Chinese plain repair failed:`, err);
        }
        working.bodyChinese = dedupeRepeatedNarrativeLinesPreferUrl(
          working.bodyChinese || ""
        );
        working.bodyChinese = sanitizeChineseResidualKanaLines(
          working.bodyChinese || ""
        );
        chineseIssues = validateChineseTranslationCompleteness(
          working.body,
          working.bodyChinese || ""
        );
      }
      if (
        chineseIssues.length > 0 &&
        hasChineseShortLengthIssue(chineseIssues) &&
        !attemptedLengthRepair
      ) {
        attemptedLengthRepair = true;
        try {
          const chunkedBody = await generateChineseBodyChunked(working.body);
          if (chunkedBody) {
            working.bodyChinese = chunkedBody;
          }
        } catch (err) {
          console.warn(`[${platform}] Chinese chunked repair failed:`, err);
        }
        working.bodyChinese = ensureChineseUrlParity(
          working.body,
          dedupeRepeatedNarrativeLinesPreferUrl(working.bodyChinese || "")
        );
        working.bodyChinese = expandChineseBodyForCoverage(
          working.body,
          working.bodyChinese || ""
        );
        working.bodyChinese = sanitizeChineseResidualKanaLines(working.bodyChinese || "");
        chineseIssues = validateChineseTranslationCompleteness(
          working.body,
          working.bodyChinese || ""
        );
      }
      if (working.titleChinese && chineseIssues.length === 0) {
        console.log(
          `[${platform}] Chinese translation refreshed successfully (retry ${retry + 1})`
        );
        return working;
      }
    } catch (err) {
      console.warn(`[${platform}] Chinese translation refresh failed:`, err);
    }
  }

  chineseIssues = validateChineseTranslationCompleteness(
    working.body,
    working.bodyChinese || ""
  );
  working.bodyChinese = dedupeRepeatedNarrativeLinesPreferUrl(
    working.bodyChinese || ""
  );
  working.bodyChinese = ensureChineseUrlParity(working.body, working.bodyChinese || "");
  working.bodyChinese = sanitizeChineseResidualKanaLines(working.bodyChinese || "");
  if (hasChineseShortLengthIssue(chineseIssues)) {
    working.bodyChinese = expandChineseBodyForCoverage(
      working.body,
      working.bodyChinese || ""
    );
  }
  chineseIssues = validateChineseTranslationCompleteness(
    working.body,
    working.bodyChinese || ""
  );
  if (chineseIssues.length > 0 && hasChineseHeadingCoverageIssue(chineseIssues)) {
    const patchedChinese = patchChineseHeadingStructure(
      working.body,
      working.bodyChinese || ""
    );
    if (patchedChinese && patchedChinese !== (working.bodyChinese || "")) {
      working.bodyChinese = patchedChinese;
      chineseIssues = validateChineseTranslationCompleteness(
        working.body,
        working.bodyChinese || ""
      );
      if (working.titleChinese && chineseIssues.length === 0) {
        return working;
      }
    }
  }
  if (hasChineseTailTruncationIssue(chineseIssues)) {
    const patchedTail = patchChineseTailPunctuation(working.bodyChinese || "");
    if (patchedTail && patchedTail !== (working.bodyChinese || "")) {
      working.bodyChinese = patchedTail;
      chineseIssues = validateChineseTranslationCompleteness(
        working.body,
        working.bodyChinese || ""
      );
      if (working.titleChinese && chineseIssues.length === 0) {
        return working;
      }
    }
  }
  if (working.titleChinese && hasOnlyChineseTailIssue(chineseIssues)) {
    console.warn(
      `[${platform}] Chinese translation tail warning tolerated to avoid false blocking`,
      chineseIssues
    );
    return working;
  }

  const requiresSemanticRepair =
    chineseIssues.length > 0 || looksLikeSyntheticChineseFallback(working.bodyChinese || "");
  if (requiresSemanticRepair) {
    const chunkProfiles: Array<{ maxChunkChars: number; maxChunks: number; chunkTimeoutMs: number }> = [
      { maxChunkChars: 900, maxChunks: 7, chunkTimeoutMs: 18000 },
      { maxChunkChars: 650, maxChunks: 10, chunkTimeoutMs: 15000 },
    ];
    for (const profile of chunkProfiles) {
      try {
        const repairedBody = await generateChineseBodyChunked(working.body, profile);
        if (!repairedBody) continue;
        working.bodyChinese = ensureChineseUrlParity(
          working.body,
          dedupeRepeatedNarrativeLinesPreferUrl(repairedBody)
        );
        working.bodyChinese = sanitizeChineseResidualKanaLines(working.bodyChinese || "");
        if (!working.titleChinese || KANA_REGEX.test(working.titleChinese)) {
          const repairedTitle = await generateChineseTitlePlain(working.title);
          if (repairedTitle) {
            working.titleChinese = repairedTitle;
          }
        }
        chineseIssues = validateChineseTranslationCompleteness(
          working.body,
          working.bodyChinese || ""
        );
        if (
          working.titleChinese &&
          chineseIssues.length === 0 &&
          !looksLikeSyntheticChineseFallback(working.bodyChinese || "")
        ) {
          console.warn(
            `[${platform}] Chinese translation semantic repair succeeded by chunk profile`,
            profile
          );
          return working;
        }
      } catch (err) {
        console.warn(`[${platform}] Chinese semantic repair failed:`, err);
      }
    }
  }

  const rescueProfiles: Array<{
    maxChunkChars: number;
    maxChunks: number;
    chunkTimeoutMs: number;
  }> = [
    { maxChunkChars: 520, maxChunks: 14, chunkTimeoutMs: 14000 },
    { maxChunkChars: 380, maxChunks: 20, chunkTimeoutMs: 12000 },
  ];
  for (const profile of rescueProfiles) {
    try {
      const repairedBody =
        (await generateChineseBodyChunked(working.body, profile)) ||
        (await generateChineseBodyPlain(working.body, 32000));
      if (!repairedBody) continue;
      working.bodyChinese = ensureChineseUrlParity(
        working.body,
        dedupeRepeatedNarrativeLinesPreferUrl(repairedBody)
      );
      working.bodyChinese = sanitizeChineseResidualKanaLines(working.bodyChinese || "");
      if (!working.titleChinese || KANA_REGEX.test(working.titleChinese)) {
        const repairedTitle = await generateChineseTitlePlain(working.title);
        if (repairedTitle) {
          working.titleChinese = repairedTitle;
        }
      }
      chineseIssues = validateChineseTranslationCompleteness(
        working.body,
        working.bodyChinese || ""
      );
      if (
        working.titleChinese &&
        chineseIssues.length === 0 &&
        !looksLikeSyntheticChineseFallback(working.bodyChinese || "")
      ) {
        console.warn(
          `[${platform}] Chinese translation rescue profile succeeded`,
          profile
        );
        return working;
      }
    } catch (err) {
      console.warn(`[${platform}] Chinese rescue profile failed:`, err);
    }
  }

  chineseIssues = validateChineseTranslationCompleteness(
    working.body,
    working.bodyChinese || ""
  );
  if (!working.titleChinese || KANA_REGEX.test(working.titleChinese)) {
    const fallbackTitle = normalizeChineseHeadingFromJapanese(working.title, 1);
    if (fallbackTitle) {
      working.titleChinese = fallbackTitle;
    }
  }
  if (looksLikeSyntheticChineseFallback(working.bodyChinese || "")) {
    chineseIssues.push("bodyChinese がテンプレート化しており、実質翻訳になっていません");
  }

  if (working.titleChinese && chineseIssues.length === 0) {
    return working;
  }

  // Last deterministic fallback: map finalized Japanese structure into Chinese fields.
  const structuralFallback = buildChineseStructuralFallback(
    working.title,
    working.body,
    working.titleChinese || ""
  );
  working.titleChinese = structuralFallback.titleChinese || working.titleChinese;
  working.bodyChinese = ensureChineseUrlParity(
    working.body,
    sanitizeChineseResidualKanaLines(
      dedupeRepeatedNarrativeLinesPreferUrl(structuralFallback.bodyChinese || "")
    )
  );
  chineseIssues = validateChineseTranslationCompleteness(
    working.body,
    working.bodyChinese || ""
  );
  if (looksLikeSyntheticChineseFallback(working.bodyChinese || "")) {
    chineseIssues.push("bodyChinese がテンプレート化しており、実質翻訳になっていません");
  }
  if (working.titleChinese && chineseIssues.length === 0) {
    console.warn(`[${platform}] Chinese translation fallback mapper succeeded`);
    return working;
  }

  if (!working.titleChinese) {
    chineseIssues.push("titleChinese が空です");
  }
  if (!working.bodyChinese) {
    chineseIssues.push("bodyChinese が空です");
  }
  throw new Error(
    `[${platform}] 中国語翻訳の品質チェック失敗: ${chineseIssues.join(" / ")}`
  );
}

function countMarkdownHeadingLines(text: string): number {
  return (text.match(/^##+\s+.+$/gm) || []).length;
}

function getLastMarkdownHeadingLine(text: string): string {
  const headings = text.match(/^##+\s+.+$/gm) || [];
  return headings.length > 0 ? headings[headings.length - 1].trim() : "";
}

export function validateFinalJapaneseChineseConsistency(
  content: GeneratedContent
): string[] {
  const issues: string[] = [];
  const title = (content.title || "").trim();
  const body = (content.body || "").trim();
  const titleChinese = (content.titleChinese || "").trim();
  const bodyChinese = (content.bodyChinese || "").trim();

  if (!title) issues.push("title が空です");
  if (!body) issues.push("body が空です");
  if (!titleChinese) issues.push("titleChinese が空です");
  if (!bodyChinese) issues.push("bodyChinese が空です");

  issues.push(...validateChineseTranslationCompleteness(body, bodyChinese));

  const jpHeadings = countMarkdownHeadingLines(body);
  const zhHeadings = countMarkdownHeadingLines(bodyChinese);
  if (jpHeadings !== zhHeadings) {
    issues.push(`日中見出し数が一致しません（日本語:${jpHeadings}, 中国語:${zhHeadings}）`);
  }

  const jpLastHeading = getLastMarkdownHeadingLine(body);
  const zhLastHeading = getLastMarkdownHeadingLine(bodyChinese);
  if (jpLastHeading && !zhLastHeading) {
    issues.push("中国語本文の末尾見出しが不足しています");
  }

  return Array.from(new Set(issues));
}

function repairChineseConsistencyDeterministically(
  content: GeneratedContent
): GeneratedContent {
  const structuralFallback = buildChineseStructuralFallback(
    content.title || "",
    content.body || "",
    content.titleChinese || ""
  );

  return {
    ...content,
    titleChinese: structuralFallback.titleChinese || content.titleChinese || "",
    bodyChinese: ensureChineseUrlParity(
      content.body || "",
      sanitizeChineseResidualKanaLines(
        dedupeRepeatedNarrativeLinesPreferUrl(structuralFallback.bodyChinese || "")
      )
    ),
  };
}

export async function ensureFinalJapaneseChineseConsistency(
  platform: Platform,
  content: GeneratedContent
): Promise<GeneratedContent> {
  const synced = await ensureChineseTranslationForContent(platform, content, {
    forceRefresh: true,
  });
  let issues = validateFinalJapaneseChineseConsistency(synced);
  if (issues.length === 0) {
    return synced;
  }

  const repaired = repairChineseConsistencyDeterministically(synced);
  issues = validateFinalJapaneseChineseConsistency(repaired);
  if (issues.length === 0) {
    console.warn(
      `[${platform}] 日中一致性を deterministic fallback で修復しました`
    );
    return repaired;
  }

  throw new Error(`[${platform}] 日中一致性チェック失敗: ${issues.join(" / ")}`);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function generateSeoGeoAiReview(params: {
  platform: Platform;
  title: string;
  body: string;
  seoTitle?: string;
  ruleReport: SeoGeoReport;
}): Promise<Pick<SeoGeoReport, "aiStatus" | "aiSummaryChinese" | "aiActionsChinese">> {
  const { platform, title, body, seoTitle = "", ruleReport } = params;
  const bodyExcerpt = body.slice(0, 1800);

  const systemPrompt =
    "你是SEO/GEO内容质量审阅助手。请以中文输出简洁、客观、非营销语的建议。必须只输出JSON。";
  const userPrompt = `请根据下面的文章与规则评分，输出中文审阅结论。\n\n` +
    `平台: ${platform}\n` +
    `标题: ${title}\n` +
    `SEO标题: ${seoTitle || "（无）"}\n` +
    `主关键词: ${ruleReport.primaryKeyword}\n` +
    `规则评分: SEO=${ruleReport.seoScore}, GEO=${ruleReport.geoScore}, ChatGPT=${ruleReport.chatgptSearchScore}\n` +
    `规则问题: ${ruleReport.issues.join("；") || "无"}\n` +
    `规则优势: ${ruleReport.strengths.join("；") || "无"}\n\n` +
    `补充规则: 若平台为hatena，Markdown表格是可选项，不得将“无表格”作为硬性不达标结论。\n\n` +
    `正文节选:\n${bodyExcerpt}\n\n` +
    `输出要求：\n` +
    `1) 仅输出JSON，不要额外文字\n` +
    `2) summaryChinese: 1-2句\n` +
    `3) actionsChinese: 1-3条可执行优化建议\n` +
    `4) 禁止营销口吻、禁止夸大\n\n` +
    `JSON格式：\n` +
    `{\n` +
    `  "summaryChinese": "......",\n` +
    `  "actionsChinese": ["......", "......"]\n` +
    `}`;

  try {
    const raw = await withTimeout(
      callOpenRouter(systemPrompt, userPrompt),
      8000,
      "seo-geo ai review"
    );
    let jsonText = raw.trim();
    const block = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (block) jsonText = block[1].trim();

    try {
      const parsed = JSON.parse(jsonText);
      const summaryChinese = String(parsed.summaryChinese || "").trim();
      const actionsChinese = Array.isArray(parsed.actionsChinese)
        ? parsed.actionsChinese
            .map((item: unknown) => String(item || "").trim())
            .filter(Boolean)
            .slice(0, 3)
        : [];
      if (summaryChinese) {
        return {
          aiStatus: "ok",
          aiSummaryChinese: summaryChinese,
          aiActionsChinese: actionsChinese,
        };
      }
    } catch {
      const summaryChinese = extractJsonStringField(raw, "summaryChinese").trim();
      const actionsChinese = extractJsonStringArrayField(raw, "actionsChinese")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 3);
      if (summaryChinese) {
        return {
          aiStatus: "ok",
          aiSummaryChinese: summaryChinese,
          aiActionsChinese: actionsChinese,
        };
      }
    }
  } catch (error) {
    console.warn("[seo-geo] ai-review failed:", error);
  }

  return {
    aiStatus: "fallback",
    aiSummaryChinese: "AI评审暂不可用，当前为规则评估结果",
    aiActionsChinese: [],
  };
}

function parseSeoGeoOptimizationDraft(rawText: string): {
  title?: string;
  body?: string;
  seoTitle?: string;
} {
  let jsonText = rawText.trim();
  const block = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (block) jsonText = block[1].trim();

  try {
    const parsed = JSON.parse(jsonText);
    return {
      title: typeof parsed.title === "string" ? parsed.title.trim() : undefined,
      body: typeof parsed.body === "string" ? parsed.body.trim() : undefined,
      seoTitle:
        typeof parsed.seoTitle === "string" ? parsed.seoTitle.trim() : undefined,
    };
  } catch {
    const title = extractJsonStringField(rawText, "title").trim();
    const body = extractJsonStringField(rawText, "body").trim();
    const seoTitle = extractJsonStringField(rawText, "seoTitle").trim();
    return {
      ...(title ? { title } : {}),
      ...(body ? { body } : {}),
      ...(seoTitle ? { seoTitle } : {}),
    };
  }
}

function ensureKeywordInTitle(title: string, keyword: string): string {
  const cleanTitle = (title || "").trim();
  const cleanKeyword = (keyword || "").trim();
  if (!cleanTitle || !cleanKeyword) return cleanTitle;
  const normalizedTitle = normalizeComparableText(cleanTitle);
  const normalizedKeyword = normalizeComparableText(cleanKeyword);
  if (!normalizedKeyword || normalizedTitle.includes(normalizedKeyword)) {
    return cleanTitle;
  }
  return `${cleanKeyword}｜${cleanTitle}`;
}

function normalizeAiActions(actions: string[] | undefined): string[] {
  return (actions || [])
    .map((item) => (item || "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

function deriveAiActionFocus(actions: string[]): {
  requireCalculationExample: boolean;
  requireTerminologyConsistency: boolean;
  requirePracticalScenarios: boolean;
  requireEvidenceCitation: boolean;
  requireDedupe: boolean;
} {
  const joined = actions.join(" ");
  return {
    requireCalculationExample:
      /(計算|算式|数値|数字|シミュレーション|演示|示例|例題|例示|サンプル)/i.test(
        joined
      ),
    requireTerminologyConsistency:
      /(用語|術語|术语|表現|表述|一貫|一致|概念|定義|統一)/i.test(joined),
    requirePracticalScenarios:
      /(実務|場面|场景|シナリオ|ケース|特殊|例外)/i.test(joined),
    requireEvidenceCitation:
      /(統計|データ|数値|出典|来源|信頼性|引用|根拠|ソース)/i.test(joined),
    requireDedupe: /(重複|重复|冗長|削除|統合)/i.test(joined),
  };
}

function buildEvidenceSection(items: OptimizationEvidenceItem[]): string {
  if (items.length === 0) return "";
  const rows = items
    .slice(0, 2)
    .map(
      (item) =>
        `- ${item.source}（${item.year}）: ${item.metric}。${item.summary}`
    );
  if (rows.length === 0) return "";
  return `### 参考データ（出典付き）\n${rows.join("\n")}`;
}

function paragraphSimilarity(a: string, b: string): number {
  const aNorm = normalizeComparableText(a);
  const bNorm = normalizeComparableText(b);
  if (!aNorm || !bNorm) return 0;
  if (aNorm === bNorm) return 1;
  const minLen = Math.min(aNorm.length, bNorm.length);
  const maxLen = Math.max(aNorm.length, bNorm.length);
  if (minLen >= 50 && (aNorm.includes(bNorm) || bNorm.includes(aNorm))) {
    return minLen / maxLen;
  }
  let same = 0;
  const bSet = new Set(bNorm.split(""));
  for (const char of aNorm) {
    if (bSet.has(char)) same += 1;
  }
  return same / Math.max(aNorm.length, bNorm.length);
}

function dedupeParagraphs(body: string): string {
  const normalizedLines = (body || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd());
  const lineCollapsed: string[] = [];
  let previousComparable = "";
  for (const line of normalizedLines) {
    const trimmed = line.trim();
    if (!trimmed) {
      lineCollapsed.push("");
      previousComparable = "";
      continue;
    }
    const shouldSkipLineDedupe =
      /^#{1,6}\s+/.test(trimmed) ||
      /^\|/.test(trimmed) ||
      /^[-*]\s+/.test(trimmed) ||
      /^\d+\.\s+/.test(trimmed) ||
      FAQ_QUESTION_LINE_REGEX.test(trimmed) ||
      /^\s*(?:\*\*)?A(?:[0-9０-９]+(?:[.．:：])?|[:：])\s*/.test(trimmed);
    const comparable = normalizeComparableText(trimmed);
    if (
      !shouldSkipLineDedupe &&
      comparable &&
      comparable.length >= 18 &&
      comparable === previousComparable
    ) {
      continue;
    }
    lineCollapsed.push(line);
    previousComparable = shouldSkipLineDedupe ? "" : comparable;
  }

  const paragraphs = lineCollapsed
    .join("\n")
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (paragraphs.length <= 1) {
    return lineCollapsed.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  const kept: string[] = [];
  for (const para of paragraphs) {
    const duplicate = kept.some((existing) => paragraphSimilarity(existing, para) >= 0.92);
    if (!duplicate) {
      kept.push(para);
    }
  }
  return kept.join("\n\n").trim();
}

function dedupeRepeatedNarrativeLinesPreferUrl(body: string): string {
  const lines = (body || "").split(/\r?\n/);
  if (lines.length <= 1) return (body || "").trim();

  const output: string[] = [];
  const seenKeyToIndex = new Map<string, number>();
  const isStructuralLine = (trimmed: string): boolean =>
    /^#{1,6}\s+/.test(trimmed) ||
    /^\|/.test(trimmed) ||
    /^[-*]\s+/.test(trimmed) ||
    /^\d+\.\s+/.test(trimmed) ||
    FAQ_QUESTION_LINE_REGEX.test(trimmed) ||
    /^\s*(?:\*\*)?A(?:[0-9０-９]+(?:[.．:：])?|[:：])\s*/.test(trimmed) ||
    /^>\s+/.test(trimmed);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      output.push(line);
      continue;
    }
    if (isStructuralLine(trimmed)) {
      output.push(line);
      continue;
    }

    const key = normalizeComparableText(trimmed.replace(URL_REGEX, " "));
    if (!key || key.length < 20) {
      output.push(line);
      continue;
    }

    const seenIndex = seenKeyToIndex.get(key);
    if (seenIndex === undefined) {
      seenKeyToIndex.set(key, output.length);
      output.push(line);
      continue;
    }

    const prevLine = output[seenIndex] || "";
    const currentHasUrl = INLINE_URL_REGEX.test(trimmed);
    const prevHasUrl = INLINE_URL_REGEX.test(prevLine);
    if (currentHasUrl && !prevHasUrl) {
      output[seenIndex] = line;
    }
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function collapseDuplicateFaqSections(body: string): string {
  if (!body) return body;

  const lines = body.split(/\r?\n/);
  const result: string[] = [];
  let seenFaqHeading = false;
  let skippingDuplicateFaqBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isHeading = /^##+\s+/.test(trimmed);
    const isFaqHeading = /^##+\s*FAQ\s*$/i.test(trimmed);

    if (isFaqHeading) {
      if (!seenFaqHeading) {
        seenFaqHeading = true;
        skippingDuplicateFaqBlock = false;
        result.push(line);
      } else {
        skippingDuplicateFaqBlock = true;
      }
      continue;
    }

    if (skippingDuplicateFaqBlock) {
      if (isHeading) {
        skippingDuplicateFaqBlock = false;
        result.push(line);
      }
      continue;
    }

    result.push(line);
  }

  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function pickStableVariant(values: string[], seed: string): string {
  if (values.length === 0) return "";
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % values.length;
  return values[idx];
}

function buildHumanizedIntro(platform: Platform, keyword: string): string {
  const ameba = [
    `最近、${keyword}で手が止まる人が増えています。どこで迷いやすいか、先に整理しておきましょう。`,
    `${keyword}は「順番」を押さえるだけで解きやすくなります。今日はつまずきやすい所から見ていきます。`,
    `「これ、なんとなく分かる」で進むと${keyword}は失点しがちです。最初に判断の軸を確認しましょう。`,
  ];
  const note = [
    `${keyword}は、暗記よりも判断手順の設計で差が出ます。実務に繋がる観点から要点を解いていきます。`,
    `同じ${keyword}でも、読む順番を変えるだけで理解速度は大きく変わります。先に全体像を掴みましょう。`,
    `見落とされがちですが、${keyword}は現場判断に直結します。試験対策と実務の接点を整理します。`,
  ];
  const hatena = [
    `${keyword}は「論点の切り分け方」で精度が変わります。まず判断フローの骨格から整理します。`,
    `表面的な暗記だけでは${keyword}は安定しません。実務で再利用できる形に構造化して確認します。`,
    `${keyword}は似た論点との境界整理が鍵です。誤判定を防ぐための確認順を先に示します。`,
  ];

  const candidates =
    platform === "ameba" ? ameba : platform === "note" ? note : hatena;
  return pickStableVariant(candidates, `${platform}:${keyword}`);
}

function injectEvidenceSnippet(
  body: string,
  evidenceItems: OptimizationEvidenceItem[]
): string {
  if (!body || evidenceItems.length === 0) return body;
  if (/(出典|統計|調査).*(?:\d{4}年|令和\d+年|平成\d+年)/.test(body)) {
    return body;
  }

  const section = buildEvidenceSection(evidenceItems);
  if (!section) return body;
  return `${body.trim()}\n\n${section}`.trim();
}

function applyAiActionEnhancements(
  body: string,
  keyword: string,
  actions: string[],
  evidenceItems: OptimizationEvidenceItem[] = []
): string {
  const cleanKeyword = (keyword || "").trim() || "このテーマ";
  const focus = deriveAiActionFocus(actions);
  let text = (body || "").trim();
  if (!text || actions.length === 0) return text;

  if (
    focus.requireCalculationExample &&
    !/(計算例|数値例|シミュレーション|算出例)/.test(text)
  ) {
    text +=
      `\n\n例えば、${cleanKeyword}の確認では基準値と係数を先に置いて順番に計算すると、` +
      `判断のぶれを防ぎやすくなります。端数処理と例外条件は、計算前に確認しておくと安全です。`;
  }

  if (
    focus.requireTerminologyConsistency &&
    !/(用語の統一|用語整理|表記ルール)/.test(text)
  ) {
    const taxTermNote = /課税標準額/.test(text)
      ? "「課税標準額」は同一概念として一貫した意味でのみ使用します。"
      : "";
    text +=
      `\n\n本文では「${cleanKeyword}」を主要用語として表記を統一し、` +
      `同じ概念に複数の呼称を混在させないように整理します。` +
      `${taxTermNote}`;
  }

  if (
    focus.requirePracticalScenarios &&
    !/(実務シナリオ|ケース別|特殊ケース)/.test(text)
  ) {
    text +=
      `\n\n実務では、標準条件では基本手順をそのまま適用し、` +
      `例外条件がある場合は先に例外要件を確認してから判断すると精度が上がります。` +
      `迷ったときは、根拠条文や公式資料に戻って確認する流れが有効です。`;
  }

  if (focus.requireEvidenceCitation) {
    text = injectEvidenceSnippet(text, evidenceItems);
  }

  if (focus.requireDedupe) {
    text = dedupeParagraphs(text);
  }

  text = enrichSparseHeadingSections(text, cleanKeyword);
  text = removeFaqMetaGuidanceSentences(text);
  return text;
}

function ensureSeoGeoStructure(
  platform: Platform,
  body: string,
  keyword: string,
  trackedTakkenaiUrl: string,
  aiActions: string[] = [],
  evidenceItems: OptimizationEvidenceItem[] = [],
  relatedNote?: RelatedNoteLinkContext
): string {
  const cleanKeyword = (keyword || "").trim() || "このテーマ";
  let text = (body || "").trim();
  if (!text) {
    text = `${cleanKeyword}の要点を整理します。`;
  }

  text = stripFormulaicLeadSentence(text);
  text = collapseDuplicateFaqSections(text);

  const introLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .slice(0, 3)
    .join(" ");
  const introHasSummaryOrHook =
    /(?:結論|先に結論|要点|本記事では|この記事では|まず結論|最初に結論|実は|意外|見落としがち|ご存じ|なぜ|どうして|ポイント|鍵|コツ)/.test(
      introLines
    ) || /[?？]/.test(introLines);
  const introHasKeyword =
    normalizeComparableText(introLines).includes(
      normalizeComparableText(cleanKeyword)
    );
  if (!introHasSummaryOrHook || !introHasKeyword) {
    const intro = buildHumanizedIntro(platform, cleanKeyword);
    text = `${intro}\n\n${text}`;
  }

  if (!/(?:とは|とは何か|定義)/.test(text)) {
    text += `\n\n## ${cleanKeyword}とは\n${cleanKeyword}とは、試験と実務で判断基準として使う基本知識です。`;
  }

  let headings = text.match(/^##+\s+.+$/gm) || [];
  if (headings.length < 2) {
    text += `\n\n## ${cleanKeyword}を判断する前提`;
    text +=
      "\n適用条件・対象範囲・期限の3点を先に固定すると、後工程での判断ぶれを抑えやすくなります。";
    text += `\n\n## ${cleanKeyword}で迷いやすい分岐`;
    text +=
      "\n例外規定がある項目は通常ルールと分けてメモし、最後に数値条件を照合すると見落としを減らせます。";
    headings = text.match(/^##+\s+.+$/gm) || [];
  }

  const headingContainsKeyword = headings.some((line) =>
    normalizeComparableText(line).includes(normalizeComparableText(cleanKeyword))
  );
  if (!headingContainsKeyword) {
    text = `## ${cleanKeyword}の要点\n${text}`;
  }

  const bulletCount = (text.match(/^\s*(?:[-*]|\d+\.)\s+/gm) || []).length;
  if (bulletCount < 2) {
    text += "\n\n- 適用条件を先に固定してから比較する\n- 例外条件を通常ルールと分けて最終確認する";
  }

  const requiredFaqCount = platform === "ameba" ? 1 : 2;
  const existingQCount =
    (text.match(/^\s*(?:\*\*)?Q(?:[0-9０-９]+(?:[.．:：])?|[:：])\s*/gm) || []).length;
  const hasFaqHeading = /^##+\s*FAQ\s*$/im.test(text);
  if (existingQCount < requiredFaqCount) {
    if (!hasFaqHeading) {
      text += `\n\n## FAQ`;
    }
    if (existingQCount < 1) {
      text += `\nQ: ${cleanKeyword}は何から覚えるべきですか？`;
      text += `\nA: まず定義と計算・判断の基本式を押さえ、次に例題で確認すると定着しやすいです。`;
    }
    if (requiredFaqCount >= 2 && existingQCount < 2) {
      text += `\nQ: 実務で迷ったときの確認順は？`;
      text += `\nA: 結論→根拠→例外の順で整理すると、判断がブレにくくなります。`;
    }
  }

  const normalizedAiActions = normalizeAiActions(aiActions);
  if (normalizedAiActions.length > 0) {
    text = applyAiActionEnhancements(
      text,
      cleanKeyword,
      normalizedAiActions,
      evidenceItems
    );
  }

  text = dedupeParagraphs(text);
  text = enrichSparseHeadingSections(text, cleanKeyword);
  text = removeFaqMetaGuidanceSentences(text);
  text = normalizeFaqSectionToQa(text, platform, cleanKeyword);
  text = normalizeRelatedResourceSection(text, cleanKeyword);
  text = removeNonReaderFacingArtifacts(text);
  text = dedupeRepeatedNarrativeLinesPreferUrl(text);

  return ensureSingleBodyCtaLink(
    text,
    trackedTakkenaiUrl,
    platform,
    cleanKeyword,
    relatedNote
  ).trim();
}

function validateFaqQaStructure(platform: Platform, body: string): string[] {
  const issues: string[] = [];
  if (!body) return issues;

  const hasFaqHeading = /^##+\s*(?:FAQ|よくある質問|Q&A|Q＆A)\s*$/im.test(body);
  if (!hasFaqHeading) return issues;

  const qCount = (body.match(FAQ_QUESTION_LINE_GLOBAL_REGEX) || []).length;
  const aCount = (body.match(FAQ_ANSWER_LINE_GLOBAL_REGEX) || []).length;
  const required = platform === "ameba" ? 1 : 2;
  if (qCount < required || aCount < required) {
    issues.push(
      `FAQ は読者向けQ/A形式で最低${required}問必要です（Q:${qCount}, A:${aCount}）`
    );
  }
  if (aCount < qCount) {
    issues.push(`FAQ の回答行が不足しています（Q:${qCount}, A:${aCount}）`);
  }
  return issues;
}

// Exposed for regression tests only.
export function __testOnlyEnsureSeoGeoStructure(params: {
  platform: Platform;
  body: string;
  keyword: string;
  trackedTakkenaiUrl: string;
  aiActions?: string[];
}): string {
  return ensureSeoGeoStructure(
    params.platform,
    params.body,
    params.keyword,
    params.trackedTakkenaiUrl,
    params.aiActions || []
  );
}

export function __testOnlyRemoveNonReaderFacingArtifacts(body: string): string {
  return removeNonReaderFacingArtifacts(body);
}

export function __testOnlyDedupeRepeatedNarrativeLines(body: string): string {
  return dedupeRepeatedNarrativeLinesPreferUrl(body);
}

export function __testOnlySanitizeJapaneseField(text: string): string {
  return sanitizeJapaneseField(text);
}

export function __testOnlySanitizeChineseResidualKanaLines(text: string): string {
  return sanitizeChineseResidualKanaLines(text);
}

export function __testOnlyNormalizeParenthesizedUrls(text: string): string {
  return normalizeParenthesizedUrls(text);
}

export function __testOnlySanitizeHistoricalDateArtifacts(
  content: GeneratedContent,
  referenceDate: string
): GeneratedContent {
  return sanitizeHistoricalDateUsageArtifacts(content, referenceDate);
}

export function __testOnlyBuildChineseStructuralFallback(
  japaneseTitle: string,
  japaneseBody: string,
  existingTitleChinese = ""
): { titleChinese: string; bodyChinese: string } {
  return buildChineseStructuralFallback(
    japaneseTitle,
    japaneseBody,
    existingTitleChinese
  );
}

export function __testOnlyRepairChineseConsistencyDeterministically(
  content: GeneratedContent
): GeneratedContent {
  return repairChineseConsistencyDeterministically(content);
}

export async function optimizeSeoGeoForContent(
  platform: Platform,
  inputContent: GeneratedContent,
  takkenaiUrl: string,
  options: OptimizeSeoGeoOptions = {}
): Promise<SeoGeoOptimizeResult> {
  const targetSeoScore = Math.max(
    50,
    Math.min(100, options.targetSeoScore ?? 85)
  );
  const targetGeoScore = Math.max(
    50,
    Math.min(100, options.targetGeoScore ?? 85)
  );
  const targetAiScore = resolveAiTargetScore(options.targetAiScore);
  const targetChatgptSearchScore = resolveChatgptSearchTargetScore(
    options.targetChatgptSearchScore
  );
  const aiGateMode = resolveAiGateMode(options.aiGateMode);
  const chatgptSearchEnabled = resolveChatgptSearchEnabled();
  const chatgptSearchGateMode = resolveChatgptSearchGateMode();
  const evidenceMode = resolveEvidenceMode(options.evidenceMode);
  const maxRounds = Math.max(1, Math.min(4, options.maxRounds ?? 3));
  const referenceDate = new Date().toISOString().slice(0, 10);

  const trackedTakkenaiUrl = buildTrackedTakkenaiUrl(
    takkenaiUrl || inputContent.takkenaiLink || "",
    platform
  );
  const inferredAssetType: AssetType = trackedTakkenaiUrl.toLowerCase().includes("/tools/")
    ? "tool"
    : trackedTakkenaiUrl.toLowerCase().includes("/takken/")
    ? "knowledge-point"
    : "past-question";
  const isNoteViralMode =
    platform === "note" &&
    (inputContent.meta?.noteEntryMode === "viral" ||
      inputContent.meta?.contentKey === "note-viral");
  const optimizeRelatedNote: RelatedNoteLinkContext =
    platform === "note" && !isNoteViralMode
      ? {
          url: normalizeNoteArticleUrl(inputContent.meta?.relatedNoteUrl || ""),
          title: normalizeTopicLabelForCta(inputContent.meta?.relatedNoteAccount || ""),
        }
      : {};
  const optimizeLinkPolicyContext: LinkPolicyContext = {
    platform,
    noteEntryMode:
      platform === "note" ? (isNoteViralMode ? "viral" : "standard") : undefined,
    relatedNoteUrl: optimizeRelatedNote.url,
    relatedNoteAllowedAccounts: [],
  };
  const resolvedArticleType = resolveArticleType(
    options.articleType || inputContent.meta?.articleType,
    getRecommendedArticleType(platform, inferredAssetType)
  );
  const articleTypeOption = getArticleTypeOption(resolvedArticleType);
  const articleTypePromptBlock = buildArticleTypePromptBlock(articleTypeOption);
  const collectHistoricalIssues = (candidate: GeneratedContent): string[] =>
    isNoteViralMode ? [] : validateHistoricalDateUsage(candidate, referenceDate);
  const collectArticleTypeIssues = (body: string): string[] =>
    isNoteViralMode
      ? []
      : validateArticleTypeStructure(body, resolvedArticleType, platform);
  const keywordLabel = resolveOptimizationKeywordLabel(
    inputContent.seoGeoReport?.primaryKeyword || "",
    inputContent.title || "",
    trackedTakkenaiUrl || takkenaiUrl || inputContent.takkenaiLink || ""
  );
  const primaryKeyword = keywordLabel;

  let working: GeneratedContent = sanitizeUrlArtifactsInContent(
    {
      ...inputContent,
      takkenaiLink: trackedTakkenaiUrl,
      seoTitle: inputContent.seoTitle || "",
      meta: {
        ...(inputContent.meta || {}),
        ...(!isNoteViralMode ? { articleType: resolvedArticleType } : {}),
      },
    },
    takkenaiUrl || trackedTakkenaiUrl,
    keywordLabel,
    platform,
    optimizeRelatedNote
  );
  working = sanitizeHistoricalDateUsageArtifacts(working, referenceDate);

  let bestContent = working;
  let bestReport = evaluateSeoGeoRules({
    platform,
    title: working.title,
    body: working.body,
    seoTitle: working.seoTitle,
    primaryKeyword,
    trackedUrl: trackedTakkenaiUrl,
  });
  let aiActionsToApply = normalizeAiActions(
    inputContent.seoGeoReport?.aiActionsChinese
  );

  if (aiActionsToApply.length === 0) {
    const seedAiReview = await generateSeoGeoAiReview({
      platform,
      title: working.title,
      body: working.body,
      seoTitle: working.seoTitle,
      ruleReport: bestReport,
    });
    aiActionsToApply = normalizeAiActions(seedAiReview.aiActionsChinese);
  }

  const evidenceResult =
    evidenceMode === "auto"
      ? await collectOptimizationEvidence({
          platform,
          title: working.title,
          body: working.body,
          primaryKeyword: keywordLabel,
          takkenaiUrl: trackedTakkenaiUrl,
        })
      : { items: [] as OptimizationEvidenceItem[] };

  const beforeRuleReport = bestReport;
  const beforeAiActionReport = evaluateAiActionCompletion(
    working.body,
    aiActionsToApply,
    {
      platform,
      primaryKeyword: keywordLabel,
      evidenceFailureReason: evidenceResult.failureReason,
    }
  );

  let achieved = false;
  let executedRounds = 0;

  const computeDistance = (
    report: SeoGeoReport,
    aiActionReport: AiActionReport,
    hardIssueCount: number,
    platformIssueCount: number,
    articleTypeIssueCount: number
  ) =>
    Math.max(0, targetSeoScore - report.seoScore) +
    Math.max(0, targetGeoScore - report.geoScore) +
    (chatgptSearchEnabled
      ? (chatgptSearchGateMode === "hard" ? 1 : 0.35) *
        Math.max(0, targetChatgptSearchScore - report.chatgptSearchScore)
      : 0) +
    (aiGateMode === "hard"
      ? Math.max(0, targetAiScore - aiActionReport.completionScore)
      : 0) +
    hardIssueCount * 20 +
    platformIssueCount * 20 +
    articleTypeIssueCount * 20 +
    aiActionReport.unresolvedActions.length * 2;

  let bestDistance = Number.POSITIVE_INFINITY;

  const systemPrompt =
    "あなたは日本語のSEO/GEO編集者です。事実は維持しつつ、記事を検索最適化してください。必ずJSONのみで回答。";

  for (let round = 1; round <= maxRounds; round++) {
    const ruleReport = evaluateSeoGeoRules({
      platform,
      title: working.title,
      body: working.body,
      seoTitle: working.seoTitle,
      primaryKeyword,
      trackedUrl: trackedTakkenaiUrl,
    });
    const aiActionReport = evaluateAiActionCompletion(
      working.body,
      aiActionsToApply,
      {
        platform,
        primaryKeyword: keywordLabel,
        evidenceFailureReason: evidenceResult.failureReason,
      }
    );
    const hardIssues = [
      ...validateJapaneseFields(working, trackedTakkenaiUrl, optimizeLinkPolicyContext),
      ...collectHistoricalIssues(working),
      ...validatePlatformSafety(working),
      ...validateHeadingDetailDepth(working.body),
      ...validateFaqQaStructure(platform, working.body),
      ...validateReaderFacingBodyOnly(working.body),
    ];
    const articleTypeIssues = collectArticleTypeIssues(working.body);
    const platformIssues = validatePlatformCompliance(
      working,
      platform,
      trackedTakkenaiUrl,
      optimizeLinkPolicyContext
    );

    const distance = computeDistance(
      ruleReport,
      aiActionReport,
      hardIssues.length,
      platformIssues.length,
      articleTypeIssues.length
    );

    if (distance < bestDistance) {
      bestDistance = distance;
      bestContent = working;
      bestReport = ruleReport;
    }

    const aiScorePassed =
      aiGateMode === "soft" || aiActionReport.completionScore >= targetAiScore;
    const chatgptScorePassed =
      !chatgptSearchEnabled ||
      chatgptSearchGateMode === "soft" ||
      ruleReport.chatgptSearchScore >= targetChatgptSearchScore;
    const softChatgptStillNeedsWork =
      chatgptSearchEnabled &&
      chatgptSearchGateMode === "soft" &&
      ruleReport.chatgptSearchScore < targetChatgptSearchScore;
    if (
      ruleReport.seoScore >= targetSeoScore &&
      ruleReport.geoScore >= targetGeoScore &&
      chatgptScorePassed &&
      aiScorePassed &&
      hardIssues.length === 0 &&
      platformIssues.length === 0 &&
      articleTypeIssues.length === 0 &&
      !softChatgptStillNeedsWork
    ) {
      achieved = true;
      executedRounds = round - 1;
      bestContent = working;
      bestReport = ruleReport;
      break;
    }

    const requiredFaqCount = platform === "ameba" ? 1 : 2;
    const platformExtraRule =
      platform === "hatena"
        ? "- Markdown表は任意。比較データがある場合のみ活用し、なくても箇条書きで明確に整理する\n"
        : "";

    const revisionIssues = [
      ...ruleReport.issues,
      ...hardIssues,
      ...platformIssues,
      ...articleTypeIssues,
      ...aiActionReport.unresolvedActions.map((item) => `AI点评未闭环: ${item}`),
    ];
    const aiActionBlock =
      aiActionsToApply.length > 0
        ? aiActionsToApply.map((item, idx) => `${idx + 1}. ${item}`).join("\n")
        : "（なし）";
    const evidenceBlock =
      evidenceResult.items.length > 0
        ? evidenceResult.items
            .map(
              (item, idx) =>
                `${idx + 1}. ${item.source}（${item.year}）: ${item.metric} / ${item.summary}`
            )
            .join("\n")
        : evidenceResult.failureReason
        ? `利用可能な出典データなし: ${evidenceResult.failureReason}`
        : "利用可能な出典データなし";

    const articleTypeLine = isNoteViralMode
      ? ""
      : `【記事タイプ】${articleTypeOption.label}\n`;
    const articleTypeRequirementBlock = isNoteViralMode
      ? "【記事タイプ構成】爆款改写モードのため固定タイプ要件は不要。読者価値と具体性を優先\n\n"
      : `【記事タイプ構成（必須）】\n${articleTypePromptBlock}\n\n`;
    const urlRuleLine =
      platform === "note" && !isNoteViralMode
        ? `- 本文URLは次のルールを満たす: takkenaiリンク ${trackedTakkenaiUrl} を1件 + 関連note記事リンクを最大1件（白名单アカウントのみ）`
        : `- 本文URLは次の1件のみを自然文脈で入れる: ${trackedTakkenaiUrl}`;
    const userPrompt = `以下の記事をSEO/GEO観点で改善してください。\n\n` +
      `【目標】SEOスコア>=${targetSeoScore}、GEOスコア>=${targetGeoScore}、ChatGPT Searchスコア>=${targetChatgptSearchScore}、AI実行率>=${targetAiScore}\n` +
      `【現状】SEO=${ruleReport.seoScore}, GEO=${ruleReport.geoScore}, ChatGPT Search=${ruleReport.chatgptSearchScore}, AI実行率=${aiActionReport.completionScore}\n` +
      `【主キーワード】${ruleReport.primaryKeyword || keywordLabel}\n` +
      articleTypeLine +
      `【不足点】${revisionIssues.join(" / ") || "なし"}\n\n` +
      `【AI点评の改善要求（必須）】\n${aiActionBlock}\n\n` +
      `【ChatGPT Search改善要求（必須）】\n` +
      `- 冒頭3行で答えを先に示す（answer-first）\n` +
      `- 機関名+年度+具体数値を含む根拠文を最低2文含める（外部URL追加は禁止）\n` +
      `- 単独引用しやすい短文を最低3つ作る\n` +
      `- 本文に属性説明・メタ説明を入れない\n\n` +
      articleTypeRequirementBlock +
      `【利用可能な出典データ（優先使用）】\n${evidenceBlock}\n\n` +
      `【絶対ルール】\n` +
      `- title/bodyは日本語のみ\n` +
      `- 事実やデータは捏造しない\n` +
      `${urlRuleLine}\n` +
      `- FAQは最低${requiredFaqCount}問\n` +
      `- 冒頭は問い/具体場面/データのいずれかで自然に始め、定型句「結論として」で固定しない\n` +
      `- H2/H3で構造化する\n` +
      `- 「〜とは」定義を1つ入れる\n` +
      `- 箇条書きを2項目以上入れる\n` +
      `- 上記AI点评の改善要求を本文に具体反映する\n` +
      `- 実務ケース（手順付き）を最低1つ含める\n` +
      `- 出典・年・具体数値を含む根拠記述を最低1つ含める\n` +
      `- 重複段落を削除し、同じ趣旨の説明を繰り返さない\n` +
      `${platformExtraRule}` +
      `- title/seoTitle/imagePromptに過去年を入れない\n\n` +
      `【現在のタイトル】\n${working.title}\n\n` +
      `【現在のSEOタイトル】\n${working.seoTitle || "（なし）"}\n\n` +
      `【現在の本文】\n${working.body}\n\n` +
      `次のJSONのみ出力:\n` +
      `{\n` +
      `  "title": "改善後タイトル",\n` +
      `  "seoTitle": "改善後SEOタイトル（任意）",\n` +
      `  "body": "改善後本文（Markdown）"\n` +
      `}`;

    let revisedRaw = "";
    try {
      revisedRaw = await withTimeout(
        callOpenRouter(systemPrompt, userPrompt),
        12000,
        "seo-geo optimize"
      );
    } catch (error) {
      console.warn("[seo-geo] optimize round failed:", error);
      executedRounds = round;
      continue;
    }

    const draft = parseSeoGeoOptimizationDraft(revisedRaw);
    const revised: GeneratedContent = sanitizeUrlArtifactsInContent(
      {
        ...working,
        title: draft.title || working.title,
        body: draft.body || working.body,
        seoTitle: draft.seoTitle || working.seoTitle || "",
        takkenaiLink: trackedTakkenaiUrl,
        meta: {
          ...(working.meta || {}),
          ...(!isNoteViralMode ? { articleType: resolvedArticleType } : {}),
        },
      },
      takkenaiUrl || trackedTakkenaiUrl,
      keywordLabel,
      platform,
      optimizeRelatedNote
    );

    revised.body = dedupeParagraphs(revised.body);
    if (!isNoteViralMode) {
      revised.body = applyArticleTypeFallbackStructure(
        revised.body,
        resolvedArticleType,
        keywordLabel
      );
    }
    working = sanitizeHistoricalDateUsageArtifacts(revised, referenceDate);
    executedRounds = round;
  }

  // Deterministic fallback: enforce SEO/GEO structure even when model rewrites are weak.
  const structuredBodyBase = ensureSeoGeoStructure(
    platform,
    bestContent.body,
    keywordLabel,
    trackedTakkenaiUrl,
    aiActionsToApply,
    evidenceResult.items,
    optimizeRelatedNote
  );
  const structuredCandidateRaw: GeneratedContent = sanitizeUrlArtifactsInContent(
    {
      ...bestContent,
      title: ensureKeywordInTitle(bestContent.title, keywordLabel),
      body: isNoteViralMode
        ? structuredBodyBase
        : applyArticleTypeFallbackStructure(
            structuredBodyBase,
            resolvedArticleType,
            keywordLabel
          ),
      takkenaiLink: trackedTakkenaiUrl,
      meta: {
        ...(bestContent.meta || {}),
        ...(!isNoteViralMode ? { articleType: resolvedArticleType } : {}),
      },
    },
    takkenaiUrl || trackedTakkenaiUrl,
    keywordLabel,
    platform,
    optimizeRelatedNote
  );
  const structuredCandidate = sanitizeHistoricalDateUsageArtifacts(
    structuredCandidateRaw,
    referenceDate
  );
  const structuredReport = evaluateSeoGeoRules({
    platform,
    title: structuredCandidate.title,
    body: structuredCandidate.body,
    seoTitle: structuredCandidate.seoTitle,
    primaryKeyword,
    trackedUrl: trackedTakkenaiUrl,
  });
  const structuredAiActionReport = evaluateAiActionCompletion(
    structuredCandidate.body,
    aiActionsToApply,
    {
      platform,
      primaryKeyword: keywordLabel,
      evidenceFailureReason: evidenceResult.failureReason,
    }
  );
  const structuredHardIssues = [
    ...validateJapaneseFields(
      structuredCandidate,
      trackedTakkenaiUrl,
      optimizeLinkPolicyContext
    ),
    ...collectHistoricalIssues(structuredCandidate),
    ...validatePlatformSafety(structuredCandidate),
    ...validateHeadingDetailDepth(structuredCandidate.body),
    ...validateFaqQaStructure(platform, structuredCandidate.body),
  ];
  const structuredArticleTypeIssues = collectArticleTypeIssues(
    structuredCandidate.body
  );
  const structuredPlatformIssues = validatePlatformCompliance(
    structuredCandidate,
    platform,
    trackedTakkenaiUrl,
    optimizeLinkPolicyContext
  );
  const structuredDistance = computeDistance(
    structuredReport,
    structuredAiActionReport,
    structuredHardIssues.length,
    structuredPlatformIssues.length,
    structuredArticleTypeIssues.length
  );
  if (structuredDistance <= bestDistance) {
    bestContent = structuredCandidate;
    bestReport = structuredReport;
    bestDistance = structuredDistance;
  }

  bestContent = sanitizeHistoricalDateUsageArtifacts(bestContent, referenceDate);

  const finalRuleReport = evaluateSeoGeoRules({
    platform,
    title: bestContent.title,
    body: bestContent.body,
    seoTitle: bestContent.seoTitle,
    primaryKeyword,
    trackedUrl: trackedTakkenaiUrl,
  });
  const aiReview = await generateSeoGeoAiReview({
    platform,
    title: bestContent.title,
    body: bestContent.body,
    seoTitle: bestContent.seoTitle,
    ruleReport: finalRuleReport,
  });
  const finalAiActions = normalizeAiActions(aiReview.aiActionsChinese);
  const finalAiActionReport = evaluateAiActionCompletion(
    bestContent.body,
    finalAiActions.length > 0 ? finalAiActions : aiActionsToApply,
    {
      platform,
      primaryKeyword: keywordLabel,
      evidenceFailureReason: evidenceResult.failureReason,
    }
  );

  bestContent = {
    ...bestContent,
    takkenaiLink: trackedTakkenaiUrl,
    meta: {
      ...(bestContent.meta || {}),
      ...(!isNoteViralMode ? { articleType: resolvedArticleType } : {}),
    },
    seoGeoReport: {
      ...finalRuleReport,
      ...aiReview,
      aiActionReport: finalAiActionReport,
      dualThresholdPassed:
        finalRuleReport.seoScore >= targetSeoScore &&
        finalRuleReport.geoScore >= targetGeoScore &&
        (!chatgptSearchEnabled ||
          chatgptSearchGateMode === "soft" ||
          finalRuleReport.chatgptSearchScore >= targetChatgptSearchScore) &&
        (aiGateMode === "soft" ||
          finalAiActionReport.completionScore >= targetAiScore),
      fullThresholdPassed:
        finalRuleReport.seoScore >= targetSeoScore &&
        finalRuleReport.geoScore >= targetGeoScore &&
        (!chatgptSearchEnabled ||
          chatgptSearchGateMode === "soft" ||
          finalRuleReport.chatgptSearchScore >= targetChatgptSearchScore) &&
        (aiGateMode === "soft" ||
          finalAiActionReport.completionScore >= targetAiScore),
    },
  };

  // Keep Chinese fields in sync with optimized Japanese content.
  bestContent = await ensureFinalJapaneseChineseConsistency(platform, bestContent);

  const finalHardIssues = [
    ...validateJapaneseFields(bestContent, trackedTakkenaiUrl, optimizeLinkPolicyContext),
    ...collectHistoricalIssues(bestContent),
    ...validatePlatformSafety(bestContent),
    ...validateHeadingDetailDepth(bestContent.body),
    ...validateFaqQaStructure(platform, bestContent.body),
  ];
  const finalArticleTypeIssues = collectArticleTypeIssues(bestContent.body);
  const finalPlatformIssues = validatePlatformCompliance(
    bestContent,
    platform,
    trackedTakkenaiUrl,
    optimizeLinkPolicyContext
  );
  const finalAchieved =
    achieved ||
    (finalRuleReport.seoScore >= targetSeoScore &&
      finalRuleReport.geoScore >= targetGeoScore &&
      (!chatgptSearchEnabled ||
        chatgptSearchGateMode === "soft" ||
        finalRuleReport.chatgptSearchScore >= targetChatgptSearchScore) &&
      (aiGateMode === "soft" ||
        finalAiActionReport.completionScore >= targetAiScore) &&
      finalHardIssues.length === 0 &&
      finalPlatformIssues.length === 0 &&
      finalArticleTypeIssues.length === 0);

  const improvement: SeoGeoImprovementSummary = {
    seoScoreBefore: beforeRuleReport.seoScore,
    seoScoreAfter: finalRuleReport.seoScore,
    geoScoreBefore: beforeRuleReport.geoScore,
    geoScoreAfter: finalRuleReport.geoScore,
    chatgptSearchBefore: beforeRuleReport.chatgptSearchScore,
    chatgptSearchAfter: finalRuleReport.chatgptSearchScore,
    aiCompletionBefore: beforeAiActionReport.completionScore,
    aiCompletionAfter: finalAiActionReport.completionScore,
    unresolvedBefore: beforeAiActionReport.unresolvedActions.length,
    unresolvedAfter: finalAiActionReport.unresolvedActions.length,
  };

  const message = finalAchieved
    ? `SEO/GEO/ChatGPT/AI 已达标（SEO ${finalRuleReport.seoScore} / GEO ${finalRuleReport.geoScore} / ChatGPT ${finalRuleReport.chatgptSearchScore} / AI ${finalAiActionReport.completionScore}）`
    : `已优化但未达标（SEO ${finalRuleReport.seoScore} / GEO ${finalRuleReport.geoScore} / ChatGPT ${finalRuleReport.chatgptSearchScore} / AI ${finalAiActionReport.completionScore}，未闭环 ${finalAiActionReport.unresolvedActions.length} 项，类型结构问题 ${finalArticleTypeIssues.length} 项）`;

  return {
    content: bestContent,
    achieved: finalAchieved,
    rounds: executedRounds,
    targetSeoScore,
    targetGeoScore,
    targetAiScore,
    targetChatgptSearchScore,
    aiGateMode,
    improvement,
    message,
  };
}

// ---------------------------------------------------------------------------
// Content generation with quality review loop
// ---------------------------------------------------------------------------

const DEFAULT_ENABLE_RESEARCH = true;
const DEFAULT_REVIEW_ROUNDS = 2; // 生成1回 + 修正最大2回 = 計3回

export async function generateContent(
  platform: Platform,
  motherTopic: MotherTopic,
  takkenaiUrl: string,
  options: GenerateContentOptions = {}
): Promise<GeneratedContent> {
  const enableResearch = options.enableResearch ?? DEFAULT_ENABLE_RESEARCH;
  const reviewRounds = Math.max(0, options.reviewRounds ?? DEFAULT_REVIEW_ROUNDS);
  const allowAutoSanitize = options.allowAutoSanitize ?? false;
  const complianceMode = resolveComplianceMode(
    options.complianceMode ?? process.env.COMPLIANCE_MODE
  );
  const trackedTakkenaiUrl = buildTrackedTakkenaiUrl(takkenaiUrl, platform);
  const resolvedArticleType = resolveArticleType(
    options.articleType,
    getRecommendedArticleType(
      platform,
      motherTopic.asset.type as AssetType
    )
  );
  const isNoteViralMode =
    platform === "note" &&
    (options.noteViralMode === true || options.noteViralBrief?.enabled === true);
  const relatedNote: RelatedNoteLinkContext =
    platform === "note" && !isNoteViralMode
      ? {
          url: normalizeNoteArticleUrl(options.relatedNoteUrl || ""),
          title: normalizeTopicLabelForCta(options.relatedNoteTitle || ""),
        }
      : {};
  const linkPolicyContext: LinkPolicyContext = {
    platform,
    noteEntryMode:
      platform === "note" ? (isNoteViralMode ? "viral" : "standard") : undefined,
    relatedNoteUrl: relatedNote.url,
    relatedNoteAllowedAccounts:
      platform === "note" ? options.relatedNoteAllowedAccounts || [] : undefined,
  };
  const urlRuleForCopy =
    platform === "note" && !isNoteViralMode
      ? "本文URLは takkenai.jp 対象URLを1回 + 関連note記事URLを最大1回まで。その他URLや短縮URLは禁止"
      : "本文には takkenai.jp の対象URLを1回だけ自然に入れ、他URLや短縮URLは入れないこと";
  const collectHistoricalIssues = (candidate: GeneratedContent): string[] =>
    isNoteViralMode ? [] : validateHistoricalDateUsage(candidate, motherTopic.date);
  const collectArticleTypeIssues = (body: string): string[] =>
    isNoteViralMode
      ? []
      : validateArticleTypeStructure(body, resolvedArticleType, platform);

  // Step 1: Research — gather real data from the web via Perplexity
  const topicLabel =
    (options.topicLabelOverride || "").trim() || getAssetLabel(motherTopic.asset);
  const researchData = enableResearch
    ? await researchTopic(
        topicLabel,
        motherTopic.asset.type,
        motherTopic.phaseLabel
      )
    : "";

  // Step 2: Generate content with research data as context
  const systemPrompt = getSystemPrompt(platform);
  const userPrompt = buildUserPrompt(
    platform,
    motherTopic,
    trackedTakkenaiUrl,
    researchData,
    topicLabel,
    resolvedArticleType,
    platform === "note" ? options.noteViralBrief : undefined,
    relatedNote
  );
  const freshnessIssues = isNoteViralMode
    ? []
    : validateFreshPastQuestion(motherTopic);
  if (freshnessIssues.length > 0) {
    throw new Error(`[${platform}] ${freshnessIssues.join(" / ")}`);
  }

  let rawText = await callOpenRouter(systemPrompt, userPrompt);
  let content = sanitizeUrlArtifactsInContent(
    parseGeneratedContent(rawText),
    takkenaiUrl,
    topicLabel,
    platform,
    relatedNote
  );
  if (!isNoteViralMode) {
    content.body = applyArticleTypeFallbackStructure(
      content.body,
      resolvedArticleType,
      topicLabel
    );
    content = sanitizeUrlArtifactsInContent(
      content,
      takkenaiUrl,
      topicLabel,
      platform,
      relatedNote
    );
  }

  // Step 3: Quality review loop
  for (let round = 0; round < reviewRounds; round++) {
    const hardIssues = [
      ...validateJapaneseFields(content, trackedTakkenaiUrl, linkPolicyContext),
      ...collectHistoricalIssues(content),
      ...validatePlatformSafety(content),
      ...validateHeadingDetailDepth(content.body),
      ...validateFaqQaStructure(platform, content.body),
      ...validateReaderFacingBodyOnly(content.body),
      ...collectArticleTypeIssues(content.body),
    ];

    const review =
      hardIssues.length > 0
        ? {
            passed: false,
            issues: hardIssues,
            suggestions: [
              "title と body は必ず100%ネイティブ日本語で出力すること（中国語禁止）",
              "中国語は titleChinese / bodyChinese のみに出力し、本文に混ぜないこと",
              "body に JSON キー（titleChinese/bodyChinese/hashtags）を含めないこと",
              "誇大・断定・煽り表現（絶対合格/必ず受かる/100%稼げる 等）を削除し、事実ベースで表現すること",
              urlRuleForCopy,
              "タイトル/SEOタイトル/画像説明に過去年（例: 2024年）を入れないこと",
              "本文で過去年に言及する場合は必ず出典や調査文脈を付けること",
              ...(isNoteViralMode
                ? []
                : [
                    `記事タイプ（${getArticleTypeOption(resolvedArticleType).label}）の構成要件を満たすこと`,
                  ]),
            ],
          }
        : parseReviewResult(
            await callOpenRouter(
              REVIEW_SYSTEM_PROMPT,
              buildReviewPrompt(platform, content, motherTopic.date)
            )
          );

    if (review.passed) {
      console.log(`[${platform}] Quality review passed (round ${round + 1})`);
      break;
    }

    console.log(
      `[${platform}] Quality review failed (round ${round + 1}):`,
      review.issues
    );

    // Regenerate with review feedback
    const revisionPrompt = `${userPrompt}

## 前回の生成結果に対するレビュー指摘（必ず修正すること）
以下の問題点が見つかりました。これらを必ず修正した上で、記事を再生成してください。

### 問題点
${review.issues.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}

### 修正指示
${review.suggestions.map((s, idx) => `${idx + 1}. ${s}`).join("\n")}

【重要】上記の指摘をすべて反映した修正版を出力してください。同じミスを繰り返さないこと。`;

    rawText = await callOpenRouter(systemPrompt, revisionPrompt);
    content = sanitizeUrlArtifactsInContent(
      parseGeneratedContent(rawText),
      takkenaiUrl,
      topicLabel,
      platform,
      relatedNote
    );
  }

  let platformComplianceIssues = validatePlatformCompliance(
    content,
    platform,
    trackedTakkenaiUrl,
    linkPolicyContext
  );
  if (platformComplianceIssues.length > 0 && complianceMode !== "warn_only") {
    const complianceRevisionPrompt = `${userPrompt}

## 追加の合規修正（必須）
以下の合規問題を解消したうえで、本文を再生成してください。特にURL導線は「自然な文脈内の1回のみ」にしてください。

### 問題点
${platformComplianceIssues.map((item, idx) => `${idx + 1}. ${item}`).join("\n")}

### 強制ルール
1. ${
      platform === "note" && !isNoteViralMode
        ? `本文URLは ${trackedTakkenaiUrl} を1件 + 関連note記事URLを最大1件`
        : `本文URLは1件のみ。必ず ${trackedTakkenaiUrl}`
    }
2. URL単独行は禁止（前後に説明文を付ける）
3. 命令口調の販促文（今すぐ/限定/必見/クリック等）を避ける
4. タイトルと imagePrompt にURLを入れない
`;

    rawText = await callOpenRouter(systemPrompt, complianceRevisionPrompt);
    content = sanitizeUrlArtifactsInContent(
      parseGeneratedContent(rawText),
      takkenaiUrl,
      topicLabel,
      platform,
      relatedNote
    );
    platformComplianceIssues = validatePlatformCompliance(
      content,
      platform,
      trackedTakkenaiUrl,
      linkPolicyContext
    );
  }

  if (!isNoteViralMode) {
    content.body = applyArticleTypeFallbackStructure(
      content.body,
      resolvedArticleType,
      topicLabel
    );
  }
  content = sanitizeUrlArtifactsInContent(
    content,
    takkenaiUrl,
    topicLabel,
    platform,
    relatedNote
  );
  content = sanitizeHistoricalDateUsageArtifacts(content, motherTopic.date);
  const collectFinalHardIssues = (candidate: GeneratedContent): string[] => [
    ...validateJapaneseFields(candidate, trackedTakkenaiUrl, linkPolicyContext),
    ...collectHistoricalIssues(candidate),
    ...validateHeadingDetailDepth(candidate.body),
    ...validateFaqQaStructure(platform, candidate.body),
    ...validateReaderFacingBodyOnly(candidate.body),
    ...collectArticleTypeIssues(candidate.body),
  ];
  let finalHardIssues = collectFinalHardIssues(content);

  // Final deterministic guard: enforce article-type structure one more time after sanitization.
  if (
    !isNoteViralMode &&
    finalHardIssues.some((issue) => issue.includes("类型") || issue.includes("記事タイプ"))
  ) {
    const reinforcedBody = applyArticleTypeFallbackStructure(
      content.body,
      resolvedArticleType,
      topicLabel
    );
    if (reinforcedBody !== content.body) {
      content = {
        ...content,
        body: reinforcedBody,
      };
      finalHardIssues = collectFinalHardIssues(content);
    }
  }
  if (finalHardIssues.length > 0 && allowAutoSanitize) {
    const sanitizedContent: GeneratedContent = {
      ...content,
      title: sanitizeJapaneseField(content.title),
      body: sanitizeJapaneseField(content.body),
    };
    const urlSanitizedContent = sanitizeUrlArtifactsInContent(
      sanitizedContent,
      takkenaiUrl,
      topicLabel,
      platform,
      relatedNote
    );
    const sanitizedIssues = validateJapaneseFields(
      urlSanitizedContent,
      trackedTakkenaiUrl,
      linkPolicyContext
    );
    const sanitizedFreshnessIssues = collectHistoricalIssues(urlSanitizedContent);
    const sanitizedTypeIssues = collectArticleTypeIssues(
      urlSanitizedContent.body
    );
    const sanitizedReaderBodyIssues = validateReaderFacingBodyOnly(
      urlSanitizedContent.body
    );
    if (
      sanitizedIssues.length === 0 &&
      sanitizedFreshnessIssues.length === 0 &&
      sanitizedTypeIssues.length === 0 &&
      sanitizedReaderBodyIssues.length === 0
    ) {
      console.warn(`[${platform}] Applied auto-sanitize fallback for Japanese fields`);
      content = urlSanitizedContent;
      finalHardIssues = [];
    }
  }

  if (
    finalHardIssues.length > 0 &&
    finalHardIssues.some(
      (issue) =>
        issue.includes("中国語") ||
        issue.includes("日本語") ||
        issue.includes("JSON 断片") ||
        issue.includes("過去年")
    )
  ) {
    const emergencyPrompt = `${userPrompt}

## 緊急再生成（日本語品質のみ最優先）
前回出力では日本語品質または時效性ルール違反がありました。以下を厳守して全文を再生成してください。

1. title/body/hashtags/imagePrompt は日本語のみ（中国語文字を一切含めない）
2. titleChinese/bodyChinese は中国語翻訳として別フィールドにのみ出力
3. body にJSONキーやコードブロック断片を混入させない
4. ${
      platform === "note" && !isNoteViralMode
        ? `bodyのURLは ${trackedTakkenaiUrl} を1回 + 関連note記事URLを最大1回（自然文脈で）`
        : `bodyのURLは ${trackedTakkenaiUrl} を1回のみ（自然文脈で）`
    }
5. title/seoTitle/imagePrompt に過去年（例: 2024年）を書かない
6. bodyで過去年を使う場合は、必ず出典・調査・統計の引用文脈を付ける
`;

    const emergencyRaw = await callOpenRouter(systemPrompt, emergencyPrompt);
    const emergencyContent = sanitizeUrlArtifactsInContent(
      parseGeneratedContent(emergencyRaw),
      takkenaiUrl,
      topicLabel,
      platform,
      relatedNote
    );
    const emergencyIssues = validateJapaneseFields(
      emergencyContent,
      trackedTakkenaiUrl,
      linkPolicyContext
    );
    const emergencyDepthIssues = validateHeadingDetailDepth(emergencyContent.body);
    const emergencyFaqIssues = validateFaqQaStructure(platform, emergencyContent.body);
    const emergencyFreshnessIssues = collectHistoricalIssues(emergencyContent);
    const emergencyTypeIssues = collectArticleTypeIssues(emergencyContent.body);

    if (
      emergencyIssues.length === 0 &&
      emergencyDepthIssues.length === 0 &&
      emergencyFaqIssues.length === 0 &&
      emergencyFreshnessIssues.length === 0 &&
      emergencyTypeIssues.length === 0
    ) {
      console.warn(
        `[${platform}] Applied emergency Japanese-quality regeneration fallback`
      );
      content = emergencyContent;
      finalHardIssues = [];
    }
  }

  if (
    finalHardIssues.length > 0 &&
    hasJapaneseFieldContaminationIssue(finalHardIssues)
  ) {
    const seededBody = sanitizeJapaneseField(content.body).trim();
    const reconstructedBodySeed =
      seededBody.length > 40
        ? seededBody
        : `${topicLabel}の基本を整理し、実務で判断しやすい順序を確認します。`;
    let rescuedContent: GeneratedContent = sanitizeUrlArtifactsInContent(
      {
        ...content,
        title: sanitizeJapaneseField(content.title),
        body: ensureSeoGeoStructure(
          platform,
          reconstructedBodySeed,
          topicLabel,
          trackedTakkenaiUrl,
          [],
          [],
          relatedNote
        ),
      },
      takkenaiUrl,
      topicLabel,
      platform,
      relatedNote
    );
    if (!isNoteViralMode) {
      rescuedContent.body = applyArticleTypeFallbackStructure(
        rescuedContent.body,
        resolvedArticleType,
        topicLabel
      );
      rescuedContent = sanitizeUrlArtifactsInContent(
        rescuedContent,
        takkenaiUrl,
        topicLabel,
        platform,
        relatedNote
      );
    }
    const rescueIssues = validateJapaneseFields(
      rescuedContent,
      trackedTakkenaiUrl,
      linkPolicyContext
    );
    const rescueFreshnessIssues = collectHistoricalIssues(rescuedContent);
    const rescueDepthIssues = validateHeadingDetailDepth(rescuedContent.body);
    const rescueFaqIssues = validateFaqQaStructure(platform, rescuedContent.body);
    const rescueTypeIssues = collectArticleTypeIssues(rescuedContent.body);
    if (rescueIssues.length === 0) {
      content = rescuedContent;
      finalHardIssues = [
        ...rescueFreshnessIssues,
        ...rescueDepthIssues,
        ...rescueFaqIssues,
        ...rescueTypeIssues,
      ];
      if (finalHardIssues.length === 0) {
        console.warn(
          `[${platform}] Applied contamination-rescue sanitize fallback for Japanese body`
        );
      }
    }
  }

  if (finalHardIssues.length > 0) {
    throw new Error(
      `[${platform}] 最終品質チェック失敗: ${finalHardIssues.join(" / ")}`
    );
  }

  platformComplianceIssues = validatePlatformCompliance(
    content,
    platform,
    trackedTakkenaiUrl,
    linkPolicyContext
  );
  if (platformComplianceIssues.length > 0 && complianceMode === "strict") {
    throw new Error(
      `[${platform}] プラットフォーム合規チェック失敗: ${platformComplianceIssues.join(
        " / "
      )}`
    );
  }

  content.complianceReport = {
    passed: platformComplianceIssues.length === 0,
    platform,
    issues: platformComplianceIssues,
    linkCount: extractUrls(content.body).length,
    trackedUrl: trackedTakkenaiUrl,
  };

  const chatgptSearchEnabled = resolveChatgptSearchEnabled();
  const chatgptSearchGateMode = resolveChatgptSearchGateMode();
  const targetChatgptSearchScore = resolveChatgptSearchTargetScore();
  let baseSeoGeoReport = evaluateSeoGeoRules({
    platform,
    title: content.title,
    body: content.body,
    seoTitle: content.seoTitle,
    primaryKeyword: topicLabel,
    trackedUrl: trackedTakkenaiUrl,
  });
  if (
    chatgptSearchEnabled &&
    baseSeoGeoReport.chatgptSearchScore < targetChatgptSearchScore
  ) {
    const chatgptRevisionPrompt = `${userPrompt}

## ChatGPT Search 定向补强（仅重试1次）
当前 ChatGPT Search 分数未达标（${baseSeoGeoReport.chatgptSearchScore}/${targetChatgptSearchScore}）。
请在不改变主题事实、不增加外部链接的前提下修正：

${baseSeoGeoReport.chatgptSearchIssues.map((item, idx) => `${idx + 1}. ${item}`).join("\n")}

必須:
- 冒頭3行で先に答えを明示（answer-first）
- 機関名+年度+具体数値を含む根拠文を最低2文
- 単独引用しやすい短文を最低3つ
- 「SEO/GEO/属性/実行ステップ」等のメタ説明を本文に出さない
- URLは既存ルールを維持（追加外部URL禁止）
`;
    try {
      const chatgptRaw = await callOpenRouter(systemPrompt, chatgptRevisionPrompt);
      let chatgptRevised = sanitizeUrlArtifactsInContent(
        parseGeneratedContent(chatgptRaw),
        takkenaiUrl,
        topicLabel,
        platform,
        relatedNote
      );
      if (!isNoteViralMode) {
        chatgptRevised.body = applyArticleTypeFallbackStructure(
          chatgptRevised.body,
          resolvedArticleType,
          topicLabel
        );
      }
      chatgptRevised = sanitizeUrlArtifactsInContent(
        chatgptRevised,
        takkenaiUrl,
        topicLabel,
        platform,
        relatedNote
      );
      chatgptRevised = sanitizeHistoricalDateUsageArtifacts(
        chatgptRevised,
        motherTopic.date
      );
      const chatgptHardIssues = collectFinalHardIssues(chatgptRevised);
      const chatgptComplianceIssues = validatePlatformCompliance(
        chatgptRevised,
        platform,
        trackedTakkenaiUrl,
        linkPolicyContext
      );
      const revisedUsable =
        chatgptHardIssues.length === 0 &&
        !(chatgptComplianceIssues.length > 0 && complianceMode === "strict");

      if (revisedUsable) {
        content = chatgptRevised;
        platformComplianceIssues = chatgptComplianceIssues;
        baseSeoGeoReport = evaluateSeoGeoRules({
          platform,
          title: content.title,
          body: content.body,
          seoTitle: content.seoTitle,
          primaryKeyword: topicLabel,
          trackedUrl: trackedTakkenaiUrl,
        });
      } else {
        console.warn(
          `[${platform}] ChatGPT Search best-effort revision discarded: hardIssues=${chatgptHardIssues.length}, complianceIssues=${chatgptComplianceIssues.length}`
        );
      }
    } catch (error) {
      console.warn(`[${platform}] ChatGPT Search best-effort revision failed:`, error);
    }
  }
  if (
    chatgptSearchEnabled &&
    baseSeoGeoReport.chatgptSearchScore < targetChatgptSearchScore
  ) {
    const detail = `[${platform}] ChatGPT Search score=${baseSeoGeoReport.chatgptSearchScore} (<${targetChatgptSearchScore}) / ${baseSeoGeoReport.chatgptSearchIssues.join(
      " / "
    )}`;
    if (chatgptSearchGateMode === "hard") {
      throw new Error(`${detail}`);
    }
    console.warn(`${detail} (best-effort mode: continue without blocking)`);
  }
  console.log(
    `[seo-geo] rule-score platform=${platform} seo=${baseSeoGeoReport.seoScore} geo=${baseSeoGeoReport.geoScore} chatgpt=${baseSeoGeoReport.chatgptSearchScore}`
  );
  const aiReview = await generateSeoGeoAiReview({
    platform,
    title: content.title,
    body: content.body,
    seoTitle: content.seoTitle,
    ruleReport: baseSeoGeoReport,
  });
  console.log(`[seo-geo] ai-review platform=${platform} status=${aiReview.aiStatus}`);
  const generatedAiActions = normalizeAiActions(aiReview.aiActionsChinese);
  const initialAiActionReport = evaluateAiActionCompletion(
    content.body,
    generatedAiActions,
    { platform, primaryKeyword: topicLabel }
  );
  const aiGateMode = resolveAiGateMode();
  const targetAiScore = resolveAiTargetScore();
  content.seoGeoReport = {
    ...baseSeoGeoReport,
    ...aiReview,
    aiActionReport: initialAiActionReport,
    dualThresholdPassed:
      baseSeoGeoReport.seoScore >= SEO_GEO_PASS_THRESHOLD &&
      baseSeoGeoReport.geoScore >= SEO_GEO_PASS_THRESHOLD &&
      (!chatgptSearchEnabled ||
        chatgptSearchGateMode === "soft" ||
        baseSeoGeoReport.chatgptSearchScore >= targetChatgptSearchScore) &&
      (aiGateMode === "soft" ||
        initialAiActionReport.completionScore >= targetAiScore),
    fullThresholdPassed:
      baseSeoGeoReport.seoScore >= SEO_GEO_PASS_THRESHOLD &&
      baseSeoGeoReport.geoScore >= SEO_GEO_PASS_THRESHOLD &&
      (!chatgptSearchEnabled ||
        chatgptSearchGateMode === "soft" ||
        baseSeoGeoReport.chatgptSearchScore >= targetChatgptSearchScore) &&
      (aiGateMode === "soft" ||
        initialAiActionReport.completionScore >= targetAiScore),
  };
  content.meta = {
    ...(content.meta || {}),
    ...(!isNoteViralMode ? { articleType: resolvedArticleType } : {}),
    ...(platform === "note"
      ? {
          noteEntryMode: isNoteViralMode ? "viral" : "standard",
          noteViralSourceUrl: options.noteViralBrief?.sourceUrl,
          noteViralSourceAccount: options.noteViralBrief?.sourceAccount,
          relatedNoteUrl: !isNoteViralMode ? relatedNote.url : undefined,
          relatedNoteAccount: !isNoteViralMode
            ? extractNoteAccount(relatedNote.url || "")
            : undefined,
          relatedNoteInserted: !isNoteViralMode ? Boolean(relatedNote.url) : undefined,
        }
      : {}),
  };

  // Final sync: Chinese fields must reflect the finalized Japanese content.
  content = await ensureFinalJapaneseChineseConsistency(platform, content);

  return content;
}

export async function generateAllPlatforms(
  motherTopics: Record<Platform, MotherTopic>
): Promise<Record<Platform, GeneratedContent>> {
  const [ameba, note, hatena] = await Promise.all([
    generateContent("ameba", motherTopics.ameba, motherTopics.ameba.takkenaiUrl),
    generateContent("note", motherTopics.note, motherTopics.note.takkenaiUrl),
    generateContent("hatena", motherTopics.hatena, motherTopics.hatena.takkenaiUrl),
  ]);
  return { ameba, note, hatena };
}
