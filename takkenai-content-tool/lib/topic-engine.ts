import {
  getKnowledgePoints,
  getTools,
  getPastQuestions,
  seededRandom,
  dateToSeed,
  buildFullUrl,
  type KnowledgePoint,
  type Tool,
  type PastQuestion,
  type ContentAsset,
} from "./takkenai-data";
import { normalizeAssetLabel } from "./topic-label";
import {
  buildTakkenaiUrlFromPath,
  canonicalizeTakkenaiPath,
  choosePreferredTierForSlot,
  loadTrafficUrlProfile,
  pickTrafficUrlForSlot,
  type TrafficUrlGroup,
  type TrafficUrlTier,
} from "./traffic-url-profile";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Platform = "ameba" | "note" | "hatena";

export type SeasonalPhase =
  | "motivation-basics"    // Jan-Mar
  | "deep-dive"            // Apr-Jun
  | "practice-intensive"   // Jul-Sep
  | "exam-tips"            // Oct
  | "results-career";      // Nov-Dec

export interface MotherTopic {
  /** The primary content asset driving today's content */
  asset: ContentAsset;
  /** Seasonal phase determining the tone and approach */
  phase: SeasonalPhase;
  /** Human-readable Japanese label for the phase */
  phaseLabel: string;
  /** The date this topic is for (YYYY-MM-DD) */
  date: string;
  /** Full URL to the relevant takkenai.jp page */
  takkenaiUrl: string;
  /** Optional URL-driven topic label when URL is not mapped to an asset */
  topicLabelOverride?: string;
  /** Whether the URL came from asset mapping or direct URL selection */
  urlSelectionMode?: "asset" | "url-direct";
  /** URL traffic tier used by allocator */
  urlTier?: TrafficUrlTier;
  /** Optional secondary asset for cross-referencing */
  secondaryAsset?: ContentAsset;
}

export interface PlatformPlan {
  platform: Platform;
  /** Japanese label for the platform */
  platformLabel: string;
  /** The content angle/approach for this platform */
  angle: string;
  /** Suggested title in Japanese */
  titleSuggestion: string;
  /** Target character count */
  targetLength: { min: number; max: number };
  /** The takkenai.jp URL to link to */
  takkenaiUrl: string;
}

export interface DayTopics {
  /** Per-platform mother topics — each platform gets its own independent topic */
  motherTopics: {
    ameba: MotherTopic;
    note: MotherTopic;
    hatena: MotherTopic;
  };
  platforms: {
    ameba: PlatformPlan;
    note: PlatformPlan;
    hatena: PlatformPlan;
  };
}

// ---------------------------------------------------------------------------
// Seasonal phase detection
// ---------------------------------------------------------------------------

// 選題比率（全フェーズ共通）
// 1) ツール: 80%
// 2) ツール以外20%は、過去問 : 知識ポイント = 2 : 1
//    => 過去問 13.3% / 知識ポイント 6.7%
const TOOL_SHARE = 0.8;
const TOOL_VIDEO_MARKETING_SHARE = 0.4; // ツール内の40%を video/marketing 系に寄せる
const TOOL_FIRST_WEIGHTS = {
  knowledgePoint: 0.067,
  tool: TOOL_SHARE,
  pastQuestion: 0.133,
};

const PHASE_CONFIG: Record<
  SeasonalPhase,
  {
    label: string;
    weights: { knowledgePoint: number; tool: number; pastQuestion: number };
  }
> = {
  "motivation-basics": {
    label: "モチベーション・基礎固め期（1〜3月）",
    weights: TOOL_FIRST_WEIGHTS,
  },
  "deep-dive": {
    label: "深掘り・科目別学習期（4〜6月）",
    weights: TOOL_FIRST_WEIGHTS,
  },
  "practice-intensive": {
    label: "実践・模試・追い込み期（7〜9月）",
    weights: TOOL_FIRST_WEIGHTS,
  },
  "exam-tips": {
    label: "直前対策・予想期（10月）",
    weights: TOOL_FIRST_WEIGHTS,
  },
  "results-career": {
    label: "結果・キャリア期（11〜12月）",
    weights: TOOL_FIRST_WEIGHTS,
  },
};

export function getSeasonalPhase(month: number): SeasonalPhase {
  if (month >= 1 && month <= 3) return "motivation-basics";
  if (month >= 4 && month <= 6) return "deep-dive";
  if (month >= 7 && month <= 9) return "practice-intensive";
  if (month === 10) return "exam-tips";
  return "results-career";
}

