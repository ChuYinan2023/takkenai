import type { Platform } from "./topic-engine";

export interface ChatgptSearchSignals {
  answerFirstIntro: boolean;
  sourceFactCount: number;
  citationReadySentenceCount: number;
  entityDefinitionPresent: boolean;
  freshnessSafe: boolean;
  noOverclaim: boolean;
  structureExtractable: boolean;
}

export interface ChatgptSearchReport {
  passed: boolean;
  score: number;
  issues: string[];
  strengths: string[];
  signals: ChatgptSearchSignals;
}

export interface EvaluateChatgptSearchInput {
  platform: Platform;
  title: string;
  body: string;
  seoTitle?: string;
}

const DATA_SOURCE_REGEX =
  /(出典|調査|統計|データ|公表|発表|白書|資料|レポート|国土交通省|総務省|厚生労働省|金融庁|内閣府|消費者庁|国税庁|日銀|不動産流通推進センター|全宅連)/;
const YEAR_REGEX =
  /(?:(?:19|20)\d{2}年?|(?:19|20)\d{2}年度|令和\d+年?|令和\d+年度|平成\d+年?|平成\d+年度|昭和\d+年?|昭和\d+年度)/;
const NUMBER_REGEX =
  /(?:\d+(?:\.\d+)?\s*(?:%|％|倍|件|人|社|棟|戸|万円|円|ポイント|pt|万|億|千))/;
const INTRO_ANSWER_REGEX =
  /(?:結論|先に結論|要点|本記事では|この記事では|まず結論|最初に結論|実は|意外|見落としがち|なぜ|どうして|ポイント|鍵|コツ|最短で|先に答え)/;
const OVERCLAIM_REGEX =
  /(絶対合格|必ず受かる|必ず稼げる|100%\s*(合格|稼げる|儲かる)|確実に儲かる|元本保証|放置で稼げる|誰でも簡単に稼げる|今すぐやらないと損|見ないと危険)/;
const URL_REGEX = /https?:\/\/[^\s)）]+/g;
const FAQ_LINE_REGEX = /^\s*(?:\*\*)?Q(?:[0-9０-９]+(?:[.．:：])?|[:：])\s*/gim;

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function requiredFaqCount(platform: Platform): number {
  if (platform === "ameba") return 1;
  return 2;
}

