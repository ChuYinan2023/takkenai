import type { Platform } from "./topic-engine";
import {
  getCoverStyleOption,
  type CoverStyleId,
} from "./cover-style";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CoverImageParams {
  title: string;
  body: string;
  platform: Platform;
  hashtags?: string[];
  styleId?: CoverStyleId;
  imageProviderPreference?: ImageProviderPreference;
  imageModel?: string;
}

export type ImageProviderPreference = "closeai" | "openrouter";

interface CoverTextSet {
  title: string;
  subTitle: string;
  hook: string;
  point1: string;
  point2: string;
  point3: string;
  footer: string;
}

export interface CoverTextLayoutPlan {
  maxTitleChars: number;
  maxSubtitleChars: number;
  maxPoints: number;
  preferSingleHeadline: boolean;
  safeArea: {
    leftPercent: number;
    rightPercent: number;
    topPercent: number;
    bottomPercent: number;
  };
}

export interface CoverReadabilityReport {
  pass: boolean;
  issues: string[];
  observedTexts?: string[];
}

export type CoverQualityCheckStatus = "pass" | "retry_pass" | "failed";

export interface CoverImageResult {
  imageBuffer: Buffer;
  mimeType: string;
  ext: "png" | "jpg" | "webp";
  qualityCheck: CoverQualityCheckStatus;
  qualityIssues?: string[];
  textAdjusted: boolean;
  providerUsed?: ImageProvider;
  modelUsed?: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GEMINI_BASE_URL = "https://api.openai-proxy.org/google/v1beta";
const OPENROUTER_IMAGE_URL = "https://openrouter.ai/api/v1/chat/completions";

export type ImageProvider = "closeai" | "openrouter";
interface ImageApiContext {
  provider: ImageProvider;
  apiKey: string;
}

const MODEL_ALIASES: Record<string, string> = {
  "nano-banana-pro": "gemini-3-pro-image-preview",
  "nanobanana-pro": "gemini-3-pro-image-preview",
  "gemini-3-pro-image-preview": "gemini-3-pro-image-preview",
  "google/gemini-3-pro-image-preview": "gemini-3-pro-image-preview",
};
const BEST_MODEL = "gemini-3-pro-image-preview";
const DEFAULT_QA_MODEL_CHAIN = [BEST_MODEL];
const ENFORCE_READABLE_TEXT = process.env.COVER_ENFORCE_READABLE_TEXT !== "0";
const AUTO_RETRY_LIMIT = 1;
const MIN_IMAGE_MODEL_TIMEOUT_MS = 90_000;
const MIN_TOTAL_BUDGET_MS = 180_000;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

const IMAGE_MODEL_TIMEOUT_MS = parsePositiveInt(
  process.env.COVER_IMAGE_MODEL_TIMEOUT_MS,
  120000
);
const QA_MODEL_TIMEOUT_MS = parsePositiveInt(
  process.env.COVER_IMAGE_QA_TIMEOUT_MS,
  20000
);
const IMAGE_MODEL_TIMEOUT = Math.max(IMAGE_MODEL_TIMEOUT_MS, MIN_IMAGE_MODEL_TIMEOUT_MS);
const TOTAL_BUDGET_MS = Math.max(
  parsePositiveInt(process.env.COVER_IMAGE_TOTAL_BUDGET_MS, MIN_TOTAL_BUDGET_MS),
  IMAGE_MODEL_TIMEOUT * 2 + QA_MODEL_TIMEOUT_MS + 20_000
);
const QA_MODEL_MAX = Math.max(1, parsePositiveInt(process.env.COVER_IMAGE_QA_MAX_MODELS, 2));
const CLOSEAI_NETWORK_RETRY_LIMIT = Math.max(
  0,
  Math.min(3, parsePositiveInt(process.env.COVER_IMAGE_NETWORK_RETRY_LIMIT, 2))
);
const CLOSEAI_NETWORK_RETRY_BASE_MS = Math.max(
  250,
  parsePositiveInt(process.env.COVER_IMAGE_NETWORK_RETRY_BASE_MS, 1200)
);

function normalizeModelName(model: string): string {
  const key = model.trim().toLowerCase();
  const normalized = MODEL_ALIASES[key] || model.trim();
  if (normalized !== BEST_MODEL) {
    throw new Error(
      `画像モデル制約: ${model} は未対応です。サポート対象: ${BEST_MODEL}`
    );
  }
  return normalized;
}

function extractErrorMessage(err: unknown): string {
  if (!err) return "unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const cause =
      err.cause && typeof err.cause === "object" && err.cause !== null
        ? (err.cause as { message?: string }).message
        : undefined;
    return [err.message, cause].filter(Boolean).join(" | ");
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableImageNetworkError(message: string): boolean {
  const text = (message || "").toLowerCase();
  return /fetch failed|network|socket|econnreset|enotfound|etimedout|tls|ssl|handshake|disconnected before secure tls connection/i.test(
    text
  );
}

interface ModelSelection {
  candidates: string[];
  strict: boolean;
}

function getConfiguredModelCandidates(): string[] {
  const csv = process.env.COVER_IMAGE_MODELS;
  if (csv && csv.trim()) {
    const fromCsv = csv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((model) => normalizeModelName(model));
    const dedupedFromCsv: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < fromCsv.length; i++) {
      const item = fromCsv[i];
      if (!item || seen.has(item)) continue;
      seen.add(item);
      dedupedFromCsv.push(item);
    }
    return dedupedFromCsv;
  }

  const configured = [process.env.COVER_IMAGE_MODEL]
    .map((item) => (item || "").trim())
    .filter(Boolean)
    .map((item) => normalizeModelName(item));

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < configured.length; i++) {
    const item = configured[i];
    if (!item || seen.has(item)) continue;
    seen.add(item);
    deduped.push(item);
  }
  return deduped.slice(0, 1);
}

function getModelCandidates(imageModel?: string): ModelSelection {
  const explicit = imageModel ? imageModel.trim() : "";
  if (explicit) {
    return {
      candidates: [normalizeModelName(explicit)],
      strict: true,
    };
  }

  const configured = getConfiguredModelCandidates();
  if (configured.length > 0) {
    const firstModel = configured[0];
    return {
      candidates: [firstModel],
      strict: true,
    };
  }

  return {
    candidates: [BEST_MODEL],
    strict: true,
  };
}

function getQAModelCandidates(): string[] {
  const configured = (process.env.COVER_IMAGE_QA_MODEL || "").trim();
  const normalizedConfigured = configured
    ? normalizeModelName(configured)
    : "";
  const merged = [normalizedConfigured || DEFAULT_QA_MODEL_CHAIN[0]];
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < merged.length; i++) {
    const model = merged[i];
    if (!model || seen.has(model)) continue;
    seen.add(model);
    deduped.push(model);
  }
  return deduped.slice(0, QA_MODEL_MAX);
}