// ---------------------------------------------------------------------------
// Deterministic asset selection
// ---------------------------------------------------------------------------

/**
 * Pick a content asset type based on seasonal weights and a seeded RNG.
 */
function pickAssetType(
  rng: () => number,
  phase: SeasonalPhase
): "knowledge-point" | "tool" | "past-question" {
  const w = PHASE_CONFIG[phase].weights;
  const roll = rng();
  if (roll < w.knowledgePoint) return "knowledge-point";
  if (roll < w.knowledgePoint + w.pastQuestion) return "past-question";
  return "tool";
}

/**
 * Select a specific asset from a pool using modular arithmetic for even rotation.
 * Uses the day-of-year + seed to cycle through items without repeating within
 * reasonable time spans.
 */
function selectFromPool<T>(pool: T[], seed: number, offset: number): T {
  const index = (seed + offset) % pool.length;
  return pool[index];
}

function isVideoOrMarketingTool(tool: Tool): boolean {
  const category = (tool.category || "").toLowerCase();
  const haystack = `${tool.name || ""} ${tool.slug || ""}`.toLowerCase();
  return category === "marketing" || /video/.test(haystack);
}

function selectToolByMix(seed: number, dayOfYear: number, rng: () => number): Tool {
  const tools = getTools();
  const videoMarketingTools = tools.filter(isVideoOrMarketingTool);
  const standardTools = tools.filter((tool) => !isVideoOrMarketingTool(tool));

  const preferVideoMarketing = rng() < TOOL_VIDEO_MARKETING_SHARE;
  const primaryPool =
    preferVideoMarketing && videoMarketingTools.length > 0
      ? videoMarketingTools
      : standardTools.length > 0
      ? standardTools
      : tools;

  return selectFromPool(
    primaryPool,
    seed + (preferVideoMarketing ? 131 : 733),
    dayOfYear
  );
}

/**
 * Use only the newest exam year for past-question themes.
 * This prevents old historical questions from being selected.
 */
function getLatestPastQuestionPool(): PastQuestion[] {
  const allQuestions = getPastQuestions();
  if (allQuestions.length === 0) {
    return [];
  }

  const latestYear = allQuestions.reduce(
    (max, pq) => (pq.year > max ? pq.year : max),
    allQuestions[0].year
  );

  return allQuestions
    .filter((pq) => pq.year === latestYear)
    .sort((a, b) => a.number - b.number);
}

export function getLatestPastQuestionYear(): number {
  const pool = getLatestPastQuestionPool();
  if (pool.length > 0) {
    return pool[0].year;
  }
  const all = getPastQuestions();
  if (all.length === 0) return new Date().getFullYear();
  return all.reduce((max, pq) => (pq.year > max ? pq.year : max), all[0].year);
}

/**
 * Generate the mother topic for a given date, with an optional platform offset
 * to ensure each platform gets a different topic.
 */
function generateMotherTopic(
  dateStr: string,
  platformOffset: number = 0,
  seedSalt: number = 0
): MotherTopic {
  const date = new Date(dateStr + "T00:00:00");
  const month = date.getMonth() + 1;
  const dayOfYear = getDayOfYear(date);
  const phase = getSeasonalPhase(month);
  const seed = dateToSeed(dateStr) + platformOffset + seedSalt * 7919;
  const rng = seededRandom(seed);

  const assetType = pickAssetType(rng, phase);

  let asset: ContentAsset;
  let takkenaiUrl: string;

  switch (assetType) {
    case "knowledge-point": {
      const pool = getKnowledgePoints();
      const item = selectFromPool(pool, seed, dayOfYear);
      asset = { type: "knowledge-point", data: item };
      takkenaiUrl = buildFullUrl(item.takkenaiUrl);
      break;
    }
    case "tool": {
      const item = selectToolByMix(seed, dayOfYear, rng);
      asset = { type: "tool", data: item };
      takkenaiUrl = buildFullUrl(item.takkenaiUrl);
      break;
    }
    case "past-question": {
      const latestPool = getLatestPastQuestionPool();
      const pool = latestPool.length > 0 ? latestPool : getPastQuestions();
      const item = selectFromPool(pool, seed, dayOfYear);
      asset = { type: "past-question", data: item };
      takkenaiUrl = buildFullUrl(item.takkenaiUrl);
      break;
    }
  }

  // Pick a secondary asset for cross-referencing (different type)
  const secondaryType =
    assetType === "tool" ? "knowledge-point" : "tool";
  let secondaryAsset: ContentAsset | undefined;
  if (secondaryType === "knowledge-point") {
    const pool = getKnowledgePoints();
    const item = selectFromPool(pool, seed, dayOfYear + 37);
    secondaryAsset = { type: "knowledge-point", data: item };
  } else {
    const pool = getTools();
    const item = selectFromPool(pool, seed, dayOfYear + 37);
    secondaryAsset = { type: "tool", data: item };
  }

  return {
    asset,
    phase,
    phaseLabel: PHASE_CONFIG[phase].label,
    date: dateStr,
    takkenaiUrl,
    secondaryAsset,
  };
}

