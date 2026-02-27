import type { Platform } from "./topic-engine";
import type { AiActionReport } from "./ai-action-report";
import {
  evaluateChatgptSearchRules,
  type ChatgptSearchSignals,
} from "./chatgpt-search-report";

export interface SeoGeoSignals {
  keywordInTitle: boolean;
  keywordInIntro: boolean;
  keywordInHeadings: boolean;
  answerFirstIntro: boolean;
  hasDefinition: boolean;
  faqCount: number;
  hasDataCitation: boolean;
  hasStructuredHeadings: boolean;
  hasQuoteFriendlyBullets: boolean;
  hasTable: boolean;
}

export interface SeoGeoAiReview {
  aiStatus: "ok" | "fallback";
  aiSummaryChinese?: string;
  aiActionsChinese?: string[];
}

export interface SeoGeoReport extends SeoGeoAiReview {
  passed: boolean;
  seoScore: number;
  geoScore: number;
  chatgptSearchScore: number;
  chatgptSearchPassed: boolean;
  chatgptSearchIssues: string[];
  chatgptSearchStrengths: string[];
  chatgptSearchSignals: ChatgptSearchSignals;
  primaryKeyword: string;
  issues: string[];
  strengths: string[];
  signals: SeoGeoSignals;
  aiActionReport?: AiActionReport;
  dualThresholdPassed?: boolean;
  fullThresholdPassed?: boolean;
}

export interface EvaluateSeoGeoInput {
  platform: Platform;
  title: string;
  body: string;
  seoTitle?: string;
  primaryKeyword?: string;
  trackedUrl?: string;
}

const DATA_CITATION_REGEX =
  /(出典|調査|統計|データ|公表|発表|白書|資料|レポート|国土交通省|総務省|厚生労働省|金融庁|内閣府|消費者庁|国税庁|年度|年版)/;

const YEAR_REGEX =
  /(?:(?:19|20)\d{2}年?|(?:19|20)\d{2}年度|令和\d+年?|令和\d+年度|平成\d+年?|平成\d+年度|昭和\d+年?|昭和\d+年度)/;
const FAQ_LINE_REGEX = /^\s*(?:\*\*)?Q(?:[0-9０-９]+(?:[.．:：])?|[:：])\s*/gim;
const INTRO_SUMMARY_OR_HOOK_REGEX =
  /(?:結論|先に結論|要点|本記事では|この記事では|まず結論|最初に結論|実は|意外|見落としがち|ご存じ|なぜ|どうして|ポイント|鍵|コツ)/;

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeForSearch(text: string): string {
  return (text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000]/g, "")
    .replace(/[「」『』【】\[\]（）()、。・,:：!?！？]/g, "");
}