function timeoutError(ms: number, label: string): Error {
  return new Error(`${label} timed out after ${ms}ms`);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "name" in err &&
      (err as { name?: string }).name === "AbortError"
    ) {
      throw timeoutError(timeoutMs, label);
    }
    throw new Error(`[${label}] fetch failed: ${extractErrorMessage(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

function shouldRetryReadability(issues: string[]): boolean {
  const text = issues.join(" ").toLowerCase();
  if (!text) return true;
  return /(切|見切|画面外|はみ出|safe|overflow|crop|clip|clipped|trunc|途切|誤字|文字化け|mojibake|garble|typo|misspell)/.test(
    text
  );
}

function hasCriticalReadabilityRisk(issues: string[]): boolean {
  const text = issues.join(" ").toLowerCase();
  if (!text) return false;
  return /(切|見切|画面外|はみ出|safe|overflow|crop|clip|clipped|trunc|途切|outside-safe-area|text-clipped|text-cropped)/.test(
    text
  );
}

function resolveImageProvider(): ImageProvider {
  const explicit = (
    process.env.COVER_IMAGE_PROVIDER ||
    process.env.IMAGE_GENERATION_PROVIDER ||
    process.env.GEMINI_IMAGE_PROVIDER ||
    ""
  ).trim()
    .toLowerCase();

  if (explicit === "closeai" || explicit === "closeai-api") return "closeai";
  if (explicit === "openrouter" || explicit === "open-router" || explicit === "or") {
    return "openrouter";
  }

  const hasCloseai = !!(process.env.CLOSEAI_API_KEY || "").trim();
  const hasOpenrouter = !!(process.env.OPENROUTER_API_KEY || "").trim();

  // 默认优先 closeai；如需强制 openrouter，设置 COVER_IMAGE_PROVIDER=openrouter
  if (hasCloseai) return "closeai";
  if (hasOpenrouter) return "openrouter";
  return "closeai";
}

function getImageApiConfig(): ImageApiContext {
  const provider = resolveImageProvider();
  return getImageApiConfigForProvider(provider);
}

function getImageApiConfigForProvider(provider: ImageProvider): ImageApiContext {
  if (provider === "openrouter") {
    const key = process.env.OPENROUTER_API_KEY?.trim();
    if (!key) {
      throw new Error("OPENROUTER_API_KEY が設定されていません");
    }
    return { provider, apiKey: key };
  }

  const key = process.env.CLOSEAI_API_KEY?.trim();
  if (!key) {
    throw new Error("CLOSEAI_API_KEY が設定されていません");
  }
  return { provider, apiKey: key };
}

function getImageProviderCandidates(
  preference: ImageProviderPreference = "closeai"
): ImageProvider[] {
  if (preference === "closeai") {
    return ["closeai"];
  }
  if (preference === "openrouter") {
    return ["openrouter"];
  }
  return ["closeai"];
}

function getApiKeyForProvider(provider: ImageProvider): string {
  return getImageApiConfigForProvider(provider).apiKey;
}

function getOpenRouterModelCandidates(
  model: string,
  strict = false
): string[] {
  const normalized = normalizeModelName(model);
  return [normalized];
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

function stripEmoji(text: string): string {
  return text
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "")
    .replace(/[\u2600-\u27BF]/g, "");
}

function sanitizeForPrompt(text: string): string {
  if (!text) return "";

  return stripEmoji(text)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi, "$1")
    .replace(/https?:\/\/[^\s)]+/gi, " ")
    .replace(/(?:^|\s)\/[a-z0-9/_-]{3,}(?=\s|$)/gi, " ")
    .replace(/\b[a-z0-9]+(?:-[a-z0-9]+){1,}\b/gi, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeShortLine(text: string, maxChars: number): string {
  return truncate(
    sanitizeForPrompt(text)
      .replace(/^#+\s*/, "")
      .replace(/^【/, "")
      .replace(/】$/, "")
      .replace(/^[\-・*\d\.\)\(\s]+/, "")
      .replace(/[。．]+$/g, "")
      .replace(/[!！?？]/g, "")
      .replace(/[ 　]{2,}/g, " ")
      .trim(),
    maxChars
  );
}

function extractKeyPoints(body: string, title: string): string[] {
  const lines = sanitizeForPrompt(body)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const candidates: string[] = [];
  const t = normalizeShortLine(title, 26);
  if (t) candidates.push(t);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^【.+】$/.test(line)) {
      candidates.push(normalizeShortLine(line, 24));
      continue;
    }
    if (/^##\s+/.test(line)) {
      candidates.push(normalizeShortLine(line.replace(/^##\s+/, ""), 24));
      continue;
    }
    if (/^[\-・*]/.test(line) || /^\d+[\.)]/.test(line)) {
      candidates.push(normalizeShortLine(line, 24));
      continue;
    }
    if (line.length >= 10 && line.length <= 40) {
      candidates.push(normalizeShortLine(line, 24));
    }
  }

  const unique: string[] = [];
  const seen: Record<string, true> = {};
  for (let i = 0; i < candidates.length; i++) {
    const value = candidates[i];
    if (!value || value.length < 6) continue;
    if (seen[value]) continue;
    seen[value] = true;
    unique.push(value);
    if (unique.length >= 3) break;
  }

  const fallback = [
    "問題文の型を先に見抜く",
    "結論を一言で言い切る",
    "根拠を最後まで確認する",
  ];

  for (let i = 0; unique.length < 3 && i < fallback.length; i++) {
    if (!seen[fallback[i]]) unique.push(fallback[i]);
  }

  return unique.slice(0, 3);
}

function buildSubTitle(body: string): string {
  const lines = sanitizeForPrompt(body)
    .split(/\n+/)
    .map((line) => normalizeShortLine(line, 20))
    .filter((line) => line.length >= 6);

  return lines[0] || "実務で使える要点整理";
}

function buildHook(title: string): string {
  const cleaned = normalizeShortLine(title, 12);
  return cleaned || "この話、本当？";
}

function dedupeTextLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] || "").trim();
    if (!line) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    output.push(line);
  }
  return output;
}

function compactHeadline(rawTitle: string): string {
  const cleaned = sanitizeForPrompt(rawTitle || "")
    .replace(/^[【\[][^】\]]+[】\]]\s*/g, "")
    .trim();
  if (!cleaned) return "";

  const splitByBar = cleaned.split(/\s*[｜|]\s*/).filter(Boolean);
  if (splitByBar.length > 0) return splitByBar[0];

  const splitByPunct = cleaned.split(/[：:。]/).filter(Boolean);
  if (splitByPunct.length > 0) return splitByPunct[0];

  return cleaned;
}

function getCoverTextLayoutPlan(
  styleId: CoverStyleId,
  strict = false
): CoverTextLayoutPlan {
  const defaultPlan: CoverTextLayoutPlan = {
    maxTitleChars: strict ? 20 : 24,
    maxSubtitleChars: strict ? 14 : 18,
    maxPoints: strict ? 2 : 3,
    preferSingleHeadline: false,
    safeArea: {
      leftPercent: 8,
      rightPercent: 8,
      topPercent: 6,
      bottomPercent: 6,
    },
  };

  if (styleId === "real_photo_clean") {
    return {
      ...defaultPlan,
      maxTitleChars: strict ? 10 : 15,
      maxSubtitleChars: strict ? 8 : 12,
      maxPoints: strict ? 1 : 3,
      preferSingleHeadline: false,
      safeArea: {
        leftPercent: strict ? 14 : 12,
        rightPercent: strict ? 14 : 12,
        topPercent: strict ? 10 : 9,
        bottomPercent: strict ? 10 : 9,
      },
    };
  }

  if (styleId === "note_minimal_bold") {
    return {
      ...defaultPlan,
      maxTitleChars: strict ? 14 : 18,
      maxSubtitleChars: strict ? 8 : 10,
      maxPoints: strict ? 0 : 1,
      preferSingleHeadline: true,
      safeArea: {
        leftPercent: 10,
        rightPercent: 10,
        topPercent: 8,
        bottomPercent: 8,
      },
    };
  }

  if (styleId === "interview_jp_clean") {
    return {
      ...defaultPlan,
      maxTitleChars: strict ? 16 : 20,
      maxSubtitleChars: strict ? 10 : 13,
      maxPoints: strict ? 2 : 3,
      preferSingleHeadline: false,
      safeArea: {
        leftPercent: 8,
        rightPercent: 8,
        topPercent: 7,
        bottomPercent: 7,
      },
    };
  }

  if (styleId === "editorial_white") {
    return {
      ...defaultPlan,
      maxTitleChars: strict ? 16 : 20,
      maxSubtitleChars: strict ? 11 : 13,
      maxPoints: strict ? 1 : 2,
      preferSingleHeadline: true,
      safeArea: {
        leftPercent: 9,
        rightPercent: 9,
        topPercent: 7,
        bottomPercent: 7,
      },
    };
  }

  return defaultPlan;
}

function buildFooter(styleId: CoverStyleId): string {
  if (styleId === "editorial_white") return "余白で要点を深く伝える";
  if (styleId === "real_photo_clean") return "実務で使える視点を1枚で";
  if (styleId === "interview_jp_clean") return "現場で効く視点を短く整理";
  if (styleId === "note_minimal_bold") return "結論を先に、短く強く";
  if (styleId === "data_card_modern") return "数値と根拠で判断を支える";
  if (styleId === "soft_lifestyle_pastel") return "やさしく学べる実務ガイド";
  if (styleId === "problem_solution_split") return "課題と解決を並べて理解";
  if (styleId === "flow_yellow") return "区→線→用→開で判定する";
  if (styleId === "impact_money") return "結論：上がる可能性大";
  if (styleId === "paper_sns") return "「原本」を濃度変換して使い分けよう";
  if (styleId === "cyber_blue") return "2026年春学習を先回り";
  if (styleId === "eco_green") return "このブログで書くこと（宅建学習にも）";
  return "この3つが揃って、はじめて正解！";
}

function buildStyleAwareTextSet(
  params: CoverImageParams,
  styleId: CoverStyleId,
  strict = false
): CoverTextSet {
  const plan = getCoverTextLayoutPlan(styleId, strict);
  const points = extractKeyPoints(params.body, params.title);
  const compactTitle = compactHeadline(params.title);
  const maxPoints = Math.max(0, Math.min(3, plan.maxPoints));
  const pointLines = dedupeTextLines(
    points.map((point) => normalizeShortLine(point, strict ? 11 : 13))
  ).slice(0, maxPoints);
  const includeSecondary =
    !plan.preferSingleHeadline && !strict;

  const baseTitle =
    normalizeShortLine(compactTitle || params.title, plan.maxTitleChars) ||
    "宅建実務ガイド";

  if (styleId === "real_photo_clean") {
    const realPhotoSub =
      normalizeShortLine(buildSubTitle(params.body), plan.maxSubtitleChars) ||
      "実務で使える要点";
    const realPhotoHook =
      normalizeShortLine(buildHook(params.title), strict ? 9 : 10) ||
      "実務ポイント";
    const realPhotoFooter = normalizeShortLine(
      buildFooter(styleId),
      strict ? 13 : 16
    );

    const realPhotoPoints = dedupeTextLines(
      points.map((point) => normalizeShortLine(point, strict ? 10 : 12))
    )
      .filter((line) => {
        if (line.length < 6) return false;
        if (line === baseTitle) return false;
        if (baseTitle.includes(line) || line.includes(baseTitle)) return false;
        if (line === realPhotoSub) return false;
        if (line === realPhotoHook) return false;
        if (line === realPhotoFooter) return false;
        return true;
      })
      .slice(0, plan.maxPoints);

    const fallbackPoints = [
      "準備手順を先に整理",
      "結論を一言で共有",
      "注意点を先に確認",
    ];
    const requiredPointCount = strict ? 1 : 2;
    for (
      let i = 0;
      realPhotoPoints.length < requiredPointCount && i < fallbackPoints.length;
      i++
    ) {
      const line = fallbackPoints[i];
      if (
        !realPhotoPoints.includes(line) &&
        line !== baseTitle &&
        line !== realPhotoSub
      ) {
        realPhotoPoints.push(line);
      }
    }

    return {
      title: baseTitle,
      subTitle: realPhotoSub,
      hook: strict ? "" : realPhotoHook,
      point1: realPhotoPoints[0] || "",
      point2: strict ? "" : realPhotoPoints[1] || "",
      point3: strict ? "" : realPhotoPoints[2] || "",
      footer: strict ? "" : realPhotoFooter,
    };
  }

  if (styleId === "interview_jp_clean") {
    const interviewPoints = dedupeTextLines(
      points.map((point) => normalizeShortLine(point, strict ? 10 : 12))
    )
      .filter((line) => {
        if (line.length < 6) return false;
        if (line === baseTitle) return false;
        return true;
      })
      .slice(0, plan.maxPoints);

    const fallbackPoints = [
      "論点を3行で整理",
      "実務判断を先に共有",
      "次の行動を明確化",
    ];
    for (let i = 0; interviewPoints.length < 3 && i < fallbackPoints.length; i++) {
      const line = fallbackPoints[i];
      if (!interviewPoints.includes(line) && line !== baseTitle) {
        interviewPoints.push(line);
      }
    }

    return {
      title: baseTitle,
      subTitle:
        normalizeShortLine(buildSubTitle(params.body), plan.maxSubtitleChars) ||
        "インタビュー視点",
      hook: strict ? "" : "INTERVIEW",
      point1: interviewPoints[0] || "",
      point2: interviewPoints[1] || "",
      point3: strict ? "" : interviewPoints[2] || "",
      footer: strict ? "" : normalizeShortLine(buildFooter(styleId), strict ? 13 : 16),
    };
  }

  if (styleId === "lecture_blue") {
    const lecturePoints = dedupeTextLines(
      points.map((point) => normalizeShortLine(point, strict ? 10 : 12))
    )
      .filter((line) => {
        if (line.length < 6) return false;
        if (line === baseTitle) return false;
        return true;
      })
      .slice(0, plan.maxPoints);

    const fallbackPoints = [
      "前提条件を先に確認",
      "比較軸をそろえて判断",
      "結論を短く共有",
    ];
    const requiredPointCount = strict ? 2 : 3;
    for (let i = 0; lecturePoints.length < requiredPointCount && i < fallbackPoints.length; i++) {
      const line = fallbackPoints[i];
      if (!lecturePoints.includes(line) && line !== baseTitle) {
        lecturePoints.push(line);
      }
    }

    return {
      title: baseTitle,
      subTitle: includeSecondary
        ? normalizeShortLine(buildSubTitle(params.body), plan.maxSubtitleChars)
        : "",
      hook: includeSecondary
        ? normalizeShortLine(buildHook(params.title), Math.min(12, plan.maxSubtitleChars))
        : "",
      point1: lecturePoints[0] || "",
      point2: lecturePoints[1] || "",
      point3: strict ? "" : lecturePoints[2] || "",
      footer: includeSecondary
        ? normalizeShortLine(buildFooter(styleId), strict ? 14 : 16)
        : "",
    };
  }

  return {
    title: baseTitle,
    subTitle: includeSecondary
      ? normalizeShortLine(buildSubTitle(params.body), plan.maxSubtitleChars)
      : "",
    hook: includeSecondary
      ? normalizeShortLine(buildHook(params.title), Math.min(12, plan.maxSubtitleChars))
      : "",
    point1: pointLines[0] || "",
    point2: pointLines[1] || "",
    point3: includeSecondary ? pointLines[2] || "" : "",
    footer: includeSecondary
      ? normalizeShortLine(buildFooter(styleId), strict ? 14 : 16)
      : "",
  };
}

// ---------------------------------------------------------------------------
// Prompt templates by style
// ---------------------------------------------------------------------------

function getLayoutRequirements(styleId: CoverStyleId): string {
  switch (styleId) {
    case "editorial_white":
      return `
【版式】
1) 白または淡灰の低ノイズ背景
2) 上段に余白を活かした見出し
3) 中段は短い要点カードを2〜3枚
4) 図形は最小限、情報の見通しを優先
5) 雑誌の編集ページのような上品さ`;
    case "real_photo_clean":
      return `