// ---------------------------------------------------------------------------
// Traffic URL allocation (GA4 profile driven)
// ---------------------------------------------------------------------------

type AssetTypeName = ContentAsset["type"];

let assetByCanonicalPathCache: Map<string, ContentAsset> | null = null;

function assetTypeToLabelType(
  type: AssetTypeName
): "knowledge-point" | "tool" | "past-question" {
  if (type === "tool") return "tool";
  if (type === "past-question") return "past-question";
  return "knowledge-point";
}

function getAssetByCanonicalPath(): Map<string, ContentAsset> {
  if (assetByCanonicalPathCache) return assetByCanonicalPathCache;
  const map = new Map<string, ContentAsset>();

  const tools = getTools();
  for (let i = 0; i < tools.length; i++) {
    const path = canonicalizeTakkenaiPath(tools[i].takkenaiUrl);
    if (!path) continue;
    map.set(path, { type: "tool", data: tools[i] });
  }

  const knowledgePoints = getKnowledgePoints();
  for (let i = 0; i < knowledgePoints.length; i++) {
    const path = canonicalizeTakkenaiPath(knowledgePoints[i].takkenaiUrl);
    if (!path || map.has(path)) continue;
    map.set(path, { type: "knowledge-point", data: knowledgePoints[i] });
  }

  const pastQuestions = getPastQuestions();
  for (let i = 0; i < pastQuestions.length; i++) {
    const path = canonicalizeTakkenaiPath(pastQuestions[i].takkenaiUrl);
    if (!path || map.has(path)) continue;
    map.set(path, { type: "past-question", data: pastQuestions[i] });
  }

  assetByCanonicalPathCache = map;
  return map;
}

function resolveTrafficGroupFromAsset(asset: ContentAsset): TrafficUrlGroup {
  return asset.type === "tool" ? "tool" : "takken";
}

function resolveAssetFromTrafficPath(
  pathValue: string,
  expectedGroup: TrafficUrlGroup
): ContentAsset | null {
  const canonicalPath = canonicalizeTakkenaiPath(pathValue);
  if (!canonicalPath) return null;
  const found = getAssetByCanonicalPath().get(canonicalPath);
  if (!found) return null;
  if (expectedGroup === "tool" && found.type !== "tool") return null;
  if (expectedGroup === "takken" && found.type === "tool") return null;
  return found;
}

function applyTrafficUrlSelection(params: {
  date: string;
  platform: Platform;
  topic: MotherTopic;
  usedCanonicalUrls: Set<string>;
  seedSalt: number;
  attempt: number;
}): MotherTopic {
  const profile = loadTrafficUrlProfile();
  if (!profile) return params.topic;

  const group = resolveTrafficGroupFromAsset(params.topic.asset);
  const preferredTier = choosePreferredTierForSlot({
    date: params.date,
    platform: params.platform,
    seedSalt: params.seedSalt + params.attempt * 37,
    strategy: profile.strategy,
  });

  const picked = pickTrafficUrlForSlot({
    profile,
    date: params.date,
    platform: params.platform,
    group,
    preferredTier,
    excludeCanonicalPaths: params.usedCanonicalUrls,
    seedSalt: params.seedSalt,
    attempt: params.attempt,
  });
  if (!picked) return params.topic;

  const canonicalPath = canonicalizeTakkenaiPath(picked.path);
  const selectedUrl = buildTakkenaiUrlFromPath(canonicalPath);
  const mappedAsset = resolveAssetFromTrafficPath(canonicalPath, group);
  if (mappedAsset) {
    return {
      ...params.topic,
      asset: mappedAsset,
      takkenaiUrl: selectedUrl,
      topicLabelOverride: undefined,
      urlSelectionMode: "asset",
      urlTier: picked.tier,
    };
  }

  const labelType = assetTypeToLabelType(params.topic.asset.type);
  const topicLabel = normalizeAssetLabel(
    picked.labelJa || canonicalPath,
    labelType,
    selectedUrl
  );
  return {
    ...params.topic,
    takkenaiUrl: selectedUrl,
    topicLabelOverride: topicLabel,
    urlSelectionMode: "url-direct",
    urlTier: picked.tier,
  };
}