function firstParagraph(text: string): string {
  const lines = (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  return lines.slice(0, 3).join(" ");
}

function extractHeadings(body: string): string[] {
  return (body.match(/^##+\s+.+$/gm) || []).map((line) =>
    line.replace(/^##+\s+/, "").trim()
  );
}

function countFaq(body: string): number {
  const headingFaq = (body.match(/^##+\s*(?:FAQ|よくある質問|Q&A|Q＆A)/gim) || [])
    .length;
  const qLineFaq = (body.match(FAQ_LINE_REGEX) || []).length;
  return Math.max(headingFaq, qLineFaq);
}

function countBullets(body: string): number {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)).length;
}

function countSourceFacts(body: string): number {
  const lines = body.split(/\r?\n/);
  let count = 0;
  for (const line of lines) {
    const cleaned = line.replace(URL_REGEX, " ").trim();
    if (!cleaned) continue;
    if (
      DATA_SOURCE_REGEX.test(cleaned) &&
      YEAR_REGEX.test(cleaned) &&
      NUMBER_REGEX.test(cleaned)
    ) {
      count += 1;
    }
  }
  return count;
}

function countCitationReadySentences(body: string): number {
  const rawSentences = body
    .split(/\r?\n/)
    .flatMap((line) => line.split(/[。！？!?]/))
    .map((part) => part.trim())
    .filter(Boolean);

  let count = 0;
  for (const sentence of rawSentences) {
    if (/^#{1,6}\s+/.test(sentence)) continue;
    if (/^[-*]\s+/.test(sentence) || /^\d+\.\s+/.test(sentence)) continue;
    if (URL_REGEX.test(sentence)) continue;

    const length = sentence.length;
    if (length < 22 || length > 120) continue;
    if (!/[\u3040-\u30ff\u3400-\u9fff]/.test(sentence)) continue;
    count += 1;
  }
  return count;
}

function isHistoricalYearSafe(body: string): boolean {
  const lines = body.split(/\r?\n/);
  const referenceYear = new Date().getFullYear();

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] || "").replace(URL_REGEX, " ");
    const yearMatches = line.match(/(?:19|20)\d{2}/g) || [];
    if (yearMatches.length === 0) continue;

    const historicalYears = yearMatches
      .map((item) => Number(item))
      .filter((year) => Number.isFinite(year) && year < referenceYear);
    if (historicalYears.length === 0) continue;

    const context = [lines[i - 1] || "", lines[i] || "", lines[i + 1] || ""].join(
      " "
    );
    if (!DATA_SOURCE_REGEX.test(context)) {
      return false;
    }
  }
  return true;
}

export function evaluateChatgptSearchRules(
  input: EvaluateChatgptSearchInput
): ChatgptSearchReport {
  const { platform, title, body, seoTitle = "" } = input;
  const intro = firstParagraph(body);
  const headings = extractHeadings(body);
  const faqCount = countFaq(body);
  const bulletCount = countBullets(body);

  const answerFirstIntro =
    INTRO_ANSWER_REGEX.test(intro) || /[?？]/.test(intro) || intro.length >= 40;
  const sourceFactCount = countSourceFacts(body);
  const citationReadySentenceCount = countCitationReadySentences(body);
  const entityDefinitionPresent = /(?:とは|とは何か|定義)/.test(body);
  const freshnessSafe = isHistoricalYearSafe(body);
  const noOverclaim = !OVERCLAIM_REGEX.test(`${title}\n${seoTitle}\n${body}`);
  const structureExtractable =
    headings.length >= 2 &&
    faqCount >= requiredFaqCount(platform) &&
    bulletCount >= 2;

  const signals: ChatgptSearchSignals = {
    answerFirstIntro,
    sourceFactCount,
    citationReadySentenceCount,
    entityDefinitionPresent,
    freshnessSafe,
    noOverclaim,
    structureExtractable,
  };

  let score = 100;
  if (!answerFirstIntro) score -= 20;
  if (sourceFactCount === 0) score -= 25;
  else if (sourceFactCount === 1) score -= 15;
  if (citationReadySentenceCount < 3) score -= 15;
  if (!entityDefinitionPresent) score -= 10;
  if (!freshnessSafe) score -= 15;
  if (!noOverclaim) score -= 20;
  if (!structureExtractable) score -= 15;
  score = clampScore(score);

  const issues: string[] = [];
  const strengths: string[] = [];

  if (!answerFirstIntro) {
    issues.push("开头未先回答核心问题（answer-first不足）");
  } else {
    strengths.push("开头具备 answer-first 结构");
  }

  if (sourceFactCount < 2) {
    issues.push(`机构+年份+数值证据不足（当前 ${sourceFactCount}，建议 >=2）`);
  } else {
    strengths.push(`证据句达标（机构+年份+数值 ${sourceFactCount} 条）`);
  }

  if (citationReadySentenceCount < 3) {
    issues.push(
      `可独立引用短句不足（当前 ${citationReadySentenceCount}，建议 >=3）`
    );
  } else {
    strengths.push("可引用短句充足，利于 ChatGPT 引用提取");
  }

  if (!entityDefinitionPresent) {
    issues.push("缺少“〜とは/定义”说明段落");
  } else {
    strengths.push("包含定义段落，利于语义对齐");
  }

  if (!freshnessSafe) {
    issues.push("存在历史年份但缺少引用语境");
  } else {
    strengths.push("时效表达安全（历史年份仅在引用语境出现）");
  }

  if (!noOverclaim) {
    issues.push("存在绝对化/夸张表达，影响可信度");
  } else {
    strengths.push("措辞克制，无夸张承诺");
  }

  if (!structureExtractable) {
    issues.push("结构可抽取性不足（H2/H3、FAQ或要点列表不完整）");
  } else {
    strengths.push("结构化良好，便于摘要抽取");
  }

  return {
    passed: score >= 85,
    score,
    issues,
    strengths,
    signals,
  };
}