【版式】
1) 実写寄り人物を主役に配置
2) 上部に横長ヘッダー帯でメインタイトルを配置
3) ヘッダー直下にサブ見出し帯を1行配置
4) 左側に小さなラベル（フック）を1つ配置
5) 右側に短い要点ラベルを2〜3個配置
6) 下部に短い結論バーを1本配置
7) 清潔感・信頼感を最優先`;
    case "note_minimal_bold":
      return `
【版式】
1) 単一の主張を大きく中央表示
2) 背景は1〜2色の強コントラスト
3) 余計なアイコンを削減し文字主導
4) サブ情報は1行のみ許容
5) スクロール停止を狙うミニマル構成`;
    case "interview_jp_clean":
      return `
【版式】
1) 右側に日本人ビジネス人物の半身写真を主役で配置
2) 左側はインタビュー見出しと3行要点で構成
3) 上段にヘッダー帯、中央に横罫や区切り線を使う
4) 余計な装飾を減らし、雑誌インタビューのような清潔感
5) 背景は淡い青〜白のグラデーション`;
    case "data_card_modern":
      return `
【版式】
1) モダンなカードUIを複数配置
2) グラフ/指標/比較ブロックを視覚化
3) タイトルは上段、根拠要点は中段
4) 右下に結論カードを置く
5) ツール・分析記事向けの情報設計`;
    case "soft_lifestyle_pastel":
      return `