// ---------------------------------------------------------------------------
// Platform-specific angle generation
// ---------------------------------------------------------------------------

/**
 * Generate platform-specific content angles based on per-platform mother topics.
 * Each platform has its own topic, style, audience expectation, and content structure.
 */
function generatePlatformPlans(
  motherTopics: DayTopics["motherTopics"]
): DayTopics["platforms"] {
  return {
    ameba: {
      platform: "ameba",
      platformLabel: "Ameba（アメブロ）",
      angle: "場面別やさしい解説 / 実務ヒント",
      titleSuggestion: generateAmebaTitle(getAssetLabel(motherTopics.ameba.asset), motherTopics.ameba.phase),
      targetLength: { min: 800, max: 1200 },
      takkenaiUrl: motherTopics.ameba.takkenaiUrl,
    },
    note: {
      platform: "note",
      platformLabel: "note",
      angle: "深掘り分析 / 実務視点",
      titleSuggestion: generateNoteTitle(getAssetLabel(motherTopics.note.asset), motherTopics.note.phase),
      targetLength: { min: 2000, max: 3000 },
      takkenaiUrl: motherTopics.note.takkenaiUrl,
    },
    hatena: {
      platform: "hatena",
      platformLabel: "はてなブログ",
      angle: "完全ガイド / 保存版まとめ",
      titleSuggestion: generateHatenaTitle(getAssetLabel(motherTopics.hatena.asset), motherTopics.hatena.phase),
      targetLength: { min: 1500, max: 3000 },
      takkenaiUrl: motherTopics.hatena.takkenaiUrl,
    },
  };
}

// ---------------------------------------------------------------------------
// Title generation helpers
// ---------------------------------------------------------------------------

function getAssetLabel(asset: ContentAsset): string {
  switch (asset.type) {
    case "knowledge-point": {
      const kp = asset.data as KnowledgePoint;
      return normalizeAssetLabel(kp.title, "knowledge-point", kp.takkenaiUrl);
    }
    case "tool": {
      const tool = asset.data as Tool;
      return normalizeAssetLabel(tool.name, "tool", tool.takkenaiUrl);
    }
    case "past-question": {
      const pq = asset.data as PastQuestion;
      return `${pq.year}年 問${pq.number}`;
    }
  }
}

function getPhaseContext(phase: SeasonalPhase): string {
  switch (phase) {
    case "motivation-basics":
      return "基礎をしっかり固めよう";
    case "deep-dive":
      return "科目別に深掘りしよう";
    case "practice-intensive":
      return "実践力をつけよう";
    case "exam-tips":
      return "直前対策で差をつけよう";
    case "results-career":
      return "合格後のキャリアを考えよう";
  }
}

/** Ameba: scenario/simple style - casual, practical, inviting */
function generateAmebaTitle(topicLabel: string, phase: SeasonalPhase): string {
  const templates: Record<SeasonalPhase, string[]> = {
    "motivation-basics": [
      `【宅建の基礎】${topicLabel}をやさしく整理しよう`,
      `3分でつかむ${topicLabel}の基本ポイント`,
      `宅建の土台づくり：${topicLabel}をやさしく解説`,
    ],
    "deep-dive": [
      `【実務視点】${topicLabel}を日常の場面で理解する`,
      `${topicLabel}をわかりやすく深掘りする`,
      `宅建学習を前進させる${topicLabel}の読み方`,
    ],
    "practice-intensive": [
      `【直前整理】${topicLabel}で間違えやすい点を先に潰す`,
      `本番前に押さえる${topicLabel}の実践ポイント`,
      `失点しやすい${topicLabel}を短時間で整理`,
    ],
    "exam-tips": [
      `【直前まとめ】${topicLabel}の最終ポイント整理`,
      `試験直前に見直す${topicLabel}の要点`,
      `宅建本番前に固める${topicLabel}の実戦メモ`,
    ],
    "results-career": [
      `宅建合格おめでとう！${topicLabel}を実務で活かすコツ`,
      `宅建合格後に知りたい${topicLabel}の実務知識`,
      `${topicLabel}って実務でこう使う！合格後の世界`,
    ],
  };

  const options = templates[phase];
  return options[0];
}

