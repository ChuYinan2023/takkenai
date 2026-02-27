import type { Platform } from "./topic-engine";

export interface AiActionSignals {
  hasConcreteCase: boolean;
  hasSpecificNumbers: boolean;
  hasSourceWithYear: boolean;
  duplicateParagraphCount: number;
  termConsistencyPassed: boolean;
}

export interface AiActionReport {
  requiredActions: string[];
  completedActions: string[];
  unresolvedActions: string[];
  completionScore: number;
  signals: AiActionSignals;
}

export interface EvaluateAiActionContext {
  platform?: Platform;
  primaryKeyword?: string;
  requiredTerms?: string[];
  evidenceFailureReason?: string;
}

const SOURCE_KEYWORD_REGEX =
  /(出典|調査|統計|データ|公表|発表|白書|資料|レポート|国土交通省|総務省|厚生労働省|金融庁|内閣府|消費者庁|国税庁|source|来源|資料來源)/i;
const YEAR_REGEX =
  /(?:19|20)\d{2}(?:年|年度)?|令和\d+年(?:度)?|平成\d+年(?:度)?|昭和\d+年(?:度)?/;
const CASE_REGEX = /(ケース|事例|実務シナリオ|シナリオ|場面|具体例|案例|场景)/i;
const STEP_REGEX =
  /(手順|ステップ|まず|次に|最後に|1\.|2\.|3\.|①|②|③|第一|第二|第三)/;
const NUMBER_WITH_UNIT_REGEX =
  /(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:%|％|円|万円|億円|件|人|日|年|か月|ヶ月|倍|ポイント|問)/;
const NUMERIC_REGEX = /\d+/;

const ACTION_CASE_REGEX = /(実務|ケース|事例|場景|シナリオ|案例)/i;
const ACTION_EVIDENCE_REGEX = /(統計|数据|データ|数値|出典|来源|信頼性|根拠|引用|ソース)/i;
const ACTION_DEDUPE_REGEX = /(重复|重複|冗長|重複段落|削除|整合|統合)/i;
const ACTION_TERM_REGEX = /(用語|術語|术语|表現|表述|概念|一貫|一致|統一)/i;

const STOPWORDS = new Set([
  "文章",
  "内容",
  "部分",
  "具体",
  "提升",
  "优化",
  "改善",
  "建议",
  "补充",
  "增加",
  "删除",
  "整理",
  "日本語",
  "本文",
  "対応",
  "必要",
]);

const TERM_VARIANT_MAP: Array<{ canonical: string; variants: string[] }> = [
  { canonical: "課税標準額", variants: ["課税標準金額"] },
  { canonical: "固定資産税", variants: ["固定資產税"] },
];