【版式】
1) パステル背景で柔らかい印象
2) 上段にやさしい見出し帯
3) 中央に3つの実用ポイントカード
4) キャラクターや小物で親近感を補強
5) 圧迫感のないSNS向け軽量デザイン`;
    case "problem_solution_split":
      return `
【版式】
1) 左右2カラムの対照レイアウト
2) 左に課題、右に解決策を配置
3) 中央に矢印や変換シンボル
4) 下段に結論バーを1本
5) チュートリアル・実務手順向け`;
    case "eco_green":
      return `
【版式】
1) 全体は淡いグリーンと紙質感
2) 上段に大見出し、その下に吹き出し風サブバー
3) 左中に箇条書きブロック、右側に講師キャラ
4) 下段に追加の3項目リストと小型マスコットロボ
5) 全体は優しい教育ポスター風`;
    case "flow_yellow":
      return `
【版式】
1) 黄色グリッド背景 + 上部濃グレー帯
2) 左に大きい主題テキスト
3) 中央に赤い四角ノードと矢印でフロー
4) 右側に要点カード、左下に簡易地図風パネル
5) 教材板書のように図解中心`;
    case "impact_money":
      return `
【版式】
1) 派手な青背景、光・粒子・スピード感
2) 左に巨大なキャッチコピー、赤い上昇矢印
3) 右に実写寄りビジネス人物（スーツ）
4) 下段に結論バー + 3つのチェック項目
5) 金貨や円マークのアクセント`;
    case "cyber_blue":
      return `
【版式】
1) 未来感のある青いテクノロジー背景
2) 上中段に3行の大見出し
3) 下部に女性キャラクター + ロボットの2主体
4) 周囲に不動産/検索/分析アイコン
5) 受験・学習ガイドの保存版トーン`;
    case "paper_sns":
      return `
【版式】
1) ベージュの紙テクスチャ背景
2) 上に太い見出し + サブ見出し帯
3) 中央に3カラム比較カード（IG / X / LINE）
4) 各カードに短い行動キーワード
5) 下段に横長の結論リボン`;
    case "lecture_blue":
    default:
      return `
【版式】
1) 上部に濃紺ヘッダー帯
2) その下に白い強調ボックス
3) 中央左に2〜3つの横長要点カード（番号は実際の要点数に合わせる）
4) 右側に講師キャラクター
5) 下段に結論を強調した横長ボックス`;
  }
}

function getColorDirection(styleId: CoverStyleId): string {
  switch (styleId) {
    case "editorial_white":
      return "白・薄灰・墨色を基調。アクセントは1色まで。";
    case "real_photo_clean":
      return "白・青・グレー中心。肌色と背景の明度差で清潔感を出す。";
    case "note_minimal_bold":
      return "濃色背景 + 高彩度アクセント1色。文字可読性を最優先。";
    case "interview_jp_clean":
      return "淡青・白・紺を基調。編集感のある高級トーン。";
    case "data_card_modern":
      return "ネイビーとシアンを軸に、カードは白で整理。";
    case "soft_lifestyle_pastel":
      return "パステル（黄・桃・水色）主体。文字は濃色で読みやすく。";
    case "problem_solution_split":
      return "左暖色・右寒色で対比。中央導線は濃色で明確化。";
    case "eco_green":
      return "メインはグリーン。補色は白・淡黄。清潔で親しみやすい。";
    case "flow_yellow":
      return "メインは黄と濃グレー。アクセント赤。教材感を最優先。";
    case "impact_money":
      return "メインは青。アクセントは赤・黄。強いコントラストで目を引く。";
    case "cyber_blue":
      return "ブルー系グラデーション主体。白と黄色アクセント。未来感。";
    case "paper_sns":
      return "ベージュ紙色主体。茶・緑・青の区分色で穏やかに。";
    case "lecture_blue":
    default:
      return "濃紺 + 白 + 赤の講義配色。可読性最優先。";
  }
}

function getPlatformTone(platform: Platform): string {
  switch (platform) {
    case "ameba":
      return "Ameba向け: 親しみやすい人物感と生活文脈を重視。広告感を抑えて実用性を見せる。";
    case "hatena":
      return "はてな向け: 編集的で読みやすい情報構造を優先。過剰演出より論点の明快さを重視。";
    case "note":
    default:
      return "note向け: 一目で主張が伝わる見出し設計。余白とタイポで知的な印象を維持。";
  }
}

function buildLectureInfographicPrompt(
  params: CoverImageParams,
  strict = false
): string {
  const style = getCoverStyleOption(params.styleId);
  const styleId = style.id;
  const plan = getCoverTextLayoutPlan(styleId, strict);
  const texts = buildStyleAwareTextSet(params, styleId, strict);
  const textLines = [
    ["メインタイトル", texts.title],
    ["サブタイトル", texts.subTitle],
    ["フック", texts.hook],
    ["要点1", texts.point1],
    ["要点2", texts.point2],
    ["要点3", texts.point3],
    ["まとめ", texts.footer],
  ].filter((item) => item[1] && String(item[1]).trim().length > 0);
  const pointCount = [texts.point1, texts.point2, texts.point3].filter(
    (line) => (line || "").trim().length > 0
  ).length;
  const reduceRule =
    styleId === "real_photo_clean"
      ? strict
        ? "文字要素は必要最小限（real_photo_clean strict はメインタイトル+サブタイトル+要点1つを優先。余白不足なら要点を省略）"
        : "文字要素は必要最小限（real_photo_clean は最低4要素: メインタイトル+サブタイトル+要点2つ。余白があればフックと結論バーを追加）"
      : styleId === "interview_jp_clean"
        ? "文字要素は必要最小限（interview_jp_clean は最低5要素: メインタイトル+サブタイトル+要点3つ。余白があればフックと結論バーを追加）"
        : `文字要素は必要最小限（${textLines.length}要素）で、足りなければ減らして良い`;
  const styleSpecificRule =
    styleId === "real_photo_clean"
      ? strict
        ? "- real_photo_clean strict は a8u0 構成を維持しつつ、右要点は最大1つのみ表示\n- 上部ヘッダー帯のタイトルは1行のみ、重複表示しない\n- 上部ヘッダー帯は左右14%以上の余白を確保し、文字が入らない場合はフォント縮小を優先\n- タイトル文言を要点欄に再掲しない"
        : "- real_photo_clean は a8u0 参考の情報カード構成（上部見出し帯+サブ見出し帯+右要点2〜3+下部結論バー）を維持する\n- 上部ヘッダー帯のタイトルは1行のみ、重複表示しない\n- 上部ヘッダー帯は左右12%以上の余白を確保し、文字が入らない場合はフォント縮小を優先\n- タイトル文言を要点欄に再掲しない\n- 要点ラベル同士で同一文言を重複させない"
      : styleId === "interview_jp_clean"
        ? "- interview_jp_clean は右人物+左要点のインタビュー誌面構成を維持する\n- 主役人物は必ず日本人（日本のビジネス職の自然な顔立ち・髪型・服装）にする\n- タイトル文言を要点欄に再掲しない\n- 要点ラベル同士で同一文言を重複させない"
        : styleId === "lecture_blue"
          ? "- lecture_blue は提供した要点数に合わせて要点カードを2〜3枚で構成する\n- 空白カードや番号だけのカードを作らない\n- 要点3が空の場合は「3番カード」を描画しない"
        : "";

  const pointCardCount =
    styleId === "real_photo_clean" && strict ? Math.max(1, pointCount) : Math.max(2, pointCount);

  return `宅建・不動産学習向けの日本語インフォグラフィック画像を1枚生成してください。