/** note: deep analysis style - professional, insightful */
function generateNoteTitle(topicLabel: string, phase: SeasonalPhase): string {
  const templates: Record<SeasonalPhase, string[]> = {
    "motivation-basics": [
      `なぜ${topicLabel}を理解すると宅建合格率が上がるのか`,
      `宅建学習の第一歩：${topicLabel}の本質を理解する`,
      `AIが分析する${topicLabel}の学習効率を上げるポイント`,
    ],
    "deep-dive": [
      `${topicLabel}の深掘り：合格者が押さえている意外なポイント`,
      `実務経験者が語る${topicLabel}の本当の意味`,
      `データで見る${topicLabel}の出題傾向と対策`,
    ],
    "practice-intensive": [
      `${topicLabel}で差がつく！本試験レベルの実践分析`,
      `合格者のリアルな声：${topicLabel}はこう攻略した`,
      `AIが解説する${topicLabel}の実践的アプローチ`,
    ],
    "exam-tips": [
      `【直前分析】${topicLabel}の今年の出題予想と対策`,
      `本試験で${topicLabel}が出たらこう解く：合格者の思考法`,
      `${topicLabel}の最新傾向をAIが分析`,
    ],
    "results-career": [
      `宅建合格後、${topicLabel}の知識はキャリアにこう活きる`,
      `不動産業界で${topicLabel}の知識が求められる理由`,
      `宅建士として${topicLabel}を武器にする方法`,
    ],
  };

  const options = templates[phase];
  return options[0];
}

/** hatena: reference guide style - structured, data-driven */
function generateHatenaTitle(topicLabel: string, phase: SeasonalPhase): string {
  const templates: Record<SeasonalPhase, string[]> = {
    "motivation-basics": [
      `【保存版】${topicLabel}完全ガイド：宅建学習の基礎を固める`,
      `${topicLabel}の全体像を整理：宅建学習ロードマップ`,
      `【まとめ】${topicLabel}の基本と学習ポイント一覧`,
    ],
    "deep-dive": [
      `【完全解説】${topicLabel}の要点整理と頻出パターンまとめ`,
      `${topicLabel}を体系的に理解する：図解＆表で整理`,
      `【データ分析】${topicLabel}の最新出題傾向まとめ`,
    ],
    "practice-intensive": [
      `【実践ガイド】${topicLabel}の出題パターンと解法まとめ`,
      `${topicLabel}の頻出論点チェックリスト【保存版】`,
      `【過去問分析】${topicLabel}の正答率データと攻略法`,
    ],
    "exam-tips": [
      `【直前チェック】${topicLabel}の重要ポイント完全まとめ`,
      `試験前に確認！${topicLabel}の最終チェックリスト`,
      `【予想問題付き】${topicLabel}の直前対策ガイド`,
    ],
    "results-career": [
      `【キャリアガイド】${topicLabel}の知識を活かせる不動産の仕事`,
      `宅建合格後のステップ：${topicLabel}の実務活用まとめ`,
      `【業界分析】${topicLabel}に関連する不動産キャリアパス`,
    ],
  };

  const options = templates[phase];
  return options[0];
}

// ---------------------------------------------------------------------------
// Date-aware seasonal context (月別・時期別の時令ガイド)
// ---------------------------------------------------------------------------

/**
 * 日付に基づいた精細な時令コンテキストを返す。
 * AI が「新年」を2月に書くような季節ズレを防ぐために、
 * 具体的な日付を伝え、適切なテーマと禁止テーマを明示する。
 */