function inferPrimaryKeywordFromTitle(title: string): string {
  const cleaned = (title || "")
    .replace(/[【】\[\]「」『』]/g, " ")
    .split(/[|｜:：\-―—]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (cleaned.length === 0) return "";

  const japaneseLike = cleaned.find((s) => /[\u3040-\u30ff\u3400-\u9fff]/.test(s));
  return japaneseLike || cleaned[0];
}

function firstParagraph(text: string): string {
  const lines = (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  return lines.slice(0, 3).join(" ");
}

function extractHeadings(body: string): string[] {
  return (body.match(/^##+\s+.+$/gm) || []).map((line) => line.replace(/^##+\s+/, "").trim());
}

function countFaq(body: string): number {
  const headingFaq = (body.match(/^##+\s*(?:FAQ|よくある質問|Q&A|Q＆A)/gim) || []).length;
  const qLineFaq = (body.match(FAQ_LINE_REGEX) || []).length;
  return Math.max(headingFaq, qLineFaq);
}

function hasTableMarkdown(body: string): boolean {
  const hasAnyRow = /^\|.+\|$/m.test(body);
  const hasSeparator = /^\|(?:\s*:?-+:?\s*\|)+\s*$/m.test(body);
  return hasAnyRow && hasSeparator;
}

function detectQuoteFriendlyBullets(body: string): boolean {
  const bullets = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line));
  return bullets.length >= 2;
}

function requiredFaqCount(platform: Platform): number {
  if (platform === "ameba") return 1;
  return 2;
}

const PASS_SCORE_THRESHOLD = 85;

export function evaluateSeoGeoRules(input: EvaluateSeoGeoInput): SeoGeoReport {
  const { platform, title, body, seoTitle = "", trackedUrl = "" } = input;
  const primaryKeyword = (input.primaryKeyword || inferPrimaryKeywordFromTitle(title)).trim();

  const normalizedKeyword = normalizeForSearch(primaryKeyword);
  const intro = firstParagraph(body);
  const headings = extractHeadings(body);

  const keywordInTitle =
    normalizedKeyword.length > 0 &&
    (normalizeForSearch(title).includes(normalizedKeyword) ||
      normalizeForSearch(seoTitle).includes(normalizedKeyword));
  const keywordInIntro =
    normalizedKeyword.length > 0 && normalizeForSearch(intro).includes(normalizedKeyword);
  const keywordInHeadings =
    normalizedKeyword.length > 0 && headings.some((h) => normalizeForSearch(h).includes(normalizedKeyword));

  const answerFirstIntro =
    INTRO_SUMMARY_OR_HOOK_REGEX.test(intro) || /[?？]/.test(intro);
  const hasDefinition = /(?:とは|とは何か|定義)/.test(body);
  const faqCount = countFaq(body);
  const hasDataCitation = DATA_CITATION_REGEX.test(body) && YEAR_REGEX.test(body);
  const hasStructuredHeadings = headings.length >= 2;
  const hasQuoteFriendlyBullets = detectQuoteFriendlyBullets(body);
  const hasTable = hasTableMarkdown(body);

  const signals: SeoGeoSignals = {
    keywordInTitle,
    keywordInIntro,
    keywordInHeadings,
    answerFirstIntro,
    hasDefinition,
    faqCount,
    hasDataCitation,
    hasStructuredHeadings,
    hasQuoteFriendlyBullets,
    hasTable,
  };

  const requiredFaq = requiredFaqCount(platform);
  const chatgptSearch = evaluateChatgptSearchRules({
    platform,
    title,
    body,
    seoTitle,
  });

  let seoScore = 100;
  if (!keywordInTitle) seoScore -= 25;
  if (!keywordInIntro) seoScore -= 15;
  if (!keywordInHeadings) seoScore -= 10;
  if (!hasStructuredHeadings) seoScore -= 15;
  if (!hasDefinition) seoScore -= 10;
  if (!hasDataCitation) seoScore -= 10;
  if (faqCount < requiredFaq) seoScore -= 15;

  let geoScore = 100;
  if (!answerFirstIntro) geoScore -= 12;
  if (faqCount < requiredFaq) geoScore -= 20;
  if (!hasDataCitation) geoScore -= 15;
  if (!hasQuoteFriendlyBullets) geoScore -= 15;
  if (!hasStructuredHeadings) geoScore -= 15;
  if (!keywordInIntro) geoScore -= 10;

  seoScore = clampScore(seoScore);
  geoScore = clampScore(geoScore);

  const issues: string[] = [];
  const strengths: string[] = [];

  if (!keywordInTitle) issues.push("主关键词未自然出现在标题/SEO标题");
  if (!keywordInIntro) issues.push("开头段落未覆盖主关键词");
  if (!keywordInHeadings) issues.push("H2/H3 未覆盖主关键词");
  if (!hasStructuredHeadings) issues.push("正文结构化不足（H2/H3 不足）");
  if (!hasDefinition) issues.push("缺少“〜とは”定义段落");
  if (faqCount < requiredFaq)
    issues.push(`FAQ 数量不足（当前 ${faqCount}，要求 ${requiredFaq}）`);
  if (!answerFirstIntro) issues.push("开头缺少可读钩子或摘要句");
  if (!hasDataCitation) issues.push("缺少带年份的统计/机构引用");
  if (!hasQuoteFriendlyBullets) issues.push("缺少可引用的要点列表（bullet）");
  if (trackedUrl && !body.includes(trackedUrl)) issues.push("正文未包含目标导流 URL");

  for (const item of chatgptSearch.issues) {
    issues.push(`ChatGPT搜索: ${item}`);
  }

  if (keywordInTitle) strengths.push("关键词已进入标题层");
  if (keywordInIntro) strengths.push("开头已覆盖关键词并具备检索相关性");
  if (answerFirstIntro) strengths.push("开头具备可读钩子/摘要，利于检索与停留");
  if (hasStructuredHeadings) strengths.push("结构化层级清晰（H2/H3）");
  if (faqCount >= requiredFaq) strengths.push(`FAQ 覆盖达标（${faqCount} 条）`);
  if (hasDataCitation) strengths.push("包含统计/机构引用，利于可信度与GEO抽取");
  if (hasQuoteFriendlyBullets) strengths.push("有可引用的要点列表，便于AI摘要抽取");
  for (const item of chatgptSearch.strengths) {
    strengths.push(`ChatGPT搜索: ${item}`);
  }
  strengths.push("平台格式要求满足");

  return {
    passed: seoScore >= PASS_SCORE_THRESHOLD && geoScore >= PASS_SCORE_THRESHOLD,
    seoScore,
    geoScore,
    chatgptSearchScore: chatgptSearch.score,
    chatgptSearchPassed: chatgptSearch.passed,
    chatgptSearchIssues: chatgptSearch.issues,
    chatgptSearchStrengths: chatgptSearch.strengths,
    chatgptSearchSignals: chatgptSearch.signals,
    primaryKeyword,
    issues,
    strengths,
    signals,
    fullThresholdPassed:
      seoScore >= PASS_SCORE_THRESHOLD &&
      geoScore >= PASS_SCORE_THRESHOLD &&
      chatgptSearch.score >= PASS_SCORE_THRESHOLD,
    aiStatus: "fallback",
    aiSummaryChinese: "AI评审暂不可用，当前为规则评估结果",
    aiActionsChinese: [],
  };
}