【必須仕様】
- 16:9 比率（横長）
- 完成画像1枚のみ
- 高コントラストで文字を明瞭に
- 日本語テキストを自然に配置
- 文字量は最小限（短文中心）
- 各テキストは 4〜14 文字以内を優先
- 優先表示は「メインタイトル + 要点2つ」。余白不足時は他要素を省略する
- すべての文字要素を安全エリア内に配置（左${plan.safeArea.leftPercent}% / 右${plan.safeArea.rightPercent}% / 上${plan.safeArea.topPercent}% / 下${plan.safeArea.bottomPercent}%）
- 文字が画面端に触れないようにし、必ず全文が見切れずに読める状態にする
- ${reduceRule}

【最重要禁止事項】
- URL、英字スラッグ、パス、透かし、無関係な英単語を入れない
- 文字化け・崩れ・誤字を避ける
- 文字を貼り付けない（端ギリギリに配置しない）
- 文字が画面外に出る配置をしない
- 下記リストにない文字列を追加しない
- 同一文言を複数箇所で繰り返さない
- 文末記号（例: 「｜」「【」「（」）で不自然に終わる文字列を作らない
- 空白の要点カード（番号だけ/装飾だけ）を作らない
- 下記の日本語テキストは原文をそのまま使い、言い換えない
${styleSpecificRule}

【選択スタイル】
- 名前: ${style.name}
- 方向性: ${style.promptDirection}
- 色指定: ${getColorDirection(styleId)}
- プラットフォーム最適化: ${getPlatformTone(params.platform)}
- 要点カード数: ${pointCardCount}（この数だけ表示。空カードは禁止）
${getLayoutRequirements(styleId)}

【画像内テキスト（日本語）】
${textLines.map((entry) => `- ${entry[0]}: ${entry[1]}`).join("\n")}`;
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

function extractImageBuffer(data: unknown): Buffer | null {
  if (!data || typeof data !== "object") return null;
  const parsed = data as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { data?: string };
          inline_data?: { data?: string };
        }>;
      };
    }>;
  };

  const candidates = parsed.candidates || [];
  for (let i = 0; i < candidates.length; i++) {
    const parts = candidates[i].content?.parts || [];
    for (let j = 0; j < parts.length; j++) {
      const base64Data = parts[j].inlineData?.data || parts[j].inline_data?.data;
      if (base64Data) {
        return Buffer.from(base64Data, "base64");
      }
    }
  }

  return null;
}

function extractImageBufferFromOpenRouter(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const parsed = data as {
    data?: unknown;
    image?: unknown;
    images?: unknown;
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          inlineData?: { data?: string };
          inline_data?: { data?: string };
          image_url?: {
            url?: string;
          };
        }>;
      };
    }>;
    output?: Array<{
      image?: {
        data?: string;
      };
    }>;
    choices?: Array<{
      message?: {
        content?: string | Array<{
          type?: string;
          text?: string;
          image?: string;
          image_url?: {
            url?: string;
          };
          b64_json?: string;
          url?: string;
          data?: string;
        }>;
      };
      image?: string;
      images?: Array<{ url?: string; b64_json?: string; data?: string }>;
    }>;
  };

  if (parsed.data) {
    if (typeof parsed.data === "string" && /^[A-Za-z0-9+/=]+$/.test(parsed.data) && parsed.data.length > 3000) {
      return parsed.data;
    }
    const direct = parsed.data as string | { b64_json?: string };
    if (typeof direct === "string") {
      return direct;
    }
    if (direct && typeof direct === "object" && typeof direct.b64_json === "string") {
      return direct.b64_json;
    }
  }

  if (parsed.image && typeof parsed.image === "string") return parsed.image;
  if (Array.isArray(parsed.images)) {
    for (const img of parsed.images as Array<{
      data?: string;
      b64_json?: string;
      url?: string;
    }>) {
      if (img?.data && typeof img.data === "string" && img.data.length > 3000) return img.data;
      if (img?.b64_json && typeof img.b64_json === "string") return img.b64_json;
      if (img?.url && /^https?:\/\//.test(img.url)) return img.url;
    }
  }

  const choices = parsed.choices || [];
  for (const choice of choices) {
    const message = choice.message;
    if (!message || typeof message !== "object") continue;
    if (typeof (message as { image?: string }).image === "string") {
      const img = (message as { image?: string }).image;
      if (img) return img;
    }

    if (Array.isArray((message as { images?: Array<{ b64_json?: string; data?: string; url?: string }> }).images)) {
      const images = (message as { images?: Array<{ b64_json?: string; data?: string; url?: string }> }).images;
      for (const img of images || []) {
        if (img?.data && typeof img.data === "string" && img.data.length > 3000) return img.data;
        if (img?.b64_json && typeof img.b64_json === "string") return img.b64_json;
        if (img?.url && /^https?:\/\//.test(img.url)) return img.url;
      }
    }

    const content = (message as { content?: string | Array<{ type?: string; text?: string; image?: string; image_url?: { url?: string }; b64_json?: string; data?: string }> }).content;
    if (typeof content === "string") {
      const markdownImageMatch = content.match(/!\[[^\]]*\]\(([^)\s]+)\)/);
      if (markdownImageMatch && markdownImageMatch[1]) {
        return markdownImageMatch[1];
      }

      const directUrlMatch = content.match(/https?:\/\/\S+\.(?:png|jpe?g|webp)(?:\?\S+)?/);
      if (directUrlMatch?.[0]) return directUrlMatch[0];

      const dataUrlMatch = content.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/);
      if (dataUrlMatch && dataUrlMatch[1]) return dataUrlMatch[1];
    }

    if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        if (part.type === "text" && typeof part.text === "string") continue;
        if (part.image && typeof part.image === "string") return part.image;
        if (part.b64_json && typeof part.b64_json === "string") return part.b64_json;
        if (part.data && typeof part.data === "string" && part.data.length > 3000) return part.data;
        const imageUrl = part.image_url?.url;
        if (typeof imageUrl === "string" && /^https?:\/\//.test(imageUrl)) return imageUrl;
      }
    }
  }

  const candidates = parsed.candidates || [];
  for (const candidate of candidates) {
    const parts = candidate.content?.parts || [];
    for (const part of parts) {
      const base64Data = part.inlineData?.data || part.inline_data?.data;
      if (base64Data) {
        return base64Data;
      }
      const imageUrl = part.image_url?.url;
      if (imageUrl && /^https?:\/\//.test(imageUrl)) {
        return imageUrl;
      }
    }
  }

  return null;
}

async function resolveImageBufferFromOpenRouterResult(data: unknown): Promise<Buffer | null> {
  const imagePayload = extractImageBufferFromOpenRouter(data);
  if (!imagePayload) return null;
  if (imagePayload.startsWith("http://") || imagePayload.startsWith("https://")) {
    const res = await fetchWithTimeout(
      imagePayload,
      {
        method: "GET",
      },
      Math.max(8000, Math.min(IMAGE_MODEL_TIMEOUT, 12000)),
      `cover-image-openrouter-image-url-${imagePayload.slice(0, 48)}`
    );
    if (!res.ok) {
      throw new Error(`OpenRouter image_url fetch failed (${res.status})`);
    }
    const imageBuffer = Buffer.from(await res.arrayBuffer());
    if (imageBuffer.length < 100) {
      throw new Error("OpenRouter image_url fetch returned empty image buffer");
    }
    return imageBuffer;
  }
  if (/^[A-Za-z0-9+/=]+$/.test(imagePayload) && imagePayload.length > 300) {
    return Buffer.from(imagePayload, "base64");
  }
  return null;
}

function extractTextResponse(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const parsed = data as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };
  type OpenRouterChatResponse = {
    choices?: Array<{
      message?: {
        content?: string | Array<{ text?: string }>;
      };
    }>;
  };
  const candidates = parsed.candidates || [];
  for (let i = 0; i < candidates.length; i++) {
    const parts = candidates[i]?.content?.parts || [];
    for (let j = 0; j < parts.length; j++) {
      const text = parts[j]?.text;
      if (text && text.trim()) return text.trim();
    }
  }

  const openRouterResponse = parsed as OpenRouterChatResponse;
  const choices = openRouterResponse.choices || [];
  for (let i = 0; i < choices.length; i++) {
    const content = choices[i]?.message?.content;
    if (typeof content === "string") return content.trim();
    const parts = Array.isArray(content) ? content : [];
    for (let j = 0; j < parts.length; j++) {
      const text = parts[j]?.text;
      if (text && text.trim()) return text.trim();
    }
  }
  return "";
}

function extractJsonFromModelResponse(data: unknown): string {
  const text = extractTextResponse(data);
  if (!text) return "";
  const match = text.match(/\{[\s\S]*\}/);
  if (match) return match[0];
  return text;
}

function detectImageFormat(buffer: Buffer): {
  mimeType: string;
  ext: "png" | "jpg" | "webp";
} {
  if (buffer.length >= 12) {
    const isPng =
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47;
    if (isPng) return { mimeType: "image/png", ext: "png" };

    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (isJpeg) return { mimeType: "image/jpeg", ext: "jpg" };

    const isWebp =
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP";
    if (isWebp) return { mimeType: "image/webp", ext: "webp" };
  }
  return { mimeType: "image/png", ext: "png" };
}

function parseReadabilityJson(text: string): CoverReadabilityReport | null {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;

  const match = trimmed.match(/\{[\s\S]*\}/);
  const candidate = match ? match[0] : trimmed;
  try {
    const parsed = JSON.parse(candidate) as {
      pass?: boolean;
      issues?: string[];
      observedTexts?: string[];
      observedText?: string[];
      extractedTexts?: string[];
    };
    return {
      pass: parsed.pass === true,
      issues: Array.isArray(parsed.issues)
        ? parsed.issues.map((item) => String(item).trim()).filter(Boolean)
        : [],
      observedTexts: (
        parsed.observedTexts ||
        parsed.observedText ||
        parsed.extractedTexts ||
        []
      )
        .map((item) => String(item).trim())
        .filter(Boolean),
    };
  } catch {
    return null;
  }
}

function normalizeMatchText(text: string): string {
  return sanitizeForPrompt(text)
    .replace(/[\s\u3000]+/g, "")
    .replace(/[|｜「」『』【】（）\[\]{}<>〈〉《》"“”'’`~!！?？,，.。:：;；\-—_]/g, "")
    .toLowerCase();
}