export function getDateSeasonalContext(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const month = date.getMonth() + 1;
  const day = date.getDate();

  // 曜日
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const weekday = weekdays[date.getDay()];
  const dateDisplay = `${month}月${day}日（${weekday}）`;

  // 宅建試験は毎年10月第3日曜日 — 残り日数の目安
  const examMonth = 10;
  const examYear = month <= 10 ? date.getFullYear() : date.getFullYear() + 1;
  const examApprox = new Date(examYear, examMonth - 1, 15); // 10月15日を概算
  const daysToExam = Math.round(
    (examApprox.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
  );

  let seasonalTheme: string;
  let appropriateHooks: string;
  let avoidThemes: string;

  if (month === 1 && day <= 10) {
    // 1月上旬: 新年OK
    seasonalTheme = "新年・学習スタート期";
    appropriateHooks =
      "新年の目標設定、今年こそ宅建合格、年始の学習計画、冬休み中の勉強";
    avoidThemes = "特になし";
  } else if (month === 1) {
    // 1月中旬〜下旬: 新年はもう終わり
    seasonalTheme = "冬の基礎固め期";
    appropriateHooks =
      "冬の学習習慣づくり、基礎インプット開始、寒い時期の勉強モチベーション維持";
    avoidThemes = "「新年」「年始」「お正月」— 1月中旬以降は新年ムードは終了";
  } else if (month === 2) {
    // 2月: 基礎学習本格化
    seasonalTheme = "基礎学習本格化・インプット期";
    appropriateHooks = [
      "基礎固めの本番、学習ペースの確立",
      "確定申告シーズン（不動産の税金知識と絡める好機）",
      "不動産業界の繁忙期入り（実務の話題）",
      day <= 3 ? "節分（季節の話題として軽く触れる程度）" : "",
      day >= 10 && day <= 14 ? "バレンタイン前後（軽い雑談程度）" : "",
      "春に向けた学習計画の見直し",
    ]
      .filter(Boolean)
      .join("、");
    avoidThemes =
      "「新年」「年始」「お正月」「年末年始」— 2月は完全に新年ではない。絶対に使わないこと";
  } else if (month === 3) {
    // 3月: 年度末・春の始まり
    seasonalTheme = "年度末・春の学習シーズン到来";
    appropriateHooks =
      "年度末の振り返り、春からの学習本格化、引っ越しシーズン（不動産繁忙期）、桜・春の訪れ、4月開講の宅建講座";
    avoidThemes =
      "「新年」「年始」— 3月は春。「冬の〜」も不適切（春の話題を使う）";
  } else if (month === 4) {
    seasonalTheme = "新年度スタート・学習本格開始";
    appropriateHooks =
      "新年度・新生活、宅建講座の開講、新社会人のキャリアアップ、春の学習モチベーション";
    avoidThemes = "「新年」— 4月は新年度であって新年ではない";
  } else if (month === 5) {
    seasonalTheme = "GW集中学習・科目別深掘り期";
    appropriateHooks =
      "GW(ゴールデンウィーク)の集中学習、中間振り返り、科目別の弱点克服";
    avoidThemes = "「新年」「年始」";
  } else if (month === 6) {
    seasonalTheme = "梅雨・申込準備期";
    appropriateHooks =
      "梅雨の自宅学習、試験申込の準備、科目別の仕上げ、折り返し地点";
    avoidThemes = "「新年」「年始」";
  } else if (month === 7) {
    seasonalTheme = "夏の集中学習・申込開始";
    appropriateHooks =
      "夏の集中学習、試験申込手続き、過去問演習の開始、模試の活用";
    avoidThemes = "「新年」「年始」";
  } else if (month === 8) {
    seasonalTheme = "お盆返上・模試シーズン";
    appropriateHooks =
      "お盆期間の集中学習、模試で実力チェック、弱点の最終補強、ラストスパートへ";
    avoidThemes = "「新年」「年始」";
  } else if (month === 9) {
    seasonalTheme = "追い込み・直前対策開始";
    appropriateHooks =
      "直前期の追い込み、頻出論点の総復習、時間配分の練習、メンタル管理";
    avoidThemes = "「新年」「年始」「基礎固め」— 9月は基礎ではなく実践";
  } else if (month === 10) {
    seasonalTheme = "試験直前・本番月";
    appropriateHooks =
      "試験直前の最終確認、当日の心構え、直前に差がつくポイント、合格ラインの予想";
    avoidThemes =
      "「新年」「基礎固め」— 試験直前期に基礎の話はミスマッチ";
  } else if (month === 11) {
    seasonalTheme = "合格発表・結果期";
    appropriateHooks =
      "合格発表、合格後の登録手続き、実務講習、キャリアプラン、来年度受験者への助言";
    avoidThemes = "「直前対策」「試験対策」— 試験は終了済み";
  } else {
    // 12月
    seasonalTheme = "年末・来年度計画期";
    appropriateHooks =
      "年末の振り返り、来年の宅建学習計画、キャリア検討、不動産業界の年末動向";
    avoidThemes = "「直前対策」「試験対策」— 試験は終了済み";
  }

  return `## 時令ガイド（厳守）
- 今日の日付: ${dateDisplay}
- 時期テーマ: ${seasonalTheme}
- 試験まで: 約${daysToExam}日
- 適切な切り口: ${appropriateHooks}
- 禁止テーマ: ${avoidThemes}

【重要】記事のフック・導入・タイトルは必ず上記の「適切な切り口」に沿ったものにしてください。
「禁止テーマ」に該当する表現は、タイトル・本文・ハッシュタグのいずれにも絶対に使わないでください。`;
}

// ---------------------------------------------------------------------------
// Utility: day of year
// ---------------------------------------------------------------------------

function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a unique identifier for a mother topic's primary asset.
 */
function getMotherTopicAssetId(mt: MotherTopic): string {
  const asset = mt.asset;
  switch (asset.type) {
    case "knowledge-point":
      return `kp:${asset.data.id}`;
    case "tool":
      return `tool:${asset.data.id}`;
    case "past-question":
      return `pq:${asset.data.id}`;
  }
}

function getMotherTopicUrlKey(mt: MotherTopic): string {
  const canonicalPath = canonicalizeTakkenaiPath(mt.takkenaiUrl);
  if (canonicalPath) return canonicalPath;
  return `asset:${getMotherTopicAssetId(mt)}`;
}

/**
 * Generate 3 independent mother topics and platform-specific content plans for a given date.
 * Each platform gets its own unique topic to maximize content variety.
 *
 * @param date - Date string in YYYY-MM-DD format
 * @returns DayTopics with per-platform motherTopics and platform plans
 */
export function generateDayTopics(date: string, seedSalt: number = 0): DayTopics {
  // Use prime-number offsets to ensure different topics per platform
  const PLATFORM_OFFSETS: Record<Platform, number> = {
    ameba: 0,
    note: 997,
    hatena: 1999,
  };

  const motherTopics = {} as DayTopics["motherTopics"];
  const usedUrlKeys = new Set<string>();
  const debugRows: string[] = [];

  for (const platform of ["ameba", "note", "hatena"] as const) {
    let selectedTopic: MotherTopic | null = null;
    let attempts = 0;

    // Generate topic and ensure no duplicate URLs across platforms (canonical path).
    while (attempts < 20) {
      const offset = PLATFORM_OFFSETS[platform] + attempts * 7;
      const baseTopic = generateMotherTopic(date, offset, seedSalt);
      const withTraffic = applyTrafficUrlSelection({
        date,
        platform,
        topic: baseTopic,
        usedCanonicalUrls: usedUrlKeys,
        seedSalt,
        attempt: attempts,
      });
      const urlKey = getMotherTopicUrlKey(withTraffic);
      if (!usedUrlKeys.has(urlKey)) {
        usedUrlKeys.add(urlKey);
        selectedTopic = withTraffic;
        break;
      }
      attempts++;
    }

    if (!selectedTopic) {
      const fallbackOffset = PLATFORM_OFFSETS[platform] + 9973;
      const fallbackTopic = generateMotherTopic(date, fallbackOffset, seedSalt + 1);
      const fallbackKey = getMotherTopicUrlKey(fallbackTopic);
      if (!usedUrlKeys.has(fallbackKey)) {
        usedUrlKeys.add(fallbackKey);
      }
      selectedTopic = fallbackTopic;
    }

    motherTopics[platform] = selectedTopic;
    debugRows.push(
      `${platform}: url=${selectedTopic.takkenaiUrl} tier=${selectedTopic.urlTier || "n/a"} mode=${
        selectedTopic.urlSelectionMode || "asset"
      } attempts=${attempts + 1}`
    );
  }

  if (process.env.NODE_ENV !== "production") {
    console.log(`[topic-engine] ${date} URL allocation\n${debugRows.join("\n")}`);
  }

  const platforms = generatePlatformPlans(motherTopics);

  return {
    motherTopics,
    platforms,
  };
}

/**
 * Preview topics for a range of dates.
 * Useful for calendar views and batch planning.
 */
export function previewTopics(
  startDate: string,
  days: number
): DayTopics[] {
  const result: DayTopics[] = [];
  const start = new Date(startDate + "T00:00:00");

  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split("T")[0];
    result.push(generateDayTopics(dateStr));
  }

  return result;
}