function normalizeText(input: string): string {
  return (input || "")
    .normalize("NFKC")
    .replace(/[【】\[\]「」『』"'`]/g, "")
    .replace(/[!！?？:：・\-—―、。,.()\s]/g, "")
    .toLowerCase();
}

function splitParagraphs(body: string): string[] {
  return (body || "")
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function makeBigrams(text: string): Set<string> {
  const out = new Set<string>();
  if (text.length < 2) return out;
  for (let i = 0; i < text.length - 1; i++) {
    out.add(text.slice(i, i + 2));
  }
  return out;
}

function jaccardSimilarity(a: string, b: string): number {
  const aSet = makeBigrams(a);
  const bSet = makeBigrams(b);
  if (aSet.size === 0 || bSet.size === 0) return 0;

  let intersect = 0;
  aSet.forEach((token) => {
    if (bSet.has(token)) intersect += 1;
  });
  const union = aSet.size + bSet.size - intersect;
  return union <= 0 ? 0 : intersect / union;
}

function isNearDuplicate(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;

  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);
  if (minLen >= 50 && (a.includes(b) || b.includes(a)) && minLen / maxLen >= 0.9) {
    return true;
  }

  return jaccardSimilarity(a, b) >= 0.92;
}

function countDuplicateParagraphs(body: string): number {
  const normalized = splitParagraphs(body).map((item) => normalizeText(item)).filter(Boolean);
  const kept: string[] = [];
  let duplicates = 0;

  for (const para of normalized) {
    const repeated = kept.some((base) => isNearDuplicate(base, para));
    if (repeated) {
      duplicates += 1;
    } else {
      kept.push(para);
    }
  }
  return duplicates;
}

function hasConcreteCase(body: string): boolean {
  if (!CASE_REGEX.test(body)) return false;
  return STEP_REGEX.test(body);
}

function hasSpecificNumbers(body: string): boolean {
  if (NUMBER_WITH_UNIT_REGEX.test(body)) return true;
  return NUMERIC_REGEX.test(body);
}

function hasSourceWithYear(body: string): boolean {
  const paragraphs = splitParagraphs(body);
  return paragraphs.some((para) => SOURCE_KEYWORD_REGEX.test(para) && YEAR_REGEX.test(para));
}

function extractTermsFromActions(actions: string[]): string[] {
  const terms: string[] = [];

  for (const action of actions) {
    const quoted = action.match(/[「"'“](.{2,24}?)[」"'”]/g) || [];
    for (const fragment of quoted) {
      const cleaned = fragment.replace(/[「」"'“”]/g, "").trim();
      if (cleaned.length >= 2) terms.push(cleaned);
    }

    for (const { canonical, variants } of TERM_VARIANT_MAP) {
      if (action.includes(canonical)) terms.push(canonical);
      for (const variant of variants) {
        if (action.includes(variant)) terms.push(canonical);
      }
    }
  }

  return Array.from(new Set(terms));
}

function termConsistencyPassed(
  body: string,
  requiredTerms: string[],
  primaryKeyword: string
): boolean {
  const normalizedBody = normalizeText(body);
  const required = Array.from(
    new Set(
      [...requiredTerms, primaryKeyword]
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );

  if (required.length > 0) {
    const allFound = required.every((term) =>
      normalizedBody.includes(normalizeText(term))
    );
    if (!allFound) return false;
  }

  for (const { canonical, variants } of TERM_VARIANT_MAP) {
    const hasCanonical = normalizedBody.includes(normalizeText(canonical));
    if (!hasCanonical) continue;
    for (const variant of variants) {
      if (normalizedBody.includes(normalizeText(variant))) {
        return false;
      }
    }
  }

  return true;
}

function extractActionKeywords(action: string): string[] {
  const candidates =
    action.match(/[A-Za-z0-9\u3040-\u30ff\u3400-\u9fff]{2,}/g)?.map((s) => s.trim()) || [];
  return candidates.filter((token) => !STOPWORDS.has(token));
}

function isActionCompleted(
  action: string,
  body: string,
  signals: AiActionSignals,
  context: EvaluateAiActionContext
): boolean {
  if (ACTION_CASE_REGEX.test(action)) {
    return signals.hasConcreteCase;
  }
  if (ACTION_EVIDENCE_REGEX.test(action)) {
    return signals.hasSpecificNumbers && signals.hasSourceWithYear;
  }
  if (ACTION_DEDUPE_REGEX.test(action)) {
    return signals.duplicateParagraphCount === 0;
  }
  if (ACTION_TERM_REGEX.test(action)) {
    return signals.termConsistencyPassed;
  }

  const normalizedBody = normalizeText(body);
  const keywordHits = extractActionKeywords(action)
    .map((token) => normalizeText(token))
    .filter(Boolean)
    .filter((token) => normalizedBody.includes(token));

  if (keywordHits.length > 0) return true;
  if (context.primaryKeyword) {
    return normalizedBody.includes(normalizeText(context.primaryKeyword));
  }
  return false;
}

export function evaluateAiActionCompletion(
  body: string,
  aiActions: string[] = [],
  context: EvaluateAiActionContext = {}
): AiActionReport {
  const requiredActions = (aiActions || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 5);

  const dedupeCount = countDuplicateParagraphs(body);
  const requiredTerms = [
    ...(context.requiredTerms || []),
    ...extractTermsFromActions(requiredActions),
  ];

  const signals: AiActionSignals = {
    hasConcreteCase: hasConcreteCase(body),
    hasSpecificNumbers: hasSpecificNumbers(body),
    hasSourceWithYear: hasSourceWithYear(body),
    duplicateParagraphCount: dedupeCount,
    termConsistencyPassed: termConsistencyPassed(
      body,
      requiredTerms,
      context.primaryKeyword || ""
    ),
  };

  if (requiredActions.length === 0) {
    return {
      requiredActions: [],
      completedActions: [],
      unresolvedActions: [],
      completionScore: 100,
      signals,
    };
  }

  const completedActions: string[] = [];
  const unresolvedActions: string[] = [];
  const hasSourceCue = SOURCE_KEYWORD_REGEX.test(body);
  for (const action of requiredActions) {
    if (
      ACTION_EVIDENCE_REGEX.test(action) &&
      context.evidenceFailureReason &&
      signals.hasSpecificNumbers &&
      hasSourceCue
    ) {
      // If external evidence fetch is unavailable, do not hard-block on evidence actions
      // when the article already contains source cues + concrete numbers.
      completedActions.push(action);
      continue;
    }
    if (isActionCompleted(action, body, signals, context)) {
      completedActions.push(action);
    } else {
      unresolvedActions.push(action);
    }
  }

  if (context.evidenceFailureReason) {
    const evidenceRelated = unresolvedActions.some((item) =>
      ACTION_EVIDENCE_REGEX.test(item)
    );
    if (evidenceRelated) {
      unresolvedActions.push(`证据补强受限: ${context.evidenceFailureReason}`);
    }
  }

  const completionScore =
    requiredActions.length === 0
      ? 100
      : Math.round((completedActions.length / requiredActions.length) * 100);

  return {
    requiredActions,
    completedActions,
    unresolvedActions,
    completionScore: Math.max(0, Math.min(100, completionScore)),
    signals,
  };
}