function buildBigrams(text: string): Set<string> {
  const normalized = normalizeMatchText(text);
  const grams = new Set<string>();
  if (!normalized) return grams;
  if (normalized.length === 1) {
    grams.add(normalized);
    return grams;
  }
  for (let i = 0; i < normalized.length - 1; i++) {
    grams.add(normalized.slice(i, i + 2));
  }
  return grams;
}

function bigramCoverage(hint: string, observed: string): number {
  const hintGrams = buildBigrams(hint);
  const observedGrams = buildBigrams(observed);
  if (hintGrams.size === 0 || observedGrams.size === 0) return 0;
  let hit = 0;
  hintGrams.forEach((gram) => {
    if (observedGrams.has(gram)) hit += 1;
  });
  return hit / hintGrams.size;
}

function evaluateExpectedTextMatch(
  hints: string[],
  observedTexts: string[],
  strict = false
): { passed: boolean; issue?: string } {
  const normalizedHints = hints
    .map((item) => item.trim())
    .filter((item) => normalizeMatchText(item).length >= 5);
  if (normalizedHints.length === 0) return { passed: true };

  const observed = observedTexts.filter(Boolean);
  if (observed.length === 0) {
    return {
      passed: false,
      issue: "quality-qa-could-not-read-text",
    };
  }

  const requiredHintCount = Math.min(strict ? 4 : 3, normalizedHints.length);
  const threshold = strict ? 0.5 : 0.42;
  let matched = 0;
  for (let i = 0; i < requiredHintCount; i++) {
    const hint = normalizedHints[i];
    let best = 0;
    for (let j = 0; j < observed.length; j++) {
      const score = bigramCoverage(hint, observed[j]);
      if (score > best) best = score;
    }
    if (best >= threshold) matched += 1;
  }

  const minMatches = strict ? 2 : 1;
  if (matched < minMatches) {
    return {
      passed: false,
      issue: `expected-japanese-text-mismatch(${matched}/${requiredHintCount})`,
    };
  }
  return { passed: true };
}

async function evaluateCoverTextReadability(
  imageBuffer: Buffer,
  hints: string[],
  safeArea: CoverTextLayoutPlan["safeArea"],
  apiKey: string,
  imageProvider: ImageProvider = "closeai",
  platform?: Platform
): Promise<CoverReadabilityReport | null> {
  const qaModels = getQAModelCandidates();
  const imageMeta = detectImageFormat(imageBuffer);
  const base64 = imageBuffer.toString("base64");
  const strictTextMatch = platform === "note";
  const prompt = [
    "この画像の文字可読性を判定してください。",
    "軽微な余白ズレは許容し、明確な見切れ・欠損がある場合のみ fail にしてください。",
    "判定基準:",
    "- 文字が画面端で切れていない",
    "- 文字が安全エリア外（左右上下の余白）に食い込んでいない",
    "- 同一文言の重複が不自然に多くない",
    "- 文末が「｜」「【」「（」で途切れたような文字がない",
    "- 日本語テキストに明らかな誤字・欠字・文字化けがない（意味不明な文字列は fail）",
    `安全エリア: 左${safeArea.leftPercent}% 右${safeArea.rightPercent}% 上${safeArea.topPercent}% 下${safeArea.bottomPercent}%`,
    `期待テキスト例: ${hints.join(" / ")}`,
    "画像から読める文字を最大8件まで observedTexts に列挙してください（推測で補わない）。",
    "JSONのみで返答: {\"pass\": boolean, \"issues\": string[], \"observedTexts\": string[]}",
  ].join("\n");

  for (let i = 0; i < qaModels.length; i++) {
    const model = qaModels[i];
    const providerModels = imageProvider === "openrouter"
      ? getOpenRouterModelCandidates(model)
      : [model];
    for (let m = 0; m < providerModels.length; m++) {
      const providerModel = providerModels[m];
      try {
        const url =
          imageProvider === "closeai"
            ? `${GEMINI_BASE_URL}/models/${providerModel}:generateContent`
            : OPENROUTER_IMAGE_URL;
        const payload =
          imageProvider === "closeai"
            ? {
                contents: [
                  {
                    parts: [
                      { text: prompt },
                      {
                        inlineData: {
                          mimeType: imageMeta.mimeType,
                          data: base64,
                        },
                      },
                    ],
                  },
                ],
                generationConfig: {
                  responseModalities: ["TEXT"],
                },
              }
            : {
                model: providerModel,
                messages: [
                  {
                    role: "user",
                    content: [
                      { type: "text", text: prompt },
                      {
                        type: "image_url",
                        image_url: {
                          url: `data:${imageMeta.mimeType};base64,${base64}`,
                        },
                      },
                    ],
                  },
                ],
                max_tokens: 1024,
              };

        const res = await fetchWithTimeout(
          url,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
          QA_MODEL_TIMEOUT_MS,
          `cover-qa(${providerModel})`
        );
        if (!res.ok) continue;
        const data = (await res.json()) as unknown;
        const parsed = parseReadabilityJson(extractJsonFromModelResponse(data));
        if (parsed) {
          const textMatch = evaluateExpectedTextMatch(
            hints,
            parsed.observedTexts || [],
            strictTextMatch
          );
          if (!textMatch.passed) {
            parsed.pass = false;
            parsed.issues = [...parsed.issues, textMatch.issue || "expected-text-mismatch"];
          }
          return parsed;
        }
      } catch {
        // ignore and try next model
      }
    }
  }
  return null;
}

async function callImageApi(
  prompt: string,
  apiKey: string,
  model: string,
  imageProvider: ImageProvider = "closeai",
  strictModel = false
): Promise<{ imageBuffer: Buffer; modelUsed: string; providerUsed: ImageProvider }> {
  if (imageProvider === "closeai") {
    const url = `${GEMINI_BASE_URL}/models/${model}:generateContent`;
    let res: Response | null = null;
    const requestErrors: string[] = [];
    for (let requestAttempt = 0; requestAttempt <= CLOSEAI_NETWORK_RETRY_LIMIT; requestAttempt++) {
      try {
        res = await fetchWithTimeout(
          url,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
                imageConfig: {
                  aspectRatio: "16:9",
                },
              },
            }),
          },
          IMAGE_MODEL_TIMEOUT,
          `cover-image(${model})`
        );
        break;
      } catch (err) {
        const errorMessage = extractErrorMessage(err);
        requestErrors.push(errorMessage);
        const canRetry =
          isRetryableImageNetworkError(errorMessage) &&
          requestAttempt < CLOSEAI_NETWORK_RETRY_LIMIT;
        if (!canRetry) {
          const attemptNote =
            requestAttempt > 0 ? ` after ${requestAttempt + 1} attempts` : "";
          throw new Error(
            `Image API error [provider=closeai, model=${model}] request failed${attemptNote}: ${requestErrors.join(
              " | "
            )}`
          );
        }
        const delayMs = CLOSEAI_NETWORK_RETRY_BASE_MS * (requestAttempt + 1);
        console.warn(
          `[cover-image] closeai network retry (${requestAttempt + 1}/${
            CLOSEAI_NETWORK_RETRY_LIMIT
          }) in ${delayMs}ms: ${errorMessage}`
        );
        await wait(delayMs);
      }
    }

    if (!res) {
      throw new Error(
        `Image API error [provider=closeai, model=${model}] request failed: no response`
      );
    }

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(
        `Image API error [provider=closeai, model=${model}] (${res.status}): ${errorText.slice(0, 400)}`
      );
    }

    const responseText = await res.text();
    if (!responseText || !responseText.trim()) {
      throw new Error(`Image API error [provider=closeai, model=${model}]: empty response`);
    }
    let data: unknown;
    try {
      data = JSON.parse(responseText) as unknown;
    } catch (err) {
      throw new Error(
        `Image API error [provider=closeai, model=${model}]: invalid JSON response (${extractErrorMessage(err)}): ${responseText.slice(0, 200)}`
      );
    }
    const imageBuffer = extractImageBuffer(data);
    if (!imageBuffer) {
      throw new Error(`Gemini did not return image payload (${model})`);
    }

    return {
      imageBuffer,
      modelUsed: model,
      providerUsed: imageProvider,
    };
  }

  const providerModels = getOpenRouterModelCandidates(model, strictModel);
  let lastError = "";
  const failures: string[] = [];
  for (let i = 0; i < providerModels.length; i++) {
    const providerModel = providerModels[i];
    let res: Response;
    try {
      res = await fetchWithTimeout(
        OPENROUTER_IMAGE_URL,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: providerModel,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 2048,
          }),
        },
        IMAGE_MODEL_TIMEOUT,
        `cover-image-openrouter(${providerModel})`
      );
    } catch (err) {
      lastError = `OpenRouter(${providerModel}) network error: ${extractErrorMessage(err)}`;
      failures.push(lastError);
      continue;
    }
    if (!res.ok) {
      const detail = await res.text();
      lastError = `OpenRouter(${providerModel}) ${res.status}: ${detail.slice(0, 200)}`;
      failures.push(lastError);
      continue;
    }
    const responseText = await res.text();
    if (!responseText || !responseText.trim()) {
      lastError = `OpenRouter(${providerModel}) empty response`;
      failures.push(lastError);
      continue;
    }

    let data: unknown;
    try {
      data = JSON.parse(responseText);
    } catch (err) {
      lastError = `OpenRouter(${providerModel}) invalid json response: ${extractErrorMessage(err)}:${responseText.slice(0, 200)}`;
      failures.push(lastError);
      continue;
    }

    let imageBuffer: Buffer | null;
    try {
      imageBuffer = await resolveImageBufferFromOpenRouterResult(data);
    } catch (err) {
      lastError = `OpenRouter(${providerModel}) image payload load error: ${extractErrorMessage(err)}`;
      failures.push(lastError);
      continue;
    }
    if (imageBuffer) {
      return {
        imageBuffer,
        modelUsed: providerModel,
        providerUsed: imageProvider,
      };
    }
    failures.push(`OpenRouter(${providerModel}) image payload missing`);
  }

  throw new Error(
    `Image API error [provider=openrouter, model=${model}]: ${failures.length ? failures.join(" | ") : lastError || "no image payload"}`
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerateCoverImageDeps {
  callImageApiFn: typeof callImageApi;
  evaluateCoverTextReadabilityFn: typeof evaluateCoverTextReadability;
  getApiKeyFn?: (provider: ImageProvider) => string;
  getImageProviderCandidatesFn?: (preference?: ImageProviderPreference) => ImageProvider[];
  getImageProviderFn?: () => ImageProvider;
  getModelCandidatesFn: typeof getModelCandidates;
  enforceReadableText: boolean;
}

async function generateCoverImageWithDeps(
  params: CoverImageParams,
  deps: GenerateCoverImageDeps
): Promise<CoverImageResult> {
  const imageProviderCandidates = deps.getImageProviderCandidatesFn
    ? deps.getImageProviderCandidatesFn(params.imageProviderPreference)
    : getImageProviderCandidates(params.imageProviderPreference);
  const style = getCoverStyleOption(params.styleId);
  const modelCandidates = deps.getModelCandidatesFn(params.imageModel);
  const models = modelCandidates.candidates;
  const resolvedSingleProvider = deps.getImageProviderFn
    ? [deps.getImageProviderFn()]
    : [];

  console.log(
    `[cover-image] providerCandidates=${
      resolvedSingleProvider.length ? resolvedSingleProvider : imageProviderCandidates
    } models=${models.join(",")} strict=${String(modelCandidates.strict)}`
  );
  const requireStrictReadability = params.platform === "note";
  const startedAt = Date.now();

  console.log(
    `[cover-image] direct-ai style=${style.id} platform=${params.platform} models=${models.join(",")} strict=${String(
      modelCandidates.strict
    )}`
  );

  let lastError: unknown = null;
  let lastIssues: string[] = [];
  let lastGenerated:
    | {
        imageBuffer: Buffer;
        mimeType: string;
        ext: "png" | "jpg" | "webp";
        strict: boolean;
      }
    | null = null;
  const normalizedCompactTitle = normalizeShortLine(compactHeadline(params.title) || params.title, 40);
  const preferStrictFromFirstAttempt =
    params.platform === "note" ||
    (style.id === "real_photo_clean" && normalizedCompactTitle.length >= 13);

  for (let attempt = 0; attempt <= AUTO_RETRY_LIMIT; attempt++) {
    if (Date.now() - startedAt > TOTAL_BUDGET_MS) {
      if (lastGenerated && !requireStrictReadability) {
        return {
          imageBuffer: lastGenerated.imageBuffer,
          mimeType: lastGenerated.mimeType,
          ext: lastGenerated.ext,
          qualityCheck: lastGenerated.strict ? "retry_pass" : "pass",
          qualityIssues: ["time-budget-reached"],
          textAdjusted: lastGenerated.strict,
        };
      }
      break;
    }
    const strict = preferStrictFromFirstAttempt || attempt > 0;
    const prompt = buildLectureInfographicPrompt(
      strict
        ? { ...params, title: truncate(params.title, 36), body: truncate(params.body, 420) }
        : params,
      strict
    );
    const textSet = buildStyleAwareTextSet(params, style.id, strict);
    const layoutPlan = getCoverTextLayoutPlan(style.id, strict);
    const expectedTextHints = [
      textSet.title,
      textSet.subTitle,
      textSet.hook,
      textSet.point1,
      textSet.point2,
      textSet.point3,
      textSet.footer,
    ]
      .map((line) => (line || "").trim())
      .filter(Boolean);

    let generated:
      | {
          imageBuffer: Buffer;
          imageProvider: ImageProvider;
          apiKey: string;
          modelUsed: string;
          providerUsed: ImageProvider;
        }
      | null = null;
      const providers = resolvedSingleProvider.length ? resolvedSingleProvider : imageProviderCandidates;
      for (let p = 0; p < providers.length; p++) {
        const imageProvider = providers[p];
        let apiKey = "";
        try {
          apiKey = deps.getApiKeyFn
            ? deps.getApiKeyFn(imageProvider)
            : getApiKeyForProvider(imageProvider);
          if (!apiKey || !apiKey.trim()) {
            throw new Error(`Missing API key for image provider ${imageProvider}`);
          }
          apiKey = apiKey.trim();
        } catch (err) {
          lastError = err;
          console.warn(
            `[cover-image] provider skipped: ${imageProvider} (missing key) (${Date.now() - startedAt}ms)`
          );
          continue;
        }

        for (let i = 0; i < models.length; i++) {
          const model = models[i];
          const modelStartedAt = Date.now();
          try {
            const generatedBuffer = await deps.callImageApiFn(
              prompt,
              apiKey,
              model,
              imageProvider,
              modelCandidates.strict
            );
          console.log(
            `[cover-image] model ${model} ok in ${Date.now() - modelStartedAt}ms (attempt ${attempt + 1}, provider=${imageProvider})`
          );
          generated = {
            imageBuffer: generatedBuffer.imageBuffer,
            imageProvider,
            apiKey,
            modelUsed: generatedBuffer.modelUsed,
            providerUsed: generatedBuffer.providerUsed,
          };
          break;
        } catch (err) {
          lastError = err;
          console.warn(
            `[cover-image] model failed: ${model} (provider=${imageProvider}) (${Date.now() - modelStartedAt}ms)`
          );
          console.warn(err);
        }
      }
      if (generated) break;
    }

    if (!generated) continue;

    const {
      imageBuffer: generatedBuffer,
      imageProvider,
      apiKey,
      modelUsed,
      providerUsed,
    } = generated;
    const imageMeta = detectImageFormat(generatedBuffer);
    lastGenerated = {
      imageBuffer: generatedBuffer,
      mimeType: imageMeta.mimeType,
      ext: imageMeta.ext,
      strict,
    };

    if (!deps.enforceReadableText) {
    return {
      imageBuffer: generatedBuffer,
      mimeType: imageMeta.mimeType,
      ext: imageMeta.ext,
      providerUsed,
      modelUsed,
      qualityCheck: attempt > 0 ? "retry_pass" : "pass",
      qualityIssues: [],
      textAdjusted: strict,
    };
    }

    const qaStartedAt = Date.now();
    const readability = await deps.evaluateCoverTextReadabilityFn(
      generatedBuffer,
      expectedTextHints,
      layoutPlan.safeArea,
      apiKey,
      imageProvider,
      params.platform
    );
    console.log(
      `[cover-image] readability check ${
        readability ? "completed" : "skipped"
      } in ${Date.now() - qaStartedAt}ms (attempt ${attempt + 1})`
    );

    if (!readability) {
      const canRetryUnavailable =
        requireStrictReadability &&
        attempt < AUTO_RETRY_LIMIT &&
        Date.now() - startedAt <= TOTAL_BUDGET_MS;
      if (canRetryUnavailable) {
        lastIssues = ["readability-check-unavailable"];
        continue;
      }
      if (requireStrictReadability) {
        return {
          imageBuffer: generatedBuffer,
          mimeType: imageMeta.mimeType,
          ext: imageMeta.ext,
          providerUsed,
          modelUsed,
          qualityCheck: attempt > 0 ? "retry_pass" : "pass",
          qualityIssues: ["readability-check-unavailable-soft-accepted"],
          textAdjusted: strict,
        };
      }
      return {
        imageBuffer: generatedBuffer,
        mimeType: imageMeta.mimeType,
        ext: imageMeta.ext,
        providerUsed,
        modelUsed,
        qualityCheck: attempt > 0 ? "retry_pass" : "pass",
        qualityIssues: ["readability-check-unavailable"],
        textAdjusted: strict,
      };
    }

    if (readability.pass) {
      return {
        imageBuffer: generatedBuffer,
        mimeType: imageMeta.mimeType,
        ext: imageMeta.ext,
        providerUsed,
        modelUsed,
        qualityCheck: attempt > 0 ? "retry_pass" : "pass",
        qualityIssues: readability.issues,
        textAdjusted: strict,
      };
    }

    lastIssues = readability.issues;
    console.warn(
      `[cover-image] readability check failed (attempt ${attempt + 1}): ${readability.issues.join(" | ")}`
    );
    const canRetryForReadability =
      attempt < AUTO_RETRY_LIMIT &&
      shouldRetryReadability(readability.issues) &&
      Date.now() - startedAt <= TOTAL_BUDGET_MS;
    if (!canRetryForReadability) {
      if (requireStrictReadability) {
        const issues =
          readability.issues.length > 0 ? readability.issues : ["readability-risk"];
        if (!hasCriticalReadabilityRisk(issues)) {
          console.warn(
            `[cover-image] note readability non-critical issues accepted: ${issues.join(" | ")}`
          );
          return {
            imageBuffer: generatedBuffer,
            mimeType: imageMeta.mimeType,
            ext: imageMeta.ext,
            providerUsed,
            modelUsed,
            qualityCheck: attempt > 0 ? "retry_pass" : "pass",
            qualityIssues: issues,
            textAdjusted: strict,
          };
        }
        throw new Error(`[cover-image] note readability check failed: ${issues.join(" | ")}`);
      }
      return {
        imageBuffer: generatedBuffer,
        mimeType: imageMeta.mimeType,
        ext: imageMeta.ext,
        providerUsed,
        modelUsed,
        qualityCheck: attempt > 0 ? "retry_pass" : "pass",
        qualityIssues: readability.issues.length
          ? readability.issues
          : ["readability-risk"],
        textAdjusted: strict,
      };
    }
  }

  throw new Error(
    `[cover-image] all models failed. last error: ${
      lastError instanceof Error ? lastError.message : String(lastError || lastIssues.join(" / "))
    }`
  );
}

export async function generateCoverImage(
  params: CoverImageParams
): Promise<CoverImageResult> {
  return generateCoverImageWithDeps(params, {
    callImageApiFn: callImageApi,
    evaluateCoverTextReadabilityFn: evaluateCoverTextReadability,
    getApiKeyFn: getApiKeyForProvider,
    getModelCandidatesFn: getModelCandidates,
    enforceReadableText: ENFORCE_READABLE_TEXT,
  });
}

export function __testOnlyBuildStyleAwareTextSet(
  params: CoverImageParams,
  styleId: CoverStyleId,
  strict = false
): CoverTextSet {
  return buildStyleAwareTextSet(params, styleId, strict);
}

export function __testOnlyBuildLectureInfographicPrompt(
  params: CoverImageParams,
  strict = false
): string {
  return buildLectureInfographicPrompt(params, strict);
}

export async function __testOnlyGenerateCoverImageWithDeps(
  params: CoverImageParams,
  deps: GenerateCoverImageDeps
): Promise<CoverImageResult> {
  return generateCoverImageWithDeps(params, deps);
}
